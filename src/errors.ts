/** 契約（web の error-response スキーマ）のエラーコード。 */
export type ContractErrorCode =
  | 'invalid_json'
  | 'invalid_pk'
  | 'invalid_platform'
  | 'invalid_app'
  | 'invalid_challenge'
  | 'challenge_expired'
  | 'attestation_failed'
  | 'app_not_registered'
  | 'invalid_session'
  | 'rate_limited'
  | 'unknown_project'
  | 'unknown_form'
  | 'invalid_form'
  | 'invalid_idempotency_key'
  | 'invalid_fields'
  | 'identity_invalid'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'quota_exceeded'
  | 'project_read_only'
  | 'not_found'
  | 'internal';

/** SDK 側で起きるエラー（契約のコードではない）。 */
export type SdkErrorCode =
  /** `configure` 前の呼び出し、または不正な引数。 */
  | 'not_configured'
  /** 通信できなかった（接続失敗・タイムアウト）。 */
  | 'network'
  /** アプリ証明を取得できなかった（Play ストア無し・App Attest 非対応の端末・ネイティブ未リンクなど）。 */
  | 'attestation_unavailable'
  /** サーバーが契約外の応答を返した。 */
  | 'unexpected_response';

export type FeedpulseErrorCode = ContractErrorCode | SdkErrorCode;

/** `invalid_fields` の検証エラーコード（サーバーと同じ語彙）。 */
export type FieldErrorCode =
  | 'required'
  | 'type'
  | 'too_long'
  | 'invalid_option'
  | 'invalid_email'
  | 'out_of_range'
  | 'too_many_files'
  | 'invalid_upload';

export const CONTRACT_ERROR_CODES: readonly ContractErrorCode[] = [
  'invalid_json',
  'invalid_pk',
  'invalid_platform',
  'invalid_app',
  'invalid_challenge',
  'challenge_expired',
  'attestation_failed',
  'app_not_registered',
  'invalid_session',
  'rate_limited',
  'unknown_project',
  'unknown_form',
  'invalid_form',
  'invalid_idempotency_key',
  'invalid_fields',
  'identity_invalid',
  'payload_too_large',
  'unsupported_media_type',
  'quota_exceeded',
  'project_read_only',
  'not_found',
  'internal',
];

export const FIELD_ERROR_CODES: readonly FieldErrorCode[] = [
  'required',
  'type',
  'too_long',
  'invalid_option',
  'invalid_email',
  'out_of_range',
  'too_many_files',
  'invalid_upload',
];

export interface FeedpulseErrorInit {
  message?: string;
  httpStatus?: number;
  fieldErrors?: Record<string, FieldErrorCode>;
  identityCode?: string;
  retryAfterSeconds?: number;
  cause?: unknown;
}

/** SDK が投げる唯一のエラー型（ピッカーの `FeedpulsePickError` を除く）。 */
export class FeedpulseError extends Error {
  readonly code: FeedpulseErrorCode;
  /** サーバー応答のときの HTTP ステータス。 */
  readonly httpStatus?: number;
  /** `invalid_fields` のとき、ブロック ID → 検証エラー。クライアント側検証でも同じ形。 */
  readonly fieldErrors: Record<string, FieldErrorCode>;
  /** `identity_invalid` のとき、サーバーが返した理由（`expired` など）。 */
  readonly identityCode?: string;
  /** `Retry-After`（秒）。429 など。 */
  readonly retryAfterSeconds?: number;
  readonly cause?: unknown;

  constructor(code: FeedpulseErrorCode, init: FeedpulseErrorInit = {}) {
    super(init.message ?? code);
    this.name = 'FeedpulseError';
    this.code = code;
    this.httpStatus = init.httpStatus;
    this.fieldErrors = init.fieldErrors ?? {};
    this.identityCode = init.identityCode;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.cause = init.cause;
  }

  /** 同じ送信を再試行してよいか（通信失敗・429・5xx）。 */
  get isRetryable(): boolean {
    return (
      this.code === 'network' ||
      this.code === 'rate_limited' ||
      this.code === 'internal' ||
      (this.httpStatus !== undefined && this.httpStatus >= 500)
    );
  }
}

export function contractErrorCode(v: unknown): ContractErrorCode | undefined {
  return typeof v === 'string' ? CONTRACT_ERROR_CODES.find((c) => c === v) : undefined;
}

export function fieldErrorCode(v: unknown): FieldErrorCode | undefined {
  return typeof v === 'string' ? FIELD_ERROR_CODES.find((c) => c === v) : undefined;
}
