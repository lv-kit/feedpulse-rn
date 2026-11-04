# @feedpulse/react-native

Feedpulse React Native SDK。現状は「該当箇所ピッカー」(lv-kit/feedpulse-web #116) のブリッジ層のみ。SDK 本体 (#3 P2) は未実装。

```ts
import { pickTarget } from '@feedpulse/react-native';

const target = await pickTarget({ screen: 'Checkout' }); // キャンセル時は null
// submit の context.auto.target にそのまま載せる
```

- `testID` を付けた要素をタップすると `target.id` に入る（iOS: accessibilityIdentifier、Android: View tag）。
- `target.platform` は常に `react-native`。
- 入力値は取得しない。`label` は先頭80文字。
- エラー: `FeedpulsePickError` (`unavailable` / `already_picking` / `invalid_target` / `native_error`)。
- `cancelPickTarget()` で実行中のピッカーを閉じる（`pickTarget` は null で解決）。

## 未接続
- iOS: `ios/FeedpulsePicker.swift` は iOS SDK (#114) 待ち。
- Android: `FeedpulsePickerModule.kt` は Android SDK (#115) 待ち。
- `target` の上限値 (`TARGET_LIMITS`) は #106 確定待ちの仮置き。
