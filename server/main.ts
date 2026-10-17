import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client } from '@aws-sdk/client-s3';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { createNotifier } from './notifier';
import { S3PhotoStore } from './photos';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const { db, pool } = createDb(config.databaseUrl);
  const app = buildApp({
    deps: {
      db,
      photos: new S3PhotoStore({ client: new S3Client({ region: config.s3Region, maxAttempts: 2, requestHandler: { connectionTimeout: 2_000, requestTimeout: 5_000 } }), bucket: config.s3Bucket }),
      notify: createNotifier({ fallbackSlackUrl: config.slackFallbackUrl, fallbackTeamsUrl: config.teamsFallbackUrl }),
    },
    keyHashes: config.kioskKeyHashes,
    staticDir: join(dirname(fileURLToPath(import.meta.url)), '../dist/client'),
  });

  const stop = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());

  await app.listen({ host: '0.0.0.0', port: config.port });
  console.log(`[server] listening on :${config.port}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
