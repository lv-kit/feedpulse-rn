import { AppAttestor, AppEnvironment, NativeAppAttestor } from './attestor';
import { contractErrorCode, FeedpulseError, fieldErrorCode, FieldErrorCode } from './errors';
import { FeedpulseConfig, FeedpulseForm, FieldValues, formToJson, parseForm, SubmitReceipt } from './models';
import { ConfigStore, NativeConfigStore } from './store';
import { FeedpulseTarget, sanitizeTarget } from './target';
import { FeedpulseResponse, FeedpulseTransport, FetchTransport } from './transport';
import { validateFields } from './validator';

/** 再送の設定。待ち時間は `baseDelayMs * 2^回数`。429 の `Retry-After` があればそちらを優先（`maxDelayMs` で頭打ち）。 */
export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 120_000 };

export interface FeedpulseClientOptions {
  publicKey: string;
  baseUrl: string;
  retryPolicy?: Partial<RetryPolicy>;
  /** 差し替え口（主にテスト用）。 */
  attestor?: AppAttestor;
  transport?: FeedpulseTransport;
  store?: ConfigStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  newIdempotencyKey?: () => string;
  deviceContext?: (env: AppEnvironment) => Record<string, string>;
}

export interface SubmitOptions {
  /** `forms[].id`。 */
  formId: string;
  /** ブロック ID → 値。 */
  fields: FieldValues;
  /** `pickTarget` の結果。フォームが `allowTarget` のときだけ `context.auto.target` に載せる。 */
  target?: FeedpulseTarget | null;
  /** `context.custom`（値は string / 有限の number / boolean）。 */
  custom?: Record<string, string | number | boolean>;
  /** 省略すると SDK が生成。アプリ側で再送を管理するときは同じ値を渡す（`^[A-Za-z0-9_-]{16,64}$`）。 */
  idempotencyKey?: string;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/** 期限のこの秒数前になったらセッションを取り直す。 */
const SESSION_REFRESH_MARGIN_SECONDS = 60;

function randomIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    // 冪等キーは秘密ではなく一意であればよい。時刻 + Math.random で代用する。
    let t = Date.now();
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (Math.floor(Math.random() * 256) ^ (t & 0xff)) & 0xff;
      t = Math.floor(t / 7);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultDeviceContext(env: AppEnvironment): Record<string, string> {
  const out: Record<string, string> = { os: env.os, timezone: env.timezone };
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) out.locale = locale;
  } catch {
    // Intl が無い環境では locale を送らない
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface Session {
  token: string;
  expiresAt: number;
}

/** Feedpulse のヘッドレスクライアント。通常は `configure` で作る。失敗は `FeedpulseError`。 */
export class FeedpulseClient {
  readonly publicKey: string;
  readonly baseUrl: string;
  readonly retryPolicy: RetryPolicy;

  private readonly attestor: AppAttestor;
  private readonly transport: FeedpulseTransport;
  private readonly store: ConfigStore;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly newKey: () => string;
  private readonly deviceContext: (env: AppEnvironment) => Record<string, string>;
  private readonly base: string;

  private session: Session | null = null;
  /** サーバー時刻 - 端末時刻（ミリ秒）。端末の時計ずれで毎回「期限間近」にならないよう、session 応答の Date ヘッダーから求める。 */
  private clockOffsetMs = 0;
  private sessionInFlight: Promise<string> | null = null;
  private env: AppEnvironment | null = null;
  private identityToken: string | null = null;
  private _config: FeedpulseConfig | null = null;
  private _lastError: FeedpulseError | null = null;
  private cacheLoad: Promise<void> | null = null;
  /** `refreshConfig` の開始順の連番。古い要求の結果が新しい結果を上書きしないための世代。 */
  private configSeq = 0;
  /** メモリへ反映済みの最新の世代。 */
  private appliedConfigSeq = 0;
  /** config 保存の直列化用。保存の完了順が開始順と入れ替わらないようにする。 */
  private configWrite: Promise<void> = Promise.resolve();

  constructor(o: FeedpulseClientOptions) {
    this.publicKey = o.publicKey;
    this.baseUrl = o.baseUrl;
    this.base = o.baseUrl.replace(/\/+$/, '');
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...o.retryPolicy };
    this.attestor = o.attestor ?? new NativeAppAttestor();
    this.transport = o.transport ?? new FetchTransport();
    this.store = o.store ?? new NativeConfigStore();
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.newKey = o.newIdempotencyKey ?? randomIdempotencyKey;
    this.deviceContext = o.deviceContext ?? defaultDeviceContext;
  }

  private get cacheKey(): string {
    return `config|${this.base}|${this.publicKey}`;
  }

  /** 直近の config。保存値から復元したものや通信失敗後の前回値は `isStale === true`。未取得なら null。 */
  get config(): FeedpulseConfig | null {
    return this._config;
  }

  /** 直近の通信エラー。成功すると null に戻る。 */
  get lastError(): FeedpulseError | null {
    return this._lastError;
  }

  /**
   * 身元確認トークン（顧客バックエンドが `sk_` で署名した JWT）を設定する。
   * SDK は検証せず `context.identity` にそのまま載せる。null か空文字で解除。
   */
  identify(token: string | null | undefined): void {
    this.identityToken = token == null || token.trim() === '' ? null : token;
  }

  /** 保存済みの config を読む（通信しない）。無ければ null。 */
  async loadCachedConfig(): Promise<FeedpulseConfig | null> {
    await this.ensureCacheLoaded();
    return this._config;
  }

  private ensureCacheLoaded(): Promise<void> {
    return (this.cacheLoad ??= (async () => {
      if (this._config) return;
      let text: string | null;
      try {
        text = await this.store.read(this.cacheKey);
      } catch {
        return;
      }
      if (!text) return;
      try {
        const o: unknown = JSON.parse(text);
        if (!isRecord(o) || !Array.isArray(o.forms) || typeof o.fetchedAt !== 'number') return;
        this._config ??= { forms: o.forms.map(parseForm), fetchedAt: o.fetchedAt, isStale: true };
      } catch {
        // 壊れた保存値はキャッシュ無し扱い。
      }
    })());
  }

  /** `GET /v1/config` を取りに行く。通信に失敗したら前回値（`isStale === true`）を返し、前回値も無ければ throw。 */
  async refreshConfig(): Promise<FeedpulseConfig> {
    const seq = ++this.configSeq;
    await this.ensureCacheLoaded();
    try {
      const res = await this.authed('GET', `/v1/config?pk=${encodeURIComponent(this.publicKey)}`);
      const json = this.parseObject(res.body);
      let forms: FeedpulseForm[];
      try {
        if (!Array.isArray(json.forms)) throw new Error('forms が無い');
        forms = json.forms.map(parseForm);
      } catch (e) {
        throw new FeedpulseError('unexpected_response', {
          message: `config を解釈できない: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        });
      }
      const fresh: FeedpulseConfig = { forms, fetchedAt: this.now(), isStale: false };
      // より新しい要求の結果を反映済みなら、この（古い）応答は捨てる。
      if (seq < this.appliedConfigSeq && this._config) return this._config;
      this.appliedConfigSeq = seq;
      this._config = fresh;
      this._lastError = null;
      const serialized = JSON.stringify({ fetchedAt: fresh.fetchedAt, forms: forms.map(formToJson) });
      this.configWrite = this.configWrite.then(async () => {
        // 順番待ちの間に新しい結果が反映されたら、古い値は保存しない。
        if (seq < this.appliedConfigSeq) return;
        try {
          await this.store.write(this.cacheKey, serialized);
        } catch {
          // 保存に失敗しても取得は成功
        }
      });
      await this.configWrite;
      return fresh;
    } catch (e) {
      if (!(e instanceof FeedpulseError)) throw e;
      // より新しい要求の結果を反映済みなら、古い要求の失敗で状態を書き換えない。
      if (seq < this.appliedConfigSeq && this._config) return this._config;
      this._lastError = e;
      if (this._config) return (this._config = { ...this._config, isStale: true });
      throw e;
    }
  }

  /**
   * フィードバックを送る。
   *
   * 1. 項目定義（未取得なら `refreshConfig`）で `fields` を検証し、不正なら送らず `invalid_fields` を投げる。
   * 2. 冪等キーを付けて `POST /v1/submit`。通信失敗・429・5xx は `retryPolicy` に従い同じキーで再送する。
   */
  async submit(o: SubmitOptions): Promise<SubmitReceipt> {
    const key = o.idempotencyKey ?? this.newKey();
    if (!IDEMPOTENCY_KEY.test(key)) {
      throw new FeedpulseError('invalid_idempotency_key', { message: 'idempotencyKey は ^[A-Za-z0-9_-]{16,64}$' });
    }
    const sendFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o.fields)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      sendFields[k] = v;
    }
    if (o.custom) {
      for (const v of Object.values(o.custom)) {
        const ok = typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
        if (!ok) {
          throw new FeedpulseError('not_configured', { message: 'custom の値は string / 有限の number / boolean のみ' });
        }
      }
    }

    await this.ensureCacheLoaded();
    let current = this._config;
    let form = current?.forms.find((f) => f.id === o.formId);
    if (!form) {
      current = await this.refreshConfig();
      form = current.forms.find((f) => f.id === o.formId);
    }
    if (!form) {
      throw new FeedpulseError('unknown_form', { message: `formId=${o.formId} は config に無い` });
    }
    let errors = validateFields(form, sendFields);
    if (Object.keys(errors).length > 0 && current?.isStale) {
      // 古い保存値で弾かない。最新の定義を取り直して検証し直す（取れなければ古い定義のまま）。
      form = (await this.refreshConfig()).forms.find((f) => f.id === o.formId) ?? form;
      errors = validateFields(form, sendFields);
    }
    if (Object.keys(errors).length > 0) {
      throw new FeedpulseError('invalid_fields', { message: '入力が不正', fieldErrors: errors });
    }

    const env = await this.environment();
    const auto: Record<string, unknown> = { ...this.deviceContext(env) };
    if (o.target && form.allowTarget) {
      const t = sanitizeTarget(o.target);
      if (t) auto.target = t;
    }
    const context: Record<string, unknown> = { auto };
    if (o.custom && Object.keys(o.custom).length > 0) context.custom = o.custom;
    if (this.identityToken) context.identity = this.identityToken;
    const body = JSON.stringify({ formId: o.formId, idempotencyKey: key, fields: sendFields, context });

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.authed('POST', '/v1/submit', body);
        const id = this.parseObject(res.body).id;
        if (typeof id !== 'string' || id === '') {
          throw new FeedpulseError('unexpected_response', { message: 'submit の応答に id が無い', httpStatus: res.status });
        }
        this._lastError = null;
        return { id };
      } catch (e) {
        if (!(e instanceof FeedpulseError)) throw e;
        if (!e.isRetryable || attempt >= this.retryPolicy.maxRetries) {
          this._lastError = e;
          throw e;
        }
        const wait = e.retryAfterSeconds !== undefined ? e.retryAfterSeconds * 1000 : this.retryPolicy.baseDelayMs * 2 ** attempt;
        await this.sleep(Math.min(wait, this.retryPolicy.maxDelayMs));
      }
    }
  }

  // ---- セッション ----

  private async environment(): Promise<AppEnvironment> {
    return (this.env ??= await this.attestor.environment());
  }

  private ensureSession(): Promise<string> {
    const cur = this.session;
    if (cur && Math.floor((this.now() + this.clockOffsetMs) / 1000) < cur.expiresAt - SESSION_REFRESH_MARGIN_SECONDS) {
      return Promise.resolve(cur.token);
    }
    // 同時呼び出しは 1 回の取得にまとめる（challenge は 1 回限りなので並行させない）。
    if (this.sessionInFlight) return this.sessionInFlight;
    const f = this.openSessionWithRecovery().finally(() => {
      this.sessionInFlight = null;
    });
    this.sessionInFlight = f;
    return f;
  }

  private async openSessionWithRecovery(): Promise<string> {
    this.session = null;
    try {
      return await this.openSession(true);
    } catch (e) {
      // challenge の期限切れ（端末が遅い等）は取り直して 1 回だけやり直す。
      if (!(e instanceof FeedpulseError) || (e.code !== 'challenge_expired' && e.code !== 'invalid_challenge')) throw e;
      return this.openSession(true);
    }
  }

  private async openSession(retryOnStaleKey: boolean): Promise<string> {
    const env = await this.environment();
    const ch = await this.call('POST', '/v1/native/challenge', JSON.stringify({ pk: this.publicKey }), null, env);
    const challenge = this.parseObject(ch.body).challenge;
    if (typeof challenge !== 'string' || challenge === '') {
      throw new FeedpulseError('unexpected_response', { message: 'challenge の応答が不正', httpStatus: ch.status });
    }
    const attestation = await this.attestor.attest(challenge);
    let res: FeedpulseResponse;
    try {
      res = await this.call(
        'POST',
        '/v1/native/session',
        JSON.stringify({ pk: this.publicKey, platform: env.platform, appId: env.appId, challenge, attestation }),
        null,
        env,
      );
    } catch (e) {
      if (e instanceof FeedpulseError && e.code === 'attestation_failed') {
        // iOS: サーバーが知らない鍵 ID を使い続けないよう、保存した鍵を捨てる。
        await this.attestor.reset();
        // 保存していた鍵がサーバーに無い（前回の attestation が届かなかった等）。
        // 新しい challenge で鍵を作り直して 1 回だけやり直す。
        if (retryOnStaleKey && attestation.type === 'app_attest_assertion') return this.openSession(false);
      }
      throw e;
    }
    const json = this.parseObject(res.body);
    const jwt = json.session;
    const exp = json.expiresAt;
    if (typeof jwt !== 'string' || jwt === '' || typeof exp !== 'number' || !Number.isFinite(exp)) {
      throw new FeedpulseError('unexpected_response', { message: 'session の応答が不正', httpStatus: res.status });
    }
    const serverDate = Date.parse(res.headers.date ?? '');
    if (Number.isFinite(serverDate)) this.clockOffsetMs = serverDate - this.now();
    this.session = { token: jwt, expiresAt: Math.trunc(exp) };
    await this.attestor.commit();
    return jwt;
  }

  /** セッション付きの呼び出し。`invalid_session` なら取り直して 1 回だけやり直す。 */
  private async authed(method: 'GET' | 'POST', pathAndQuery: string, body?: string): Promise<FeedpulseResponse> {
    const env = await this.environment();
    let refreshed = false;
    for (;;) {
      const token = await this.ensureSession();
      try {
        return await this.call(method, pathAndQuery, body, token, env);
      } catch (e) {
        if (!(e instanceof FeedpulseError)) throw e;
        if (e.code === 'invalid_session') {
          if (this.session?.token === token) this.session = null; // 他のリクエストが取り直した新しいセッションは消さない
          if (refreshed) throw e;
          refreshed = true;
          continue;
        }
        if ((e.code === 'app_not_registered' || e.code === 'attestation_failed') && this.session?.token === token) this.session = null;
        throw e;
      }
    }
  }

  private async call(
    method: 'GET' | 'POST',
    pathAndQuery: string,
    body: string | null | undefined,
    token: string | null,
    env: AppEnvironment,
  ): Promise<FeedpulseResponse> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body != null) headers['Content-Type'] = 'application/json';
    if (token) {
      headers['X-FeedPulse-Platform'] = env.platform;
      headers.Authorization = `Bearer ${token}`;
    }
    let res: FeedpulseResponse;
    try {
      res = await this.transport.send({ method, url: `${this.base}${pathAndQuery}`, headers, body: body ?? undefined });
    } catch (e) {
      const aborted = (e as { name?: unknown } | null)?.name === 'AbortError';
      throw new FeedpulseError('network', {
        message: aborted ? '通信がタイムアウト' : `通信に失敗: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
    if (res.status >= 200 && res.status < 300) return res;
    throw this.toError(res);
  }

  private toError(res: FeedpulseResponse): FeedpulseError {
    let json: Record<string, unknown> | undefined;
    try {
      const d: unknown = JSON.parse(res.body);
      if (isRecord(d)) json = d;
    } catch {
      // JSON でない応答
    }
    const code = contractErrorCode(json?.error) ?? (res.status >= 500 ? 'internal' : 'unexpected_response');
    const fieldErrors: Record<string, FieldErrorCode> = {};
    if (isRecord(json?.fields)) {
      for (const [k, v] of Object.entries(json.fields)) {
        const c = fieldErrorCode(v);
        if (c) fieldErrors[k] = c;
      }
    }
    const retryRaw = res.headers['retry-after']?.trim();
    const retry = retryRaw && /^\d+$/.test(retryRaw) ? Number(retryRaw) : undefined;
    return new FeedpulseError(code, {
      httpStatus: res.status,
      fieldErrors,
      identityCode: typeof json?.code === 'string' && json.code !== '' ? json.code : undefined,
      retryAfterSeconds: retry,
    });
  }

  private parseObject(text: string): Record<string, unknown> {
    try {
      const d: unknown = JSON.parse(text);
      if (isRecord(d)) return d;
    } catch {
      // 下で throw
    }
    throw new FeedpulseError('unexpected_response', { message: 'JSON オブジェクトを解釈できない' });
  }
}
