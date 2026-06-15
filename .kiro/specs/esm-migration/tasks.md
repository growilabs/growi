# 実装計画

以下のタスク集は design.md の Phased Migration (Phase 1–5) と Phase 6 の end-to-end 検証に対応する。各 major task の末尾には phase gate を設け、成功時のみ次 phase に進む (Req 6.6)。

## Phase 0: ベースライン捕捉と事前ガード整備

Phase 1 以降の検証に必要な比較基準と構造ガードを、移行前の master に対して先行取得する。ここで取得した成果物は移行全ての phase のゲート判定に利用する。

- [x] 0. 移行前ベースラインを確立する
- [x] 0.1 テスト結果ベースラインを捕捉
  - 移行前 master で `turbo run test --filter @growi/app` を **3 回連続実行** し、全回の per-spec pass/fail を記録
  - 結果を `.kiro/specs/esm-migration/test-baseline.md` にコミット (3 回連続 fail = 真の失敗、回ごとに揺れる = 既知 flaky)
  - Phase 3 以降の Req 2.9 / 6.3 判定はこの表との差分のみを新規失敗として扱う
  - _Requirements: 2.9, 6.3_

- [x] 0.2 セキュリティ監査ベースラインを捕捉
  - `pnpm audit --audit-level=moderate --json > .kiro/specs/esm-migration/audit-baseline.json` を取得
  - Phase 5 の override 削除ごとに diff を取り、新規 HIGH/CRITICAL advisory が出た場合は該当 override を維持
  - **`axios` override の CVE プレースホルダ (`package.json` 内の `CVE-2025-XXXXX` 等) を Phase 0 で実 advisory ID / GHSA URL に置換**。プレースホルダのまま次 phase に進むことを禁止。現行ピン (`^1.15.0` 等) が該当 advisory を実際にカバーしていることを `pnpm audit --json` 出力で確認し、確認結果を `audit-baseline.json` に併記
  - _Requirements: 4.1, 4.3, 4.4, 7.3_

- [x] 0.3 `/api/v3/**` auth middleware チェーンのスナップショットを取得
  - 移行前の `pnpm dev` 起動状態で `app._router.stack` を walk し、各 apiv3 エンドポイントについて `(method, path, middlewareNames[])` を JSON に出力するスクリプトを追加 (`tools/snapshot-route-middleware.ts`)
  - walker は **無名関数を許容しない**: `handle.name === ''` / `'anonymous'` が apiv3 リーフのチェーンに 1 件でも出現したら fail として、該当 middleware factory を named function 化してから再実行する
  - 出力を `.kiro/specs/esm-migration/route-middleware-baseline.json` にコミット
  - スクリプトは Phase 3.8 ゲートで再実行して diff を取るため、ESM/CJS 両方で動作する実装にする (Phase 3.7.a で選定する ESM 対応ランナー、もしくは pre-build した `dist/` 経由で起動可能)
  - _Requirements: 2.6, 2.8_

- [x] 0.3.1 ブラックボックス認可マトリクスベースラインを捕捉 (snapshot 補完 / MANDATORY)
  - structural snapshot (0.3) が拾えないケース (インライン `express.Router()` のガード、無名アロー middleware、Mongoose model 取得順差異) を補完するため、**supertest ベースの認可マトリクステスト**を追加
  - 全 apiv3 エンドポイント × {unauthenticated / guest / read-only / admin} の 4 persona で期待 HTTP ステータス (401 / 403 / 200 / 302 等) を記録
  - 出力を `.kiro/specs/esm-migration/authz-matrix-baseline.json` にコミット
  - テストは本番ビルド成果物に対して実行する想定 (dev 実装と分岐しないため)。Phase 3.8.c で diff 実行し、差分 = 認可バイパスと見なして Phase 4 進行を block する
  - _Requirements: 2.6, 2.8, 6.5_

- [x] 0.3.2 WebSocket 認可マトリクスベースラインを捕捉 (MANDATORY)
  - `service/yjs/upgrade-handler.ts` と `service/socket-io/socket-io.ts` の認可は `app._router.stack` から見えないため独立ベースライン化
  - `/yjs/<pageId>` について 3 ケース (セッション無し / 有効セッション+閲覧不可ページ / 有効セッション+許可ページ) の接続結果 (4xx / 4xx / 101+Yjs 同期) を記録
  - socket.io `connect` についても同等 3 ケースを記録
  - 出力を `.kiro/specs/esm-migration/ws-authz-baseline.json` にコミット
  - Phase 3.8.d で diff 実行し、差分は Phase 4 進行を block
  - _Requirements: 2.6, 6.5_

- [x] 0.4 起動時パフォーマンスベースラインを捕捉 (本番側)
  - 移行前の本番相当出力 (`pnpm run server:ci` 相当) で、起動完了までの wall time を 5 回計測し中央値を記録
  - OpenTelemetry が利用可能な場合、5 代表ルート (`/`, `/editor/:id`, `/_api/v3/healthcheck`, `/admin`, LSX/drawio/attachment-refs を含むサンプルページ) の first-request p50/p95 を `.kiro/specs/esm-migration/perf-baseline.md` に記録
  - _Requirements: 6.5_

- [x] 0.5 dev 起動ベースラインを捕捉 (現 ts-node 構成)
  - 現状の `pnpm dev` (= `node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config ...`) で、起動 → `/_api/v3/healthcheck` が 200 を返すまでの wall time を 5 回計測し中央値を `.kiro/specs/esm-migration/perf-baseline.md` の "dev 起動時間 (ts-node 時代)" セクションに記録
  - 計測条件を明文化 (warm cache / cold cache、Node.js バージョン、ホスト CPU、並走プロセスなし)。Phase 3.7.a の bake-off と完全に同一条件で再現できるよう記述する
  - この値が Phase 3.7.a dev runner bake-off の相対評価の基準、および Phase 3.8.e の dev 側 ±20% gate の判定基準となる
  - _Requirements: 2.7, 6.5_

- [x] 0.6 Phase 0 完了確認
  - 以下のファイルがコミットされていることを確認:
    - `test-baseline.md` (0.1)
    - `audit-baseline.json` + `axios` CVE ID 実値置換 (0.2)
    - `route-middleware-baseline.json` (0.3)
    - `authz-matrix-baseline.json` (0.3.1)
    - `ws-authz-baseline.json` (0.3.2)
    - `perf-baseline.md` の本番部 (0.4) と dev 部 (0.5)
  - ベースラインが存在しない状態での Phase 1 以降の着手を禁止する
  - _Depends: 0.1, 0.2, 0.3, 0.3.1, 0.3.2, 0.4, 0.5_

## Phase 1: 残余共有パッケージの ESM 宣言

- [x] 1. 共有パッケージ 5 つを ESM 宣言に揃える
- [x] 1.1 (P) `@growi/pdf-converter-client` を ESM 化
  - `packages/pdf-converter-client/package.json` に `"type": "module"` を追加
  - `packages/pdf-converter-client/orval.config.js` を `orval.config.cjs` にリネーム
  - `packages/pdf-converter-client/package.json` の orval 関連スクリプトの参照を `.cjs` に更新
  - `turbo run build --filter @growi/pdf-converter-client` が成功し、orval 生成コードが ESM として解決される
  - _Requirements: 1.1, 1.2, 5.3_
  - _Boundary: Package Config Updater (pdf-converter-client)_

- [x] 1.2 (P) `@growi/preset-templates` を ESM 化
  - `packages/preset-templates/package.json` に `"type": "module"` を追加
  - 本パッケージは JS ソースを持たないため設定のみの変更
  - `turbo run build --filter @growi/preset-templates` が成功
  - _Requirements: 1.1, 1.2, 5.3_
  - _Boundary: Package Config Updater (preset-templates)_

- [x] 1.3 (P) `@growi/preset-themes` を ESM 化 (dual 出力維持)
  - `packages/preset-themes/package.json` に `"type": "module"` を追加
  - Vite 設定の `build.lib.formats` に ES と UMD の両方が残っていることを確認
  - `turbo run build --filter @growi/preset-themes` が成功し、`dist/` に ES と UMD の双方が生成される
  - _Requirements: 1.1, 1.2, 1.3, 5.3_
  - _Boundary: Package Config Updater (preset-themes)_

- [x] 1.4 (P) `@growi/core-styles` と `@growi/custom-icons` を ESM 化
  - 両パッケージの `package.json` に `"type": "module"` を追加
  - JS 出力を持たないため一貫性目的の宣言のみ
  - `turbo run build --filter @growi/core-styles --filter @growi/custom-icons` が成功
  - _Requirements: 1.1, 5.3_
  - _Boundary: Package Config Updater (core-styles, custom-icons)_

- [x] 1.5 Phase 1 統合ゲート
  - 5 パッケージ変換後に `turbo run build` をモノレポ全体で実行し、`apps/app` を含む下流コンシューマが退行しないことを確認
  - Phase 1 完了コミットに revert 用のタグを付与
  - _Requirements: 1.4, 6.6_
  - _Depends: 1.1, 1.2, 1.3, 1.4_

## Phase 2: ルート/apps/app の type:module 宣言と CJS 隔離

- [x] 2. 既定モジュールを ESM に切替え、CJS 残置箇所を明示化
- [x] 2.1 (P) `apps/app/src/migrations/` をディレクトリ単位で CJS 隔離
  - `apps/app/src/migrations/package.json` を新規作成し `{ "type": "commonjs" }` を宣言
  - **`apps/app/tsconfig.build.server.json` の `exclude` に `src/migrations/**` を追加する (既存で含まれていない場合は必ず追加。hard precondition として Phase 3.6 までに完了していること)**
  - ESLint/grep による構造ガードを追加: `apps/app/src/server/` 以下から `import ... from '~/server/migrations/...'` もしくは相対パスでの `src/migrations/` への import を禁止 (現状存在しないことを確認した上で将来回帰を防止)
  - `pnpm run dev:migrate` が実 DB に対してマイグレーション読込を成功させる
  - _Requirements: 5.4, 5.5_
  - _Boundary: CJS Isolation Strategy (migrations)_

