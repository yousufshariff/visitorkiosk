import type { DeliveryArrival, NotificationTarget, VisitorArrival } from '../shared/types';

// ───────── Types ─────────
export interface SlackImageAccessory {
  type: 'image';
  image_url: string;
  alt_text: string;
}
export interface SlackHeaderBlock {
  type: 'header';
  text: { type: 'plain_text'; text: string; emoji: false };
}
export interface SlackSectionBlock {
  type: 'section';
  fields: { type: 'plain_text'; text: string }[];
  accessory?: SlackImageAccessory;
}
export type SlackBlock = SlackHeaderBlock | SlackSectionBlock;
export interface SlackPayload {
  /** Fallback text for notifications; mrkdwn, so everything in it is escaped. */
  text: string;
  blocks: SlackBlock[];
}

export interface TeamsFact {
  title: string;
  value: string;
}
export type TeamsCardElement =
  | { type: 'TextBlock'; text: string; weight?: 'Bolder'; size?: 'Large'; wrap: true }
  | { type: 'FactSet'; facts: TeamsFact[] }
  | { type: 'Image'; url: string; altText: string; size: 'Large' };
export interface TeamsAdaptiveCard {
  $schema: string;
  type: 'AdaptiveCard';
  version: '1.4';
  body: TeamsCardElement[];
}
export interface TeamsPayload {
  type: 'message';
  attachments: {
    contentType: 'application/vnd.microsoft.card.adaptive';
    contentUrl: null;
    content: TeamsAdaptiveCard;
  }[];
}

export interface NotifyOptions {
  fallbackSlackUrl?: string;
  fallbackTeamsUrl?: string;
  fetchImpl?: typeof fetch;
}

// ───────── Limits ─────────
const WEBHOOK_TIMEOUT_MS = 5_000;
const SLACK_HEADER_MAX = 150;
const SLACK_FIELD_MAX = 2_000;
const VALUE_MAX = 300;

// ───────── Text helpers ─────────
function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max - 1).join('') + '…';
}

/** Escape text for Slack mrkdwn (only &, < and > are control characters). */
export function escapeSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Visitor-supplied text for plain_text fields: collapse whitespace and swap < > for inert look-alikes. */
function plain(s: string, max = VALUE_MAX): string {
  return truncate(s.replace(/\s+/g, ' ').trim().replace(/</g, '‹').replace(/>/g, '›'), max);
}

