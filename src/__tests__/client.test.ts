jest.mock('react-native', () => ({ NativeModules: {}, Platform: { OS: 'ios' } }));

import { FeedpulseClient } from '../client';
import { Feedpulse, configure, getClient } from '../feedpulse';
import { MemoryConfigStore } from '../store';
import { FetchTransport } from '../transport';
import { validateFields } from '../validator';
import { parseForm } from '../models';
import { CHALLENGE, CONFIG_BODY, FakeAttestor, FakeServer, FORM_ID, fx, json, NOW_MS, res, SESSION } from './helpers';

const ENV = { platform: 'ios' as const, appId: 'com.example.app', os: 'iOS 18.1', timezone: 'Asia/Tokyo' };

function setup(handlers: ConstructorParameters<typeof FakeServer>[0] = {}, opts: { store?: MemoryConfigStore; now?: () => number; attest?: () => any } = {}) {
  const server = new FakeServer({
    'POST /v1/native/challenge': () => res(fx('challenge-ok').response),
    'POST /v1/native/session': () => res(fx('session-ok-app-attest-assertion').response),
    'GET /v1/config': () => json(200, CONFIG_BODY),
    'POST /v1/submit': () => res(fx('submit-ok').response),
    ...handlers,
  });
  const attestor = new FakeAttestor(ENV, opts.attest ?? (() => ({ type: 'app_attest_assertion', keyId: 'a2V5SWQ=', assertion: 'YXNzZXJ0aW9u' })));
  const sleeps: number[] = [];
  const store = opts.store ?? new MemoryConfigStore();
  let clock = NOW_MS;
  const client = new FeedpulseClient({
    publicKey: 'pk_example',
    baseUrl: 'https://ingest.example.test/',
    transport: server,
    attestor,
    store,
    now: opts.now ?? (() => clock),
    sleep: async (ms) => void sleeps.push(ms),
    newIdempotencyKey: () => 'generated-key-0123456789',
  });
  return { server, attestor, client, sleeps, store, advance: (ms: number) => (clock += ms) };
}

const fields = { title: 'ログインできない', severity: 'high' };

test('Origin を付けない・URL 末尾スラッシュを吸収・冪等キーを生成', async () => {
  const { client, server } = setup();
  await client.submit({ formId: FORM_ID, fields });
  for (const c of server.calls) expect(Object.keys(c.headers).map((k) => k.toLowerCase())).not.toContain('origin');
  expect(server.calls[0].url).toBe('https://ingest.example.test/v1/native/challenge');
  const sent = JSON.parse(server.calls.find((c) => c.url.endsWith('/v1/submit'))!.body!);
  expect(sent.idempotencyKey).toBe('generated-key-0123456789');
  expect(sent.context.auto).toMatchObject({ os: 'iOS 18.1', timezone: 'Asia/Tokyo' });
});

test('不正な冪等キーは送らずに invalid_idempotency_key', async () => {
  const { client, server } = setup();
  await expect(client.submit({ formId: FORM_ID, fields, idempotencyKey: 'short' })).rejects.toMatchObject({ code: 'invalid_idempotency_key' });
  expect(server.calls).toHaveLength(0);
});