- [x] 2.2 (P) `apps/app/config/` の 3 ファイルを `.cjs` にリネーム
  - `apps/app/config/migrate-mongo-config.js`, `next-i18next.config.js`, `i18next.config.js` をそれぞれ `.cjs` に変更
  - **拡張子なし importer の全列挙と書換え**: `apps/app/` 配下で `^/config/migrate-mongo-config`, `^/config/next-i18next.config`, `^/config/i18next.config` を import / require している全ファイル (server + client 両方) を grep で列挙し、specifier を `.cjs` 付きに書換える。Phase 3 で NodeNext 切替 (3.6) 後は拡張子なしの解決が失敗するため、この書換えは Phase 2 で完了させる
  - 該当既知箇所 (最低限): `src/server/models/user/index.js`, `src/server/service/i18next.ts`, `src/server/routes/apiv3/personal-setting/index.js`, `src/server/util/locale-utils.ts`, `src/pages/_app.page.tsx` — grep で上記以外の importer が無いことを確認
  - **ESLint / grep guard の追加**: 拡張子なしで `^/config/{migrate-mongo,next-i18next,i18next}-config` を import する行を CI で禁止 (将来回帰防止)
  - `apps/app/package.json` 内の `migrate` 系スクリプトと i18next 初期化コードのパス参照を新拡張子に更新
  - `pnpm run dev:migrate` と i18next 初期化が正常動作することを smoke 確認
  - _Requirements: 5.4_
  - _Boundary: CJS Isolation Strategy (config files)_

- [x] 2.3 ワークスペースルートと `apps/app` に `"type": "module"` を宣言
  - ルート `package.json` に `"type": "module"` を追加 (Req 5.1)
  - **`apps/app` への宣言は Phase 3.7.b に延期** — ts-node v10 は `"type":"module"` 宣言済みパッケージ内の `.ts` ファイルを `require()` できず、`dev:migrate` (turbo で `dev` の必須依存) が破綻するため。Phase 3.7.b で dev runner を tsx/swc-node に切り替える際に同時追加する (Req 5.2 は Phase 3 で充足)
  - **(更新 2026-06-12)** 上記延期分は **task 3.6 で前倒し宣言済み** — NodeNext + `import.meta` が type:module 無しでは成立しない (TS1470) ため。代償として ts-node 系スクリプトは 3.7.b まで起動不能 (ユーザー承認済み、3.6 実績参照)
  - `pnpm install` が成功し、root の type:module 宣言が既存パッケージ解決に影響しないことを確認
  - _Requirements: 5.1_
  - _Depends: 2.1, 2.2_

- [x] 2.4 Phase 2 統合ゲート
  - `turbo run build` と `turbo run lint` が成功 (サーバ側は依然 CJS でコンパイル)
  - 既存 dev ランナー (`ts-node` + `tsconfig-paths`) による `pnpm dev` が引き続き起動する
  - **dev ランナー切替禁止**: 本フェーズ時点でサーバソースは CJS のままなので、ここで `tsx` / `@swc-node/register` 等への切替は行わない。CJS 状態で切替えると hybrid 解決コストが最大化し、Phase 3.7.a の bake-off 測定が実運用プロファイルを反映しなくなる (Dev Runner Adapter 切替タイミング制約)
  - _Requirements: 5.6, 6.6_
  - _Depends: 2.3_

## Phase R: GROWI v8 (dev/8.0.x) 再統合 — 2026-06-11 追加

約 2 ヶ月の中断後、リリースターゲットを GROWI v7 から **GROWI v8 (dev/8.0.x)** に変更して再開した。
時系列上は task 3.3.b 完了後に実施。dev/8.0.x (= master 包含済み, HEAD `447ddd20ad`) を support/esm にマージし、
これ以降の全 phase は v8 コードベースを前提とする。**新しい「移行前基準」は dev/8.0.x HEAD である。**

- [x] R.1 dev/8.0.x を support/esm にマージ (`e66f9fdeb9`)
  - コンフリクト 5 ファイル解消: root package.json (version 8.0.0-RC.0 + type:module 併存、pnpm セクションは pnpm 11 化に伴い pnpm-workspace.yaml へ移転)、apps/app/package.json (Prisma/umzug マイグレーション分割スクリプト × `.cjs` パスの合成)、crowi/index.ts (ESM 変換済みメソッドの async 版維持)、biome.json (除外 union)、pnpm-lock.yaml (theirs 起点で `pnpm install` 再整合)
  - axios override の CVE placeholder → 実 advisory (CVE-2026-40175 / GHSA-fvcv-3m26-pcqx) を pnpm-workspace.yaml に引き継ぎ
  - **auto-merge 意味的事故 1 件を検出・修正**: `setUpFileUpload` で上流の sync シグネチャ × 当方の `await` 本体が合成されパースエラー化 → async シグネチャ復元
  - _Requirements: 6.6_

- [x] R.2 task 3.3.b の add 漏れを補修 (`d841440551`)
  - `search-types.ts` が import のみコミットされ実体未コミットで、**マージ前から build が TS2307 で破綻していた**
  - merge-base の interfaces.ts 末尾の 4 型定義から cycle-free な型専用ファイルとして復元
  - _Requirements: 2.6_

- [x] R.3 codemod を dev/8.0.x の biome 基準に適合 (`16c66f5b35`)
  - 上流の biome 強化で `tools/codemod/cjs-to-esm.cjs` が lint gate で fail → format 適用 + CLI usage の console.error に biome-ignore 付与

