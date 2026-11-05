jest.mock('react-native', () => ({ NativeModules: {}, Platform: { OS: 'ios' } }));

import { FeedpulseClient } from '../client';
import { MemoryConfigStore } from '../store';
import { CHALLENGE, CONFIG_BODY, FakeAttestor, FakeServer, FORM_ID, Fixture, fixtures, fx, json, NOW_MS, res, SESSION } from './helpers';

/** 契約 fixture（正本: lv-kit/feedpulse-web packages/shared/src/native/fixtures）を読んで、サーバーのモックとして使う。 */

const PK = 'pk_example';
const APP_ID = 'com.example.app';

function subst(v: any, map: Record<string, string>): any {
  if (typeof v === 'string') return Object.entries(map).reduce((s, [k, r]) => s.split(k).join(r), v);
  if (Array.isArray(v)) return v.map((x) => subst(x, map));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x, map)]));
  return v;
}

function build(platform: 'ios' | 'android', handlers: ConstructorParameters<typeof FakeServer>[0], attestation?: any) {
  const server = new FakeServer({
    'POST /v1/native/challenge': () => res(fx('challenge-ok').response),
    'POST /v1/native/session': () => res(fx('session-ok-play-integrity').response),
    ...handlers,
  });
  const attestor = new FakeAttestor({ platform, appId: APP_ID, os: 'TestOS 1', timezone: 'Asia/Tokyo' }, () => attestation ?? { type: 'play_integrity', token: 'integrity-token' });
  const sleeps: number[] = [];
  const client = new FeedpulseClient({
    publicKey: PK,
    baseUrl: 'https://ingest.example.test',
    transport: server,
    attestor,
    store: new MemoryConfigStore(),
    now: () => NOW_MS,
    sleep: async (ms) => void sleeps.push(ms),
    deviceContext: () => ({ os: 'Android 15', locale: 'ja-JP' }),
  });
  return { server, attestor, client, sleeps };
}

test('fixture はすべて読めて kind が既知', () => {
  expect(fixtures.length).toBeGreaterThan(10);
  const kinds = new Set(fixtures.map((f) => f.kind));
  expect([...kinds].sort()).toEqual(['attestation_failure', 'expired', 'rate_limited', 'success', 'validation_error']);
});

describe('POST /v1/native/session', () => {
  const sessionFixtures = fixtures.filter((f) => f.request.path === '/v1/native/session');
  test.each(sessionFixtures.map((f) => [f.name, f] as [string, Fixture]))('%s', async (_n, f) => {
    const body = subst(f.request.body, { '{{challenge}}': CHALLENGE, '{{expiredChallenge}}': CHALLENGE });
    let seen: any;
    const { client, server, attestor } = build(
      body.platform,
      {
        'POST /v1/native/session': (req) => {
          seen = JSON.parse(req.body!);
          return res(f.response);
        },
        'GET /v1/config': () => res(fx('config-ok').response),
      },
      body.attestation,
    );
    attestor.env.appId = body.appId;
    if (f.response.status === 200) {
      const cfg = await client.refreshConfig();
      expect(cfg.forms[0].id).toBe(FORM_ID);
      expect(seen).toEqual(body);
      expect(attestor.commits).toBe(1);
      const cfgReq = server.calls.find((c) => c.method === 'GET')!;
      expect(cfgReq.headers.Authorization).toBe(`Bearer ${f.response.body.session}`);
      expect(cfgReq.headers['X-FeedPulse-Platform']).toBe(body.platform);
      return;
    }
    const e: any = await client.refreshConfig().catch((x) => x);
    expect(e.name).toBe('FeedpulseError');
    expect(e.code).toBe(f.response.body.error);
    expect(e.httpStatus).toBe(f.response.status);
    expect(attestor.commits).toBe(0);
    if (f.response.headers?.['retry-after']) expect(e.retryAfterSeconds).toBe(Number(f.response.headers['retry-after']));
    if (e.code === 'attestation_failed') expect(attestor.resets).toBe(1);
    if (e.code === 'challenge_expired') expect(server.count('POST /v1/native/challenge')).toBe(2); // 1 回だけ取り直す
  });
});

