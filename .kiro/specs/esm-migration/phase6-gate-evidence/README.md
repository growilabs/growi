# Phase 6 Gate Evidence — 本番アセンブリ end-to-end 検証

Phase 6 は Phase 4 (transpilePackages 削減) / Phase 5 (overrides 削除) の変更後に、
本番アーティファクトで全要件が回帰していないことを最終確認する (tasks 6.1–6.3)。
3.8.b/c/d/e で前倒し実施済みの項目を Phase 4/5 後に再実行する位置づけ。

- 実行日: 2026-06-16
- 対象 SHA: `567df72b6b` (Phase 5 完了 HEAD)
- ホスト: devcontainer (mongo `mongo:27017` rs0 / ES `elasticsearch:9200` / Node v24.15.0)
  = Phase 0.4/0.5 perf baseline と同一ホスト
- baseline: committed `*-baseline.json` / `perf-baseline.md` (R.6 で dev/8.0.x HEAD から取得)

## 6.2 本番起動 smoke + 各 baseline diff

### 機能 smoke (本番 dist 起動 `node --import dotenv-flow/config.js dist/server/app.js`)

- `/_api/v3/healthcheck` = **200**
- apiv3 認可ゲート (unauth): `/_api/v3/users` = **403** / `/_api/v3/page` = **403** /
  `/_api/v3/statistics/user/count` = **302** (→login)
- SSR (`/`, `/Sandbox`, `/Sandbox/Diagrams`, `/Sandbox/Math`): いずれも **302→/login** (未認証)。
  = 3.8.b/3.8.e と同じ挙動 (curl は未認証で /login へ)。**markdown 全拡張のレンダリング SSR
  アサーションは認証必須のため 6.3 CI E2E (実ブラウザ・認証済) が担保** (3.8.b と同じ運用)。
- socket.io upgrade (生 curl, Upgrade header): **HTTP 400** (4xx, 5xx/ERR_MODULE 非該当) = 3.8.d 同一
- attach-before-listen: `YjsService initialized` (t=…147814) < `Express server is listening`
  (t=…148028) = yjs attach が listen callback の **214ms 前**に完了 ✅

### auth middleware snapshot diff (3.8.c 再実行 / route-middleware-baseline.json)

- セマンティック diff (entries[], メタデータ・整形除外): **273 endpoints / added 0 / removed 0**
- middleware チェーン変更 = **3 件のみ** (slack-integration commands/events/interactions)、
  内容は `verifySlackRequest` の `.name` が `S → $` の 1 文字シフトのみ。順序・個数・他の named
  guard・anonymous slot (272, terminal route body のみ) 完全一致。
  = `@growi/slack` dist の minify 名割当てシフト (再ビルド由来、ESM 移行と無関係) = **3.8.c と同一**。
  認可チェーン構造は Phase 4/5 後も**不変** ✅
- (注) snapshot ツールは `--out` を先頭優先で拾うため npm script 経由 (`pnpm run snapshot-routes`)
  だと committed baseline を上書きする (Implementation Note 0.3 の既知ハザード, last-wins 未修正)。
  ツールを直接呼び `--out=/tmp/...` 単一指定で capture し、committed baseline は `git checkout` で
  保全した (diff は git restore 後にセマンティック比較)。

### ブラックボックス認可マトリクス diff (0.3.1 / authz-matrix-baseline.json)

- 264 rows × 4 persona / vault-manager 非稼働 (ECONNREFUSED :3001) = baseline 同条件
- **認可ゲート列 (unauthenticated / guest / readonly): 264 行全件で diff = 0** ✅
- admin 列 diff = **1 件のみ**: `POST /_api/v3/import/upload` admin `599 → 400`
  (599 = post-auth クラッシュ/timeout sentinel → 400 正常応答の改善。admin は認証通過済 persona の
  ため認可バイパスではない) = **3.8.c と同一**

### WS 認可マトリクス diff (0.3.2 / ws-authz-baseline.json)

- メタデータ除外 deep-compare: **EXACT match (diff = 0)** ✅
  - yjs: no-session=401 / session-unviewable=403 / session-viewable=101+sync=true
  - socketio: no-session=false / session-nonadmin-admin-ns=false / session-viewable=true
  = 3.8.d と同一。**WS 認可は Phase 4/5 後も完全保全**

### 起動性能・first-request (3.8.e 再実行 / perf-baseline.md)

| 指標 | 今回 | gate | 判定 |
|---|---|---|---|
| 本番起動 wall (measure-prod ×3, server:ci) | median **3938ms** (3925/3938/3955) | [3294, 4940] | ✅ baseline 4117ms 比 -4.3% |
| dev cold start (measure-dev ×3, nodemon) | median **3239ms** (5223/3057/3239) | [2246, 3370] | ✅ run1 は nodemon 初回コールド外れ値 |
| first-request `/_api/v3/healthcheck` p95 | 10.7ms | 9.8–16.3 | ✅ |
| first-request `/Sandbox` p95 | 28.0ms | 24.8–41.3 | ✅ |
| first-request `/Sandbox/Diagrams` p95 | 25.9ms | 21.8–36.3 | ✅ |
| first-request `/admin`(→/login) p95 | 26.3ms | 23.3–38.8 | ✅ |
| first-request `/`(→content page) p95 | **168–170ms** | 99.8–**166.3** | ⚠️ +1–2% 超過 (要判断) |

