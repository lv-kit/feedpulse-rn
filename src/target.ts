/**
 * `context.auto.target` の型とサニタイズ。
 * スキーマの正本は lv-kit/feedpulse-web #106 (packages/shared/src/context.ts)。
 * 上限値は web の packages/shared/src/context.ts (MAX_TARGET_ID 等) と一致させる。
 * サーバーは超過時に target ごと捨てるので、SDK 側で事前に整える。
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
  label: 200,
  rectAbs: 1_000_000,
} as const;

/** ネイティブへ渡す label の既定の切り詰め長（サーバー上限より短く、先頭のみ）。 */
export const LABEL_PREFERRED_LENGTH = 80;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** 制御文字除去→trim。truncate=true なら max (UTF-16 長) まで切る。false で超過なら null（サーバーは捨てる）。 */
function str(v: unknown, max: number, truncate = false): string | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return null;
  let s = v.replace(CONTROL_CHARS, '').trim();
  if (s.length > max) {
    if (!truncate) return null;
    let out = '';
    for (const ch of s) {
      if (out.length + ch.length > max) break;
      out += ch;
    }
    s = out.trim();
  }
  return s === '' ? undefined : s;
}

function rect(v: unknown): TargetRect | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const out: number[] = [];
  for (const k of ['x', 'y', 'w', 'h']) {
    const n = r[k];
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > TARGET_LIMITS.rectAbs) return undefined;
    if ((k === 'w' || k === 'h') && n < 0) return undefined;
    out.push(n);
  }
  return { x: out[0], y: out[1], w: out[2], h: out[3] };
}

/**
 * ネイティブから返った値を #106 の形に整える。
 * `platform` は常に 'react-native' で上書きする（Issue #116）。
 * id と path のどちらも無ければ null（サーバーも捨てる）。
 */
export function sanitizeTarget(raw: unknown): FeedpulseTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const target: FeedpulseTarget = { platform: 'react-native' };
  const screen = str(r.screen, TARGET_LIMITS.screen);
  const id = str(r.id, TARGET_LIMITS.id);
  const path = str(r.path, TARGET_LIMITS.path);
  const label = str(r.label, TARGET_LIMITS.label, true);
  // id / path が上限超過・型違いならサーバーが target ごと捨てるので null。screen は欠落扱いで続行。
  if (id === null || path === null) return null;
  if (!id && !path) return null;
  if (screen) target.screen = screen;
  if (id) target.id = id;
  if (path) target.path = path;
  const rc = rect(r.rect);
  if (rc) target.rect = rc;
  if (label) target.label = label;
  return target;
}
