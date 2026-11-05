# @feedpulse/react-native

Feedpulse React Native SDK。現状は「該当箇所ピッカー」(lv-kit/feedpulse-web #116) のブリッジ層のみ。SDK 本体 (#3 P2) は未実装。

```ts
import { pickTarget } from '@feedpulse/react-native';

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
- 最低 iOS は 15.0（iOS SDK に合わせる）。
- 上限値 (`TARGET_LIMITS`) は web `feat/issue-105-target-picker` の #106 実装と一致済み（id 200 / label 200 / screen,path 512）。サーバーは id・path 超過で target ごと捨てる。