describe('セッション', () => {
  test('有効な間は使い回し、期限の 60 秒前に取り直す', async () => {
    const { client, server, advance, attestor } = setup();
    await client.submit({ formId: FORM_ID, fields });
    await client.submit({ formId: FORM_ID, fields });
    expect(server.count('POST /v1/native/session')).toBe(1);
    expect(attestor.commits).toBe(1);
    advance(839_000); // expiresAt(1700000900) - 61s
    await client.submit({ formId: FORM_ID, fields });
    expect(server.count('POST /v1/native/session')).toBe(1);
    advance(2_000); // 残り 59 秒
    await client.submit({ formId: FORM_ID, fields });
    expect(server.count('POST /v1/native/session')).toBe(2);
  });

  test('端末の時計が進んでいても、サーバーの Date ヘッダーで期限を判定する', async () => {
    const serverNow = new Date((1_700_000_000_000 - 3_600_000)).toUTCString(); // 端末は 1 時間進んでいる
    const { client, server } = setup({
      'POST /v1/native/session': () => ({ ...res(fx('session-ok-app-attest-assertion').response), headers: { date: serverNow } }),
    });
    await client.submit({ formId: FORM_ID, fields });
    await client.submit({ formId: FORM_ID, fields });
    expect(server.count('POST /v1/native/session')).toBe(1);
  });

  test('遅れて返った invalid_session は、取り直された新しいセッションを消さない', async () => {
    let sessions = 0;
    const gate: { release?: () => void } = {};
    const held = new Promise<void>((r) => (gate.release = r));
    let submits = 0;
    const { client, server } = setup({
      'POST /v1/native/session': () => json(200, { session: `aaa.bbb.s${++sessions}`, expiresAt: 1_700_000_900 }),
      'POST /v1/submit': async (req) => {
        submits++;
        const n = submits;
        if (n === 2) await held; // 2 件目の応答を遅らせる
        return req.headers.Authorization === 'Bearer aaa.bbb.s1'
          ? json(401, { error: 'invalid_session' })
          : res(fx('submit-ok').response);
      },
    });
    await client.refreshConfig(); // s1 を取得
    const a = client.submit({ formId: FORM_ID, fields }); // s1 → invalid_session → s2 で成功
    const b = client.submit({ formId: FORM_ID, fields }); // s1 → 遅れて invalid_session
    await a;
    gate.release!();
    await b;
    expect(server.count('POST /v1/native/session')).toBe(2); // 3 回目の取り直しは起きない
  });

  test('同時呼び出しはセッション取得 1 回にまとまる', async () => {
    const { client, server } = setup();
    await Promise.all([client.refreshConfig(), client.refreshConfig(), client.submit({ formId: FORM_ID, fields })]);
    expect(server.count('POST /v1/native/challenge')).toBe(1);
    expect(server.count('POST /v1/native/session')).toBe(1);
  });

  test('invalid_session は取り直して 1 回だけやり直し、成功する', async () => {
    let n = 0;
    const { client, server } = setup({
      'POST /v1/submit': () => (++n === 1 ? json(401, { error: 'invalid_session' }) : res(fx('submit-ok').response)),
    });
    await expect(client.submit({ formId: FORM_ID, fields })).resolves.toEqual({ id: fx('submit-ok').response.body.id });
    expect(server.count('POST /v1/native/session')).toBe(2);
  });

  test('assertion が attestation_failed なら鍵を捨てて attestation で 1 回だけやり直す', async () => {
    let sessions = 0;
    let attests = 0;
    const { client, attestor } = setup(
      { 'POST /v1/native/session': () => (++sessions === 1 ? json(403, { error: 'attestation_failed' }) : res(fx('session-ok-app-attest-attestation').response)) },
      { attest: () => (++attests === 1 ? { type: 'app_attest_assertion', keyId: 'k', assertion: 'a' } : { type: 'app_attest_attestation', keyId: 'k2', attestation: 'b' }) },
    );
    await client.refreshConfig();
    expect(attestor.resets).toBe(1);
    expect(attestor.commits).toBe(1);
    expect(attestor.attests).toHaveLength(2);
  });

  test('attestation の取得失敗は attestation_unavailable のまま伝わり、リトライしない', async () => {
    const { FeedpulseError } = await import('../errors');
    const { client, sleeps } = setup({}, { attest: () => new FeedpulseError('attestation_unavailable', { message: 'x' }) });
    await expect(client.submit({ formId: FORM_ID, fields })).rejects.toMatchObject({ code: 'attestation_unavailable' });
    expect(sleeps).toEqual([]);
  });
});

