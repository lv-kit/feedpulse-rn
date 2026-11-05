# リリース手順

1. `package.json` の `version` を更新し、`CHANGELOG.md` に同じバージョンの節を追加する。
2. `npm run typecheck` / `npm test` / `npm pack --dry-run` を確認する。
3. 上記を PR で `main` に取り込む。
4. `main` で `git tag vX.Y.Z` を打って push する。
5. `npm publish --access public` で公開する（公開は取り消しにくい。メンテナが実行する）。

## 公開前提

- iOS SDK（`lv-kit/feedpulse-ios`）に `0.1.1` 以上のタグが打たれていること（`Feedpulse.podspec` を含む版。利用側の Podfile が `:tag` で参照する）。
- Android SDK（`com.feedpulse:feedpulse-picker`）が GitHub Packages に公開されていること（`lv-kit/feedpulse-android` で `vX.Y.Z` タグを push すると公開される。`android/build.gradle` の依存版と一致させる）。
- ネイティブ側は実機・実アプリでの動作確認が済んでいること（CI は JS の typecheck / test のみ）。
