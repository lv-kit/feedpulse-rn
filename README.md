# @stargazy/feedpulse-rn

Feedpulse React Native SDK。ヘッドレス（UI・スクリーンショットは含まない）。

- 設定取得（`GET /v1/config`）とローカル保存（失敗時は前回値）
- アプリ証明（iOS: App Attest、Android: Play Integrity）とセッション管理
- 項目定義に基づく入力検証、`POST /v1/submit`（冪等キー・再送）、`identify`
- 該当箇所ピッカー（`context.auto.target`）

## 導入

> **利用には Feedpulse への登録が必要。** SDK を使う前に <https://feedpulse.stargazy.xyz/> でアカウントを登録し、プロジェクトを作成して公開鍵（`pk_`）を発行する。さらに、プロジェクトに**アプリを登録**する（iOS: bundle ID と Apple Team ID、Android: package name と署名証明書の SHA-256）。未登録のアプリは `app_not_registered` になる。

要件: React Native（`react` / `react-native` は peerDependencies）、iOS 15.0 以上、Android minSdk 23 以上。ネイティブモジュールを含むので Expo Go では動かない（Expo は development build / prebuild が必要）。

### 1. JS パッケージを入れる

```bash
npm install @stargazy/feedpulse-rn
# または yarn add @stargazy/feedpulse-rn
```

### 2. iOS

`ios/Podfile` に、ネイティブ SDK（`Feedpulse`）を Git のタグで指定して追加する（CocoaPods のトランクには未公開）。

```ruby
pod 'Feedpulse', :git => 'https://github.com/lv-kit/feedpulse-ios.git', :tag => '0.1.1'
```

```bash
cd ios && pod install
```

### 3. Android

ネイティブ SDK（`com.feedpulse:feedpulse-picker:0.1.1`）は GitHub Packages にある。`read:packages` 権限のトークンを `~/.gradle/gradle.properties` に書く（コミットしない）。

```properties
gpr.user=<GitHub のユーザー名>
gpr.key=<read:packages 権限のトークン>
```

`android/build.gradle` の `allprojects.repositories` に追加する。

```groovy
maven {
    url = uri("https://maven.pkg.github.com/lv-kit/feedpulse-android")
    credentials {
        username = project.findProperty("gpr.user")
        password = project.findProperty("gpr.key")
    }
}
```

### 4. ビルドし直す

JS のみの再読み込みでは反映されない。`npx react-native run-ios` / `run-android`（または Xcode / Android Studio のビルド）でネイティブを再ビルドする。

### 5. プラットフォーム設定

- **iOS**: Xcode の Signing & Capabilities で **App Attest** を有効にする（entitlement `com.apple.developer.devicecheck.appattest-environment`。開発ビルドは `development`、配布は `production`）。サーバー側で開発環境の許可（`APPLE_APP_ATTEST_ALLOW_DEVELOPMENT`）が必要。シミュレーターは App Attest 非対応（`attestation_unavailable`）。
- **Android**: Play Console でアプリに **Play Integrity API** を有効にし、Google Cloud プロジェクトを紐づける。Google Play 配信（内部テスト含む）の署名で判定される。エミュレーターや Play ストアの無い端末は `attestation_unavailable`。

## 使い方

```ts
import { configure, identify, refreshConfig, submit, pickTarget, FeedpulseError } from '@stargazy/feedpulse-rn';

// 1. 起動時に 1 回。baseUrl の既定は本番。
configure({ publicKey: 'pk_...' });

// 2. 項目定義を取得（失敗時は前回値。isStale で判別）
const config = await refreshConfig();
const form = config.forms.find((f) => f.slug === 'bug')!;

// 3. ログイン中のユーザーを紐づける（任意）。顧客バックエンドが sk_ で署名した JWT をそのまま渡す。
identify(jwtFromYourBackend); // null で解除

// 4. 送信。入力は項目定義で事前検証され、不正なら送らず invalid_fields を投げる。
try {
  const receipt = await submit({
    formId: form.id,
    fields: { title: 'ログインできない', severity: 'high' },
    target, // pickTarget の結果（任意）。form.allowTarget のときだけ送る
    custom: { plan: 'pro' }, // context.custom（任意）
  });
} catch (e) {
  if (e instanceof FeedpulseError) {
    switch (e.code) {
      case 'invalid_fields': // e.fieldErrors: ブロック ID → 'required' | 'too_long' | ...
      case 'identity_invalid': // e.identityCode: 'expired' など
      case 'rate_limited': // e.retryAfterSeconds
      default:
        break;
    }
  }
}
```

### 公開 API

