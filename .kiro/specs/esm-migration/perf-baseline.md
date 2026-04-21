# Performance Baseline (pre-migration)

本ドキュメントは ESM 移行前の起動性能・first-request レイテンシの基準値を記録するものである。Phase 3.7.a の dev runner bake-off、および Phase 3.8.e の ±20% / ±25% gate 判定で参照される。

## 計測環境

| 項目 | 値 |
|---|---|
| Node.js | v24.13.1 |
| pnpm | 10.32.1 |
| turbo | 2.1.3 |
| OS | Linux 5.15.0-174-generic (devcontainer) |
| CPU | 12th Gen Intel Core i7-12650H, 10 cores / 16 threads, max 4.7 GHz |
| Memory | 31 GiB total / 21 GiB available |
| Git SHA (計測時点) | 32764e0fae1ac0c9b5ede475831eb37190817dc9 |
| 計測日時 (UTC) | 2026-04-21 (本ブランチ `support/esm`) |
| MongoDB | `mongo:27017` (内部ネットワーク、mongo:8.0 コンテナ、コンテナ経路での接続) |
| Elasticsearch | `elasticsearch:9200` (v9.0.3、dev 用にのみ使用) |
| OTel collector | `otel-collector:4317` reachable (本計測では使用せず。理由は後述) |
| 並走プロセス | GROWI 由来の node/nodemon プロセスは存在しないことを事前に `ps aux` で確認。devcontainer server と Biome LSP (合計 CPU 0.3% 未満) を除く。ただし過去タスク由来のアイドル状態 `snapshot-route-middleware.ts` プロセスが計測中 3 件 (PID 339097 / 340280 / 340719) 存在。いずれも CPU 0.1%、Sleeping 状態のため実測への影響は無視可能と判断 (詳細は末尾 "注記 / 制約事項" を参照) |
| 計測手法 | `process.hrtime.bigint()` を Node.js one-liner で呼び出し、バックグラウンドプロセス起動前後で差分計算 (ms 粒度) |

## dev 起動時間 (ts-node 時代) — task 0.5

### コマンド
```bash
# apps/app 配下で実行
pnpm run dev
# 内部展開:
# cross-env NODE_ENV=development nodemon --exec "node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config --inspect src/server/app.ts"
```

計測は以下の手順。詳細は `tmp/perf-baseline/measure-dev.sh` を参照 (tmp 配下、本番コードは未変更)。

1. `hrtime.bigint()` で開始時刻記録
2. `setsid pnpm run dev` をバックグラウンド起動
3. 100ms ごとに `curl http://localhost:3000/_api/v3/healthcheck` をポーリング
4. 200 が返却された時点で `hrtime.bigint()` で終了時刻記録、差分を ms で算出
5. プロセスグループに SIGTERM → 2 秒後 SIGKILL

### 事前条件

- **dev migration は事前に完了済み**: 本計測では `pnpm run dev:migrate` を事前に 1 回実行しておき、`pnpm run dev` 側では migration ステップを含めない (nodemon は migration を実行しない仕様)。
- **healthcheck の性質**: `/_api/v3/healthcheck` は Express API ルートであり Next.js ページコンパイルには依存しない。よって本計測は **サーバ (Crowi クラス) 起動 + Express listen までの wall time** を表す。

### キャッシュ条件

- **warm cache**: Next.js `.next/dev` キャッシュを iteration 間で保持。OS page cache も保持 (devcontainer 内で root 権限を持たないため `drop_caches` は実行できない)。
- **cold cache**: `.next/dev` を削除した直後の 1 回計測を別途取得。`node_modules` / pnpm store / OS page cache はそのまま (devcontainer 制約のため不可)。

### 生データ (5 runs, warm cache)

| # | wall time (ms) | HTTP |
|---|---|---|
| 1 | 2703 | 200 |
| 2 | 2809 | 200 |
| 3 | 2724 | 200 |
| 4 | 2716 | 200 |
| 5 | 2760 | 200 |

- sorted: `[2703, 2716, 2724, 2760, 2809]` ms
- **median: 2724 ms**
- mean: 2742 ms
- stddev: ~39 ms (~1.4% of median)

### cold cache 参照値

- `.next/dev` 削除直後: **2737 ms** (1 回)
- warm との差分は数十 ms 程度でノイズ範囲内。理由は healthcheck が Next.js 非依存で、かつ OS page cache / node_modules が保持されているため。**より厳密な cold start を要する場合は、Phase 3.7.a / 3.8.e 時点で同じ制約下 (devcontainer / 非 root) で再測することで公平な比較が可能。**

### Phase 3.8.e dev 側判定基準

- **±20% gate**: `[2179 ms, 3269 ms]` — Phase 3.7.b で dev runner を切替えた後の `pnpm run dev` cold start wall time 中央値がこの範囲を超過した場合、Phase 4 に進めない (Requirement 6.5)。
- **再現条件**: 上記 "計測環境" / "事前条件" / "キャッシュ条件" のすべてを Phase 3.7.a bake-off / 3.8.e 比較測定時に再現すること。特に以下を厳守:
  - `pnpm run dev:migrate` を事前実行し migration 要因を排除
  - OS / Node.js / pnpm / turbo のバージョンを一致させる
  - devcontainer 内で計測 (ホストの file system / CPU 差異を排除)
  - GROWI 関連の node プロセスが存在しないことを `ps aux | grep -E 'nodemon|src/server/app'` で事前確認
  - healthcheck 200 ポーリング間隔 = 100ms (スクリプト固定)
  - iteration 間に 3 秒の sleep を挟む (ポート解放のため)

