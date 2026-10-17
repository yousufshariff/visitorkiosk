import { describe, expect, it, vi } from 'vitest';
import { MemoryPhotoStore, parseJpegDataUrl, PhotoError, S3PhotoStore } from './photos';

const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);
const jpegUrl = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;

function rejection(fn: () => unknown): PhotoError {
  try {
    fn();
  } catch (e) {
    return e as PhotoError;
  }
  throw new Error('expected PhotoError');
}

describe('parseJpegDataUrl', () => {
  it('returns the decoded bytes of a jpeg data URL', () => {
    expect(parseJpegDataUrl(jpegUrl).equals(jpegBytes)).toBe(true);
  });
  it('rejects a png data URL', () => {
    const e = rejection(() => parseJpegDataUrl(`data:image/png;base64,${jpegBytes.toString('base64')}`));
    expect(e).toBeInstanceOf(PhotoError);
    expect([e.status, e.code]).toEqual([400, 'invalid_photo']);
  });
  it('rejects invalid base64', () => {
    expect(rejection(() => parseJpegDataUrl('data:image/jpeg;base64,@@@not base64!!')).code).toBe('invalid_photo');
  });
  it('rejects bytes without the jpeg magic number', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    expect(rejection(() => parseJpegDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`)).code).toBe('invalid_photo');
  });
  it('rejects more than 2 MB decoded with 413', () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024)]);
    const e = rejection(() => parseJpegDataUrl(`data:image/jpeg;base64,${big.toString('base64')}`));
    expect([e.status, e.code]).toEqual([413, 'photo_too_large']);
  });
  it('accepts exactly 2 MB', () => {
    const edge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024 - 3)]);
    expect(parseJpegDataUrl(`data:image/jpeg;base64,${edge.toString('base64')}`).length).toBe(2 * 1024 * 1024);
  });
});

describe('MemoryPhotoStore', () => {
  it('stores the bytes under a visits/ key and returns a memory:// url', async () => {
    const s = new MemoryPhotoStore();
    const r = await s.put('visits', jpegUrl);
    expect(r.key).toMatch(/^visits\/[0-9a-f-]{36}\.jpg$/);
    expect(r.url).toBe(`memory://${r.key}`);
    expect(s.objects.get(r.key)?.equals(jpegBytes)).toBe(true);
  });
  it('writes nothing for an invalid photo', async () => {
    const s = new MemoryPhotoStore();
    await expect(s.put('visits', 'data:text/plain;base64,aGk=')).rejects.toBeInstanceOf(PhotoError);
    expect(s.objects.size).toBe(0);
  });
});

describe('S3PhotoStore', () => {
  const make = () => {
    const send = vi.fn(async () => ({}));
    const presign = vi.fn(async () => 'https://s3.test/signed');
    const store = new S3PhotoStore({ client: { send } as never, bucket: 'bkt', presign: presign as never });
    return { send, presign, store };
  };
  it('puts a jpeg object and returns a 7-day presigned url', async () => {
    const { send, presign, store } = make();
    const r = await store.put('deliveries', jpegUrl);
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = (send.mock.calls[0] as unknown as [{ input: Record<string, unknown> }])[0];
    expect(cmd.input).toMatchObject({ Bucket: 'bkt', ContentType: 'image/jpeg' });
    expect(cmd.input.Key).toMatch(/^deliveries\/[0-9a-f-]{36}\.jpg$/);
    expect((cmd.input.Body as Buffer).equals(jpegBytes)).toBe(true);
    expect(presign).toHaveBeenCalledTimes(1);
    expect((presign.mock.calls[0] as unknown as [unknown, unknown, { expiresIn: number }])[2]).toEqual({ expiresIn: 604800 });
    expect(r).toEqual({ key: cmd.input.Key, url: 'https://s3.test/signed' });
  });
  it('makes no S3 call for a rejected photo', async () => {
    const { send, store } = make();
    await expect(store.put('visits', 'data:image/png;base64,AAAA')).rejects.toBeInstanceOf(PhotoError);
    expect(send).not.toHaveBeenCalled();
  });
});
