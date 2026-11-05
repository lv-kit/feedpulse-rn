import contract from './fixtures/contract.json';
import type { AppAttestor, AppEnvironment, Attestation } from '../attestor';
import type { FeedpulseRequest, FeedpulseResponse, FeedpulseTransport } from '../transport';

export interface Fixture {
  name: string;
  kind: string;
  request: { method: string; path: string; headers: Record<string, string>; body?: any };
  response: { status: number; headers?: Record<string, string>; body: any };
}

export const fixtures: Fixture[] = contract.fixtures as unknown as Fixture[];

export function fx(name: string): Fixture {
  const f = fixtures.find((x) => x.name === name);
  if (!f) throw new Error(`fixture not found: ${name}`);
  return f;
}

export const NOW_MS = 1_700_000_000_000;

export function res(f: Fixture['response']): FeedpulseResponse {
  return { status: f.status, headers: { ...(f.headers ?? {}) }, body: JSON.stringify(f.body) };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): FeedpulseResponse {
  return { status, headers, body: JSON.stringify(body) };
}

export type Handler = (req: FeedpulseRequest, n: number) => FeedpulseResponse | Promise<FeedpulseResponse>;

/** パスごとのハンドラ。呼び出しを記録する。 */
export class FakeServer implements FeedpulseTransport {
  calls: FeedpulseRequest[] = [];
  private counts = new Map<string, number>();
  constructor(private readonly handlers: Record<string, Handler>) {}

  async send(req: FeedpulseRequest): Promise<FeedpulseResponse> {
    this.calls.push(req);
    const p = req.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const key = `${req.method} ${p}`;
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    const h = this.handlers[key];
    if (!h) throw new Error(`unexpected request: ${key}`);
    return h(req, n);
  }

  calledPaths(): string[] {
    return this.calls.map((c) => `${c.method} ${c.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}`);
  }
  count(key: string): number {
    return this.calledPaths().filter((p) => p === key).length;
  }
}

export class FakeAttestor implements AppAttestor {
  commits = 0;
  resets = 0;
  attests: string[] = [];
  constructor(
    public env: AppEnvironment,
    public next: () => Attestation | Error,
  ) {}
  async environment() {
    return this.env;
  }
  async attest(challenge: string) {
    this.attests.push(challenge);
    const a = this.next();
    if (a instanceof Error) throw a;
    return a;
  }
  async commit() {
    this.commits++;
  }
  async reset() {
    this.resets++;
  }
}

export const CHALLENGE = fx('challenge-ok').response.body.challenge as string;
export const SESSION = fx('session-ok-play-integrity').response.body.session as string;
export const CONFIG_BODY = fx('config-ok').response.body;
export const FORM_ID = CONFIG_BODY.forms[0].id as string;
