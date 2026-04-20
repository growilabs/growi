# 実装計画

以下のタスク集は design.md の Phased Migration (Phase 1–5) と Phase 6 の end-to-end 検証に対応する。各 major task の末尾には phase gate を設け、成功時のみ次 phase に進む (Req 6.6)。

## Phase 1: 残余共有パッケージの ESM 宣言

- [ ] 1. 共有パッケージ 5 つを ESM 宣言に揃える
- [ ] 1.1 (P) `@growi/pdf-converter-client` を ESM 化
  - `packages/pdf-converter-client/package.json` に `"type": "module"` を追加
  - `packages/pdf-converter-client/orval.config.js` を `orval.config.cjs` にリネーム
  - `packages/pdf-converter-client/package.json` の orval 関連スクリプトの参照を `.cjs` に更新
  - `turbo run build --filter @growi/pdf-converter-client` が成功し、orval 生成コードが ESM として解決される
  - _Requirements: 1.1, 1.2, 5.3_
  - _Boundary: Package Config Updater (pdf-converter-client)_

- [ ] 1.2 (P) `@growi/preset-templates` を ESM 化
  - `packages/preset-templates/package.json` に `"type": "module"` を追加
  - 本パッケージは JS ソースを持たないため設定のみの変更
  - `turbo run build --filter @growi/preset-templates` が成功
  - _Requirements: 1.1, 1.2, 5.3_
  - _Boundary: Package Config Updater (preset-templates)_

- [ ] 1.3 (P) `@growi/preset-themes` を ESM 化 (dual 出力維持)
  - `packages/preset-themes/package.json` に `"type": "module"` を追加
  - Vite 設定の `build.lib.formats` に ES と UMD の両方が残っていることを確認
  - `turbo run build --filter @growi/preset-themes` が成功し、`dist/` に ES と UMD の双方が生成される
  - _Requirements: 1.1, 1.2, 1.3, 5.3_
  - _Boundary: Package Config Updater (preset-themes)_

- [ ] 1.4 (P) `@growi/core-styles` と `@growi/custom-icons` を ESM 化
  - 両パッケージの `package.json` に `"type": "module"` を追加
  - JS 出力を持たないため一貫性目的の宣言のみ
  - `turbo run build --filter @growi/core-styles --filter @growi/custom-icons` が成功
  - _Requirements: 1.1, 5.3_
  - _Boundary: Package Config Updater (core-styles, custom-icons)_

- [ ] 1.5 Phase 1 統合ゲート
  - 5 パッケージ変換後に `turbo run build` をモノレポ全体で実行し、`apps/app` を含む下流コンシューマが退行しないことを確認
  - Phase 1 完了コミットに revert 用のタグを付与
  - _Requirements: 1.4, 6.6_
  - _Depends: 1.1, 1.2, 1.3, 1.4_

## Phase 2: ルート/apps/app の type:module 宣言と CJS 隔離

- [ ] 2. 既定モジュールを ESM に切替え、CJS 残置箇所を明示化
- [ ] 2.1 (P) `apps/app/src/migrations/` をディレクトリ単位で CJS 隔離
  - `apps/app/src/migrations/package.json` を新規作成し `{ "type": "commonjs" }` を宣言
  - `apps/app/tsconfig.build.server.json` の `exclude` に `src/migrations/**` が含まれていることを再確認
  - `pnpm run dev:migrate` が実 DB に対してマイグレーション読込を成功させる
  - _Requirements: 5.4, 5.5_
  - _Boundary: CJS Isolation Strategy (migrations)_

- [ ] 2.2 (P) `apps/app/config/` の 3 ファイルを `.cjs` にリネーム
  - `apps/app/config/migrate-mongo-config.js`, `next-i18next.config.js`, `i18next.config.js` をそれぞれ `.cjs` に変更
  - `apps/app/package.json` 内の `migrate` 系スクリプトと i18next 初期化コードのパス参照を新拡張子に更新
  - `pnpm run dev:migrate` と i18next 初期化が正常動作することを smoke 確認
  - _Requirements: 5.4_
  - _Boundary: CJS Isolation Strategy (config files)_

