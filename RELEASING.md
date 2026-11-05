# リリース手順

1. `package.json` の `version` を更新し、`CHANGELOG.md` に同じバージョンの節を追加する。
2. `npm run typecheck` / `npm test` / `npm pack --dry-run` を確認する。
3. 上記を PR で `main` に取り込む。
4. `main` で `git tag vX.Y.Z` を打って push する。
5. `npm publish --access public` で公開する（公開は取り消しにくい。メンテナが実行する）。

## 公開前提

- iOS SDK（`lv-kit/feedpulse-ios`）に `0.1.0` 以上のタグが打たれていること（podspec の `spm_dependency` が参照する）。
- Android SDK（`com.feedpulse:feedpulse-picker`）が GitHub Packages に公開されていること（`lv-kit/feedpulse-android` で `v0.1.0` タグを push すると公開される）。
- iOS SDK は `0.1.0` タグが push 済み。
- ネイティブ側は実機・実アプリでの動作確認が済んでいること（CI は JS の typecheck / test のみ）。