- `/` は 2 回計測 (5 iter ×2) で安定して ~164–170ms = 環境ノイズではない。warm-vs-cold 検証で
  **cold 初回=163ms / warm 2回目以降=19–27ms** = 167ms は **コールド初回 SSR レンダリングのコスト**。
- load average 0.86/16コア = CPU 競合なし (環境要因ではない)。
- 起因: **Phase 4 の transpilePackages 削除** (3.8.e 時点 114ms → 現 167ms)。remark/rehype 系の
  多数の小 ESM モジュールを Turbopack が native 解決するため、最重量コンテンツページの cold module
  instantiation がやや増加。Phase 5 (flat) は SSR 非経路で無関係。これは ESM 化の既知トレードオフ
  (小モジュール多数 = cold load わずか増、warm は健全)。
- 4/5 ルート + 起動 2 指標は gate 内。`/` のみ +1–2% 超過。
- **判断 (2026-06-16, ユーザー承認 = 受容)**: 「ビルド/起動/定常状態の劣化ではなく、再起動直後の
  最重量ページへの初回 1 リクエストのみ +約50ms (warm は ~20ms で不変)」「transpile という回避策を
  Phase 4 で意図的に撤去した代償としての ESM cold-init トレードオフ」「markdown レンダリングの機能
  正当性は 6.3 CI E2E が担保」を説明のうえ **borderline として受容**。性能上の有意な悪化なしと判定。

## 6.1 ローカル本番アセンブリ — CI (6.3) に統合 (ユーザー選択)

ユーザー選択により、`rm -rf node_modules` を含む破壊的なローカル `assemble-prod.sh` 実行 (共有
devcontainer への一時的影響) は回避し、6.3 CI (`reusable-app-prod.yml`) のクリーン隔離環境での
`build-prod` ジョブ (= `turbo build` + `assemble-prod.sh` + `check-next-symlinks.sh`) に統合して
権威的に検証する。CI の `build-prod` 成功が 6.1 の受け入れ条件 (assemble-prod 成功 + broken
symlink が ALLOWED_BROKEN 以外 0) を満たす。

## 6.2.1 Yjs 同期 Playwright spec — SKIP (任意項目)

tasks.md で「(任意)…CI 自動化を目的とする延命措置で、6.2 の手動 smoke 成功が Req 6.5 の充足条件」
と明記。Yjs 同期は (a) 6.2 の ws-authz `session-viewable` = `101 + syncReceived:true`、(b) 3.8.d の
Chromium 2 クライアント同期実証、(c) 6.3 CI E2E (実ブラウザ) で担保済みのため本タスクは **SKIP**。

## 6.3 CI 最終通過

- run **27609048544** @ `567df72b6b` (Phase 5 完了 HEAD) を `workflow_dispatch` で実行
  (node-version=24.x, skip-e2e-test=false)。
- **結果: 全 job success** (rerun 後):
  - `build-prod` ✅ (= `turbo build` + `assemble-prod.sh` + `check-next-symlinks.sh` broken 0) → **6.1 充足**
  - `launch-prod (6.0)` ✅ / `launch-prod (8.0)` ✅ (= `server:ci` exit 0 = 全 ESM モジュールグラフ
    ロード到達 + native `migrate:umzug`) → 本番依存完全性・本番起動 OK
  - `run-playwright` **全 16 shard ✅** (chromium/firefox/webkit × 2 shard × mongo 6.0/8.0) =
    本番出力上で実ブラウザ E2E (installer / main / guest-mode / markdown レンダリング / API / WS /
    Yjs) green → **6.2 の markdown SSR 担保 + 機能正当性を権威的に確認**
  - `report-playwright` ✅
- **初回 run の 1 shard failure は既知 flaky** (`comments.spec.ts` の test-isolation:
  Playwright retry が同一 mongo にコメント重複追加 → `.page-comment-body` strict-mode violation。
  Implementation Notes 記載済み、前回 run #27552484985 でも firefox shard で発生)。`gh run rerun
  --failed` で green = ESM 移行/Phase 4/5 とは無関係のテスト品質問題。chromium は mongo 8.0 で同テスト
  pass、他ブラウザ全 pass = コード回帰でないことを裏付け。

---

## Phase 6 総括 — 全サブタスク充足

| task | 判定 | 根拠 |
|------|------|------|
| 6.1 本番アセンブリ | ✅ | CI `build-prod` (assemble-prod + check-next-symlinks broken 0) |
| 6.2 機能 smoke + 認可 diff | ✅ | route-mw 構造不変 / authz ゲート列 diff 0 / ws-authz exact / attach<listen / CI E2E |
| 6.2 perf | ✅ | 起動 prod 3938ms・dev 3239ms gate 内 / first-request `/` のみ borderline=ユーザー受容 |
| 6.2.1 Yjs Playwright (任意) | SKIP | ws-authz synced=true + 3.8.d + CI E2E で担保済 (Req 6.5 充足) |
| 6.3 CI 最終通過 | ✅ | run 27609048544 全 job success @ 567df72b6b |

**Phase 6 完了 = esm-migration 全 Phase (0,1,2,R,3,4,5,6) クローズ。**