- [ ] 2.3 ワークスペースルートと `apps/app` に `"type": "module"` を宣言
  - ルート `package.json` と `apps/app/package.json` の両方に `"type": "module"` を追加
  - 宣言後に `apps/app/config/*.cjs` および `src/migrations/*.js` が CJS として扱われ続けることを確認
  - `pnpm install` が成功し、`pnpm why` で解決が変化していないこと
  - _Requirements: 5.1, 5.2_
  - _Depends: 2.1, 2.2_

- [ ] 2.4 Phase 2 統合ゲート
  - `turbo run build` と `turbo run lint` が成功 (サーバ側は依然 CJS でコンパイル)
  - 既存 dev ランナー (`ts-node` + `tsconfig-paths`) による `pnpm dev` が引き続き起動する
  - _Requirements: 5.6, 6.6_
  - _Depends: 2.3_

## Phase 3: apps/app サーバ層の ESM 化

- [ ] 3. サーバソースから CJS 構文を排除し、ESM 出力に切替
- [ ] 3.0 循環依存ベースラインの取得と記録
  - `npx madge --circular --extensions js,ts apps/app/src/server` を実行し結果を `research.md` または PR 本文に保存
  - 2026-04-20 時点の 25 件ベースラインと件数・ハブ構造が一致することを確認 (差分があれば design.md を更新)
  - `service/search-delegator/elasticsearch-client-delegator/interfaces.ts` の独立分離 (`crowi/index.ts` 非経由の 1 件) の対処計画を確定
  - _Requirements: 2.6_
  - _Boundary: Codemod Transform (pre-analysis)_

- [ ] 3.1 `models/user/*` の service singleton 参照を lazy 化
  - `configManager` と `aclService` のモジュールトップ import を getter / ラッパ関数経由の遅延取得に置換
  - research.md §2.3 パターン A に挙げた他のモデルファイルも同様に修正
  - 既存の `apps/app/src/**/*.integ.ts` を実行し、モデル初期化を経由する統合テストが pass する
  - _Requirements: 2.6_
  - _Depends: 3.0_
  - _Boundary: Codemod Transform (models lazy-load)_

- [ ] 3.2 jscodeshift カスタム transform を作成
  - `tools/codemod/cjs-to-esm.ts` を新規作成し、design.md の 4 パターン (module.exports → export、static require → import、factory require+invoke、conditional require) をすべて扱う
  - ディレクトリ引数を受け取る CLI ラッパ (`pnpm codemod:cjs-to-esm -- <path>`) を実装し、step ごとに独立実行できるようにする
  - jscodeshift の test utility で 4 パターンそれぞれに input→expected のスナップショットテストを追加
  - 追加テストが全件 pass
  - _Requirements: 2.2, 2.3, 2.5, 2.6_
  - _Boundary: Codemod Transform (tooling)_

- [ ] 3.3 段階適用: codemod を依存の内側から外側へディレクトリ単位で適用
  - 各 step は単一コミット。失敗時は当該 step のみ revert して原因修正後に再実行する (Req 6.6)
  - 各 step 完了後に `tsc --noEmit` を実行し、型エラー 0 件を確認 (NodeNext 切替前のため `.js` 拡張子エラーは許容)

- [ ] 3.3.a (step 3.a) `models/` と `events/` を変換
  - `pnpm codemod:cjs-to-esm -- apps/app/src/server/models apps/app/src/server/events` を実行
  - `module.exports` → named export、静的 `require` → `import` の 2 パターンが対象
  - `ReferenceError: Cannot access 'X' before initialization` が発生しないこと (dev build で確認)
  - _Requirements: 2.2, 2.3_
  - _Depends: 3.2_
  - _Boundary: Codemod Transform (models/events)_

