import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const full = {
  DATABASE_URL: 'postgres://u@h/db',
  S3_BUCKET: 'b',
  S3_REGION: 'us-west-2',
  KIOSK_KEY_HASHES: 'aaa, bbb',
};

describe('loadConfig', () => {
  it('parses a full env and defaults port to 3000', () => {
    const c = loadConfig(full);
    expect(c).toMatchObject({ databaseUrl: 'postgres://u@h/db', s3Bucket: 'b', s3Region: 'us-west-2', port: 3000 });
    expect(c.slackFallbackUrl).toBeUndefined();
  });
  it('splits and trims KIOSK_KEY_HASHES', () => {
    expect(loadConfig(full).kioskKeyHashes).toEqual(['aaa', 'bbb']);
  });
  it('reads optional fallback webhooks and PORT', () => {
    const c = loadConfig({ ...full, PORT: '8080', SLACK_FALLBACK_WEBHOOK: 'https://s', TEAMS_FALLBACK_WEBHOOK: 'https://t' });
    expect(c).toMatchObject({ port: 8080, slackFallbackUrl: 'https://s', teamsFallbackUrl: 'https://t' });
  });
  it('names every missing required variable at once', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL.*S3_BUCKET.*S3_REGION.*KIOSK_KEY_HASHES/s);
  });
  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ ...full, PORT: 'abc' })).toThrow(/PORT/);
  });
});
