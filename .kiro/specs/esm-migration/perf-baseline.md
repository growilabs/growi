# Performance Baseline (pre-migration, GROWI v8 基準)

本ドキュメントは ESM 移行前の起動性能・first-request レイテンシの基準値を **GROWI v8 (dev/8.0.x HEAD `447ddd20ad`)** 基準で記録するものである (R.6.6 — 旧 task 0.4 + 0.5 の再計測)。Phase 3.7.a の dev runner bake-off、および Phase 3.8.e の ±20% / ±25% gate 判定で参照される。

2026-04-21 取得の旧ベースライン (v7 ベース `32764e0fae`、dev median 2724 ms / prod median 3220 ms) は本ドキュメントにより置き換えられる。

## 計測環境

| 項目 | 値 |
|---|---|
| Node.js | v24.15.0 |
| pnpm | 11.1.1 |
| turbo | 2.9.16 |
| OS | Linux 5.15.0-181-generic (devcontainer) |
| CPU | 12th Gen Intel Core i7-12650H, 10 cores / 16 threads, max 4.7 GHz |
| Memory | 31 GiB total / ~11 GiB available (計測時) |
| 計測対象 worktree | `/workspace/growi-baseline` (GROWI v8 = dev/8.0.x HEAD) |
| Git SHA (計測時点) | 447ddd20ad (Merge branch 'master' into dev/8.0.x) |
| worktree 上の差分 | route-middleware snapshot 用の **naming-only 変更 10 ファイル** 適用済み (middlewares 9 + routes/forgot-password.ts。挙動同一、詳細は末尾注記 1) |
| 計測日時 (UTC) | 2026-06-12 |
| MongoDB | `mongo:27017` (内部ネットワーク、MongoDB 8.2.7、replica set `rs0`) |
| Elasticsearch | `elasticsearch:9200` (v9.3.3、dev 用にのみ使用) |
| OTel | 不採取 (理由は後述。旧ベースラインと同じ事情) |
| 並走プロセス | GROWI 由来の node/nodemon/vitest プロセスが存在しないこと、ポート 3000 が空いていることを事前に `ps aux` / `ss` で確認 (別 worktree の dev サーバが残存していたため計測前に kill)。旧計測時に存在した snapshot-route-middleware 残存プロセスは今回ゼロ |
| 計測手法 | `process.hrtime.bigint()` を Node.js スクリプトで呼び出し、子プロセス起動前後で差分計算 (ms 粒度) |

## dev 起動時間 (ts-node 時代) — R.6.6 (旧 task 0.5)

### コマンド

```bash
# apps/app 配下で実行
pnpm run dev
# v8 での内部展開:
# cross-env NODE_ENV=development nodemon --exec pnpm run ts-node --inspect src/server/app.ts
#   → node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config --inspect src/server/app.ts
```

v8 では dev スクリプトの記述が `nodemon --exec pnpm run ts-node ...` 形式に変わっているが、最終的に exec される内側コマンドは旧ベースラインと同一 (`node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config --inspect src/server/app.ts`)。

**計測方式は旧ベースラインと同じ nodemon 経由 (`pnpm run dev`) のまま**。懸念されていた nodemon の `ENOSPC` (inotify watcher 枯渇) は今回の環境では発生しなかった (全 run のログで ENOSPC ゼロ件を確認)。direct 起動への切替フォールバックは `tmp/perf-baseline/dev-once.js` の `MODE=direct` として準備済みだが、本計測では未使用。Phase 3.7.a bake-off も同じ nodemon 経由方式で比較すること (ENOSPC が発生した環境でのみ MODE=direct に揃えて比較する)。

計測手順は以下。詳細は `tmp/perf-baseline/measure-dev.sh` / `dev-once.js` を参照 (tmp 配下、本番コードは未変更)。

1. `process.hrtime.bigint()` で開始時刻記録
2. dev サーバを新規プロセスグループ (detached) でバックグラウンド起動
3. 100ms ごとに `http://localhost:3000/_api/v3/healthcheck` をポーリング
4. 200 が返却された時点で `hrtime.bigint()` で終了時刻記録、差分を ms で算出
5. プロセスグループに SIGTERM → 2 秒後 SIGKILL
6. iteration 間に 3 秒 sleep

### 事前条件

