import { AppAttestor } from './attestor';
import { FeedpulseClient, RetryPolicy, SubmitOptions } from './client';
import { FeedpulseError } from './errors';
import { FeedpulseConfig, SubmitReceipt } from './models';
import { ConfigStore } from './store';
import { FeedpulseTransport } from './transport';

/** 既定の API ベース URL（本番の ingest）。 */
export const DEFAULT_BASE_URL = 'https://ingest.feedpulse.stargazy.xyz';

export interface ConfigureOptions {
  /** プロジェクトの公開鍵（`pk_...`）。 */
  publicKey: string;
  /** 既定は本番。https のみ（開発用の localhost / 127.0.0.1 / 10.0.2.2 は http 可）。 */
  baseUrl?: string;
  retryPolicy?: Partial<RetryPolicy>;
  /** 主にテスト用の差し替え口。 */
  attestor?: AppAttestor;
  transport?: FeedpulseTransport;
  store?: ConfigStore;
}

let current: FeedpulseClient | null = null;

/** SDK を初期化する。アプリ起動時に 1 回呼ぶ。再度呼ぶと置き換わる。通信は最初の `refreshConfig` / `submit` で始まる。 */
export function configure(options: ConfigureOptions): FeedpulseClient {
  const publicKey = options.publicKey?.trim();
  if (!publicKey) throw new FeedpulseError('not_configured', { message: 'publicKey が空' });
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const m = /^(https?):\/\/([^/:?#]+)/i.exec(baseUrl);
  const local = m !== null && ['localhost', '127.0.0.1', '10.0.2.2'].includes(m[2].toLowerCase());
  if (!m || !(m[1].toLowerCase() === 'https' || local)) {
    throw new FeedpulseError('not_configured', {
      message: 'baseUrl は https（開発用の localhost / 127.0.0.1 / 10.0.2.2 のみ http 可）',
    });
  }
  return (current = new FeedpulseClient({ ...options, publicKey, baseUrl }));
}

/** `configure` で作ったクライアント。未設定なら `not_configured` を投げる。 */
export function getClient(): FeedpulseClient {
  if (!current) throw new FeedpulseError('not_configured', { message: 'configure を先に呼ぶ' });
  return current;
}

/** `FeedpulseClient.identify` */
export function identify(token: string | null | undefined): void {
  getClient().identify(token);
}

/** `FeedpulseClient.refreshConfig` */
export function refreshConfig(): Promise<FeedpulseConfig> {
  return getClient().refreshConfig();
}

/** `FeedpulseClient.submit` */
export function submit(options: SubmitOptions): Promise<SubmitReceipt> {
  return getClient().submit(options);
}

/** 他 SDK（`Feedpulse.configure` 形式）に合わせた名前空間。 */
export const Feedpulse = {
  configure,
  identify,
  refreshConfig,
  submit,
  get client(): FeedpulseClient {
    return getClient();
  },
};
