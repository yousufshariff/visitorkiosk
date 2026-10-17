import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSlackDeliveryPayload,
  buildSlackVisitorPayload,
  buildTeamsDeliveryPayload,
  buildTeamsVisitorPayload,
  escapeSlack,
  notifyDelivery,
  notifyVisitorArrival,
  postWebhook,
} from './notifications';
import type { DeliveryArrival, VisitorArrival } from '../shared/types';

const visitor: VisitorArrival = {
  visitorName: 'Vic Visitor',
  company: 'Acme',
  hostName: 'Hana Host',
  purpose: 'Interview',
  arrivedAt: new Date('2026-10-16T15:00:00Z'),
};

const delivery: DeliveryArrival = {
  carrier: 'UPS',
  type: 'package',
  recipientName: 'Hana Host',
  receivedAt: new Date('2026-10-16T15:00:00Z'),
};

const ok = () => new Response('ok', { status: 200 });
const fetchMock = (impl?: (...a: Parameters<typeof fetch>) => Promise<Response>) =>
  vi.fn(impl ?? (async () => ok())) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('escapeSlack', () => {
  it('escapes &, < and > so <!channel> cannot ping', () => {
    expect(escapeSlack('<!channel> & x')).toBe('&lt;!channel&gt; &amp; x');
  });
});

describe('Slack visitor payload', () => {
  it('has a header block first and a section with fields', () => {
    const p = buildSlackVisitorPayload(visitor, {});
    expect(p.blocks[0]?.type).toBe('header');
    const fieldsSection = p.blocks.find((b) => b.type === 'section' && 'fields' in b);
    expect(fieldsSection).toBeDefined();
  });

  it('adds an image accessory when photoUrl is set and none when it is not', () => {
    const withPhoto = buildSlackVisitorPayload({ ...visitor, photoUrl: 'https://img.test/a.jpg' }, {});
    const accessories = withPhoto.blocks.flatMap((b) => ('accessory' in b && b.accessory ? [b.accessory] : []));
    expect(accessories).toEqual([expect.objectContaining({ type: 'image', image_url: 'https://img.test/a.jpg' })]);

    const without = buildSlackVisitorPayload(visitor, {});
    expect(without.blocks.some((b) => 'accessory' in b && b.accessory)).toBe(false);
  });

  it('never emits a raw <!channel> from visitor-supplied text', () => {
    const p = buildSlackVisitorPayload({ ...visitor, visitorName: '<!channel>', company: '<!here> & co' }, {});
    expect(JSON.stringify(p)).not.toContain('<!channel>');
    expect(JSON.stringify(p)).not.toContain('<!here>');
  });

  it('mentions the host in fallback text when slackUserId is valid, and ignores a malformed one', () => {
    expect(buildSlackVisitorPayload(visitor, { slackUserId: 'U123ABC' }).text).toContain('<@U123ABC>');
    expect(buildSlackVisitorPayload(visitor, { slackUserId: '<!channel>' }).text).not.toContain('<!channel>');
  });

  it('truncates the header to 150 chars and every field to <= 2000', () => {
    const p = buildSlackVisitorPayload({ ...visitor, visitorName: 'x'.repeat(400), company: 'c'.repeat(5000) }, {});
    const header = p.blocks[0];
    expect(header?.type === 'header' && header.text.text.length).toBeLessThanOrEqual(150);
    for (const b of p.blocks) {
      if (b.type === 'section' && 'fields' in b && b.fields) {
        for (const f of b.fields) expect(f.text.length).toBeLessThanOrEqual(2000);
      }
    }
  });
});

describe('Teams visitor payload', () => {
  it('is a message with one adaptive card attachment', () => {
    const p = buildTeamsVisitorPayload(visitor);
    expect(p.type).toBe('message');
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0]?.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(p.attachments[0]?.content.type).toBe('AdaptiveCard');
  });

  it('includes an Image element only when photoUrl is set', () => {
    const body = (u: VisitorArrival) => JSON.stringify(buildTeamsVisitorPayload(u).attachments[0]?.content.body);
    expect(body({ ...visitor, photoUrl: 'https://img.test/a.jpg' })).toContain('"type":"Image"');
    expect(body(visitor)).not.toContain('"type":"Image"');
  });

  it('escapes markdown so a visitor cannot inject a link', () => {
    const p = buildTeamsVisitorPayload({ ...visitor, visitorName: '[click](http://evil.test)' });
    expect(JSON.stringify(p)).not.toContain('[click](');
  });
});