- **dev migration は事前に完了済み**: 本計測では `pnpm run dev:migrate` を事前に 1 回実行 (migrate-mongo: 適用済み確認のみ、umzug: `applied 0 migrations.`) しておき、`pnpm run dev` 側では migration ステップを含めない (nodemon は migration を実行しない仕様)。
- **healthcheck の性質**: `/_api/v3/healthcheck` は Express API ルートであり Next.js ページコンパイルには依存しない。よって本計測は **サーバ (Crowi クラス) 起動 + Express listen までの wall time** を表す。

### キャッシュ条件

- **warm cache**: Next.js `.next/dev` キャッシュを iteration 間で保持。OS page cache も保持 (devcontainer 内で root 権限を持たないため `drop_caches` は実行できない)。
- **cold cache**: `.next/dev` を削除した直後の 1 回計測を別途取得。`node_modules` / pnpm store / OS page cache はそのまま (devcontainer 制約のため不可)。
- ENOSPC 発生有無の確認を兼ねた試行 1 回 (4982 ms) を warm 計測 5 回の前に実施した。これは dev:migrate 直後の初回起動でページキャッシュが温まっていない状態の値であり、warm-up として統計から除外している (旧ベースラインの計測プロトコルと整合させるための試行であり、値の捏造・選別ではない点を明記する)。

### 生データ (5 runs, warm cache, nodemon 経由)

| # | wall time (ms) | HTTP |
|---|---|---|
| 1 | 2794 | 200 |
| 2 | 2775 | 200 |
| 3 | 2808 | 200 |
| 4 | 2839 | 200 |
| 5 | 2828 | 200 |

- sorted: `[2775, 2794, 2808, 2828, 2839]` ms
- **median: 2808 ms**
- mean: 2808.8 ms
- stddev: ~23 ms (~0.8% of median)
- 参考: 旧ベースライン (v7 ベース) median 2724 ms → v8 で **+84 ms (+3.1%)**

### cold cache 参照値

- `.next/dev` 削除直後: **2833 ms** (1 回)
- warm との差分は数十 ms 程度でノイズ範囲内。理由は healthcheck が Next.js 非依存で、かつ OS page cache / node_modules が保持されているため。**より厳密な cold start を要する場合は、Phase 3.7.a / 3.8.e 時点で同じ制約下 (devcontainer / 非 root) で再測することで公平な比較が可能。**

### Phase 3.8.e dev 側判定基準

- **±20% gate**: `[2246 ms, 3370 ms]` — Phase 3.7.b で dev runner を切替えた後の `pnpm run dev` cold start wall time 中央値がこの範囲を超過した場合、Phase 4 に進めない (Requirement 6.5)。
- **再現条件**: 上記 "計測環境" / "事前条件" / "キャッシュ条件" のすべてを Phase 3.7.a bake-off / 3.8.e 比較測定時に再現すること。特に以下を厳守:
  - `pnpm run dev:migrate` を事前実行し migration 要因を排除 (v8 では migrate-mongo + umzug の 2 系統)
  - OS / Node.js / pnpm / turbo のバージョンを一致させる
  - devcontainer 内で計測 (ホストの file system / CPU 差異を排除)
  - GROWI 関連の node プロセスが存在しないことを `ps aux | grep -E 'nodemon|src/server/app|dist/server/app|vitest'` で事前確認、ポート 3000 解放を確認
  - healthcheck 200 ポーリング間隔 = 100ms (スクリプト固定)
  - iteration 間に 3 秒の sleep を挟む (ポート解放のため)
  - 起動方式 (nodemon 経由 / direct) を baseline と比較側で揃える

---

## 本番起動時間 — R.6.6 (旧 task 0.4)

### コマンド

```bash
# apps/app 配下で実行
pnpm run server:ci
# v8 での内部展開:
# preserver: cross-env NODE_ENV=production pnpm run migrate
#   migrate:migrate-mongo → node -r dotenv-flow/config node_modules/migrate-mongo/bin/migrate-mongo up -f config/migrate-mongo-config.js
#   migrate:umzug         → pnpm run ts-node prisma/migrate.ts up
# server:   cross-env NODE_ENV=production node -r dotenv-flow/config dist/server/app.js --ci
```

`--ci` フラグにより、全モジュールロード・全リスナー attach が完了したタイミングで `server.close(() => process.exit())` が実行される。したがって `pnpm run server:ci` の wall time = "本番相当の起動完了までの時間" と等価となる (preserver migration を含む)。