- [x] R.4 Phase 1/2 ゲートをマージ後ツリーで再実行
  - `turbo run build --filter @growi/app` 21/21 成功、`turbo run lint --filter @growi/app` 21/21 成功
  - Phase 1/2 の成果 (全 17 パッケージの type:module、config/*.cjs、src/migrations 隔離、orval.config.cjs) の無傷をgrep 検証済み
  - dev 起動 smoke: マージ済み migrate スクリプト (migrate-mongo `.cjs` + umzug) end-to-end 成功、`/_api/v3/healthcheck` 200 (R.8 修復後)
  - _Requirements: 6.6_

- [x] R.5 マージ意味的衝突の深層レビュー完了確認
  - 両側変更ファイル交差 11 件の 3-way 分析 + 不変条件 4 種 (async/await 対応、CJS 再流入、Phase 1/2 不変条件、上流新規コードの consumer 整合) + 指摘の敵対的検証を 20 エージェントで実施
  - 結果: 指摘 9 件中 **確定 1 件** (残 8 件は「計画済み残作業 (task 3.5 の `__dirname`)」「上流自身の既存債務」「クリーン検証報告」として棄却)。網羅検証: tsgo `--noEmit` クリーン、src/server 全 64 `.js` の `node --check` クリーン、両側変更ファイル全件のバイト照合一致
  - **確定指摘 (major) を修正済み**: task 3.3.b が design の旧「memoize 必須」指示に従い `getUploader` に導入した `cachedUploader` が、`setUpFileUpload(isForceUpdate=true)` の再初期化契約 (管理画面でのアップロード設定変更 / S2S 切替伝播 / G2G 移行の 3 経路) を silent failure 化していた。メモ化を撤去し、回帰防止の契約テスト (`file-uploader/index.spec.ts`) を TDD (red→green) で追加。design.md / tasks.md の誤指示も訂正

- [x] R.6 ベースライン全面再取得 (Phase 0 の v8 基準やり直し / MANDATORY) — **全 6 ベースライン完了 (2026-06-12)**
  - **理由**: Phase 0 成果物 6 点はすべて 2026-04 時点の master で捕捉されており、v8 マージ後はルート増加 (apiv3 require 行 45→46)、access-token-parser 改編、新規テスト追加、pnpm 11 / turbo 2.9 化により diff 比較が成立しない。再取得なしで Phase 3.8 ゲートを判定してはならない
  - **基準**: `git worktree` で dev/8.0.x HEAD (`447ddd20ad`) を checkout し、support/esm から `tools/` の capture スクリプト群をコピーして実行する (v8 の移行前状態が比較基準)
  - 再取得時の環境条件 (Node 24.15, pnpm 11.1.1, ホスト条件) を perf-baseline.md に明記し、Phase 3.7.a bake-off と同一条件にする
  - **進捗 (2026-06-11)**: worktree `/workspace/growi-baseline` 構築済み (install + 依存パッケージ 17 build 済み、capture ツール 3 種コピー済み)
  - [x] R.6.1 (0.2) audit-baseline.json — 再取得・置換済み (pnpm 11.1.1 / advisories 203 件 / 旧 pnpm 10 形式から `actions`/`muted` キーが消失している点に注意。axios advisory 20 件は >=1.15.1〜>=1.16.0 要求 — Phase 5.x の override 再評価の入力)
  - [x] R.6.2 (0.3) route-middleware-baseline.json — **再取得・置換済み** (273 エントリ / git 447ddd20ad / Node v24.15.0)。当初 758 件発火した無名関数ガードは、task 0.3 で named 化した 10 ファイル (middlewares 9 + routes/forgot-password.ts) が worktree (素の v8) に無いことが原因だった — **support/esm 側はマージで naming が全て生存しており新規コミット不要**。worktree へ同 10 ファイルを naming-only 同期 (`git checkout support/esm -- <files>`) して capture。v8 追加ルートは 13 件 (news 6 + vault 7)、削除 0 件、terminal `<anonymous>` 慣行は旧 baseline と同一で diff 互換あり
  - [x] R.6.3 (0.3.1) authz-matrix-baseline.json — **再取得・置換済み** (264 行 × 4 persona / git 447ddd20ad)。再現性検証として 3 回連続 capture を実施し、揺れは `PUT /_api/v3/bookmark-folder/update-bookmark` の readonly/admin 列のみ (probe の DB 状態依存で 200↔500。authz 列 unauth/guest は 403 で安定)。**baseline は steady-state の run3 値 (500) を採用 — 3.8.c diff ではこの 1 行の readonly/admin 差分を回帰と見なさないこと**。vault reconcile 系の admin=500 は VAULT_MANAGER_ENDPOINT 不通環境での handler エラー — 3.8.c 再実行も同条件 (vault-manager 非稼働) で行うこと。April baseline との共通 245 ルートは authz 列全件不変、readonly/admin の挙動変化 6 件はすべて v8 上流の handler 仕様変更
  - [x] R.6.4 (0.3.2) ws-authz-baseline.json — **再取得・置換済み** (git 447ddd20ad)。yjs 3 ケース (401 / 403 / 101+sync) と socketio 3 ケース (false / false / true) はすべて April baseline と同値 — v8 で WS 認可挙動は不変
  - [x] R.6.5 (0.1) test-baseline.md — **再取得・置換済み** (3 回連続 `--force` 実行 / 219 files / 2669 tests)。真の失敗 0 件、既知 flaky 1 file (`growi-vault/__tests__/clone-e2e.integ.ts` の clone 系 4 テスト — ephemeral git server のタイミング起因で Run3 のみ失敗)。**注意**: mongodb-memory-server のバイナリキャッシュが切り詰められていると全 integ テストが SIGSEGV する (今回、初回実行を中断した際にバイナリ展開が中断され 51 files が即死した。再実行時はキャッシュ完全性を確認すること)
  - [x] R.6.6 (0.4/0.5) perf-baseline.md — **再取得・置換済み**。dev 起動 median **2808 ms** (旧 2724 ms、+3.1%、nodemon 方式維持 — worktree では ENOSPC 未発生)、本番起動 median **4117 ms** (旧 3220 ms、**+27.9% は v8 で preserver に umzug 段が追加されたため** — 内訳を文書に明記)、first-request 5 ルート p50/p95 取得済み。新 gate: dev ±20% `[2246, 3370]` / prod ±20% `[3294, 4940]` / first-request p95 ±25%。umzug が MONGO_URI 必須のため本番系計測でコード内デフォルト同値を export (注記済み)。計測スクリプト 4 本は `apps/app/tmp/perf-baseline/` に保存
  - _Requirements: 2.9, 6.3, 6.5_
  - _Depends: R.1_

- [x] R.7 循環依存ベースラインの再計測 (task 3.0 の更新)
  - マージ後ツリーで `madge --circular`: **サーバ循環 25 件** (ハブ構造は維持)
  - 構成変化: `search-delegator/elasticsearch-client-delegator` の 1 件は search-types.ts 分離で**解消済み**、`service/file-uploader-switch` が新規 +1、socket-io は `service/socket-io/index.ts` 経由の 2 エントリに再編
  - design.md の循環依存ベースライン節に反映済み

- [x] R.8 dev 起動の修復: `@growi/pdf-converter-client` を dual ESM+CJS 出力化
  - **task 1.1 以降 `pnpm dev` が ERR_REQUIRE_ESM で破綻していた** (3 つ目の潜在欠陥)。ts-node 10 は vendored した旧 CJS ローダーガードを使うため Node 24 の `require(esm)` が効かず、boot 時の `features/page-bulk-export → @growi/pdf-converter-client` チェーンで即死。素の node / turbo build では再現しないため build ゲートをすり抜けていた (task 2.4 の「pnpm dev 起動」は実検証されていなかったことが確定)
  - Req 1.3 の原則に従い exports map で dual 出力化: `import` → ESM (従来)、`require` → `dist/cjs/` (CJS 隔離)。require 条件は **Phase 3.7 のランナー置換後に撤去** (package.json にコメント明記)
  - 検証: ts-node 直接起動で `/_api/v3/healthcheck` 200 + Express listening + YjsService 初期化をログ確認
  - _Requirements: 1.3, 2.7, 6.6_

## Phase 3: apps/app サーバ層の ESM 化

- [ ] 3. サーバソースから CJS 構文を排除し、ESM 出力に切替
- [x] 3.0 循環依存ベースラインの取得と記録
  - `npx madge --circular --extensions js,ts apps/app/src/server` を実行し結果を `research.md` または PR 本文に保存
  - 2026-04-20 時点の 25 件ベースラインと件数・ハブ構造が一致することを確認 (差分があれば design.md を更新)
  - `service/search-delegator/elasticsearch-client-delegator/interfaces.ts` の独立分離 (`crowi/index.ts` 非経由の 1 件) の対処計画を確定
  - _Requirements: 2.6_
  - _Boundary: Codemod Transform (pre-analysis)_

- [x] 3.1 `models/user/*` の service singleton 参照を lazy 化
  - `configManager` と `aclService` のモジュールトップ import を getter / ラッパ関数経由の遅延取得に置換
  - **実装規約 (MANDATORY)**: 遅延取得は **sync cached reference** で実装する (初回呼出しで cache に詰めて以降は同期取得)。`await import()` / 動的 `require()` を hot path (auth / ACL 毎 request 経路) に入れないこと。auth チェックは request-path のため、非同期化すると steady-state レイテンシに全量影響する
  - unit test で (a) cache が singleton、(b) 呼出しが同期関数、の 2 点を assert
  - research.md §2.3 パターン A に挙げた他のモデルファイルも同様に修正 (同規約適用)
  - 既存の `apps/app/src/**/*.integ.ts` を実行し、モデル初期化を経由する統合テストが pass する
  - _Requirements: 2.6, 6.5_
  - _Depends: 3.0_
  - _Boundary: Codemod Transform (models lazy-load)_

- [x] 3.2 jscodeshift カスタム transform を作成
  - `tools/codemod/cjs-to-esm.ts` を新規作成し、design.md の **8 パターン**を扱う:
    1. `module.exports` → named export
    2. 静的 `require('./x')` → `import`
    3. factory invoke `require('./x')(crowi, app)` → `import { setup } + invoke`
    4. 三項 × factory invoke (`routes/apiv3/index.js:124` `isInstalled ? ... : require('./installer')(crowi)`) — enclosing を async 化しない書換え
    5. 分割代入 require (`const { x } = require('pkg')`) → named import
    6. 部分名前空間利用 (`require('pkg').member(...)`) → named import (対象例: `crowi/dev.js:65`, `crowi/index.ts:364`, `models/attachment.ts:16`)
    7. 動的 `require(modulePath)(ctx)` 6 箇所 (`service/file-uploader/index.ts:16`, `service/s2s-messaging/index.ts:60`, `service/slack-integration.ts:287,322,354`) → `await import(modulePath)` + factory invoke (**明示メモ化は禁止** — design.md パターン 7 の Phase R 訂正参照)
    8. **意図的 lazy の exclusion list**: `crowi/index.ts:500` setupMailer 内 `MailService = require('~/server/service/mail').default` 等、codemod で触ってはならない箇所をファイル+行で明示リスト化し、`transform` の先頭で AST マーカを確認してスキップする
  - 追加で `^/config/{migrate-mongo,next-i18next,i18next}-config` specifier の `.cjs` 書換えサブパスも組込む
  - ディレクトリ引数を受け取る CLI ラッパ (`pnpm codemod:cjs-to-esm -- <path>`) を実装し、step ごとに独立実行できるようにする
  - jscodeshift の test utility で **8 パターン + exclusion list + specifier 書換え**それぞれに input→expected のスナップショットテストを追加。フィクスチャは実ファイル (上記で列挙した行位置) から抽出する
  - 追加テストが全件 pass
  - _Requirements: 2.2, 2.3, 2.5, 2.6_
  - _Boundary: Codemod Transform (tooling)_

- [x] 3.3 段階適用: codemod を依存の内側から外側へディレクトリ単位で適用
  - 各 step は単一コミット。失敗時は当該 step のみ revert して原因修正後に再実行する (Req 6.6)
  - 各 step 完了後に `tsc --noEmit` を実行し、型エラー 0 件を確認 (NodeNext 切替前のため `.js` 拡張子エラーは許容)

- [x] 3.3.a (step 3.a) `models/` と `events/` を変換
  - `pnpm codemod:cjs-to-esm -- apps/app/src/server/models apps/app/src/server/events` を実行
  - `module.exports` → named export、静的 `require` → `import` の 2 パターンが対象
  - `ReferenceError: Cannot access 'X' before initialization` が発生しないこと (dev build で確認)
  - _Requirements: 2.2, 2.3_
  - _Depends: 3.2_
  - _Boundary: Codemod Transform (models/events)_

- [x] 3.3.b (step 3.b) `service/` を変換 (`search-delegator` の interface 分離を含む)
  - `service/search-delegator/elasticsearch-client-delegator/interfaces.ts` と `es7-client-delegator.ts` の循環を、型のみの独立ファイルに分離することで構造解消
  - `pnpm codemod:cjs-to-esm -- apps/app/src/server/service` を実行
  - 動的 `require(modulePath)(ctx)` → `await import(modulePath)` の対象を **6 箇所すべて** 明示的に検証:
    - `service/file-uploader/index.ts:16` (getUploader — ~~memoize 追加必須~~ **Phase R 訂正: メモ化禁止**。追加されたメモ化が `setUpFileUpload(true)` の再初期化契約を壊す回帰を生んだため撤去済み)
    - `service/s2s-messaging/index.ts:60` (既存 `this.delegator` memoize を維持)
    - `service/slack-integration.ts:287, 322, 354` (3 箇所、design.md 記述の "2 ファイル" から増補)
  - `*.integ.ts` のうち service 層を触るテストが pass
  - **マトリクス smoke の追加**: uploader (`FILE_UPLOAD={aws,local}`) × s2s (`S2S_MESSAGING_TYPE={redis,none}`) の各組合せで本番出力を起動し、attach endpoint に 1 回ずつ到達 (env 依存の動的 import が全分岐で機能することを確認)
  - _Requirements: 2.2, 2.3, 2.5_
  - _Depends: 3.3.a_
  - _Boundary: Codemod Transform (service)_

- [x] 3.3.c (step 3.c) `middlewares/`, `util/`, `pageserv/` 等の非ルートを変換
  - `pnpm codemod:cjs-to-esm -- apps/app/src/server/middlewares apps/app/src/server/util apps/app/src/server/pageserv` ほか
  - 各サブツリーで `tsc --noEmit` をクリーン
  - **実績 (2026-06-12)**: `pageserv/` は v8 ツリーに存在せず、実スコープは middlewares 6 + util 7 ファイル。stranded CJS caller 9 箇所 (routes 7 / crowi/express-init 1 / integ test mock 1) を同一 step で修正 (3.3.b 先例)。検証: typecheck / biome / `turbo run build` 21/21 / vitest 95/95 / dev boot healthcheck 200
  - _Requirements: 2.2, 2.3_
  - _Depends: 3.3.b_
  - _Boundary: Codemod Transform (middlewares/util)_

- [x] 3.3.d (step 3.d) `routes/` 配下の非中央ファイル (~40 本) を変換
  - `routes/index.js` と `routes/apiv3/index.js` を **除く** `routes/**/*.js` に対して codemod を実行
  - factory DI (`module.exports = (crowi, app) => ...`) を named export に変換
  - _Requirements: 2.2, 2.3, 2.6_
  - _Depends: 3.3.c_
  - _Boundary: Codemod Transform (routes leaves)_
  - **実績 (2026-06-12)**: 49 ファイル変換 (.ts 含む)。初回適用で codemod が leading comments (@swagger 約 2300 行) を欠落 → codemod 修正 (`207fe517a4`) 後に再適用。declaration:true 起因の TS2742 に対し全 route factory へ明示 `Router` 戻り値型を付与 (.ts 10 / .js JSDoc 22)。express 型付化で顕在化した潜在型債務 3 ファイルを CrowiRequest/ApiV3Response + 到達不能ガードで解消。中央ルーターは member-access 修正のみ + 既存 synthetic default import 2 件 (g2g-transfer / security-settings) を named import 化 (boot クラッシュの実修正)。検証: build 21/21 / tests 75/75 / dev boot smoke (healthcheck 200, security-setting 未認証 403)

- [x] 3.3.e (step 3.e) `routes/index.js` (中央ルーター 12 箇所) を変換
  - factory invoke (`require('./x')(crowi, app)`) を `import { setup as setupX } from './x.js'; const x = setupX(crowi, app);` に変換
  - 変換後に `pnpm dev` を起動し、`/_api/v3/healthcheck` が 200 を返すこと
  - _Requirements: 2.3, 2.6_
  - _Depends: 3.3.d_
  - _Boundary: Codemod Transform (routes/index)_
  - **実績 (2026-06-12)**: 13 invoke を named import 化。`require('./apiv3')` の 1 行のみ意図的に残置 (apiv3/index.js が module.exports のままのため — 3.3.f で解消、コメント明記)。stranded caller `crowi/index.ts` の `await import('../routes')` を `.default` → `.setup` 化し `as unknown as` 撤去。検証: typecheck 0 / lint 0 / build 21/21 / dev smoke 200×3

- [x] 3.3.f (step 3.f) `routes/apiv3/index.js` (中央ルーター 44 箇所) を変換
  - 3.3.e と同じ規約で 44 エントリを名前付き factory invoke に変換
  - supertest もしくは手動で apiv3 代表エンドポイント (例: `/_api/v3/healthcheck`, `/_api/v3/users`, `/_api/v3/page`) がそれぞれ想定ステータスを返すこと
  - 複合パターン (例: `isInstalled ? alreadyInstalledMiddleware : require('./installer')(crowi)` — 三項演算子の片側のみ factory invoke) が正しく変換されていること。該当箇所を事前に grep して codemod の単体テスト (タスク 3.2) に入力フィクスチャとして追加しておく
  - _Requirements: 2.3, 2.6_
  - _Depends: 3.3.e_
  - _Boundary: Codemod Transform (routes/apiv3/index)_
  - **実績 (2026-06-12)**: 44 invoke を named import 化 (マウント順序は HEAD と完全一致 — 3.8.c snapshot 互換)。installer 三項は member 形のまま 3.3.d で `.setup` 化済みだったため async 化なしで alias 置換のみ (codemod フィクスチャ追加は不要 — 対象パターンが member 形に変化済み)。**スコープ追補**: 3.3.d の src/server glob から漏れていた feature route factory 5 件 (templates / page-bulk-export / external-user-group ×2 / growi-plugin) を同時に `export const setup` 化し、growiPlugin の synthetic default import (実行時 undefined 化リスク) を named 化。routes/index.js の最終 require('./apiv3') を解消し中央ルーター 2 ファイルの require/module.exports は 0。smoke: healthcheck・statistics 200 / users・page・templates・security-setting 未認証 403 / login 200

- [x] 3.3.h (step 3.h) 変換済みルートモジュールのトップレベル副作用を禁止するガードを追加
  - `routes/**/*.js` および `routes/**/*.ts` に対し、import / type-only 宣言 / 関数宣言 / `export const setup = (crowi, app) => { ... }` 以外のトップレベル文を ESLint カスタムルール (もしくは CI の grep チェック) で禁止
  - 現状のファイルで違反がある場合、副作用コードを `setup` 関数内に移す (例: 過去に module-top で `crowi.model('X')` を取得していた箇所を factory 内に移動)
  - ガード追加後に `turbo run lint --filter @growi/app` でエラー 0 件
  - _Requirements: 2.2, 2.3, 2.6_
  - _Depends: 3.3.f_
  - _Boundary: Codemod Transform (top-level side-effect guard)_
  - **実績 (2026-06-12)**: ESLint 不在 (Biome) のため jscodeshift AST ベースの `tools/lint/route-top-level-guard.cjs` + vitest spec 10 件 (TDD) + `lint:route-guard` script で実装。良性初期化子 (literals / Router() / loggerFactory 等の allowlist) は許容する shallow-check 仕様 (logger 61 / Router 34 件の mass-churn と 3.8.c マウント順序保全の衝突を回避)。CJS 回帰ガード (require / module.exports / exports.x) も同梱。**実違反 5 件を修正**: slack-integration.js の import 時 `mongoose.model()` (真のハザード) + raw-body router.use、routes/index.js の autoReap 設定、ogp.ts の fs.readFile、share-links.js の `new Date()` — すべて setup 内へ移動。features 側 route dirs もスキャン (openai の zod builder 1 件のみ = 良性、対象外として記録)

- [x] 3.3.g (step 3.g) `crowi/` を変換し `import/no-commonjs` 0 件を達成
  - `crowi/index.ts`, `crowi/setup-models.ts`, `crowi/dev.js` に codemod を適用
  - 変換完了後、ESLint `import/no-commonjs` が `apps/app/src/server/` 全域で 0 件検出
  - 変換統計が想定規模と累計で一致。**規模は Phase R 再 survey 値を基準にする** (2026-06-11 マージ後ツリー: module.exports 残 63 ファイル = middlewares 5 / util 6 / routes 50 / crowi 2、`= require(` 残 94 箇所 38 ファイル、factory invoke 残 = routes/index.js 11 + apiv3/index.js 44)
  - _Requirements: 2.2, 2.3, 2.5, 2.6_
  - _Depends: 3.3.h_
  - _Boundary: Codemod Transform (crowi)_
  - **実績 (2026-06-12)**: crowi 3 ファイル変換 (setup-models.ts は 3.3.a 時点で既 ESM)。条件付き redis スタックと MailService (パターン 8 lazy) は `await import()` で lazy 維持、無条件外部依存はトップ import 化。ts-node 専用 `require.extensions` hack は `typeof require` ガードで ESM ビルド時 inert 化 (完全撤去は 3.7.b)。ESLint 不在のため **`lint:no-cjs`** (guard の `--cjs-only` モード、TDD 13/13) を import/no-commonjs 相当として追加 — **src/server 全域 349 ファイルで CJS 構文 0 件**。統計累計: module.exports 63 (mw 5 + util 6 + routes 50 + crowi 2) + feature routes 5 (3.3.f 追補) = 全件変換済み

- [x] 3.4 `ts2esm` で `.js` 拡張子を補完
  - `ts2esm` を `apps/app/src/server/` に対して実行
  - すべての relative import が `.js` 拡張子付きとなる
  - `NodeNext` 切替前の段階でも `tsc --noEmit` が拡張子起因のエラーを出さないこと
  - _Requirements: 2.2, 2.3_
  - _Depends: 3.3.g_
  - _Boundary: Codemod Transform (extensions)_
  - **実績 (2026-06-12)**: 拡張子なし relative specifier **887 → 0** (静的 776 / re-export 28 / 動的 80 / TSImportType 3、288 ファイル変更)。ツール分担: ts2esm 2.2.7 (796 specifier / 281 ファイル、専用 `tools/codemod/tsconfig.ts2esm.json` で対話的 tsconfig 改変・type:module 注入・不正 json attribute の 3 つの癖を封じて実行) + jscodeshift 補完 `add-import-extensions.cjs` (ts2esm 盲点 91 箇所: 動的 import 80 / TSImportType 3 / .d.ts 専用 8、spec 20 件) + `ssr-relative-to-alias.cjs` (SSR 到達 32 ファイルの値 import 60 件を `~/server/...` 化 — 下記 Turbopack 制約) + 手動 1 行。`.cjs` 参照 5 件バイト不変。レビューで 288 ファイル全件の import ターゲット集合前後一致・コメント量不変を機械検証済み。検証: tsgo クリーン / build·lint 21/21 / unit 1944 pass / dev boot は DB 接続まで全グラフロード成功 + require.resolve 823 specifier 全数 0 失敗

- [x] 3.5 `__dirname` / `__filename` を 3 ファイルで手動置換
  - `apps/app/src/server/crowi/index.ts`, `crowi/dev.js`, `service/i18next.ts` の `__dirname` を `import.meta.dirname` 相当に置換
  - 置換後も i18next リソース読込とアプリ起動が同じファイルパスに解決されることを smoke で確認
  - _Requirements: 2.4_
  - _Boundary: Codemod Transform (dirname)_
  - **実績 (2026-06-12)**: 3 ファイル置換完了 (`__dirname`/`__filename` 残存 0 件)。i18next の locale 動的 import に ESM 必須の `with { type: 'json' }` 属性を追加 (resourcesToBackend が `.default` を unwrap するため互換)。**3.6 と同一コミットで実施** — `import.meta` は CJS 形式ファイルではコンパイルエラー (TS1470)、`__dirname` は ESM 出力で ReferenceError となる相互依存のため、個別実施では必ず壊れた中間状態が生じることを実証確認しユーザー承認のうえ統合。smoke: 本番 ESM 出力の起動プローブで 3 箇所すべて実行通過 (下記 3.6 実績参照)

- [x] 3.6 `tsconfig.build.server.json` を NodeNext に切替
  - **Precondition (hard)**: タスク 2.1 で `exclude` に `src/migrations/**` が追加済みであること。未完了なら本タスクを着手してはならない
  - `"module": "CommonJS"` → `"module": "NodeNext"`、`"moduleResolution": "Node"` → `"moduleResolution": "NodeNext"` に変更
  - `turbo run build --filter @growi/app` が成功し、`transpiled/` 配下に ESM 出力が生成される
  - _Requirements: 2.1_
  - _Depends: 2.1, 3.3, 3.4, 3.5_
  - _Boundary: Server Build Config_
  - **実績 (2026-06-12)**: NodeNext 切替完了。`turbo run build --filter @growi/app` 21/21 成功、`dist/server/` に ESM 出力 (import/export 構文 + 拡張子付き相対 specifier) を確認。主要な付随変更:
    - **`apps/app/package.json` に `"type": "module"` を前倒し追加** (2.3 で 3.7.b に延期していたもの)。NodeNext はファイル形式を package.json の type で判定するため、これ無しでは `import.meta` が TS1470 になることを実験で確認 — 3.5+3.6+type:module は不可分の 3 点セット
    - **dual-pipeline ファイル戦略**: サーバプログラム (`tspc --listFiles` = src 配下 1095 ファイル、うち src/server 外 745) と Turbopack グラフの共有ファイルは「相対 import 禁止 → alias+`.js`」(671 specifier 変換)。tsconfig.json に suffix パターン `"~/*.js": ["./src/*"]` を追加し、tspc (NodeNext: paths 先で .js→.ts 置換) / Turbopack / tsgo / vitest 全系統で解決可能に。サーバプログラム外の client 専用 526 ファイルは拡張子付与を巻き戻し (3.4 と同じ理由: Turbopack は相対 .js→.ts 置換不可)
    - **NodeNext 型解決シム**: `types/server-build-shims/` (next/link 等 13 マッピング、tsconfig.build.server.json paths)。client 値 import の emit はサーバビルドでは dead code
    - **CJS interop 実バグ修正 (起動プローブで発見)**: ldapjs named import → default+分割代入 / `@growi/remark-attachment-refs` exports map の import 条件が実在しない index.js を指すゴースト → 実在の index.cjs に修正+types 条件追加 / `@growi/preset-themes` に exports map 追加 (ESM ビルド実在も main が UMD cjs のみ指し named import がリンク不能だった)
    - **Prisma generator**: `moduleFormat = "cjs"` → `"esm"` + `importFileExtension = "js"` (生成コードの拡張子なし相対 import が ESM ランタイムで不能のため)
    - **codemod 修正**: `add-import-extensions.cjs` CLI が `.tsx` に `--parser ts` を強制し JSX spread でパース失敗→静かに処理漏れするバグを拡張子別 2 パス化で修正。`ssr-relative-to-alias.cjs` に `--files` モード (明示リスト処理) + src 外/非コードターゲットのガードを追加
    - **検証**: tspc/tsgo typecheck クリーン、Biome クリーン、unit 1951 passed/8 skipped (135/136 ファイル、1 ファイルは既知の mongodb-memory-server 403 env 起因)、lint:no-cjs / route-guard 通過、本番起動プローブ (`NODE_ENV=production node -r dotenv-flow/config dist/server/app.js`) が **MongoDB 接続 ECONNREFUSED のみで停止** = ESM 全モジュールグラフのリンク/実行成功 (サンドボックスに DB 無しのため healthcheck 200 は 3.8 ゲートで検証)
    - **既知の影響 (計画どおり/承認済み)**: ts-node 依存スクリプト (`pnpm dev` / `dev:migrate*` / `migrate:umzug` / `repl`) は 3.7.b のランナー置換まで起動不能。`next.config.prod.cjs` → `.mjs` 化、bin/openapi definition の `.cjs` 化、`resource/Contributor.js` ESM 化等の type:module 追随を含む

- [x] 3.7.a dev runner bake-off で ESM 対応ランナーを実測選定
  - **Precondition (hard)**: タスク 3.6 (NodeNext 切替) 完了後に限り実施。サーバソースが ESM として本番ビルド可能な状態でのみ bake-off 結果が実運用プロファイルを反映する
  - 候補ランナーごとに `apps/app/package.json` の `scripts.dev` を一時的に切替え、cold start wall time (`pnpm dev` 起動 → `/_api/v3/healthcheck` 200 までの壁時計時間) を Phase 0.5 と **同一条件** で 5 回計測し中央値を記録
  - 最低限の候補:
    1. `tsx` (latest) — `node --import tsx src/server/app.ts` 相当
    2. `@swc-node/register` — `node --import @swc-node/register/esm src/server/app.ts` 相当
    3. 評価時点で他に有力候補があれば追加可
  - **除外**: `ts-node/esm` (`--loader` API deprecated) は候補に含めない
  - 各候補で以下を確認:
    - cold start wall time (中央値)
    - `tsconfig.paths` (`~/*`) の runtime 解決が成立するか (`import ... from '~/...'` を含むモジュールが起動時に解決できるか)
    - Node.js 24 下で起動ログにエラー/警告が出ないか
  - 生データ (全 5 回の計測値) と選定理由、採用ランナー名を `.kiro/specs/esm-migration/dev-runner-bench.md` にコミット
  - **選定基準**: `tsconfig.paths` 解決成立を必須条件とし、その上で Phase 0.5 baseline との差分が最小の候補を選定する。ただし Phase 3.8.e の ±20% gate を通過できない候補は選定時点で却下 (= 本タスク失敗として扱い、候補を追加して再測定)
  - _Requirements: 2.7, 6.5_
  - _Depends: 3.6, 0.5_
  - _Boundary: Dev Runner Adapter (selection)_
  - **実績 (2026-06-13)**: **tsx 4.22.4 を採用** (`node --import tsx`)。`@swc-node/register` 1.10.9 は `^/*` エイリアス (`"^/*": ["./*"]`) を bare package `'^'` と誤解釈して解決不能 → 必須条件 (paths 解決成立) 未達で**失格**。選定は機能要件で確定。`tsconfig.paths` は `~/*`・`^/*`・suffix パターン `~/*.js` すべて tsx で runtime 解決成立 (グラフ全体ロード成功で実証)。**計測 deviation**: 本サンドボックスは MongoDB 不在のため healthcheck 200 計測が実施不能 → モジュールグラフ全ロード時間で代理計測 (tsx 中央値 4029ms / 5 回)。Phase 0.5 ベースライン (devcontainer, Node 24, i7-12650H) との ±20% gate 正式判定は **3.8.e に委譲** (別ハードのため絶対値直接比較は不可)。詳細・生データは `dev-runner-bench.md`

- [x] 3.7.b 開発/本番起動スクリプトを選定ランナー / --import に切替
  - **Note**: `apps/app` の `"type": "module"` 宣言は task 3.6 で前倒し済み (本タスクでの追加は不要)。3.6 以降 ts-node 系スクリプトは起動不能のため、本タスクが dev 復旧の完了点となる
  - `apps/app/package.json` の `scripts.ts-node` を廃止し、`dev` / `launch-dev:ci` / `repl` / `dev:migrate-mongo` を **3.7.a で選定したランナー** ベースに書き換え
  - **(Phase R 追加)** v8 で導入された umzug 系スクリプト (`migrate:umzug`, `dev:umzug` — `pnpm run ts-node prisma/migrate.ts` 経由で TS マイグレーションを実行) も同時に選定ランナーへ移行し、`pnpm run dev:migrate` end-to-end (migrate-mongo + umzug 両系統) を実 DB で再検証する
  - 本番起動スクリプトを `node --import dotenv-flow/config dist/server/app.js` に変更 (選定ランナーに依存しない共通部)
  - `pnpm dev` でサーバが起動し、`curl http://localhost:3000/_api/v3/healthcheck` が 200 を返す
  - 選定ランナー依存の追加パッケージを `devDependencies` に追加し、`ts-node` / `tsconfig-paths` を削除
  - _Requirements: 2.7_
  - _Depends: 3.7.a_
  - _Boundary: Dev Runner Adapter (adoption)_
  - **実績 (2026-06-13)**: `scripts.ts-node` 削除。全スクリプトを `node --import tsx --import dotenv-flow/config.js` 形式へ移行 (dev / dev:migrate-mongo / dev:umzug / migrate:umzug / launch-dev:ci / repl / snapshot-routes / authz-matrix / ws-authz)。本番 `server` は `node --import dotenv-flow/config.js dist/server/app.js`。tsconfig.json の `ts-node` ブロック削除。**`ts-node` / `tsconfig-paths` / 試用した `@swc-node/register` `@swc/core` を削除**し、**`tsx` は `dependencies`** に配置 (本番 `migrate:umzug` が `preserver` 経路で TS を実行するため devDependencies 不可)。
    - **発見・修正した実バグ 2 件**: (1) `--import dotenv-flow/config` は ESM 解決で `.js` を自動補完せず `ERR_MODULE_NOT_FOUND` → 全箇所 `--import dotenv-flow/config.js` に明示 (`-r` は CJS 解決が補完していた)。(2) `dev:migrate-mongo` は `migrate-mongo-config.cjs` が dev 分岐で `src/server/util/mongoose-utils.ts` (TS) を require するため tsx 必須 → `--import tsx` を追加 (本番分岐は `dist/.../mongoose-utils.js` なので plain node のまま正しい)
    - **引数互換**: snapshot/authz 系ツールの `pnpm run ts-node ... -- --out=` の `--` 区切りを除去。3 ツールとも `argv` 全体から `--out=` を `.find/.includes` する実装で `--` 非依存と確認済み
    - **サンドボックス検証** (MongoDB 不在のため接続到達/グラフロードで代理確認): `server` (本番 ESM) → ECONNREFUSED 到達、`dev:migrate-mongo status` (tsx+CJS bin) → ECONNREFUSED 到達、`dev:umzug pending` (tsx+TS) → ServerSelectionError 到達、`app.ts --ci` (launch-dev:ci 中核) → mongo 接続失敗で exit (catch に一時 console.error を挿し ECONNREFUSED が原因と断定、グラフは完全ロード)。Yjs 二重 import 警告は本番 dist boot にも出る既存事象で tsx 固有でないと確認。typecheck/biome/no-cjs/route-guard green、unit 1951 passed (既知の mongodb-memory-server 403 で `update-activity.spec.ts` 1 ファイルのみ env-fail)
    - **実 DB での end-to-end (`dev:migrate` 両系統 / healthcheck 200) は push 後 CI** (`ci-app-launch-dev`・`ci-app-test-integration`、mongo サービスコンテナ付き) で検証する

- [x] 3.7.c 全面 native 化 — tsx を撤去し Node v24 ネイティブ TS 実行 (transform + resolve-only hook) に置換
  - **動機**: 3.7.a/3.7.b で暫定採用した tsx が ESM loader hook 経由の resolve/load で dev 起動を劣化させていた (research.md「bake-off で実測選定」「ネイティブ transform 一本化」決定参照)。Node v24 では型ストリップが既定、`--experimental-transform-types` で enum / parameter property も実行可能。
  - **実装**: `apps/app/bin/dev-esm-resolver.mjs` を新規追加 — `module.registerHooks` による *resolve 専用* 同期 in-thread フック (`~/`→src, `^/`→app root, 相対/拡張子無し `.js`→`.ts`, `index.*`)。全 TS ランナー呼び出し (dev / dev:migrate-mongo / dev:umzug / 本番 migrate:umzug / launch-dev:ci / repl / snapshot-routes / authz-matrix:capture/verify / ws-authz-matrix:capture/verify / openapi apiv3 cli) を `node --experimental-transform-types --import ./bin/dev-esm-resolver.mjs ...` に統一。`tsx` を dependencies から削除し lockfile 再生成。`apps/app` engines に `node: ^24` を明示。
  - **enum / parameter property**: server-reachable な enum 5 件・parameter property 3 箇所は transform mode が変換するためソース無変更 (共有 interfaces の enum を const-object 化する型カスケードを回避)。decorator は `apps/app/src/**` で不使用を確認 — strip-types を当初「候補外」とした 3 制約をすべて解消。
  - **追補 (2026-06-15, フラグ全廃)**: 上記「ソース無変更で transform 吸収」を変更し、enum 6 件 (server 5 + client 1) を const-object+union、parameter property 3 件を明示フィールド代入に erasable 化。`--experimental-transform-types` を `tsrun` 定義から削除して全廃し、Node 24 デフォルト strip-only (フラグ無し) で実行。`tsconfig.json` に `erasableSyntaxOnly: true` を常設し回帰防止 (CI lint で検出)。型カスケードは `SearchDelegatorName` の型位置参照 2 箇所のみ (`typeof` 追加)。検証: tsgo --noEmit (erasableSyntaxOnly 込み) exit0 / フラグ無し strip-only で crowi cold-load 3.40s / biome green。
  - **実測 (Node v24.16.0, crowi グラフ cold-load, warm disk, 各 3 回)**: native transform = 2.42–2.79s / tsx = 5.82–6.38s → **約 2.3× 高速** (native は transform キャッシュ無しでも tsx 上回り = ボトルネックは tsx の loader-hook 往復)。
  - **サンドボックス検証**: crowi グラフ cold-load OK (resolver で全エイリアス/拡張子解決成立) / typecheck (tsgo --noEmit) green / biome green / openapi apiv3 spec 生成成功 (native cli.ts)。
  - **実 DB / 本番 boot は push 後 CI** (`ci-app.yml` launch-dev/test/test-es, `ci-app-prod.yml` build-prod/launch-prod — 本番 `migrate:umzug` の native 経路もここで検証) で確認する。
  - _Supersedes: 3.7.a/3.7.b の tsx 採用_

- [ ] 3.8 Phase 3 統合ゲート (MANDATORY — 迂回禁止)

  > **サンドボックス実行状況 (2026-06-14, gate 未完)**: 本ゲートは全サブが本番出力 ×
  > 実 MongoDB (3.8.d は Chromium、3.8.e は Phase 0.4/0.5 と同一ホスト) を要求するが、
  > Claude Code クラウドサンドボックスには mongo/ES/Chromium が無いため **3.8.b〜3.8.e は
  > 実行不可 = 未完**。env 非依存で実証できた範囲 (3.8.a の build/lint/no-cjs/unit green、
  > および 3.8.c/3.8.d capture スクリプトが tsx で ESM ロード成立し mongo 接続地点まで到達
  > = devcontainer 実行準備完了) と、devcontainer 向けの ready-to-run 手順を
  > `.kiro/specs/esm-migration/phase3-gate-evidence/SANDBOX-STATUS.md` に記録。
  > 残りは devcontainer / 本番 CI (`test-prod-node24` / reusable-app-prod) で実行すること。

  本ゲートは ESM 化の成否を決定する最重要検証であり、以下の項目すべてを **本番コンパイル出力** (`node --import dotenv-flow/config dist/server/app.js` ないし `pnpm run server:ci`) に対して実行する。`pnpm dev` (選定 TS ランナー経由) と Vitest と Node NodeNext は ESM 実装が異なるため、dev / test での pass は本ゲートの代替にはならない。

  **迂回禁止条項**: 下記 3.8.c (auth middleware snapshot diff) のいずれかの手順 — 特に `app._router.stack` の walk — が実装上の理由で失敗した場合、代替検証で代用したり「実害がなさそうだから」とスキップすることは **禁止** する。スクリプトが動作しないなら修正するまで Phase 4 には進まない。担当者はユーザーに対して明確に「ゲート 3.8.c を通過できないため Phase 4 に進めない」と報告し、対処方針の指示を仰ぐこと。これは他の 3.8.a / 3.8.b / 3.8.d / 3.8.e にも同様に適用される (Req 6.6 を厳格運用)。

  **Evidence 捕捉義務 (MANDATORY)**: 3.8.a〜3.8.e のすべてのゲート判定は、実行ログ / 計測生データ / diff 出力を `.kiro/specs/esm-migration/phase3-gate-evidence/` 配下に artifact としてコミットすること。tasks.md の check 更新のみで「通過した」と主張することは禁止する (Phase 2 の post-hoc 検証不能問題の再発防止)。最低限以下を成果物として残す:
  - 3.8.a: `turbo run build lint test` の full output と、test baseline との diff
  - 3.8.b: `server:ci` exit 0 の証跡 + `/_api/v3/healthcheck` 等の curl 応答ログ + SSR サンプルの HTML 一部
  - 3.8.c: `route-middleware-baseline.json` との diff 出力 (matrix 配列のみ) + `authz-matrix-baseline.json` との diff 出力
  - 3.8.d: WS 接続 curl 応答 + `ws-authz-baseline.json` との diff + attach/listen タイムスタンプログ
  - 3.8.e: 本番/dev 起動 wall time 全 3 回の生値 + OTel first-request p95 生値 + ±%gate 判定

  - [ ] 3.8.a 基本品質ゲート
    - `turbo run build lint test --filter @growi/app` がすべて成功
    - `test` の結果は `.kiro/specs/esm-migration/test-baseline.md` (Phase 0.1) と比較し、新規失敗 0 件 (既知 flaky のブレは除外)
    - `import/no-commonjs` が `apps/app/src/server/` で 0 件検出

  - [ ] 3.8.b 本番出力起動 smoke (production-mode)
    - `turbo run build --filter @growi/app` + `assemble-prod.sh` 相当で本番相当成果物を生成
    - `pnpm run server:ci` (= `node dist/server/app.js --ci`) がエラー終了せず exit 0 で完走 (全モジュールロード到達の確認)
    - 続いて `node --import dotenv-flow/config dist/server/app.js` で通常起動し、以下を確認:
      - `/_api/v3/healthcheck` が 200
      - 代表 apiv3 エンドポイント 2 種が想定ステータス
      - markdown 全拡張 (drawio / LSX / footnote / math / mermaid / attachment-refs) を含むサンプルページの SSR 200 応答で、各拡張のレンダリング結果を含む HTML が返る
    - **NG 時対応**: 本番モードでのみ再現する ESM ローダ起因の初期化エラー (TDZ, ERR_MODULE_NOT_FOUND, ERR_REQUIRE_ESM 等) は dev/test では捕捉不能。原因特定まで Phase 4 に進んではならない

  - [ ] 3.8.c auth middleware チェーン snapshot diff + ブラックボックス認可マトリクス diff (MANDATORY)
    - (1) Phase 0.3 で作成した `tools/snapshot-route-middleware.ts` を ESM 化後の本番出力に対して実行し、`route-middleware-baseline.json` と diff。**すべての apiv3 エンドポイントで middleware 名列が一致** + **無名関数 0 件** を確認
    - (2) Phase 0.3.1 のブラックボックス認可マトリクステストを本番出力に対して再実行し、`authz-matrix-baseline.json` と diff。全 apiv3 × 4 persona (unauth / guest / read-only / admin) の期待 HTTP ステータスが完全一致
    - (1)(2) いずれかに差分があった場合 (guard 欠落、順序変化、未知 middleware 挿入、persona ステータス変化) は認可バイパス級の潜在リスクと見なし、Phase 4 に進んではならない
    - **スクリプトが動作しない場合の対応 (迂回禁止条項の具体例)**: `app._router` 構造が Express バージョン差で変わっている、動的 mount で stack が取得できない、supertest の fixture が壊れた等の理由でどちらか一方でも動かない場合、「目視で確認した」「代表 3 エンドポイントだけテストした」での代用は禁止。スクリプトを修正して全件を捕捉できる状態にしてから再実行する。それが不可能なら Phase 4 に進まず、ユーザーに報告して方針の指示を仰ぐ
    - _Requirements: 2.6, 2.8, 6.5_

  - [ ] 3.8.d WebSocket / Yjs 接続 smoke + WS 認可マトリクス diff (Phase 6 から前倒し / MANDATORY)
    - 本番出力起動状態で以下をいずれも確認:
      - `curl --include --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" http://$HOST/socket.io/` が 101 もしくは認証起因 4xx で応答 (5xx / ERR_MODULE_NOT_FOUND は NG)
      - Yjs: Chromium 2 クライアントで同一ページを開き、クライアント A の編集が 2 秒以内にクライアント B に反映される。DevTools Network で `ws://.../y-websocket` が 101 で確立
    - **WS 認可マトリクス diff (MANDATORY)**: Phase 0.3.2 で baseline 化した 3 ケース (`/yjs/<pageId>` セッション無し / 閲覧不可 / 許可) + socket.io 3 ケースを再実行し、`ws-authz-baseline.json` と完全一致することを確認。差分があれば Phase 4 に進まず、迂回禁止条項 (3.8.c と同等) を適用
    - 起動ログに socket.io attach / yjs upgrade-handler attach / `server.listen()` callback のタイムスタンプを出力し、**attach が listen callback 前に完了している** ことを assert (ログに「socketio attached」「yjs attached」が「server listening」より先に現れる)
    - _Requirements: 6.5_

  - [ ] 3.8.e 起動性能・first-request レイテンシ比較 (本番 + dev)
    - **本番**: 本番出力起動の wall time を 3 回計測し中央値が Phase 0.4 ベースラインの ±20% 以内
    - **本番**: OpenTelemetry 経由で 5 代表ルート (`/`, `/editor/:id`, `/_api/v3/healthcheck`, `/admin`, markdown 拡張サンプルページ) の first-request-after-cold-start p95 が Phase 0.4 ベースラインの ±25% 以内
    - **dev**: 3.7.b 切替後の `pnpm dev` cold start wall time を 3 回計測し中央値が Phase 0.5 ベースライン (ts-node 時代) の ±20% 以内。超過時は bake-off 候補の再検討または lazy load 位置調整を行い、超過したまま Phase 4 に進んではならない
    - いずれかの項目が超過した場合、`require(esm)` コスト / import fan-out / lazy load 位置 / 選定ランナーのいずれかの調整を行い、超過したまま Phase 4 に進んではならない
    - _Requirements: 2.7, 6.5_

  - _Requirements: 2.8, 2.9, 6.1, 6.2, 6.3, 6.5, 6.6_
  - _Depends: 3.7.b, 0.1, 0.3, 0.4, 0.5_

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
  - **(Phase R 変更)** overrides は pnpm 11 化に伴い ルート `package.json` から **`pnpm-workspace.yaml`** に移転済み。本タスク以降の編集対象はすべて `pnpm-workspace.yaml` の `overrides:` セクション
  - `pnpm-workspace.yaml` の overrides から `flat` ピンを削除
  - `pnpm install` 成功後 `turbo run build` を実行し、`pnpm why flat` で最新 ESM バージョンが解決されることを確認
  - サーバを起動し mongoose-gridfs 経由のファイルアップロードフローを smoke
  - **セキュリティ監査必須**: override 削除後に `pnpm audit --audit-level=moderate --json` を実行し、Phase 0.2 の `audit-baseline.json` と diff。新規 HIGH/CRITICAL advisory が解決バージョンに存在する場合は override を戻し、代替としてセキュリティ境界側の新ピン (最新修正版 >= との不等式ピン等) を設定し、CVE ID を参照する正当化コメントを付与する
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
  - 残存する `transpilePackages` / `pnpm-workspace.yaml` overrides のすべてのエントリに理由コメント (YAML コメント) が存在することを確認
  - ~~`axios` override の CVE ID プレースホルダ置換~~ → **Phase R.1 で完了済み** (pnpm-workspace.yaml に CVE-2026-40175 / GHSA-fvcv-3m26-pcqx を記載済み)。残作業はコメントの現状維持確認のみ
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

- [ ] 6.2 本番アーティファクトを起動して機能 smoke (Phase 3.8 の最終確認)
  - 本タスクは Phase 3.8.b / 3.8.d / 3.8.e で既に前倒し実施済みだが、Phase 4 / 5 の変更 (transpilePackages 削減 / overrides 削除) 後に **回帰していないことの最終確認** として再実行する位置付けに変更する
  - `node --import dotenv-flow/config dist/server/app.js` でサーバを起動
  - **API / SSR / WebSocket / Yjs**: 3.8.b と 3.8.d の検証項目を再度パスすること
  - 起動時間と first-request レイテンシが Phase 0.4 ベースラインおよび Phase 3.8.e 時点と比較して有意な悪化なし (±20% / ±25% 内)
  - auth middleware snapshot を再取得して Phase 0.3 ベースラインと diff — 差分なしを確認 (3.8.c と同じ迂回禁止条項を適用)
  - ブラックボックス認可マトリクス (0.3.1) と WS 認可マトリクス (0.3.2) も再実行して baseline と完全一致することを確認 (Phase 4 / 5 の変更で認可チェーンが壊れていないことの最終保証)
  - _Requirements: 6.5_
  - _Depends: 6.1, 3.8_

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

## Implementation Notes

Learnings captured during Phase 0 baseline capture (kiro-impl). Each entry is
a cross-cutting insight meant to help later tasks avoid rediscovering the
same issue.

- **R.1 auto-merge は意味的衝突を静かに合成する**: dev/8.0.x は「await を含まない
  async メソッドの sync 化」一斉変更を含み、当方の「await import 化」と同一メソッドで
  交差すると、git は *シグネチャ行 (上流) + 本体行 (当方)* を無警告で合成する
  (`setUpFileUpload` で実際に発生 — sync シグネチャ内に await が残りパースエラー)。
  今後 dev/8.0.x を再マージする場合は、コンフリクトゼロでも crowi/index.ts と
  service/ の async メソッド境界を必ず再 diff すること。

- **R.2 タスク完了主張は build green が前提**: task 3.3.b は `search-types.ts` を
  add し忘れたまま完了扱いになっており、ブランチが 2 ヶ月間ビルド不能だった。
  3.3.x の各 step コミット前に `turbo run build --filter @growi/app` を必須化する
  (3.8 の evidence 義務を step 単位にも縮小適用)。

- **R.6 ベースラインは「基準ブランチ + 環境」のスナップショット**: pnpm major
  (10→11) や turbo minor でも実行プロファイルが変わるため、ベースライン再取得時は
  ツールチェーンのバージョンを成果物に併記し、比較時に環境差分を除外できるようにする。

- **R.8 ts-node 10 は Node 24 の require(esm) を無効化する**: ts-node は旧 Node の
  CJS ローダーガードを vendored しており、`"type": "module"` のパッケージを
  require すると Node 本体が対応していても ERR_REQUIRE_ESM を投げる。つまり
  「Allowed Dependencies の Node 24 `require(esm)`」は **Phase 3.7 のランナー置換
  までは dev / launch-dev:ci 経路で前提にできない**。Phase 3 で `"type": "module"`
  を増やす変更 (apps/app 本体の宣言 = task 3.7.b を含む) は、必ず ts-node 経由の
  dev 起動 smoke で検証すること。build (素の tsc/node) が通っても dev だけ壊れる。

- **0.3 baseline scope**: The route-middleware snapshot tool exempts the
  terminal route-body slot from the "no anonymous function" guard because
  Express arrow route handlers (~260 in apiv3) are inherently pinned to
  their (path, method) slot. Diff still catches any reordering/insertion
  in the middleware chain. Phase 3.8.c "無名関数 0 件" should be interpreted
  as "0 newly-anonymous chain middleware slots", not as "0 anonymous
  entries anywhere in the baseline". Document this at design.md as a
  Phase 3.8 follow-up.

- **0.3 CLI ergonomics**: `apps/app/tools/snapshot-route-middleware.ts`
  currently picks the first `--out=` flag. The `snapshot-routes` npm script
  bakes in `--out=../../.kiro/specs/esm-migration/route-middleware-baseline.json`,
  so Phase 3.8.c re-run with a user-supplied alternate output path will
  silently overwrite the committed baseline. Fix this (last-wins CLI
  precedence) before Phase 3.8.c consumption.

- **0.3.1 auth chain coverage**: `apps/app/tools/capture-authz-matrix.ts`
  uses an `X-Authz-Matrix-Persona` injection middleware mounted at the
  same position as `passport.session()`. This exercises the production
  route-level auth chain (`accessTokenParser` → `loginRequired` →
  `adminRequired` → handler) for all 4 named personas, but does NOT
  exercise passport's cookie-parsing logic itself. Passport cookie
  handling is covered by Phase 6 E2E and 3.8.b smoke tests, not by this
  matrix.

- **0.3.1 baseline diff scope**: `authz-matrix-baseline.json` envelope has
  `capturedAt`, `git`, `node` metadata fields that change on every run.
  Phase 3.8.c diff tooling MUST scope comparison to the `matrix` array
  only. The same applies to `route-middleware-baseline.json`.

- **0.3.1 capture runner**: The current capture uses `ts-node` + CJS. Phase
  3.8.c re-execution against production build will need either an
  ESM-compatible runner (selected in 3.7.a) or a pre-built `dist/` entry
  for the capture script.

- **2.1 migrations lint exclusion**: `biome.json` now excludes
  `apps/app/src/migrations/**` from lint targets (in addition to the
  `noRestrictedImports` guard required by task 2.1). This was necessary
  because migration source files contain a mix of ESM `import` syntax and
  raw `require()` calls (e.g. `20200903080025-remove-timeline-type.js.js`
  imports `~/server/models/config` as ESM but also `require('mongoose')`
  in the same file). The mix currently works only because `ts-node` +
  `tsconfig-paths` with `allowJs: true` transpiles both forms under
  `module: CommonJS`. **Phase 3.7.b dev runner swap (tsx / @swc-node)
  MUST re-verify `pnpm run dev:migrate` end-to-end against the chosen
  runner.** If the new runner does not transpile `.js` files in a
  `type:commonjs` subdirectory the same way, migration loading will
  fail at runtime. Record the verification command and output in the
  3.7.b bake-off evidence file.

- **3.3.c default-import interop trap**: `esModuleInterop` + `module: CommonJS`
  masks missing default exports — `import diff from 'diff'` typechecks AND works
  at runtime today (`__importDefault` wraps the CJS module), but `diff@5.2.0`'s
  ESM entry has no default export, so the same line crashes under NodeNext
  (Phase 3.6 以降). When converting `require('pkg').member(...)` (codemod
  pattern 6) or any bare `require('pkg')` of a dual/CJS package, prefer
  **namespace (`import * as`) or named imports** over default imports, and
  verify with `node -e "import('pkg').then(m => console.log(typeof m.default))"`.
  Steps 3.3.d–3.3.g must apply the same check to every external-package import
  the codemod produces.

- **3.3.d explicit export types (TS2742)**: `tsconfig.build.server.json` has
  `declaration: true`, so every exported route factory needs an explicit return
  type (`: Router` on .ts, `@returns {import('express').Router}` JSDoc on .js) —
  inferred express types are "not portable" and fail the build (NOT the tsgo
  typecheck, which doesn't emit declarations). **Steps 3.3.e/f/g must annotate
  the central routers' new exports the same way.**

- **3.3.d synthetic default-import blind spot**: `import X from './converted-module'`
  where the module has only named exports passes typecheck (esModuleInterop
  synthesizes a default) but `X` is **undefined at runtime** → boot crash.
  Stranded-caller sweeps after each codemod step MUST audit `import` statements
  too, not just `require()` sites (3.3.d hit this twice: `g2g-transfer`,
  `security-settings` in apiv3/index.js). Mechanical check: for every converted
  file, resolve all importers and match member shape against actual exports.

- **3.3.d boot-crash diagnosis pitfalls**: (1) pino's async transport loses
  `logger.error(err)` written immediately before `process.exit(1)` — a boot
  crash exits silently; temporarily inject `console.error(err)` into the
  `main()` catch in `src/server/app.ts` to capture the stack. (2) nodemon keeps
  running after "app crashed" and auto-restarts on file edits; stale dev servers
  on :3000 produce false-positive 200s. Before any smoke, verify port 3000 is
  free and attribute responses to the process you started.

- **3.3.d deferred risk — resource/Contributor.js**: `routes/apiv3/staffs.js`
  imports `^/resource/Contributor` (CJS `module.exports`, OUTSIDE src/server and
  outside codemod scope). It compiles/runs today, but when `apps/app` gains
  `"type": "module"` (task 3.7.b) the file becomes invalid as `.js`. Handle in
  3.6/3.7.b preflight (rename to `.cjs` + specifier update, or convert).

- **2.2 config .d.cts pairing**: The three CJS config files
  (`migrate-mongo-config.cjs`, `i18next.config.cjs`,
  `next-i18next.config.cjs`) each ship a hand-written `.d.cts` sibling.
  These are load-bearing: removing them breaks typecheck because callers
  use `import * as x from '...cjs'` against a module whose runtime shape
  is `module.exports = {...}` / `export =`. Under the current `Bundler`
  moduleResolution, only the `.d.cts` pairing resolves this cleanly, and
  the Phase 3.6 switch to `NodeNext` will make the `.cjs ↔ .d.cts`
  pairing strictly required. Do not delete these declaration files, and
  keep them in sync with the `.cjs` implementations when adding / removing
  exported symbols.

- **3.4 prior ts2esm attempt failed (user report, 2026-06-12)**: A previous
  session attempted to run `ts2esm` to give all imports `.js` extensions and
  it did not work well (details were not recorded; no trace in git history —
  the attempt was discarded). Treat `ts2esm` output as untrusted: the task
  3.4 gate is the mechanical scan (extensionless relative specifiers in
  `apps/app/src/server/` = 0) plus typecheck/build/lint/test green, NOT the
  tool exiting successfully. If `ts2esm` cannot deliver (crashes, partial
  rewrites, corrupted output, alias mangling), pivot to the in-repo
  jscodeshift infrastructure (`apps/app/tools/codemod/`) for the extension
  pass instead of fighting the tool — both are sanctioned dependencies of
  the Codemod Transform component (design.md: jscodeshift P0, ts2esm P1).
  Record which tool ultimately produced the rewrite.

- **3.4 Turbopack does NOT extension-substitute relative imports** (likely
  the root cause of the failed prior attempt): `next build` (`build:client`)
  resolves relative specifiers literally — webpack's `extensionAlias`
  (`.js`→`.ts`) has no Turbopack equivalent — so any `src/server` file
  reachable from the SSR import graph MUST NOT use `.js`-suffixed relative
  imports for VALUE imports. Task 3.4 converted the SSR-reachable closure
  (60 value imports / 32 files) to `~/server/...` alias form via
  `tools/codemod/ssr-relative-to-alias.cjs`; type-only relative `.js`
  imports are safe (SWC erases them before bundler resolution). Re-running
  `codemod:ts2esm` re-breaks this (and re-adds an invalid
  `with { type: 'json' }` to the `^/package.json` import in
  `growi-info.integ.ts`) — ALWAYS re-run `ssr-relative-to-alias.cjs` after
  any ts2esm re-run. Regression self-detects as a `next build`
  module-not-found. This is a permanent constraint for tasks 3.6 / 3.8.b /
  Phase 4; design.md sync pending (fold into 5.5 docs task).

- **3.4 ts-node `experimentalResolver` is a temporary crutch**: ts-node's
  CJS resolver cannot map `require('./x.js')` → `x.ts`, so dev boot died at
  the first extensioned import. `apps/app/tsconfig.json` gained
  `"experimentalResolver": true` inside the ts-node-only section (tsc /
  tsgo / tspc / vitest / Turbopack all ignore it). REMOVE together with
  ts-node at task 3.7.b.

- **3.4 leftover for 3.6**: JSDoc-comment type references
  (`@type {import('../service/...')}` etc.) in `.js` files remain
  extensionless — comment position, outside the 3.4 gate, tsgo green today.
  Re-check at the NodeNext switch (3.6).

- **Sandbox environment limits (this remote session)**: no MongoDB (`mongo`
  host ENOTFOUND) and mongodb-memory-server binary download blocked (HTTP
  403) → `--project=app-integration` cannot run, 1 unit file
  (`update-activity.spec.ts`) env-fails in suite setup, and dev-boot smoke
  can only verify "full module graph loads, stops at DB connection".
  Tasks 3.5 / 3.7 / 3.8 smoke items that need a live DB must either run in
  an environment with MongoDB or be reported as MANUAL_VERIFY_REQUIRED —
  do not claim them green here.
