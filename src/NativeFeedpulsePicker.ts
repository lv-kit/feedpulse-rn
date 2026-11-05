import { NativeModules } from 'react-native';

/** `environment()` の戻り値。 */
export interface NativeEnvironment {
  platform: 'ios' | 'android';
  /** iOS は bundle ID、Android は package name。 */
  appId: string;
  /** 例: `iOS 18.1` / `Android 15`。 */
  os: string;
  /** IANA タイムゾーン名。 */
  timezone: string;
}

/**
 * ネイティブ側が実装する契約。iOS: FeedpulsePicker.swift / Android: FeedpulsePickerModule.kt
 * アプリ証明・端末情報・保存の各メソッドは 0.2.0 で追加した。古いネイティブビルドには無いので optional。
 */
export interface NativePicker {
  /** ピッカーを開く。タップで target(dict) を resolve、キャンセルで null を resolve。 */
  pickTarget(options: { screen?: string; labelMaxLength: number }): Promise<Record<string, unknown> | null>;
  /** 実行中のピッカーをキャンセルする（pickTarget は null で resolve）。 */
  cancelPick(): void;

  environment?(): Promise<NativeEnvironment>;
  /** iOS: App Attest（保存した鍵 ID があれば assertion、無ければ attestation）。Android: Play Integrity（nonce = challenge）。 */
  attest?(challenge: string): Promise<Record<string, unknown>>;
  /** セッション発行に成功したとき。iOS は新しい端末鍵 ID を確定保存する。 */
  commitAttestation?(): Promise<void>;
  /** 保存している証明用の状態（iOS の端末鍵 ID）を捨てる。 */
  resetAttestation?(): Promise<void>;
  storeRead?(key: string): Promise<string | null>;
  storeWrite?(key: string, value: string): Promise<void>;
}

export function getNativePicker(): NativePicker | null {
  const m = (NativeModules as Record<string, unknown>).FeedpulsePicker;
  return (m as NativePicker | undefined) ?? null;
}
