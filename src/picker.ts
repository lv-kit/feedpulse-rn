import { Platform } from 'react-native';
import { getNativePicker } from './NativeFeedpulsePicker';
import { FeedpulseTarget, TARGET_LIMITS, sanitizeTarget } from './target';

export type PickErrorCode = 'unavailable' | 'already_picking' | 'invalid_target' | 'native_error';

export class FeedpulsePickError extends Error {
  constructor(public readonly code: PickErrorCode, message: string) {
    super(message);
    this.name = 'FeedpulsePickError';
  }
}

export interface PickTargetOptions {
  /** 画面名。未指定ならネイティブ側の自動取得（現在の ViewController / Activity 名）。 */
  screen?: string;
}

let picking = false;

/**
 * 画面上の要素をタップで選ばせ、`target` を返す。UI は持たない。
 * - キャンセル時は reject せず null。
 * - `testID` は iOS で accessibilityIdentifier、Android で View tag に入り、`target.id` になる。
 */
export async function pickTarget(options: PickTargetOptions = {}): Promise<FeedpulseTarget | null> {
  const native = Platform.OS === 'ios' || Platform.OS === 'android' ? getNativePicker() : null;
  if (!native) {
    throw new FeedpulsePickError('unavailable', 'Feedpulse native picker is not linked on this platform');
  }
  if (picking) {
    throw new FeedpulsePickError('already_picking', 'A target pick is already in progress');
  }
  picking = true;
  try {
    const raw = await native.pickTarget({ screen: options.screen, labelMaxLength: TARGET_LIMITS.label });
    if (raw == null) return null;
    const target = sanitizeTarget(raw);
    if (!target) throw new FeedpulsePickError('invalid_target', 'Native picker returned an unusable target');
    if (options.screen && !target.screen) target.screen = options.screen;
    return target;
  } catch (e) {
    if (e instanceof FeedpulsePickError) throw e;
    throw new FeedpulsePickError('native_error', e instanceof Error ? e.message : String(e));
  } finally {
    picking = false;
  }
}

/** 実行中のピッカーをキャンセルする。pickTarget は null で解決する。 */
export function cancelPickTarget(): void {
  getNativePicker()?.cancelPick();
}
