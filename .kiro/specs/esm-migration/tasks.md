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

- [ ] 1. 共有パッケージ 5 つを ESM 宣言に揃える
- [x] 1.1 (P) `@growi/pdf-converter-client` を ESM 化
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
  - **`apps/app/tsconfig.build.server.json` の `exclude` に `src/migrations/**` を追加する (既存で含まれていない場合は必ず追加。hard precondition として Phase 3.6 までに完了していること)**
  - ESLint/grep による構造ガードを追加: `apps/app/src/server/` 以下から `import ... from '~/server/migrations/...'` もしくは相対パスでの `src/migrations/` への import を禁止 (現状存在しないことを確認した上で将来回帰を防止)
  - `pnpm run dev:migrate` が実 DB に対してマイグレーション読込を成功させる
  - _Requirements: 5.4, 5.5_
  - _Boundary: CJS Isolation Strategy (migrations)_

- [ ] 2.2 (P) `apps/app/config/` の 3 ファイルを `.cjs` にリネーム
  - `apps/app/config/migrate-mongo-config.js`, `next-i18next.config.js`, `i18next.config.js` をそれぞれ `.cjs` に変更
  - **拡張子なし importer の全列挙と書換え**: `apps/app/` 配下で `^/config/migrate-mongo-config`, `^/config/next-i18next.config`, `^/config/i18next.config` を import / require している全ファイル (server + client 両方) を grep で列挙し、specifier を `.cjs` 付きに書換える。Phase 3 で NodeNext 切替 (3.6) 後は拡張子なしの解決が失敗するため、この書換えは Phase 2 で完了させる
  - 該当既知箇所 (最低限): `src/server/models/user/index.js`, `src/server/service/i18next.ts`, `src/server/routes/apiv3/personal-setting/index.js`, `src/server/util/locale-utils.ts`, `src/pages/_app.page.tsx` — grep で上記以外の importer が無いことを確認
  - **ESLint / grep guard の追加**: 拡張子なしで `^/config/{migrate-mongo,next-i18next,i18next}-config` を import する行を CI で禁止 (将来回帰防止)
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
  - **dev ランナー切替禁止**: 本フェーズ時点でサーバソースは CJS のままなので、ここで `tsx` / `@swc-node/register` 等への切替は行わない。CJS 状態で切替えると hybrid 解決コストが最大化し、Phase 3.7.a の bake-off 測定が実運用プロファイルを反映しなくなる (Dev Runner Adapter 切替タイミング制約)
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
  - **実装規約 (MANDATORY)**: 遅延取得は **sync cached reference** で実装する (初回呼出しで cache に詰めて以降は同期取得)。`await import()` / 動的 `require()` を hot path (auth / ACL 毎 request 経路) に入れないこと。auth チェックは request-path のため、非同期化すると steady-state レイテンシに全量影響する
  - unit test で (a) cache が singleton、(b) 呼出しが同期関数、の 2 点を assert
  - research.md §2.3 パターン A に挙げた他のモデルファイルも同様に修正 (同規約適用)
  - 既存の `apps/app/src/**/*.integ.ts` を実行し、モデル初期化を経由する統合テストが pass する
  - _Requirements: 2.6, 6.5_
  - _Depends: 3.0_
  - _Boundary: Codemod Transform (models lazy-load)_

- [ ] 3.2 jscodeshift カスタム transform を作成
  - `tools/codemod/cjs-to-esm.ts` を新規作成し、design.md の **8 パターン**を扱う:
    1. `module.exports` → named export
    2. 静的 `require('./x')` → `import`
    3. factory invoke `require('./x')(crowi, app)` → `import { setup } + invoke`
    4. 三項 × factory invoke (`routes/apiv3/index.js:124` `isInstalled ? ... : require('./installer')(crowi)`) — enclosing を async 化しない書換え
    5. 分割代入 require (`const { x } = require('pkg')`) → named import
    6. 部分名前空間利用 (`require('pkg').member(...)`) → named import (対象例: `crowi/dev.js:65`, `crowi/index.ts:364`, `models/attachment.ts:16`)
    7. 動的 `require(modulePath)(ctx)` 6 箇所 (`service/file-uploader/index.ts:16`, `service/s2s-messaging/index.ts:60`, `service/slack-integration.ts:287,322,354`) → `await import(modulePath)` + singleton memoize
    8. **意図的 lazy の exclusion list**: `crowi/index.ts:500` setupMailer 内 `MailService = require('~/server/service/mail').default` 等、codemod で触ってはならない箇所をファイル+行で明示リスト化し、`transform` の先頭で AST マーカを確認してスキップする
  - 追加で `^/config/{migrate-mongo,next-i18next,i18next}-config` specifier の `.cjs` 書換えサブパスも組込む
  - ディレクトリ引数を受け取る CLI ラッパ (`pnpm codemod:cjs-to-esm -- <path>`) を実装し、step ごとに独立実行できるようにする
  - jscodeshift の test utility で **8 パターン + exclusion list + specifier 書換え**それぞれに input→expected のスナップショットテストを追加。フィクスチャは実ファイル (上記で列挙した行位置) から抽出する
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
  - 動的 `require(modulePath)(ctx)` → `await import(modulePath)` の対象を **6 箇所すべて** 明示的に検証:
    - `service/file-uploader/index.ts:16` (getUploader — memoize 追加必須)
    - `service/s2s-messaging/index.ts:60` (既存 `this.delegator` memoize を維持)
    - `service/slack-integration.ts:287, 322, 354` (3 箇所、design.md 記述の "2 ファイル" から増補)
  - `*.integ.ts` のうち service 層を触るテストが pass
  - **マトリクス smoke の追加**: uploader (`FILE_UPLOAD={aws,local}`) × s2s (`S2S_MESSAGING_TYPE={redis,none}`) の各組合せで本番出力を起動し、attach endpoint に 1 回ずつ到達 (env 依存の動的 import が全分岐で機能することを確認)
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
  - 複合パターン (例: `isInstalled ? alreadyInstalledMiddleware : require('./installer')(crowi)` — 三項演算子の片側のみ factory invoke) が正しく変換されていること。該当箇所を事前に grep して codemod の単体テスト (タスク 3.2) に入力フィクスチャとして追加しておく
  - _Requirements: 2.3, 2.6_
  - _Depends: 3.3.e_
  - _Boundary: Codemod Transform (routes/apiv3/index)_

