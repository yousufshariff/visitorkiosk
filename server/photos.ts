import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type PhotoKind = 'visits' | 'deliveries';

export interface PhotoStore {
  put(kind: PhotoKind, dataUrl: string): Promise<{ key: string; url: string }>;
}

export class PhotoError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: 'invalid_photo' | 'photo_too_large',
    message: string,
  ) {
    super(message);
  }
}

const MAX_BYTES = 2 * 1024 * 1024;
const PREFIX = 'data:image/jpeg;base64,';
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
export const PRESIGN_SECONDS = 7 * 24 * 60 * 60;

/** Decode a `data:image/jpeg;base64,...` URL, enforcing type, magic bytes and the 2 MB cap. */
export function parseJpegDataUrl(dataUrl: string): Buffer {
  if (!dataUrl.startsWith(PREFIX)) throw new PhotoError(400, 'invalid_photo', 'The photo must be a JPEG image.');
  const b64 = dataUrl.slice(PREFIX.length);
  if (b64.length % 4 !== 0 || !BASE64.test(b64)) throw new PhotoError(400, 'invalid_photo', 'The photo could not be read.');
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  if ((b64.length / 4) * 3 - pad > MAX_BYTES) throw new PhotoError(413, 'photo_too_large', 'The photo is too large.');
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new PhotoError(400, 'invalid_photo', 'The photo must be a JPEG image.');
  }
  return bytes;
}

export class MemoryPhotoStore implements PhotoStore {
  readonly objects = new Map<string, Buffer>();
  async put(kind: PhotoKind, dataUrl: string): Promise<{ key: string; url: string }> {
    const bytes = parseJpegDataUrl(dataUrl);
    const key = `${kind}/${randomUUID()}.jpg`;
    this.objects.set(key, bytes);
    return { key, url: `memory://${key}` };
  }
}

export class S3PhotoStore implements PhotoStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly presign: typeof getSignedUrl;
  constructor(opts: { client: S3Client; bucket: string; presign?: typeof getSignedUrl }) {
    this.client = opts.client;
    this.bucket = opts.bucket;
    this.presign = opts.presign ?? getSignedUrl;
  }
  async put(kind: PhotoKind, dataUrl: string): Promise<{ key: string; url: string }> {
    const body = parseJpegDataUrl(dataUrl);
    const key = `${kind}/${randomUUID()}.jpg`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: 'image/jpeg' }));
    const url = await this.presign(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: PRESIGN_SECONDS });
    return { key, url };
  }
}