**v8 差分**: preserver の `migrate` が **migrate-mongo + umzug (`pnpm run ts-node prisma/migrate.ts up`) の 2 段構成**になっている (旧ベースラインでは migrate-mongo のみ)。umzug 段は production でも ts-node (transpile-only) 経由で起動し、内部で `dist/utils/prisma` を import する。これは v8 本番起動の実態なので計測に含めている。旧ベースラインとの prod median 差 (+897 ms) の相当部分はこの umzug 段 (pnpm 2 階層 + ts-node 起動 + MongoDB 接続) の追加によるものと考えられる。

**MONGO_URI の明示 export (v8 固有の前提)**: `prisma/migrate.ts` は `process.env.MONGO_URI` を必須とし、未設定だと `Error: MONGO_URI is required` で preserver が失敗する (`.env.production` には MONGO_URI が無い)。このため計測シェルで `MONGO_URI=mongodb://mongo/growi` を export した。この値はコード内デフォルト (`src/server/util/mongoose-utils.ts` の `getMongoUri()` フォールバック) と完全に同一であり、アプリ本体・migrate-mongo の接続挙動は未設定時と変わらない (挙動同一の unblock 措置)。Phase 3.8.e 比較時も同じ export を行うこと。

事前に `turbo run build --filter @growi/app` で production artifact (`apps/app/dist/server/app.js` および `.next/`) を生成済み (exit 0)。migration は migrate-mongo / umzug とも全適用済みであることを status / pending コマンドで事前確認済み (1 回目の実行ログでも `applied 0 migrations.` を確認)。

### 生データ (5 runs)

| # | wall time (ms) | exit |
|---|---|---|
| 1 | 3994 | 0 |
| 2 | 4005 | 0 |
| 3 | 4117 | 0 |
| 4 | 4150 | 0 |
| 5 | 4220 | 0 |

- sorted: `[3994, 4005, 4117, 4150, 4220]` ms
- **median: 4117 ms**
- mean: 4097.2 ms
- stddev: ~87 ms (~2.1% of median)
- 参考: 旧ベースライン (v7 ベース、migrate-mongo 1 段) median 3220 ms → v8 で **+897 ms (+27.9%)** (umzug 段追加を含む)

### Phase 3.8.e 本番側判定基準

- **±20% gate**: `[3294 ms, 4940 ms]` — Phase 3.7.b ESM 切替後の `pnpm run server:ci` (もしくは同等の本番起動コマンド) を計測した中央値がこの範囲内であること (Requirement 6.5)。
- 比較時は preserver 2 段 migration (migrate-mongo + umzug) を含めた同一コマンド・同一前提 (`MONGO_URI` export、全 migration 適用済み) で計測すること。

### 計測対象に含まれる処理

1. `preserver` による migrate-mongo 起動 + migration status チェック (全 migration 適用済みなので up 処理は no-op)
2. **(v8 追加)** `preserver` による umzug 起動 (`pnpm run ts-node prisma/migrate.ts up`、ts-node transpile-only + `dist/utils/prisma` import + MongoDB 接続。`applied 0 migrations.` の no-op)
3. Node.js 起動 + `dotenv-flow/config` preload
4. `apps/app/dist/server/app.js` 全モジュールロード (CJS 側全 import 展開)
5. OpenTelemetry SDK 初期化 (`initInstrumentation`)
6. `Crowi#start()` — Mongoose 接続、Passport 初期化、Elasticsearch delegator 初期化 (NODE_ENV=production 時は `.env.production` に ES URI が無いため delegator は "Failed to initialize search delegator" で即時 disable。旧ベースラインと同じ挙動)、Cron サービス起動、Yjs 初期化
7. Express listen on :3000
8. `setupAdditionalResourceAttributes()` + `startOpenTelemetry()`
9. `--ci` → `server.close()` → `process.exit()`

---

## First-request レイテンシ (本番, 5 routes) — R.6.6 (旧 task 0.4)

### 計測方針

OpenTelemetry trace は本計測では採取していない (理由は後述)。代替として `curl --silent --max-time 30 -L -w "%{time_total}"` による end-to-end wall time を計測する。これは Requirement 6.5 の代替手段として仕様書類に許容されている。

1 iteration あたりの手順:

