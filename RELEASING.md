# リリース手順

1. `package.json` の `version` を更新し、`CHANGELOG.md` に同じバージョンの節を追加する。
2. `npm run typecheck` / `npm test` / `npm pack --dry-run` を確認する。
3. 上記を PR で `main` に取り込む。
4. `main` で `git tag vX.Y.Z` を打って push する。
5. `npm publish --access public` で公開する（公開は取り消しにくい。メンテナが実行する）。