- [ ] 3.3.b (step 3.b) `service/` を変換 (`search-delegator` の interface 分離を含む)
  - `service/search-delegator/elasticsearch-client-delegator/interfaces.ts` と `es7-client-delegator.ts` の循環を、型のみの独立ファイルに分離することで構造解消
  - `pnpm codemod:cjs-to-esm -- apps/app/src/server/service` を実行
  - 動的 `require` → `await import` の変換も含む
  - `*.integ.ts` のうち service 層を触るテストが pass
  - _Requirements: 2.2, 2.3, 2.5_
  - _Depends: 3.3.a_
  - _Boundary: Codemod Transform (service)_

- [ ] 3.3.c (step 3.c) `middlewares/`, `util/`, `pageserv/` 等の非ルートを変換
  - `pnpm codemod:cjs-to-esm -- apps/app/src/server/middlewares apps/app/src/server/util apps/app/src/server/pageserv` ほか
  - 各サブツリーで `tsc --noEmit` をクリーン
  - _Requirements: 2.2, 2.3_
  - _Depends: 3.3.b_
  - _Boundary: Codemod Transform (middlewares/util)_

- [ ] 3.3.d (step 3.d) `routes/` 配下の非中央ファイル (~40 本) を変換
  - `routes/index.js` と `routes/apiv3/index.js` を **除く** `routes/**/*.js` に対して codemod を実行
  - factory DI (`module.exports = (crowi, app) => ...`) を named export に変換
  - _Requirements: 2.2, 2.3, 2.6_
  - _Depends: 3.3.c_
  - _Boundary: Codemod Transform (routes leaves)_

- [ ] 3.3.e (step 3.e) `routes/index.js` (中央ルーター 12 箇所) を変換
  - factory invoke (`require('./x')(crowi, app)`) を `import { setup as setupX } from './x.js'; const x = setupX(crowi, app);` に変換
  - 変換後に `pnpm dev` を起動し、`/_api/v3/healthcheck` が 200 を返すこと
  - _Requirements: 2.3, 2.6_
  - _Depends: 3.3.d_
  - _Boundary: Codemod Transform (routes/index)_

- [ ] 3.3.f (step 3.f) `routes/apiv3/index.js` (中央ルーター 44 箇所) を変換
  - 3.3.e と同じ規約で 44 エントリを名前付き factory invoke に変換
  - supertest もしくは手動で apiv3 代表エンドポイント (例: `/_api/v3/healthcheck`, `/_api/v3/users`, `/_api/v3/page`) がそれぞれ想定ステータスを返すこと
  - _Requirements: 2.3, 2.6_
  - _Depends: 3.3.e_
  - _Boundary: Codemod Transform (routes/apiv3/index)_

- [ ] 3.3.g (step 3.g) `crowi/` を変換し `import/no-commonjs` 0 件を達成
  - `crowi/index.ts`, `crowi/setup-models.ts`, `crowi/dev.js` に codemod を適用
  - 変換完了後、ESLint `import/no-commonjs` が `apps/app/src/server/` 全域で 0 件検出
  - 変換統計が想定規模 (約 82 ファイルの module.exports、176 箇所の require、56 箇所の factory invoke) と累計で一致
  - _Requirements: 2.2, 2.3, 2.5, 2.6_
  - _Depends: 3.3.f_
  - _Boundary: Codemod Transform (crowi)_

- [ ] 3.4 `ts2esm` で `.js` 拡張子を補完
  - `ts2esm` を `apps/app/src/server/` に対して実行
  - すべての relative import が `.js` 拡張子付きとなる
  - `NodeNext` 切替前の段階でも `tsc --noEmit` が拡張子起因のエラーを出さないこと
  - _Requirements: 2.2, 2.3_
  - _Depends: 3.3.g_
  - _Boundary: Codemod Transform (extensions)_

- [ ] 3.5 `__dirname` / `__filename` を 3 ファイルで手動置換
  - `apps/app/src/server/crowi/index.ts`, `crowi/dev.js`, `service/i18next.ts` の `__dirname` を `import.meta.dirname` 相当に置換
  - 置換後も i18next リソース読込とアプリ起動が同じファイルパスに解決されることを smoke で確認
  - _Requirements: 2.4_
  - _Boundary: Codemod Transform (dirname)_