- [ ] 3.3.h (step 3.h) 変換済みルートモジュールのトップレベル副作用を禁止するガードを追加
  - `routes/**/*.js` および `routes/**/*.ts` に対し、import / type-only 宣言 / 関数宣言 / `export const setup = (crowi, app) => { ... }` 以外のトップレベル文を ESLint カスタムルール (もしくは CI の grep チェック) で禁止
  - 現状のファイルで違反がある場合、副作用コードを `setup` 関数内に移す (例: 過去に module-top で `crowi.model('X')` を取得していた箇所を factory 内に移動)
  - ガード追加後に `turbo run lint --filter @growi/app` でエラー 0 件
  - _Requirements: 2.2, 2.3, 2.6_
  - _Depends: 3.3.f_
  - _Boundary: Codemod Transform (top-level side-effect guard)_

- [ ] 3.3.g (step 3.g) `crowi/` を変換し `import/no-commonjs` 0 件を達成
  - `crowi/index.ts`, `crowi/setup-models.ts`, `crowi/dev.js` に codemod を適用
  - 変換完了後、ESLint `import/no-commonjs` が `apps/app/src/server/` 全域で 0 件検出
  - 変換統計が想定規模 (約 82 ファイルの module.exports、176 箇所の require、56 箇所の factory invoke) と累計で一致
  - _Requirements: 2.2, 2.3, 2.5, 2.6_
  - _Depends: 3.3.h_
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
  - **Precondition (hard)**: タスク 2.1 で `exclude` に `src/migrations/**` が追加済みであること。未完了なら本タスクを着手してはならない
  - `"module": "CommonJS"` → `"module": "NodeNext"`、`"moduleResolution": "Node"` → `"moduleResolution": "NodeNext"` に変更
  - `turbo run build --filter @growi/app` が成功し、`transpiled/` 配下に ESM 出力が生成される
  - _Requirements: 2.1_
  - _Depends: 2.1, 3.3, 3.4, 3.5_
  - _Boundary: Server Build Config_

- [ ] 3.7.a dev runner bake-off で ESM 対応ランナーを実測選定
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

- [ ] 3.7.b 開発/本番起動スクリプトを選定ランナー / --import に切替
  - `apps/app/package.json` の `scripts.ts-node` を廃止し、`dev` / `launch-dev:ci` / `repl` / `dev:migrate-mongo` を **3.7.a で選定したランナー** ベースに書き換え
  - 本番起動スクリプトを `node --import dotenv-flow/config dist/server/app.js` に変更 (選定ランナーに依存しない共通部)
  - `pnpm dev` でサーバが起動し、`curl http://localhost:3000/_api/v3/healthcheck` が 200 を返す
  - 選定ランナー依存の追加パッケージを `devDependencies` に追加し、`ts-node` / `tsconfig-paths` を削除
  - _Requirements: 2.7_
  - _Depends: 3.7.a_
  - _Boundary: Dev Runner Adapter (adoption)_

- [ ] 3.8 Phase 3 統合ゲート (MANDATORY — 迂回禁止)

  本ゲートは ESM 化の成否を決定する最重要検証であり、以下の項目すべてを **本番コンパイル出力** (`node --import dotenv-flow/config dist/server/app.js` ないし `pnpm run server:ci`) に対して実行する。`pnpm dev` (選定 TS ランナー経由) と Vitest と Node NodeNext は ESM 実装が異なるため、dev / test での pass は本ゲートの代替にはならない。

  **迂回禁止条項**: 下記 3.8.c (auth middleware snapshot diff) のいずれかの手順 — 特に `app._router.stack` の walk — が実装上の理由で失敗した場合、代替検証で代用したり「実害がなさそうだから」とスキップすることは **禁止** する。スクリプトが動作しないなら修正するまで Phase 4 には進まない。担当者はユーザーに対して明確に「ゲート 3.8.c を通過できないため Phase 4 に進めない」と報告し、対処方針の指示を仰ぐこと。これは他の 3.8.a / 3.8.b / 3.8.d / 3.8.e にも同様に適用される (Req 6.6 を厳格運用)。

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
  - ルート `package.json` の overrides から `flat` ピンを削除
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
  - 残存する `transpilePackages` / `pnpm.overrides` のすべてのエントリにインライン理由コメントが存在することを確認
  - `axios` override のコメントに含まれる CVE ID プレースホルダ (`CVE-2025-XXXXX` 等) を正式な CVE 識別子もしくは内部アドバイザリ URL に置換する
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