describe('GET /v1/config', () => {
  const configFixtures = fixtures.filter((f) => f.request.path.startsWith('/v1/config'));
  test.each(configFixtures.map((f) => [f.name, f] as [string, Fixture]))('%s', async (_n, f) => {
    const platform = f.request.headers['x-feedpulse-platform'] as 'ios' | 'android';
    const { client, server } = build(platform, { 'GET /v1/config': () => res(f.response) });
    if (f.response.status === 200) {
      const cfg = await client.refreshConfig();
      const call = server.calls.find((c) => c.method === 'GET')!;
      expect(call.url).toBe(`https://ingest.example.test${f.request.path}`);
      expect(call.headers['X-FeedPulse-Platform']).toBe(platform);
      expect(call.headers.Authorization).toBe(`Bearer ${SESSION}`);
      expect(Object.keys(call.headers).map((k) => k.toLowerCase())).not.toContain('origin');
      expect(cfg.isStale).toBe(false);
      const form = cfg.forms[0];
      const src = f.response.body.forms[0];
      expect(form).toMatchObject({ id: src.id, slug: src.slug, name: src.name, type: src.type, version: src.version, allowTarget: true });
      expect(form.blocks.map((b) => b.id)).toEqual(['title', 'body', 'severity']);
      expect(form.blocks[2].options).toEqual(src.definition.blocks[2].options);
      expect(client.config).toEqual(cfg);
      return;
    }
    const e: any = await client.refreshConfig().catch((x) => x);
    expect(e.code).toBe(f.response.body.error);
    expect(e.httpStatus).toBe(f.response.status);
    if (f.response.headers?.['retry-after']) expect(e.retryAfterSeconds).toBe(30);
    // invalid_session は新しいセッションで 1 回だけやり直す
    expect(server.count('GET /v1/config')).toBe(e.code === 'invalid_session' ? 2 : 1);
    expect(server.count('POST /v1/native/session')).toBe(e.code === 'invalid_session' ? 2 : 1);
  });
});

describe('POST /v1/submit', () => {
  const submitFixtures = fixtures.filter((f) => f.request.path === '/v1/submit');
  test.each(submitFixtures.map((f) => [f.name, f] as [string, Fixture]))('%s', async (_n, f) => {
    const platform = f.request.headers['x-feedpulse-platform'] as 'ios' | 'android';
    const body = subst(f.request.body, { '{{formId}}': FORM_ID, '{{identity}}': 'identity.jwt.token' });
    const { client, server, sleeps } = build(platform, {
      'GET /v1/config': () => json(200, CONFIG_BODY),
      'POST /v1/submit': () => res(f.response),
    });
    if (body.context?.identity) client.identify(body.context.identity);
    const run = () =>
      client.submit({ formId: body.formId, fields: body.fields, custom: body.context?.custom, idempotencyKey: body.idempotencyKey });

    if (f.response.status === 202) {
      await expect(run()).resolves.toEqual({ id: f.response.body.id });
      const call = server.calls.find((c) => c.url.endsWith('/v1/submit'))!;
      const sent = JSON.parse(call.body!);
      expect(call.headers['X-FeedPulse-Platform']).toBe(platform);
      expect(call.headers.Authorization).toBe(`Bearer ${SESSION}`);
      expect(Object.keys(call.headers).map((k) => k.toLowerCase())).not.toContain('origin');
      expect(sent.formId).toBe(body.formId);
      expect(sent.idempotencyKey).toBe(body.idempotencyKey);
      expect(sent.fields).toEqual(body.fields);
      expect(sent.context.custom).toEqual(body.context?.custom);
      expect(sent.context.identity).toBe(body.context?.identity);
      expect(sent.context.auto).toMatchObject(body.context?.auto ?? {});
      expect(sent.turnstileToken).toBeUndefined();
      return;
    }

    const e: any = await run().catch((x) => x);
    expect(e.name).toBe('FeedpulseError');
    expect(e.code).toBe(f.response.body.error);
    if (f.name === 'submit-invalid-fields') {
      // 項目定義による検証で送信前に弾く。語彙は server の fields と同じ。
      expect(e.fieldErrors).toEqual(f.response.body.fields);
      expect(server.count('POST /v1/submit')).toBe(0);
      return;
    }
    expect(e.httpStatus).toBe(f.response.status);
    if (e.code === 'identity_invalid') expect(e.identityCode).toBe(f.response.body.code);
    if (e.code === 'rate_limited') {
      // 429 は同じ冪等キーで再送し、Retry-After を待つ
      expect(server.count('POST /v1/submit')).toBe(4);
      expect(sleeps).toEqual([30_000, 30_000, 30_000]);
      const keys = new Set(server.calls.filter((c) => c.url.endsWith('/v1/submit')).map((c) => JSON.parse(c.body!).idempotencyKey));
      expect(keys.size).toBe(1);
      expect([...keys][0]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(e.retryAfterSeconds).toBe(30);
    } else if (e.code === 'invalid_session') {
      expect(server.count('POST /v1/submit')).toBe(2);
      expect(server.count('POST /v1/native/session')).toBe(2);
    } else {
      expect(server.count('POST /v1/submit')).toBe(1);
    }
  });

  test('サーバー側の invalid_fields も fieldErrors にマップする', async () => {
    const f = fx('submit-invalid-fields');
    const { client } = build('android', {
      'GET /v1/config': () => json(200, CONFIG_BODY),
      'POST /v1/submit': () => res(f.response),
    });
    const e: any = await client.submit({ formId: FORM_ID, fields: { title: 't', severity: 'low' } }).catch((x) => x);
    expect(e.code).toBe('invalid_fields');
    expect(e.fieldErrors).toEqual({ title: 'required', severity: 'invalid_option' });
    expect(e.httpStatus).toBe(422);
  });
});
