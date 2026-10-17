import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotifier } from './notifier';

const visitor = { visitorName: 'Vic', hostName: 'Hana', arrivedAt: new Date('2026-10-17T10:00:00Z') };

afterEach(() => vi.restoreAllMocks());

describe('createNotifier', () => {
  it('returns synchronously, before a slow webhook finishes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = vi.fn(async () => {
      await gate;
      return new Response('ok');
    }) as unknown as typeof fetch;
    const n = createNotifier({ fetchImpl });
    const ret = n.visitor(visitor, { slackWebhookUrl: 'https://slack.test/h' });
    expect(ret).toBeUndefined();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    release();
  });

  it('a failing webhook produces no unhandled rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const fetchImpl = vi.fn(async () => new Response('x', { status: 400 })) as unknown as typeof fetch;
    createNotifier({ fetchImpl }).delivery(
      { carrier: 'UPS', type: 'package', recipientName: 'Hana', receivedAt: new Date() },
      { teamsWebhookUrl: 'https://teams.test/h' },
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('uses the fallback webhook when the host has none', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok')) as unknown as typeof fetch;
    createNotifier({ fetchImpl, fallbackSlackUrl: 'https://slack.test/global' }).visitor(visitor, {});
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('https://slack.test/global');
  });
});
