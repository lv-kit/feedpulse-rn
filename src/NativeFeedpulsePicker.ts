import { NativeModules } from 'react-native';

/** ネイティブ側が実装する契約。iOS: FeedpulsePicker.swift / Android: FeedpulsePickerModule.kt */
export interface NativePicker {
  /** ピッカーを開く。タップで target(dict) を resolve、キャンセルで null を resolve。 */
  pickTarget(options: { screen?: string; labelMaxLength: number }): Promise<Record<string, unknown> | null>;
  /** 実行中のピッカーをキャンセルする（pickTarget は null で resolve）。 */
  cancelPick(): void;
}

export function getNativePicker(): NativePicker | null {
  const m = (NativeModules as Record<string, unknown>).FeedpulsePicker;
  return (m as NativePicker | undefined) ?? null;
}