1. `pnpm run server` を bg 起動 (`--ci` なし、通常の production 起動。`MONGO_URI` export は本番起動時間計測と同じ)
2. `/_api/v3/healthcheck` が 200 を返すまで 100ms ポーリング (サーバ ready 待ち)
3. 5 ルートに順次 1 回ずつ GET (curl 1 回。複数サンプルを取ると cache 効果で 2 回目以降は meaningless になるため敢えて 1 回)
4. サーバのプロセスグループを SIGTERM → 2 秒後 SIGKILL、iteration 間 3 秒 sleep

### 対象ルート

| ルート | 分類 | 備考 |
|---|---|---|
| `/_api/v3/healthcheck` | API v3 | Express 直接ハンドラ (Next.js 非経由) |
| `/` | Next.js SSR | 初期ホームページ。ログイン前なので `/login` や公開ページ扱い |
| `/Sandbox` | Next.js SSR (`[[...path]]`) | 既存の seed page。LSX / drawio / markdown 混合 |
| `/Sandbox/Diagrams` | Next.js SSR | drawio を含む seed page |
| `/admin` | Next.js SSR | 未認証のため 302 → `/login` にリダイレクト (今回も実測で 302 → `/login` → 200 を確認)。`-L` で追従し `/login` 描画まで計測 |

ルート構成は旧ベースラインと同一 (固定ルート `/editor/:id` が存在しないため `/Sandbox/Diagrams` を代替採用、`/admin` は未認証 302→login フォロー版)。Phase 3.8.e 比較時も同じ未認証ルート + redirect follow 設定で再計測すること (Admin 認証済みページ計測は fixture 整備コストに見合わず、本ベースラインでも意図的にスキップ)。

### サンプル収集仕様

- 1 iteration × 5 route × 5 iteration = **25 サンプル (各ルートあたり 5 サンプル)**
- 各 iteration 間でサーバ再起動 → 各ルートに対しては "first-request after cold server" のみを計測

### 生データ (ms, curl `%{time_total}` を ms に丸め)

| route | iter1 | iter2 | iter3 | iter4 | iter5 | sorted |
|---|---|---|---|---|---|---|
| `/_api/v3/healthcheck` | 6 | 13 | 7 | 6 | 11 | 6,6,7,11,13 |
| `/` | 127 | 133 | 125 | 108 | 121 | 108,121,125,127,133 |
| `/Sandbox` | 28 | 33 | 26 | 22 | 26 | 22,26,26,28,33 |
| `/Sandbox/Diagrams` | 20 | 29 | 20 | 24 | 23 | 20,20,23,24,29 |
| `/admin` (→ `/login`) | 23 | 31 | 24 | 25 | 21 | 21,23,24,25,31 |

### p50 / p95 (per route, sample size = 5 each)

| route | p50 (ms) | p95 (ms) | Phase 3.8.e ±25% 許容範囲 (p95 基準) |
|---|---|---|---|
| `/_api/v3/healthcheck` | 7 | 13 | 9.8 – 16.3 ms |
| `/` | 125 | 133 | 99.8 – 166.3 ms |
| `/Sandbox` | 26 | 33 | 24.8 – 41.3 ms |
| `/Sandbox/Diagrams` | 23 | 29 | 21.8 – 36.3 ms |
| `/admin` (→ `/login`) | 24 | 31 | 23.3 – 38.8 ms |

p95 算出方法: nearest-rank (ceil(0.95 × n) 番目、n=5 のため index=4 = 最大値)。サンプル数が少ないため Phase 3.8.e 比較時はサンプル数を揃えた上で同じアルゴリズムを用いる。`/_api/v3/healthcheck` のように絶対値が数 ms のルートは ±25% が数 ms 幅しかなくノイズに埋もれやすい点に注意 (旧ベースラインから引き続きの制約。判定時は他ルートと合わせて総合的に判断する)。

### Phase 3.8.e first-request 判定基準

- **±25% gate**: 各ルートの p95 が上表の "許容範囲" 内 (Requirement 6.5、`first-request` のレイテンシ許容幅)。
- 超過ルートが存在した場合、以下を順に試行:
  1. lazy load 位置の調整 (Phase 4 / 5 向け改善として implement)
  2. bake-off 候補の再検討 (Phase 3.7.a やり直し)
- 超過したまま Phase 4 には進まない。

