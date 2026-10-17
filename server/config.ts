import { z } from 'zod';

export interface Config {
  databaseUrl: string;
  s3Bucket: string;
  s3Region: string;
  kioskKeyHashes: string[];
  slackFallbackUrl?: string;
  teamsFallbackUrl?: string;
  port: number;
}

const REQUIRED = ['DATABASE_URL', 'S3_BUCKET', 'S3_REGION', 'KIOSK_KEY_HASHES'] as const;

const nonEmpty = z.string().trim().min(1);

/** Parse and validate the environment; throws one error naming every missing or invalid variable. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const problems: string[] = [];
  for (const k of REQUIRED) if (!env[k]?.trim()) problems.push(`${k} is required`);

  let port = 3000;
  if (env.PORT !== undefined && env.PORT !== '') {
    const p = z.coerce.number().int().min(1).max(65535).safeParse(env.PORT);
    if (p.success) port = p.data;
    else problems.push('PORT must be an integer between 1 and 65535');
  }

  const hashes = (env.KIOSK_KEY_HASHES ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  if (env.KIOSK_KEY_HASHES?.trim() && hashes.length === 0) problems.push('KIOSK_KEY_HASHES has no hashes');

  if (problems.length) throw new Error(`Invalid configuration: ${problems.join('; ')}`);

  const opt = (v: string | undefined) => (v && nonEmpty.safeParse(v).success ? v.trim() : undefined);
  return {
    databaseUrl: env.DATABASE_URL!.trim(),
    s3Bucket: env.S3_BUCKET!.trim(),
    s3Region: env.S3_REGION!.trim(),
    kioskKeyHashes: hashes,
    slackFallbackUrl: opt(env.SLACK_FALLBACK_WEBHOOK),
    teamsFallbackUrl: opt(env.TEAMS_FALLBACK_WEBHOOK),
    port,
  };
}