---

## 本番起動時間 — task 0.4

### コマンド
```bash
# apps/app 配下で実行
pnpm run server:ci
# 内部展開:
# preserver: cross-env NODE_ENV=production pnpm run migrate
#   → node -r dotenv-flow/config node_modules/migrate-mongo/bin/migrate-mongo up -f config/migrate-mongo-config.js
# server:   cross-env NODE_ENV=production node -r dotenv-flow/config dist/server/app.js --ci
```

`--ci` フラグにより、全モジュールロード・全リスナー attach が完了したタイミングで `server.close(() => process.exit())` が実行される。したがって `pnpm run server:ci` の wall time = "本番相当の起動完了までの時間" と等価となる (preserver migration を含む)。

事前に `turbo run build --filter @growi/app` で production artifact (`apps/app/dist/server/app.js` および `.next/`) を生成済み。

### 生データ (5 runs)

| # | wall time (ms) | exit |
|---|---|---|
| 1 | 3220 | 0 |
| 2 | 3207 | 0 |
| 3 | 3244 | 0 |
| 4 | 3267 | 0 |
| 5 | 3157 | 0 |

- sorted: `[3157, 3207, 3220, 3244, 3267]` ms
- **median: 3220 ms**
- mean: 3219 ms
- stddev: ~42 ms (~1.3% of median)

### Phase 3.8.e 本番側判定基準

- **±20% gate**: `[2576 ms, 3864 ms]` — Phase 3.7.b ESM 切替後の `pnpm run server:ci` (もしくは同等の本番起動コマンド) を 3 回計測した中央値がこの範囲内であること (Requirement 6.5)。

### 計測対象に含まれる処理

1. `preserver` による migrate-mongo 起動 + migration status チェック (全 migration 適用済みなので up 処理は no-op)
2. Node.js 起動 + `dotenv-flow/config` preload
3. `apps/app/dist/server/app.js` 全モジュールロード (CJS 側全 import 展開)
4. OpenTelemetry SDK 初期化 (`initInstrumentation`)
5. `Crowi#start()` — Mongoose 接続、Passport 初期化、Elasticsearch delegator 初期化 (NODE_ENV=production 時は `.env.production` にしか設定がないため delegator は "No elasticsearch URI is specified" で即時 disable)、Cron サービス起動、Yjs 初期化
6. Express listen on :3000
7. `startOpenTelemetry()` + `setupAdditionalResourceAttributes()`
8. `--ci` → `server.close()` → `process.exit()`

---

## First-request レイテンシ (本番, 5 routes) — task 0.4

### 計測方針

OpenTelemetry trace は本計測では採取していない (理由は後述)。代替として `curl --silent --max-time 30 -L -w "%{time_total}"` による end-to-end wall time を計測する。これは Requirement 6.5 の代替手段として仕様書類に許容されている。

1 iteration あたりの手順:

1. `pnpm run server` を bg 起動 (`--ci` なし、通常の production 起動)
2. `/_api/v3/healthcheck` が 200 を返すまでポーリング (サーバ ready 待ち)
3. 5 ルートに順次 1 回ずつ GET (curl 1 回。複数サンプルを取ると cache 効果で 2 回目以降は meaningless になるため敢えて 1 回)
4. サーバ kill

### 対象ルート

| ルート | 分類 | 備考 |
|---|---|---|
| `/_api/v3/healthcheck` | API v3 | Express 直接ハンドラ (Next.js 非経由) |
| `/` | Next.js SSR | 初期ホームページ。ログイン前なので `/login` や公開ページ扱い |
| `/Sandbox` | Next.js SSR (`[[...path]]`) | 既存の seed page。LSX / drawio / markdown 混合 |
| `/Sandbox/Diagrams` | Next.js SSR | drawio を含む seed page |
| `/admin` | Next.js SSR | 未認証のため 302 → `/login` にリダイレクト。`-L` で追従し `/login` 描画まで計測 |

タスク指定の `/editor/:id` は GROWI のルーティングに該当する固定ルートが存在しない (エディタは `[[...path]]` + クエリ / クライアントモード切替) ため、代替として drawio を含む `/Sandbox/Diagrams` を採用。`/admin` 認証済み版は credentials 投入のセットアップが高コストのため **今回は未認証時 302→login フォロー版** を採用する。Phase 3.8.e 比較時も同じ未認証ルート + redirect follow 設定で再計測すること (Admin 認証済みページ計測は fixture 整備コストに見合わず、本ベースラインでは意図的にスキップ)。

### サンプル収集仕様

- 1 iteration × 5 route × 5 iteration = **25 サンプル (各ルートあたり 5 サンプル)**
- 各 iteration 間でサーバ再起動 → 各ルートに対しては "first-request after cold server" のみを計測