- [ ] 3.6 `tsconfig.build.server.json` を NodeNext に切替
  - `"module": "CommonJS"` → `"module": "NodeNext"`、`"moduleResolution": "Node"` → `"moduleResolution": "NodeNext"` に変更
  - `exclude` に `src/migrations/**` が含まれていることを再確認
  - `turbo run build --filter @growi/app` が成功し、`transpiled/` 配下に ESM 出力が生成される
  - _Requirements: 2.1_
  - _Depends: 3.3, 3.4, 3.5_
  - _Boundary: Server Build Config_

- [ ] 3.7 開発/本番起動スクリプトを tsx / --import に切替
  - `apps/app/package.json` の `scripts.ts-node` を廃止し、`dev` / `launch-dev:ci` / `repl` / `dev:migrate-mongo` を `tsx` ベースに書き換え
  - 本番起動スクリプトを `node --import dotenv-flow/config dist/server/app.js` に変更
  - `pnpm dev` でサーバが起動し、`curl http://localhost:3000/_api/v3/healthcheck` が 200 を返す
  - _Requirements: 2.7_
  - _Depends: 3.6_
  - _Boundary: Dev Runner Adapter_

- [ ] 3.8 Phase 3 統合ゲート
  - `turbo run build lint test --filter @growi/app` がすべて成功 (test は移行前ベースラインと比較して新規失敗なし)
  - `pnpm dev` 起動 + Playwright smoke (ログイン / ページ作成 / Markdown 保存) が通る
  - `import/no-commonjs` が `apps/app/src/server/` で 0 件検出を維持
  - Yjs / WebSocket の確認は Phase 6 (6.2) に委譲 (既存 Playwright スペック未整備のため)
  - _Requirements: 2.8, 2.9, 6.1, 6.2, 6.3, 6.6_
  - _Depends: 3.7_

## Phase 4: transpilePackages の削減

- [ ] 4. `next.config.ts` から CJS 起因エントリを除去
- [ ] 4.1 prefix グループを 1 つずつ削除評価
  - `remark-` / `rehype-` / `hast-` / `mdast-` / `micromark-` / `unist-` を順に `listPrefixedPackages` から除外
  - 各削除後に `turbo run build --filter @growi/app` + `.next/node_modules/` 目視確認 + `pnpm start` で SSR smoke を実行
  - 失敗した prefix は `next.config.ts` に戻し、インラインコメントで残存理由を記録
  - 最終的に prefix 配列が最小化されている (削除できたものはすべて削除済み)
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: transpilePackages Reducer (prefix groups)_

- [ ] 4.2 hardcoded エントリを評価・削除
  - 42 件のハードコードエントリをエコシステム単位でグルーピングし、グループごとに削除 → build → smoke を実施
  - 失敗したエントリは戻してインラインコメントで理由を記録
  - 残存エントリすべてが CJS 以外の理由を示すインラインコメントを持つ
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 7.2_
  - _Depends: 4.1_
  - _Boundary: transpilePackages Reducer (hardcoded)_

- [ ] 4.3 Phase 4 検証: CI `reusable-app-prod.yml` で本番相当確認
  - GitHub Actions の `reusable-app-prod.yml` を `workflow_dispatch` でトリガ
  - `build-prod` と `launch-prod` の両ジョブが成功
  - `check-next-symlinks.sh` が `fslightbox-react` 以外の broken symlink を検出しない
  - _Requirements: 3.5, 6.4, 6.6_
  - _Depends: 4.2_

## Phase 5: pnpm.overrides 削除とドキュメント整合

- [ ] 5. CJS 起因の override を除去し、文書を新状態に同期
- [ ] 5.1 `@lykmapipo/common>flat` override を削除評価
  - ルート `package.json` の overrides から `flat` ピンを削除
  - `pnpm install` 成功後 `turbo run build` を実行し、`pnpm why flat` で最新 ESM バージョンが解決されることを確認
  - サーバを起動し mongoose-gridfs 経由のファイルアップロードフローを smoke
  - 失敗時は override を戻しインラインコメントで原因記録
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Boundary: Overrides Reducer (flat)_

