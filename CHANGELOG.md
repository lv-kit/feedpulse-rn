# Changelog

## Unreleased

- Android の `pickTarget` が不正なオプション（`labelMaxLength` が数値以外・非整数、`screen` が文字列以外）で Promise を reject しないまま残る問題を修正。`invalid_options` で reject し、UI スレッド内・結果コールバック内の例外も `pick_failed` で reject する（JS 側では `native_error`）。
- `configure` の `baseUrl` 検証を修正。`http://localhost:80@attacker.example` のように URL の認証情報でローカルホスト判定を回避できた問題を、URL 全体の検証（認証情報・バックスラッシュ・空白・不正なポートの拒否）に変更。
- 開発用: lint を oxlint（型認識あり）に、TypeScript を 7 系に、Jest の変換を `@swc/jest` に更新（SDK の公開 API に変更なし）。
- `target.id` の上限を 200 から 128 に修正（feedpulse-web の `MAX_TARGET_ID` に合わせる。超過するとサーバーが target ごと捨てる）。

## 0.2.0

- SDK 本体を追加（ヘッドレス、UI なし）。`configure` / `identify` / `refreshConfig` / `submit`、`FeedpulseClient`。
- アプリ証明を追加。iOS は App Attest、Android は Play Integrity。既存のネイティブモジュール（`FeedpulsePicker`）に `environment` / `attest` / `commitAttestation` / `resetAttestation` / `storeRead` / `storeWrite` を追加。iOS / Android SDK の新 API には依存しない。Android は `com.google.android.play:integrity:1.5.0` に依存する。iOS は DeviceCheck / CryptoKit をリンクする。
- `POST /v1/native/challenge` → `POST /v1/native/session` でセッションを取得（900 秒。期限の 60 秒前に取り直し）。
- `GET /v1/config` の取得とローカル保存（iOS: UserDefaults、Android: SharedPreferences。失敗時は前回値、`isStale`）。
- 項目定義に基づくクライアント側の入力検証（`validateFields`）。
- `POST /v1/submit`: 冪等キー（SDK が生成）、再送（最大 3 回、指数バックオフ、429 は `Retry-After`）、`context.auto.target` / `context.custom` / `context.identity`。
- エラーを契約のエラーコードにマップした `FeedpulseError` を追加。
- 契約 fixture（feedpulse-web の `packages/shared/src/native/fixtures/contract.json`）を読む単体テストを追加。
- 既存の `pickTarget` / `cancelPickTarget` / `sanitizeTarget` は変更なし。
- 実機の App Attest / Play Integrity は未検証（ネイティブ実装は書いたが、実機・実サーバーでの疎通は手作業で確認が必要）。

## 0.1.0

- 該当箇所ピッカーのブリッジ（`pickTarget` / `cancelPickTarget`、target サニタイザ）を追加。
