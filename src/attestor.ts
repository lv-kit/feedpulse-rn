import { FeedpulseError } from './errors';
import { getNativePicker, NativeEnvironment } from './NativeFeedpulsePicker';

/** 端末・アプリの情報。 */
export type AppEnvironment = NativeEnvironment;

/** `POST /v1/native/session` の `attestation`。 */
export type Attestation =
  | { type: 'app_attest_attestation'; keyId: string; attestation: string }
  | { type: 'app_attest_assertion'; keyId: string; assertion: string }
  | { type: 'play_integrity'; token: string }
  | { type: 'dev_insecure' };

/**
 * アプリ証明の取得を抽象化する。既定は `NativeAppAttestor`（iOS: App Attest、Android: Play Integrity）。
 * 単体テストや独自方式では差し替える。
 */
export interface AppAttestor {
  environment(): Promise<AppEnvironment>;
  /** サーバー発行の challenge に対する attestation を返す。失敗は `attestation_unavailable` の FeedpulseError。 */
  attest(challenge: string): Promise<Attestation>;
  /** `POST /v1/native/session` が成功したときに呼ばれる。iOS はここで端末鍵 ID を確定保存する。 */
  commit(): Promise<void>;
  /** 保存している証明用の状態を捨てる。サーバーが `attestation_failed` を返したときに呼ばれる。 */
  reset(): Promise<void>;
}

function unavailable(e: unknown, fallback: string): FeedpulseError {
  if (e instanceof FeedpulseError) return e;
  const code = (e as { code?: unknown } | null)?.code;
  const msg = e instanceof Error ? e.message : String(e);
  return new FeedpulseError('attestation_unavailable', {
    message: typeof code === 'string' ? `${code}: ${msg}` : `${fallback}: ${msg}`,
    cause: e,
  });
}

/**
 * このパッケージのネイティブモジュール（`FeedpulsePicker`）による実装。
 * 実機の App Attest / Play Integrity の動作は CI では検証していない。
 */
export class NativeAppAttestor implements AppAttestor {
  private native() {
    const n = getNativePicker();
    if (!n || !n.environment || !n.attest) {
      throw new FeedpulseError('attestation_unavailable', {
        message: 'ネイティブモジュールが無い、または古い（アプリを再ビルドする。Expo Go は非対応）',
      });
    }
    return n;
  }

  async environment(): Promise<AppEnvironment> {
    const n = this.native();
    try {
      const m = await n.environment!();
      if (!m || (m.platform !== 'ios' && m.platform !== 'android') || !m.appId) {
        throw new Error('environment の戻り値が不正');
      }
      return m;
    } catch (e) {
      throw unavailable(e, 'environment');
    }
  }

  async attest(challenge: string): Promise<Attestation> {
    const n = this.native();
    try {
      const m = await n.attest!(challenge);
      if (!m || typeof m.type !== 'string') throw new Error('attest の戻り値が不正');
      return m as unknown as Attestation;
    } catch (e) {
      throw unavailable(e, 'attest');
    }
  }

  async commit(): Promise<void> {
    try {
      await getNativePicker()?.commitAttestation?.();
    } catch {
      // 確定できなくても次回は鍵を作り直すだけ。
    }
  }

  async reset(): Promise<void> {
    try {
      await getNativePicker()?.resetAttestation?.();
    } catch {
      // 掃除に失敗しても次回の証明で再度試す。
    }
  }
}

/**
 * ローカル開発専用。サーバーが `NATIVE_ATTEST_INSECURE_DEV=true`（`env.dev`）のときだけ通る。
 * 本番では `attestation_failed` になる。
 */
export class DevInsecureAttestor implements AppAttestor {
  constructor(private readonly env: AppEnvironment) {}
  async environment(): Promise<AppEnvironment> {
    return this.env;
  }
  async attest(): Promise<Attestation> {
    return { type: 'dev_insecure' };
  }
  async commit(): Promise<void> {}
  async reset(): Promise<void> {}
}