- `configure({ publicKey, baseUrl? })` / `identify(token)` / `refreshConfig()` / `submit({ formId, fields, target?, custom?, idempotencyKey? })`。`Feedpulse.configure(...)` の形でも呼べる。
- `FeedpulseClient`（`getClient()` / `configure` の戻り値）: 上記の本体。`config` / `lastError` / `loadCachedConfig()`。
- 型: `FeedpulseConfig` / `FeedpulseForm` / `FeedpulseBlock` / `SubmitReceipt` / `FieldValues`。
- `FeedpulseError`（`code: FeedpulseErrorCode`、`httpStatus`、`fieldErrors`、`identityCode`、`retryAfterSeconds`、`isRetryable`）。`code` は契約のエラーコード（`invalid_fields` / `identity_invalid` / `rate_limited` / `app_not_registered` / `attestation_failed` など）と、SDK 側の `not_configured` / `network` / `attestation_unavailable` / `unexpected_response`。
- 差し替え口: `AppAttestor`（既定は `NativeAppAttestor`。`DevInsecureAttestor` はローカル開発サーバー専用）、`FeedpulseTransport`（既定は `fetch`）、`ConfigStore`（既定は `NativeConfigStore`）。
- `validateFields(form, fields)`: 入力検証。値の型は short_text / long_text / email / select / radio = `string`、number / rating = `number`、checkbox = `string[]`。image / file は未対応（検証しない。送信もしない）。

### 挙動

- セッションは 900 秒有効。期限の 60 秒前に取り直し、`invalid_session` なら取り直して 1 回だけやり直す。challenge の期限切れも 1 回だけやり直す。
- `submit` は同じ冪等キーで再送する。対象は通信失敗・429・5xx で、最大 3 回（1 秒から倍々、429 は `Retry-After` を優先、上限 120 秒）。キーはアプリ側から渡すこともできる（`^[A-Za-z0-9_-]{16,64}$`）。
- config のローカル保存は、依存を増やさないためこのパッケージのネイティブモジュール（iOS: UserDefaults、Android: SharedPreferences）に保存する。ネイティブが使えないときはメモリだけ。保存値から復元した config は `isStale: true`。保存値が古くて入力検証に落ちたときは、最新の定義を取り直してから判定する。
- iOS は端末鍵 ID を UserDefaults に保存し、初回だけ attestation、以降は assertion を送る。サーバーが `attestation_failed` を返したら保存した鍵を捨てる。
- `Origin` ヘッダーは付けない。`X-FeedPulse-Platform` と `Authorization: Bearer` でネイティブ経路として扱われる。
- 画像・ファイル添付は未対応。

## 該当箇所ピッカー

```ts
import { pickTarget } from '@stargazy/feedpulse-rn';

const target = await pickTarget({ screen: 'Checkout' }); // キャンセル時は null
// submit の context.auto.target にそのまま載せる
```

- `testID` を付けた要素をタップすると `target.id` に入る（iOS: accessibilityIdentifier、Android: View tag）。
- 中の文字や子要素をタップしても親の `testID` を `id` にしたいときは、その `View` に `collapsable={false}` を付ける。付けないと、新アーキテクチャ（Fabric）のビュー平坦化で子が親の階層から外れ、子だけが選ばれて `id` が付かない（RN 0.88 の iOS で確認）。
- `target.platform` は常に `react-native`。
- 入力値は取得しない。`label` は先頭80文字をネイティブへ要求（上限200）。
- エラー: `FeedpulsePickError` (`unavailable` / `already_picking` / `invalid_target` / `native_error`)。
- `cancelPickTarget()` で実行中のピッカーを閉じる（`pickTarget` は null で解決）。

## ネイティブ依存
- iOS: `Feedpulse`（CocoaPods, lv-kit/feedpulse-ios）に依存する。トランクには未公開なので、利用アプリの `ios/Podfile` に次を追加する。

```ruby
pod 'Feedpulse', :git => 'https://github.com/lv-kit/feedpulse-ios.git', :tag => '0.1.1'
```
- Android: `com.feedpulse:feedpulse-picker:0.1.1` に依存する。GitHub Packages（`https://maven.pkg.github.com/lv-kit/feedpulse-android`）から取得するので、利用アプリの `android/build.gradle` の `allprojects.repositories` に次を追加する（`read:packages` 権限のトークンが要る）。

```groovy
maven {
    url = uri("https://maven.pkg.github.com/lv-kit/feedpulse-android")
    credentials {
        username = project.findProperty("gpr.user")
        password = project.findProperty("gpr.key")
    }
}
```
- アプリ証明用に、iOS は DeviceCheck / CryptoKit（OS 標準）をリンクし、Android は `com.google.android.play:integrity:1.5.0`（Maven Central / Google）に依存する。
- 最低 iOS は 15.0（iOS SDK に合わせる）。
- 上限値 (`TARGET_LIMITS`) は web main の `packages/shared/src/context.ts` と一致済み（id 128 / label 200 / screen,path 512）。サーバーは id・path 超過で target ごと捨てる。

## 検証範囲

契約 fixture を使った単体テスト（HTTP とアプリ証明を差し替え）、`tsc`、`npm pack --dry-run` は CI で確認している。**実機の App Attest / Play Integrity の動作と、ネイティブコード（Swift / Kotlin）のビルドは未検証**（CI は JS のみ。実機・実サーバーでの疎通は手作業で確認が必要）。

テストは web の契約 fixture（`src/__tests__/fixtures/contract.json`。正本は feedpulse-web の `packages/shared/src/native/fixtures/`）を読み、HTTP とアプリ証明を差し替えて検証する。
