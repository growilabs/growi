# Dev Runner Bake-off (task 3.7.a)

実施日: 2026-06-13 / 環境: Claude Code リモートサンドボックス (Node v22.22.2, pnpm 11.1.1)

## 結論

**採用ランナー: `tsx` 4.22.4**(`node --import tsx` 形式)

`@swc-node/register` 1.10.9 は必須条件「`tsconfig.paths` の runtime 解決成立」を満たせず失格。選定は機能要件で確定したため、性能比較は成立した候補 (tsx) の単独記録となる。

## 測定環境に関する重要な注記 (deviation)

本サンドボックスには **MongoDB が存在しない**ため、タスク定義の「`pnpm dev` 起動 → healthcheck 200 までの壁時計時間を Phase 0.5 と同一条件で計測」は実施不能。代わりに以下の 2 段構成とした:

1. **機能検証 + 代理計測 (本ドキュメント)**: サーバ全モジュールグラフ (`~/server/crowi/index.js` 起点) のロード完了までの壁時計時間で候補を比較。グラフロードは dev 起動時間の支配項 (TS 変換 + モジュール初期化) を含むが、Next.js prepare と DB 接続後の初期化は含まない
2. **正式計測 (3.8.e gate へ委譲)**: Phase 0.5 ベースライン (devcontainer, i7-12650H, Node 24) と同一環境・同一手順 (nodemon 経由 + healthcheck 200 ポーリング、5 回中央値) での ±20% gate 判定は **3.8.e で実施すること**。本サンドボックスの絶対値はハードウェアが異なるため Phase 0.5 の数値と直接比較してはならない

加えて、push 後の CI `ci-app-launch-dev` (mongo サービスコンテナ付き) が「tsx で healthcheck 相当 (`--ci` 起動) が成立する」ことの実 DB 検証となる。

## 候補と結果

### 1. tsx 4.22.4 — ✅ 採用

検証コマンド (apps/app 配下):

```bash
# グラフロード (代理計測)
node --import tsx tmp/graph-probe.mts   # import('~/server/crowi/index.js')
# フル起動 (機能検証)
NODE_ENV=development MONGO_URI=mongodb://127.0.0.1:27017/growi \
  node --import tsx -r dotenv-flow/config src/server/app.ts
```

| 検証項目 | 結果 |
|---|---|
| `tsconfig.paths` runtime 解決 | ✅ `~/*`・`^/*`・**suffix パターン `~/*.js` → `./src/*`** すべて解決 (グラフ全体ロード成功で実証) |
| `.js` 付き相対 specifier → `.ts` 解決 | ✅ |
| CJS deps interop (ldapjs ほか) | ✅ フル起動が `MongooseServerSelectionError: connect ECONNREFUSED` のみで停止 = 全リンク・実行成功 |
| 起動ログのエラー/警告 | punycode DeprecationWarning (Node 22 既知・ts-node 時代から存在) のみ |

グラフロード壁時計時間 (5 回, ms): **4029 / 4033 / 2880 / 4042 / 3925 → 中央値 4029ms**

### 2. @swc-node/register 1.10.9 — ❌ 失格

```bash
node --import @swc-node/register/esm-register tmp/graph-probe.mts
# → GRAPH_FAIL: Cannot find package '^' imported from .../src/utils/growi-version.ts
```

`^/` エイリアス (`"^/*": ["./*"]`, 例: `^/package.json`) を bare package `'^'` と誤解釈して解決不能。**選定基準の必須条件 (paths 解決成立) を満たさないため却下**。

### 3. その他の候補

- `ts-node/esm`: タスク定義により除外 (`--loader` API deprecated)
- `node --experimental-strip-types`: paths エイリアス非対応のため検討外 (本リポジトリは `~/`/`^/` alias が前提)

## 採用形態 (task 3.7.b)

- dev: `nodemon --exec node --inspect --import tsx --import dotenv-flow/config src/server/app.ts`
- `migrate:umzug` は本番起動経路 (`preserver`) で実行されるため、**tsx は `devDependencies` ではなく `dependencies`** に配置 (pnpm deploy --prod の除外対象にしない)
- `dev:migrate-mongo` は TS を実行しない (migrate-mongo bin + .cjs config + CJS migrations) ため tsx 不要の plain node に変更

## pino エラー握り潰しへの注意 (運用メモ)

tsx 起動で DB 接続に失敗した場合、app.ts の `logger.error` (pino transport) が flush 前にプロセス終了し**エラーが何も表示されず exit 1** することがある (tasks.md 3.3.d 記載の既知パターンの dev runner 版)。起動失敗の調査時は app.ts の catch に一時的に `console.error` を足すこと。
