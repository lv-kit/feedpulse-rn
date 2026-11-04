/**
 * `context.auto.target` の型とサニタイズ。
 * スキーマの正本は lv-kit/feedpulse-web #106 (packages/shared/src/context.ts)。
 * 上限値は #106 確定までの仮置き。確定したら TARGET_LIMITS を合わせる。
 */
export type TargetPlatform = 'web' | 'ios' | 'android' | 'flutter' | 'react-native';

export interface TargetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FeedpulseTarget {
  platform: TargetPlatform;
  screen?: string;
  /** 明示 ID（RN では testID / nativeID / feedpulseId）。優先して使われる。 */
  id?: string;
  /** 自動取得パス（補助）。 */
  path?: string;
  rect?: TargetRect;
  /** テキスト / accessibility label の先頭のみ。 */
  label?: string;
}

export const TARGET_LIMITS = {
  screen: 512,
  id: 128,
  path: 512,
  label: 80,
} as const;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(CONTROL_CHARS, '').trim();
  if (!s) return undefined;
  return Array.from(s).slice(0, max).join('');
}

function rect(v: unknown): TargetRect | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const out: number[] = [];
  for (const k of ['x', 'y', 'w', 'h']) {
    const n = r[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
    out.push(n);
  }
  return { x: out[0], y: out[1], w: out[2], h: out[3] };
}

/**
 * ネイティブから返った値を #106 の形に整える。
 * `platform` は常に 'react-native' で上書きする（Issue #116）。
 * 使える項目が id / path / rect のいずれも無ければ null。
 */
export function sanitizeTarget(raw: unknown): FeedpulseTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const target: FeedpulseTarget = { platform: 'react-native' };
  const screen = str(r.screen, TARGET_LIMITS.screen);
  const id = str(r.id, TARGET_LIMITS.id);
  const path = str(r.path, TARGET_LIMITS.path);
  const label = str(r.label, TARGET_LIMITS.label);
  const rc = rect(r.rect);
  if (screen) target.screen = screen;
  if (id) target.id = id;
  if (path) target.path = path;
  if (rc) target.rect = rc;
  if (label) target.label = label;
  if (!id && !path && !rc) return null;
  return target;
}
