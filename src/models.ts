export interface FeedpulseOption {
  value: string;
  label: string;
}

export type FeedpulseBlockType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'number'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'rating'
  | 'image'
  | 'file';

/** フォームの項目（ブロック）定義。 */
export interface FeedpulseBlock {
  id: string;
  type: FeedpulseBlockType;
  label: string;
  required: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  options: FeedpulseOption[];
  maxFiles?: number;
  maxTotalBytes?: number;
}

export interface FeedpulseForm {
  id: string;
  slug: string;
  name: string;
  type: 'inquiry' | 'bug' | 'improvement';
  /** 公開済みの版。 */
  version: number;
  /** true のときだけ `context.auto.target` を送る。 */
  allowTarget: boolean;
  blocks: FeedpulseBlock[];
}

/** `GET /v1/config` の内容。 */
export interface FeedpulseConfig {
  forms: FeedpulseForm[];
  /** 取得時刻（epoch ミリ秒）。 */
  fetchedAt: number;
  /** 通信に失敗して前回の保存値を返しているとき true。 */
  isStale: boolean;
}

/** `POST /v1/submit` の受理結果（202）。 */
export interface SubmitReceipt {
  id: string;
}

/** 入力値の型: short_text / long_text / email / select / radio = string、number / rating = number、checkbox = string[]。 */
export type FieldValue = string | number | string[];
export type FieldValues = Record<string, FieldValue | null | undefined>;

const BLOCK_TYPES: readonly string[] = [
  'short_text',
  'long_text',
  'email',
  'number',
  'select',
  'radio',
  'checkbox',
  'rating',
  'image',
  'file',
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined;
}

function optNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function parseBlock(j: unknown): FeedpulseBlock {
  if (!isObj(j) || typeof j.id !== 'string' || typeof j.type !== 'string' || typeof j.label !== 'string' || typeof j.required !== 'boolean') {
    throw new Error('block が不正');
  }
  if (!BLOCK_TYPES.includes(j.type)) throw new Error(`未知の block type: ${j.type}`);
  const options: FeedpulseOption[] = [];
  if (Array.isArray(j.options)) {
    for (const o of j.options) {
      if (!isObj(o) || typeof o.value !== 'string' || typeof o.label !== 'string') throw new Error('option が不正');
      options.push({ value: o.value, label: o.label });
    }
  }
  return {
    id: j.id,
    type: j.type as FeedpulseBlockType,
    label: j.label,
    required: j.required,
    maxLength: optInt(j.maxLength),
    min: optNum(j.min),
    max: optNum(j.max),
    options,
    maxFiles: optInt(j.maxFiles),
    maxTotalBytes: optInt(j.maxTotalBytes),
  };
}

/** config の forms[] 1 件（応答の形）を内部の形にする。不正なら Error。 */
export function parseForm(j: unknown): FeedpulseForm {
  if (!isObj(j) || !isObj(j.definition) || !Array.isArray(j.definition.blocks)) throw new Error('form が不正');
  if (typeof j.id !== 'string' || typeof j.slug !== 'string' || typeof j.name !== 'string' || typeof j.type !== 'string') {
    throw new Error('form が不正');
  }
  if (typeof j.version !== 'number' || !Number.isFinite(j.version)) throw new Error('form.version が不正');
  return {
    id: j.id,
    slug: j.slug,
    name: j.name,
    type: j.type as FeedpulseForm['type'],
    version: Math.trunc(j.version),
    allowTarget: j.definition.allowTarget === true,
    blocks: j.definition.blocks.map(parseBlock),
  };
}

/** 保存用（parseForm の入力と同じ応答の形）。 */
export function formToJson(f: FeedpulseForm): Record<string, unknown> {
  return {
    id: f.id,
    slug: f.slug,
    name: f.name,
    type: f.type,
    version: f.version,
    definition: {
      allowTarget: f.allowTarget,
      blocks: f.blocks.map((b) => ({
        id: b.id,
        type: b.type,
        label: b.label,
        required: b.required,
        ...(b.maxLength !== undefined && { maxLength: b.maxLength }),
        ...(b.min !== undefined && { min: b.min }),
        ...(b.max !== undefined && { max: b.max }),
        ...(b.options.length > 0 && { options: b.options }),
        ...(b.maxFiles !== undefined && { maxFiles: b.maxFiles }),
        ...(b.maxTotalBytes !== undefined && { maxTotalBytes: b.maxTotalBytes }),
      })),
    },
  };
}