/** Backslash-escape Adaptive Card TextBlock markdown. */
function escapeTeams(s: string): string {
  return truncate(s.replace(/\s+/g, ' ').trim(), VALUE_MAX).replace(/[\\*_[\]`<>]/g, (c) => `\\${c}`);
}

function whenUtc(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function mention(t: NotificationTarget): string {
  return t.slackUserId && /^[UW][A-Z0-9]{2,}$/.test(t.slackUserId) ? `<@${t.slackUserId}> ` : '';
}

function slackField(label: string, value: string): { type: 'plain_text'; text: string } {
  return { type: 'plain_text', text: truncate(`${label}\n${plain(value)}`, SLACK_FIELD_MAX) };
}

// ───────── Slack builders ─────────
function slackPayload(
  headline: string,
  fallback: string,
  fields: [string, string][],
  photoUrl: string | undefined,
  altText: string,
): SlackPayload {
  const section: SlackSectionBlock = {
    type: 'section',
    fields: fields.map(([label, value]) => slackField(label, value)),
  };
  if (photoUrl) section.accessory = { type: 'image', image_url: photoUrl, alt_text: plain(altText, 100) };
  return {
    text: fallback,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: truncate(plain(headline, 1_000), SLACK_HEADER_MAX), emoji: false } },
      section,
    ],
  };
}

export function buildSlackVisitorPayload(a: VisitorArrival, t: NotificationTarget): SlackPayload {
  const fields: [string, string][] = [['Visitor', a.visitorName]];
  if (a.company) fields.push(['Company', a.company]);
  fields.push(['Host', a.hostName]);
  if (a.purpose) fields.push(['Purpose', a.purpose]);
  fields.push(['Arrived', whenUtc(a.arrivedAt)]);
  const fallback = truncate(
    `${mention(t)}${escapeSlack(a.visitorName)}${a.company ? ` from ${escapeSlack(a.company)}` : ''} is here to see ${escapeSlack(a.hostName)}`,
    SLACK_FIELD_MAX,
  );
  return slackPayload(`Visitor arrived: ${a.visitorName}`, fallback, fields, a.photoUrl, `Photo of ${a.visitorName}`);
}

export function buildSlackDeliveryPayload(d: DeliveryArrival, t: NotificationTarget): SlackPayload {
  const fields: [string, string][] = [
    ['Carrier', d.carrier],
    ['Type', d.type],
    ['For', d.recipientName],
    ['Received', whenUtc(d.receivedAt)],
  ];
  const fallback = truncate(`${mention(t)}${escapeSlack(d.carrier)} ${d.type} for ${escapeSlack(d.recipientName)} is at reception`, SLACK_FIELD_MAX);
  return slackPayload(`Delivery from ${d.carrier}`, fallback, fields, d.photoUrl, `Photo of ${d.type}`);
}

// ───────── Teams builders ─────────
function teamsPayload(title: string, facts: TeamsFact[], photoUrl: string | undefined, altText: string): TeamsPayload {
  const body: TeamsCardElement[] = [
    { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Large', wrap: true },
    { type: 'FactSet', facts },
  ];
  if (photoUrl) body.push({ type: 'Image', url: photoUrl, altText, size: 'Large' });
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body },
      },
    ],
  };
}

export function buildTeamsVisitorPayload(a: VisitorArrival): TeamsPayload {
  const facts: TeamsFact[] = [{ title: 'Visitor', value: escapeTeams(a.visitorName) }];
  if (a.company) facts.push({ title: 'Company', value: escapeTeams(a.company) });
  facts.push({ title: 'Host', value: escapeTeams(a.hostName) });
  if (a.purpose) facts.push({ title: 'Purpose', value: escapeTeams(a.purpose) });
  facts.push({ title: 'Arrived', value: whenUtc(a.arrivedAt) });
  return teamsPayload('Visitor arrived', facts, a.photoUrl, 'Visitor photo');
}

export function buildTeamsDeliveryPayload(d: DeliveryArrival): TeamsPayload {
  const facts: TeamsFact[] = [
    { title: 'Carrier', value: escapeTeams(d.carrier) },
    { title: 'Type', value: d.type },
    { title: 'For', value: escapeTeams(d.recipientName) },
    { title: 'Received', value: whenUtc(d.receivedAt) },
  ];
  return teamsPayload(`Delivery from ${escapeTeams(d.carrier)}`, facts, d.photoUrl, 'Delivery photo');
}

// ───────── Transport ─────────
class WebhookError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** POST JSON; 5 s timeout per attempt; one retry on network error, timeout or 5xx; 4xx fails immediately. */
export async function postWebhook(url: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.ok) return;
      if (res.status < 500) throw new WebhookError(`webhook responded ${res.status}`, false);
      last = new WebhookError(`webhook responded ${res.status}`, true);
    } catch (e) {
      if (e instanceof WebhookError && !e.retryable) throw e;
      last = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`webhook failed after retry: ${last instanceof Error ? last.message : String(last)}`);
}

// ───────── Dispatch ─────────
interface Job {
  channel: 'slack' | 'teams';
  url: string;
  body: unknown;
}

async function dispatch(jobs: Job[], fetchImpl: typeof fetch | undefined): Promise<void> {
  const results = await Promise.allSettled(jobs.map((j) => postWebhook(j.url, j.body, fetchImpl)));
  results.forEach((r, i) => {
    // Never log the URL: webhook URLs are secrets.
    if (r.status === 'rejected') console.error(`[notifications] ${jobs[i]?.channel} webhook failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
  });
}

async function notify(
  build: { slack: () => SlackPayload; teams: () => TeamsPayload },
  t: NotificationTarget,
  opts: NotifyOptions,
): Promise<void> {
  try {
    const jobs: Job[] = [];
    // The global webhooks are for hosts with no personal webhook at all; a host who set up
    // a personal channel must not have their visitors also broadcast to the shared one.
    const hasPersonal = Boolean(t.slackWebhookUrl || t.teamsWebhookUrl);
    const slack = t.slackWebhookUrl || (hasPersonal ? undefined : opts.fallbackSlackUrl);
    const teams = t.teamsWebhookUrl || (hasPersonal ? undefined : opts.fallbackTeamsUrl);
    if (slack) jobs.push({ channel: 'slack', url: slack, body: build.slack() });
    if (teams) jobs.push({ channel: 'teams', url: teams, body: build.teams() });
    await dispatch(jobs, opts.fetchImpl);
  } catch (e) {
    console.error('[notifications] could not send:', e instanceof Error ? e.message : e);
  }
}

/** Notify the host of a visitor arrival. Always resolves. */
export function notifyVisitorArrival(a: VisitorArrival, t: NotificationTarget, opts: NotifyOptions = {}): Promise<void> {
  return notify({ slack: () => buildSlackVisitorPayload(a, t), teams: () => buildTeamsVisitorPayload(a) }, t, opts);
}

/** Notify the recipient of a delivery. Always resolves. */
export function notifyDelivery(d: DeliveryArrival, t: NotificationTarget, opts: NotifyOptions = {}): Promise<void> {
  return notify({ slack: () => buildSlackDeliveryPayload(d, t), teams: () => buildTeamsDeliveryPayload(d) }, t, opts);
}
