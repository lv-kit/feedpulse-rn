import type { FieldErrorCode } from './errors';
import type { FeedpulseBlock, FeedpulseForm } from './models';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function check(b: FeedpulseBlock, v: unknown): FieldErrorCode | null {
  switch (b.type) {
    case 'short_text':
    case 'long_text':
      if (typeof v !== 'string') return 'type';
      return b.maxLength !== undefined && v.length > b.maxLength ? 'too_long' : null;
    case 'email':
      if (typeof v !== 'string') return 'type';
      if (b.maxLength !== undefined && v.length > b.maxLength) return 'too_long';
      return EMAIL.test(v) ? null : 'invalid_email';
    case 'number':
    case 'rating':
      if (!finite(v)) return 'type';
      if (b.min !== undefined && v < b.min) return 'out_of_range';
      if (b.max !== undefined && v > b.max) return 'out_of_range';
      return null;
    case 'select':
    case 'radio':
      if (typeof v !== 'string') return 'type';
      return b.options.some((o) => o.value === v) ? null : 'invalid_option';
    case 'checkbox':
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return 'type';
      return v.every((x) => b.options.some((o) => o.value === x)) ? null : 'invalid_option';
    default:
      return null;
  }
}

/**
 * 項目定義に基づくクライアント側の入力検証。サーバーと同じ語彙で返す。
 * 最終的な判定はサーバー。ここは往復を省くための事前チェック。
 * image / file は未対応（検証しない。送信もしない）。
 */
export function validateFields(form: FeedpulseForm, fields: Record<string, unknown>): Record<string, FieldErrorCode> {
  const errors: Record<string, FieldErrorCode> = {};
  const known = new Set(form.blocks.map((b) => b.id));
  for (const k of Object.keys(fields)) if (!known.has(k)) errors[k] = 'type';
  for (const b of form.blocks) {
    if (b.type === 'image' || b.type === 'file') continue;
    const v = fields[b.id];
    if (isEmpty(v)) {
      if (b.required) errors[b.id] = 'required';
      continue;
    }
    const e = check(b, v);
    if (e) errors[b.id] = e;
  }
  return errors;
}