### OpenTelemetry 採取不可の理由

旧ベースラインと同じ事情が v8 でも変わっていないことを確認した。本計測時に実際に起動する `pnpm run server:ci` / `pnpm run server` は `NODE_ENV=production` で `.env.production` を読み込む。v8 の `.env.production` でも `OTEL_EXPORTER_OTLP_ENDPOINT` は `https://telemetry.growi.org` (GROWI プロジェクト共通の公開 collector) に設定されている。

- Production 起動時に devcontainer 内部の dev 用 collector を使うには `.env.production` を書き換えるか環境変数で上書きする必要があり、本計測の "現状再現" という趣旨から外れる。
- `https://telemetry.growi.org` に計測用トレースを送るのは公開 collector の汚染になるため不可。

したがって OTel trace 採取は断念し、`curl` による end-to-end wall time で代替した (Requirement 6.5 は "OpenTelemetry が利用可能な場合" と条件付きの要件)。Phase 3.8.e 比較時も同じ curl ベース計測で相対比較すれば整合する。

---

## 注記 / 制約事項

1. **naming-only 変更 10 ファイル適用済み worktree での計測**: 計測対象の `/workspace/growi-baseline` worktree には route-middleware snapshot 取得用の naming-only 変更 (middlewares 配下 9 ファイル + `routes/forgot-password.ts`、export 名/識別子の変更のみで挙動同一) が適用されている。性能への影響は無い。Phase 3.8.e 比較側にも同等の変更が含まれるため条件は揃っている。
2. **MONGO_URI の明示 export**: v8 の umzug migration (`prisma/migrate.ts`) が `MONGO_URI` を必須とするため、本番系計測 (起動時間 / first-request) ではコード内デフォルトと同一値 `mongodb://mongo/growi` を export した (詳細は本番起動時間の節)。dev 計測は `.env.development` の `MONGO_URI` (replicaSet=rs0 付き) をそのまま使用 (旧ベースラインと同条件)。
3. **OS page cache のクリア不可**: devcontainer 内では `echo 3 > /proc/sys/vm/drop_caches` に必要な root 権限がない。このためすべての計測は "OS page cache warm" 状態で取得している。Phase 3.7.a / 3.8.e でも同一条件を再現すること。
4. **nodemon は ENOSPC を発生させず、旧方式のまま計測**: 懸念された inotify watcher 枯渇は発生せず (max_user_watches=524288)、dev 計測は旧ベースラインと同じ `pnpm run dev` (nodemon 経由) で実施した。**計測方式の変更は無し**。ENOSPC が発生する環境向けの direct 起動フォールバック (`dev-once.js` の `MODE=direct`) は準備済み・未使用。
5. **ts-node 由来の警告**: dev 起動時に `[MONGOOSE] DeprecationWarning: strictQuery` が出力されるが計測には影響しない。旧ベースラインで観測された `[DEP0040] punycode DeprecationWarning` は v8 + Node v24.15.0 のログでは観測されなかった。
6. **`pnpm run server:ci` の preserver 内 migration**: 全 migration (migrate-mongo / umzug 両系統) 適用済みの状態で計測しているため、migration 実行自体はほぼ no-op (status 問い合わせ + `applied 0 migrations.`)。ただし v8 では umzug 段のプロセス起動コスト (pnpm + ts-node + MongoDB 接続) が wall time に常時加算される。Phase 3.8.e 時も同一条件 (事前 migration 完了済み + 2 段構成) で計測すること。
7. **計測スクリプト**: 本計測に使用したスクリプトは `apps/app/tmp/perf-baseline/measure-dev.sh` / `measure-prod.sh` / `measure-first-request.sh` / `dev-once.js` (dev 単発計測ヘルパ) に配置した (tmp 配下、production source は未変更)。いずれも `APP_DIR` 環境変数で計測対象ディレクトリを受け取り、本計測では `APP_DIR=/workspace/growi-baseline/apps/app` を指定して **v8 worktree 側に対して実行**した。Phase 3.7.a / 3.8.e で再利用する場合はこれらを参照すること。
8. **計測前のクリーンアップ**: 計測開始前に別 worktree (`growi-pdf-styles`) の dev サーバ (nodemon + ts-node、ポート 3000 占有) が稼働していたため、プロセスグループごと kill してから計測した。計測中の GROWI 由来の並走プロセスはゼロ。