describe('delivery payloads', () => {
  it('Slack header names the carrier and fields include type and recipient', () => {
    const p = buildSlackDeliveryPayload(delivery, {});
    const header = p.blocks[0];
    expect(header?.type === 'header' && header.text.text).toContain('UPS');
    const json = JSON.stringify(p);
    expect(json).toContain('package');
    expect(json).toContain('Hana Host');
  });

  it('Teams delivery is an adaptive card message', () => {
    const p = buildTeamsDeliveryPayload(delivery);
    expect(p.type).toBe('message');
    expect(p.attachments[0]?.content.type).toBe('AdaptiveCard');
    expect(JSON.stringify(p)).toContain('UPS');
  });
});

describe('postWebhook', () => {
  it('retries once on a 5xx and then succeeds', async () => {
    const f = fetchMock();
    (f as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(ok());
    await expect(postWebhook('https://h.test/x', { a: 1 }, f)).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx', async () => {
    const f = fetchMock(async () => new Response('nope', { status: 404 }));
    await expect(postWebhook('https://h.test/x', {}, f)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('aborts a hanging request after 5000 ms, retries once, then rejects', async () => {
    vi.useFakeTimers();
    const f = fetchMock(
      (_url, init) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
    );
    const assertion = expect(postWebhook('https://h.test/x', {}, f)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });
});

describe('notifyVisitorArrival / notifyDelivery', () => {
  it('uses the host webhook in preference to the fallback', async () => {
    const f = fetchMock();
    await notifyVisitorArrival(
      visitor,
      { slackWebhookUrl: 'https://slack.test/host' },
      { fallbackSlackUrl: 'https://slack.test/fallback', fetchImpl: f },
    );
    expect(f).toHaveBeenCalledTimes(1);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('https://slack.test/host');
  });

  it('posts to both Slack and Teams when both are configured', async () => {
    const f = fetchMock();
    await notifyVisitorArrival(visitor, { slackWebhookUrl: 'https://slack.test/h', teamsWebhookUrl: 'https://teams.test/h' }, { fetchImpl: f });
    const bodies = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies).toHaveLength(2);
    expect(bodies.some((b) => Array.isArray(b.blocks))).toBe(true);
    expect(bodies.some((b) => b.type === 'message')).toBe(true);
  });

  it('falls back to the global webhooks when the host has none', async () => {
    const f = fetchMock();
    await notifyDelivery(delivery, {}, { fallbackTeamsUrl: 'https://teams.test/fallback', fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('a host with only a personal Teams webhook is not also broadcast to the global Slack channel', async () => {
    const f = fetchMock();
    await notifyVisitorArrival(
      visitor,
      { teamsWebhookUrl: 'https://teams.test/mine' },
      { fallbackSlackUrl: 'https://slack.test/global', fetchImpl: f },
    );
    const urls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(urls).toEqual(['https://teams.test/mine']);
  });

  it('makes no requests and resolves when nothing is configured', async () => {
    const f = fetchMock();
    await expect(notifyVisitorArrival(visitor, {}, { fetchImpl: f })).resolves.toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it('resolves after exactly two attempts per webhook when every request fails', async () => {
    const f = fetchMock(async () => {
      throw new Error('network down');
    });
    await expect(
      notifyVisitorArrival(visitor, { slackWebhookUrl: 'https://slack.test/h', teamsWebhookUrl: 'https://teams.test/h' }, { fetchImpl: f }),
    ).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('resolves even when the payload cannot be built (invalid arrivedAt)', async () => {
    const f = fetchMock();
    await expect(
      notifyVisitorArrival({ ...visitor, arrivedAt: new Date(NaN) }, { slackWebhookUrl: 'https://slack.test/h' }, { fetchImpl: f }),
    ).resolves.toBeUndefined();
  });

  it('notifyDelivery also never throws', async () => {
    const f = fetchMock(async () => new Response('x', { status: 500 }));
    await expect(notifyDelivery(delivery, { slackWebhookUrl: 'https://slack.test/h' }, { fetchImpl: f })).resolves.toBeUndefined();
  });
});
