# @feedpulse/react-native

Feedpulse React Native SDK。現状は「該当箇所ピッカー」(lv-kit/feedpulse-web #116) のブリッジ層のみ。SDK 本体 (#3 P2) は未実装。

```ts
import { pickTarget } from '@feedpulse/react-native';

const target = await pickTarget({ screen: 'Checkout' }); // キャンセル時は null
// submit の context.auto.target にそのまま載せる
```

- `testID` を付けた要素をタップすると `target.id` に入る（iOS: accessibilityIdentifier、Android: View tag）。
- `target.platform` は常に `react-native`。
- 入力値は取得しない。`label` は先頭80文字をネイティブへ要求（上限200）。
- エラー: `FeedpulsePickError` (`unavailable` / `already_picking` / `invalid_target` / `native_error`)。
- `cancelPickTarget()` で実行中のピッカーを閉じる（`pickTarget` は null で解決）。

## ネイティブ依存
- iOS: `Feedpulse`（SwiftPM, lv-kit/feedpulse-ios）を podspec の `spm_dependency` で取り込む（React Native 0.75+ が必要）。
- Android: `com.feedpulse:feedpulse-picker:0.1.0` に依存する。公開先リポジトリは利用側の `repositories` に追加する。
- 上限値 (`TARGET_LIMITS`) は web `feat/issue-105-target-picker` の #106 実装と一致済み（id 200 / label 200 / screen,path 512）。サーバーは id・path 超過で target ごと捨てる。