describe('submit の再送', () => {
  test('通信失敗・5xx は同じ冪等キーで指数バックオフ再送し、成功する', async () => {
    let n = 0;
    const { client, server, sleeps } = setup({
      'POST /v1/submit': () => {
        n++;
        if (n === 1) throw new Error('offline');
        if (n === 2) return json(503, {});
        return res(fx('submit-ok').response);
      },
    });
    await expect(client.submit({ formId: FORM_ID, fields })).resolves.toMatchObject({ id: expect.any(String) });
    expect(sleeps).toEqual([1000, 2000]);
    const keys = server.calls.filter((c) => c.url.endsWith('/v1/submit')).map((c) => JSON.parse(c.body!).idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  test('network エラーは最大 3 回再送して network で終わる', async () => {
    const { client, server } = setup({
      'POST /v1/submit': () => {
        throw new Error('offline');
      },
    });
    const e: any = await client.submit({ formId: FORM_ID, fields }).catch((x) => x);
    expect(e.code).toBe('network');
    expect(server.count('POST /v1/submit')).toBe(4);
    expect(client.lastError?.code).toBe('network');
  });

  test('429 の Retry-After は maxDelay で頭打ち', async () => {
    let n = 0;
    const { client, sleeps } = setup({
      'POST /v1/submit': () => (++n === 1 ? json(429, { error: 'rate_limited' }, { 'retry-after': '9999' }) : res(fx('submit-ok').response)),
    });
    await client.submit({ formId: FORM_ID, fields });
    expect(sleeps).toEqual([120_000]);
  });

  test('4xx（identity_invalid など）は再送しない', async () => {
    const { client, server, sleeps } = setup({ 'POST /v1/submit': () => res(fx('submit-identity-invalid').response) });
    client.identify('tok');
    await expect(client.submit({ formId: FORM_ID, fields })).rejects.toMatchObject({ code: 'identity_invalid', identityCode: 'expired' });
    expect(server.count('POST /v1/submit')).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

describe('context', () => {
  const sent = (server: FakeServer) => JSON.parse(server.calls.find((c) => c.url.endsWith('/v1/submit'))!.body!);
  const target = { platform: 'react-native' as const, id: 'checkout-button', screen: 'Checkout', label: 'Buy' };

  test('allowTarget のフォームだけ target を載せる（platform は react-native）', async () => {
    const { client, server } = setup();
    await client.submit({ formId: FORM_ID, fields, target });
    expect(sent(server).context.auto.target).toEqual(target);
  });

  test('allowTarget が false なら target を載せない', async () => {
    const body = JSON.parse(JSON.stringify(CONFIG_BODY));
    body.forms[0].definition.allowTarget = false;
    const { client, server } = setup({ 'GET /v1/config': () => json(200, body) });
    await client.submit({ formId: FORM_ID, fields, target });
    expect(sent(server).context.auto.target).toBeUndefined();
  });

  test('identify の値をそのまま context.identity に載せ、null で解除', async () => {
    const { client, server } = setup();
    client.identify('a.b.c');
    await client.submit({ formId: FORM_ID, fields });
    expect(sent(server).context.identity).toBe('a.b.c');
    client.identify(null);
    await client.submit({ formId: FORM_ID, fields });
    const last = JSON.parse(server.calls.filter((c) => c.url.endsWith('/v1/submit')).pop()!.body!);
    expect(last.context.identity).toBeUndefined();
  });

  test('custom の値の型を検査し、空の項目は送らない', async () => {
    const { client, server } = setup();
    await expect(client.submit({ formId: FORM_ID, fields, custom: { a: {} as unknown as string } })).rejects.toMatchObject({ code: 'not_configured' });
    await client.submit({ formId: FORM_ID, fields: { ...fields, body: '  ' }, custom: { plan: 'pro' } });
    expect(sent(server).fields).toEqual(fields);
    expect(sent(server).context.custom).toEqual({ plan: 'pro' });
  });
});

describe('config とキャッシュ', () => {
  test('取得した config を保存し、新しいクライアントで通信なしに読める（isStale）', async () => {
    const store = new MemoryConfigStore();
    await setup({}, { store }).client.refreshConfig();
    const { client, server } = setup({}, { store });
    const cached = await client.loadCachedConfig();
    expect(cached?.isStale).toBe(true);
    expect(cached?.forms[0].id).toBe(FORM_ID);
    expect(server.calls).toHaveLength(0);
  });

  test('通信失敗時は前回値（isStale）を返し、lastError を残す。成功で戻る', async () => {
    let fail = false;
    const { client } = setup({ 'GET /v1/config': () => (fail ? json(500, {}) : json(200, CONFIG_BODY)) });
    const first = await client.refreshConfig();
    expect(first.isStale).toBe(false);
    fail = true;
    const second = await client.refreshConfig();
    expect(second.isStale).toBe(true);
    expect(second.forms).toEqual(first.forms);
    expect(client.lastError?.code).toBe('internal');
    fail = false;
    expect((await client.refreshConfig()).isStale).toBe(false);
    expect(client.lastError).toBeNull();
  });

  test('前回値が無く失敗したら throw', async () => {
    const { client } = setup({ 'GET /v1/config': () => json(500, {}) });
    await expect(client.refreshConfig()).rejects.toMatchObject({ code: 'internal', httpStatus: 500 });
  });

  test('壊れた保存値は無視する。契約外の config 応答は unexpected_response', async () => {
    const store = new MemoryConfigStore();
    await store.write('config|https://ingest.example.test|pk_example', '{broken');
    const { client } = setup({ 'GET /v1/config': () => json(200, { forms: [{ id: 1 }] }) }, { store });
    expect(await client.loadCachedConfig()).toBeNull();
    await expect(client.refreshConfig()).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  test('未取得の formId は config を取りに行く。無ければ unknown_form', async () => {
    const { client, server } = setup();
    await expect(client.submit({ formId: 'nope', fields })).rejects.toMatchObject({ code: 'unknown_form' });
    expect(server.count('GET /v1/config')).toBe(1);
    expect(server.count('POST /v1/submit')).toBe(0);
  });

  test('古い保存値で検証に落ちたら最新の定義を取り直して検証し直す', async () => {
    const store = new MemoryConfigStore();
    const old = JSON.parse(JSON.stringify(CONFIG_BODY));
    old.forms[0].definition.blocks[2].options = [{ value: 'low', label: '低' }]; // 'high' が無い古い定義
    await setup({ 'GET /v1/config': () => json(200, old) }, { store }).client.refreshConfig();
    const { client, server } = setup({}, { store });
    await expect(client.submit({ formId: FORM_ID, fields })).resolves.toBeTruthy();
    expect(server.count('GET /v1/config')).toBe(1);
  });
});

describe('config の並行取得', () => {
  function configWith(options: unknown) {
    const body = JSON.parse(JSON.stringify(CONFIG_BODY));
    body.forms[0].definition.blocks[2].options = options;
    return body;
  }
  const OLD = configWith([{ value: 'low', label: '低' }]);
  const NEW = configWith([{ value: 'high', label: '高' }]);
  const optionsOf = (c: { forms: any[] } | null) => c?.forms[0].blocks[2].options;

  test('後から始めた取得が先に完了したら、遅れて返った古い応答で上書きしない', async () => {
    let releaseOld!: () => void;
    const { client } = setup({
      'GET /v1/config': (_req, n) =>
        n === 1 ? new Promise((r) => (releaseOld = () => r(json(200, OLD)))) : json(200, NEW),
    });
    const first = client.refreshConfig();
    await new Promise((r) => setTimeout(r, 0));
    const second = await client.refreshConfig();
    releaseOld();
    const late = await first;
    expect(optionsOf(second)).toEqual([{ value: 'high', label: '高' }]);
    expect(optionsOf(client.config)).toEqual([{ value: 'high', label: '高' }]);
    expect(client.config?.isStale).toBe(false);
    expect(optionsOf(late)).toEqual([{ value: 'high', label: '高' }]);
  });

  test('保存の完了順が入れ替わっても、保存値は新しい config になる', async () => {
    const inner = new MemoryConfigStore();
    const releases: (() => void)[] = [];
    let writes = 0;
    const store = {
      read: (k: string) => inner.read(k),
      write: (k: string, v: string) => {
        const n = ++writes;
        // 最初の保存だけ完了を遅らせる。
        if (n === 1) return new Promise<void>((r) => releases.push(() => void inner.write(k, v).then(r)));
        return inner.write(k, v);
      },
    } as unknown as MemoryConfigStore;
    const { client } = setup(
      { 'GET /v1/config': (_req, n) => json(200, n === 1 ? OLD : NEW) },
      { store },
    );
    const first = client.refreshConfig();
    await new Promise((r) => setTimeout(r, 0));
    const second = client.refreshConfig();
    await new Promise((r) => setTimeout(r, 0));
    releases.forEach((r) => r());
    await Promise.all([first, second]);
    const cached = await setup({}, { store: inner }).client.loadCachedConfig();
    expect(optionsOf(cached)).toEqual([{ value: 'high', label: '高' }]);
  });

  test('古い取得の失敗が、新しく取れた config を stale にしない', async () => {
    let failOld!: () => void;
    const { client } = setup({
      'GET /v1/config': (_req, n) =>
        n === 1 ? new Promise((r) => (failOld = () => r(json(500, {})))) : json(200, NEW),
    });
    const first = client.refreshConfig();
    await new Promise((r) => setTimeout(r, 0));
    await client.refreshConfig();
    failOld();
    await first;
    expect(client.config?.isStale).toBe(false);
    expect(client.lastError).toBeNull();
  });
});

describe('validateFields', () => {
  const form = parseForm({
    id: 'f', slug: 's', name: 'n', type: 'bug', version: 1,
    definition: {
      blocks: [
        { id: 't', type: 'short_text', label: 't', required: true, maxLength: 3 },
        { id: 'e', type: 'email', label: 'e', required: false },
        { id: 'n', type: 'number', label: 'n', required: false, min: 1, max: 5 },
        { id: 'r', type: 'rating', label: 'r', required: false, min: 1, max: 5 },
        { id: 'c', type: 'checkbox', label: 'c', required: false, options: [{ value: 'a', label: 'A' }] },
        { id: 'f', type: 'file', label: 'f', required: true },
      ],
    },
  });
  test('サーバーと同じ語彙で返す', () => {
    expect(validateFields(form, {})).toEqual({ t: 'required' });
    expect(validateFields(form, { t: 'abcd', e: 'x', n: 9, r: 'a', c: ['z'], extra: 1 })).toEqual({
      t: 'too_long', e: 'invalid_email', n: 'out_of_range', r: 'type', c: 'invalid_option', extra: 'type',
    });
    expect(validateFields(form, { t: 'abc', e: 'a@b.co', n: 3, c: ['a'] })).toEqual({});
    expect(validateFields(form, { t: 1 })).toEqual({ t: 'type' });
    expect(validateFields(form, { t: 'a', n: NaN })).toEqual({ n: 'type' });
  });
});

describe('configure', () => {
  test('入力検証とグローバル状態', async () => {
    expect(() => configure({ publicKey: ' ' })).toThrow(expect.objectContaining({ code: 'not_configured' }));
    expect(() => configure({ publicKey: 'pk_x', baseUrl: 'http://example.com' })).toThrow(expect.objectContaining({ code: 'not_configured' }));
    expect(() => configure({ publicKey: 'pk_x', baseUrl: 'ftp://x' })).toThrow(expect.objectContaining({ code: 'not_configured' }));
    expect(configure({ publicKey: 'pk_x', baseUrl: 'http://10.0.2.2:8787' }).baseUrl).toBe('http://10.0.2.2:8787');
    expect(() => configure({ publicKey: 'pk_x', baseUrl: 'http://localhost.evil.com' })).toThrow();
    const c = configure({ publicKey: 'pk_x' });
    expect(c.baseUrl).toBe('https://ingest.feedpulse.stargazy.xyz');
    expect(getClient()).toBe(c);
    expect(Feedpulse.client).toBe(c);
    Feedpulse.identify('t');
  });
});

describe('FetchTransport', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  test('fetch を呼んでヘッダーを小文字化する', async () => {
    const fetchMock = jest.fn(async () => ({
      status: 202,
      headers: { forEach: (cb: (v: string, k: string) => void) => cb('30', 'Retry-After') },
      text: async () => '{"id":"x"}',
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await new FetchTransport().send({ method: 'POST', url: 'https://x.test/v1/submit', headers: { a: 'b' }, body: '{}' });
    expect(r).toEqual({ status: 202, headers: { 'retry-after': '30' }, body: '{"id":"x"}' });
    expect(fetchMock).toHaveBeenCalledWith('https://x.test/v1/submit', expect.objectContaining({ method: 'POST', body: '{}' }));
  });
  test('AbortError はタイムアウトの network エラーになる', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { client } = (() => {
      const c = new FeedpulseClient({
        publicKey: 'pk', baseUrl: 'https://x.test',
        transport: { send: async () => { throw err; } },
        attestor: new FakeAttestor(ENV, () => ({ type: 'dev_insecure' })),
        store: new MemoryConfigStore(),
      });
      return { client: c };
    })();
    await expect(client.refreshConfig()).rejects.toMatchObject({ code: 'network', message: '通信がタイムアウト' });
  });
});

void CHALLENGE;
void SESSION;