### 生データ (ms)

| route | iter1 | iter2 | iter3 | iter4 | iter5 | sorted |
|---|---|---|---|---|---|---|
| `/_api/v3/healthcheck` | 6 | 6 | 6 | 6 | 6 | 6,6,6,6,6 |
| `/` | 117 | 120 | 117 | 116 | 115 | 115,116,117,117,120 |
| `/Sandbox` | 26 | 27 | 26 | 26 | 26 | 26,26,26,26,27 |
| `/Sandbox/Diagrams` | 16 | 17 | 17 | 18 | 16 | 16,16,17,17,18 |
| `/admin` (→ `/login`) | 16 | 16 | 16 | 17 | 18 | 16,16,16,17,18 |

### p50 / p95 (per route, sample size = 5 each)

| route | p50 (ms) | p95 (ms) | Phase 3.8.e ±25% 許容範囲 (p95 基準) |
|---|---|---|---|
| `/_api/v3/healthcheck` | 6 | 6 | 4.5 – 7.5 ms |
| `/` | 117 | 120 | 90.0 – 150.0 ms |
| `/Sandbox` | 26 | 27 | 20.3 – 33.8 ms |
| `/Sandbox/Diagrams` | 17 | 18 | 13.5 – 22.5 ms |
| `/admin` (→ `/login`) | 16 | 18 | 13.5 – 22.5 ms |

p95 算出方法: nearest-rank (ceil(0.95 × n) 番目、n=5 のため index=4 = 最大値)。サンプル数が少ないため Phase 3.8.e 比較時はサンプル数を揃えた上で同じアルゴリズムを用いる。

### Phase 3.8.e first-request 判定基準

- **±25% gate**: 各ルートの p95 が上表の "許容範囲" 内 (Requirement 6.5、`first-request` のレイテンシ許容幅)。
- 超過ルートが存在した場合、以下を順に試行:
  1. lazy load 位置の調整 (Phase 4 / 5 向け改善として implement)
  2. bake-off 候補の再検討 (Phase 3.7.a やり直し)
- 超過したまま Phase 4 には進まない。

### OpenTelemetry 採取不可の理由

本計測時に実際に起動する `pnpm run server:ci` / `pnpm run server` は `NODE_ENV=production` で `.env.production` を読み込む。`.env.production` の `OTEL_EXPORTER_OTLP_ENDPOINT` は `https://telemetry.growi.org` (GROWI プロジェクト共通の公開 collector) に設定されている。

- devcontainer 内部の `otel-collector:4317` は `telnet` で到達可能であることを事前確認済みだが、それは **dev 用 collector**。Production 起動時にこのエンドポイントが使われるためには `.env.production` を書き換えるか環境変数で上書きする必要があり、本計測の "現状再現" という趣旨から外れる。
- `https://telemetry.growi.org` に計測用トレースを送るのは公開 collector の汚染になるため不可。

したがって OTel trace 採取は断念し、`curl` による end-to-end wall time で代替した (Requirement 6.5 は "OpenTelemetry が利用可能な場合" と条件付きの要件)。Phase 3.8.e 比較時も同じ curl ベース計測で相対比較すれば整合する。

---

## 注記 / 制約事項

1. **過去タスク由来のアイドルプロセス**: 計測中、過去 `snapshot-route-middleware.ts` 実行に由来するアイドル状態の ts-node プロセス (PID 339097 / 340280 / 340719、それぞれ elapsed ~60min、CPU 0.1%、STAT `Sl` = sleeping) が 3 件残存していた。これらは本計測を開始した agent が起動したものではなく、殺すと親オーケストレーションに影響する可能性があるため放置した。いずれも sleeping 状態で CPU / IO をほぼ消費しないため、実測値への影響は無視可能と判断した。ただし **Phase 3.7.a bake-off / 3.8.e 比較計測時にはこれらプロセスが残存していないことを確認してから計測すること** を推奨する。
2. **OS page cache のクリア不可**: devcontainer 内では `echo 3 > /proc/sys/vm/drop_caches` に必要な root 権限がない。このためすべての計測は "OS page cache warm" 状態で取得している。Phase 3.7.a / 3.8.e でも同一条件を再現すること。
3. **ts-node 由来の警告**: dev 起動時に `[MONGOOSE] DeprecationWarning: strictQuery` および `[DEP0040] punycode DeprecationWarning` が出力されるが、計測には影響しない。
4. **`pnpm run server:ci` の preserver 内 migration**: 全 migration 適用済みの状態で計測しているため、migration 実行自体はほぼ no-op (mongo に status 問い合わせのみ)。Phase 3.8.e 時も同一条件 (事前 migration 完了済み) で計測すること。
5. **計測スクリプト**: 本計測に使用したスクリプトは `tmp/perf-baseline/measure-dev.sh` / `tmp/perf-baseline/measure-prod.sh` / `tmp/perf-baseline/measure-first-request.sh` に配置した (tmp 配下、production source は未変更)。Phase 3.8.e で再利用する場合はこれらを参照すること。