- [ ] 5.2 `@lykmapipo/common>mime` override を削除評価
  - overrides から `mime` ピンを削除し、5.1 と同じプロトコル (install → build → file-upload smoke) で検証
  - `pnpm why mime` で最新 ESM バージョンが解決される
  - 失敗時は戻してインラインコメントで原因記録
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Depends: 5.1_
  - _Boundary: Overrides Reducer (mime)_

- [ ] 5.3 `@lykmapipo/common>parse-json` override を削除評価
  - overrides から `parse-json` ピンを削除し、5.1 と同じプロトコルで検証
  - `axios` override は変更しないことを確認
  - 失敗時は戻してインラインコメントで原因記録
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Depends: 5.2_
  - _Boundary: Overrides Reducer (parse-json)_

- [ ] 5.4 dependency コメントとインライン理由を整理
  - `package.json` の `// comments for dependencies` から解消済みの CJS/ESM ピン記述を削除
  - 残存する `transpilePackages` / `pnpm.overrides` のすべてのエントリにインライン理由コメントが存在することを確認
  - _Requirements: 7.1, 7.2, 7.3_
  - _Depends: 4.2, 5.3_

- [ ] 5.5 ステアリング文書と auto-loaded skill を同期更新
  - `.kiro/steering/tech.md` の Production Assembly / Turbopack 外部化の記述を ESM 前提に書き換え
  - `.claude/skills/tech-stack/SKILL.md` と `.claude/skills/monorepo-overview/SKILL.md` の CJS/ESM 関連節を最新化
  - 更新後の文書に含まれるコードブロックや件数がリポジトリ実態と一致する
  - _Requirements: 7.4_
  - _Depends: 5.4_

## Phase 6: 本番アセンブリ end-to-end 検証

- [ ] 6. 本番アーティファクトで全要件を最終確認
- [ ] 6.1 `assemble-prod.sh` をローカル実行し本番相当アーティファクトを生成
  - `assemble-prod.sh` が成功し、既定出力ディレクトリに成果物が生成される
  - `check-next-symlinks.sh` が `fslightbox-react` 以外の broken symlink を検出しない
  - _Requirements: 6.4_
  - _Depends: 5.5_

- [ ] 6.2 本番アーティファクトを起動して機能 smoke
  - `node --import dotenv-flow/config dist/server/app.js` でサーバを起動
  - **API**: apiv3 代表エンドポイント (`/_api/v3/healthcheck` ほか 2 種) が期待ステータスを返す
  - **SSR**: トップページと任意のユーザページを HTTP GET し、200 応答で HTML 内に期待文字列が含まれること
  - **WebSocket (socket.io)**: `curl --include --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" http://$HOST/socket.io/` が接続確立 (101 もしくは認証拒否の 4xx) で、5xx / `ERR_MODULE_NOT_FOUND` ではないこと
  - **WebSocket (Yjs)**: 2 クライアントで同一ページを Chromium で開き、クライアント A の編集が 2 秒以内にクライアント B に反映されること。DevTools Network で `ws://.../y-websocket` が `101 Switching Protocols` で確立
  - 起動時間が移行前ベースラインの ±20% 以内
  - _Requirements: 6.5_
  - _Depends: 6.1_

- [ ] 6.2.1 (任意) Yjs 同期 Playwright スペックを追加
  - `apps/app/playwright/23-editor/yjs-sync.spec.ts` (仮) を追加し 6.2 の Yjs 手順を自動化
  - `reusable-app-prod.yml` の `launch-prod` で自動実行されるよう組み込む
  - 本タスクは CI 自動化を目的とする延命措置で、6.2 の手動 smoke 成功が Req 6.5 の充足条件である
  - _Requirements: 6.5_
  - _Depends: 6.2_

- [ ] 6.3 CI 最終通過
  - `reusable-app-prod.yml` を `workflow_dispatch` で実行し、`build-prod` と `launch-prod` の両ジョブが成功
  - 全 Phase の変更を含むブランチが `server:ci` でエラーなく起動・終了する
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Depends: 6.2_
