# 調査・設計判断ログ: ESM 移行

---
**目的**: ESM 移行の技術設計を下支えするためのギャップ分析・技術調査・設計判断を記録する。
---

## Summary

- **Feature**: `esm-migration`
- **Discovery Scope**: Complex Integration — モノレポ全体の CJS→ESM 移行。`apps/app` サーバ層が中核課題。
- **Key Findings**:
  - `apps/app` サーバは現在完全な CJS (`module.exports` 82 ファイル / `require()` 176 箇所・57 ファイル)。最大の課題は `require('./x')(crowi, app)` の factory DI が中央ルーター 2 ファイルに 56 箇所集中している点。
  - モデル側 (`models/user` 等) がモジュールトップレベルでサービス singleton (`configManager`, `aclService`) を import する経路があり、ESM の strict loading では初期化デッドロックになりうる。これが最大のランタイムリスク。
  - Turbopack が既に本番・開発で既定になっているため、`transpilePackages` 削減のフィージビリティは Turbopack の ESM 外部化挙動に依存する。ESM-only 橋渡しのために積まれたエントリ (42 + 6 prefix) は大半が削除候補。
  - Node.js 24 の `require(esm)` により、CJS サードパーティ (`@lykmapipo/common`) が ESM-only 推移依存を解決できる可能性が高く、`pnpm.overrides` 3 件は削除候補。ただし動作検証必須。
  - `migrate-mongo` は ESM マイグレーションファイルを未サポート。`apps/app/src/migrations/` 配下の 60 本超はディレクトリ単位で CJS 隔離する必要がある (Req 5 AC5 と整合)。

---

## 1. Requirement-to-Asset Map

### Requirement 1: 残余共有パッケージの ESM 宣言

| Asset | 現状 | Gap |
|-------|------|-----|
| `@growi/pdf-converter-client` | `package.json` に `type` なし。成果物は orval 自動生成 (ESM 構文)。`orval.config.js` は CJS | **Trivial** — `"type": "module"` 追加 + `orval.config.js` → `.cjs` リネーム |
| `@growi/preset-themes` | `package.json` に `type` なし。Vite で ES + UMD デュアル出力 | **Trivial** — `"type": "module"` 追加。デュアル出力は維持 |
| `@growi/preset-templates` | JS ソースなし (プラグインデータのみ) | **Trivial** — `"type": "module"` 追加のみ |
| `@growi/core-styles` | SCSS のみ。JS 出力なし | **None** — 一貫性のため `"type": "module"` を付与 |
| `@growi/custom-icons` | SVG + フォントビルダのみ。JS 出力なし | **None** — 同上 |

**Effort: S (1 day)** | **Risk: Low**

### Requirement 2: apps/app サーバ層の ESM 移行

| Asset | 現状 | Gap |
|-------|------|-----|
| `apps/app/tsconfig.build.server.json` | `"module": "CommonJS"`, `"moduleResolution": "Node"`, `outDir: transpiled` | `"module": "NodeNext"` / `"moduleResolution": "NodeNext"` に変更 |
| Factory route 定義 | 82 ファイルが `module.exports = (crowi, app) => { ... }` 形式 | **大規模改修** — 名前付きエクスポートのファクトリ関数へ変換 |
| 静的/動的 require | 57 ファイル 176 箇所 | 機械的変換 — `import` または `await import()` に置換 |
| Factory require+invoke | 56 箇所 — `routes/index.js` に 12、`routes/apiv3/index.js` に 44 | 静的 `import` + ファクトリ呼び出しに変換 |
| 条件付き require | 2 ファイルで三項演算子の require | 条件付き `await import()` に変換 |
| `__dirname` / `__filename` | 3 ファイル — `crowi/index.ts`, `crowi/dev.js`, `service/i18next.ts` | `import.meta.dirname` (Node.js 21.2+) に置換。`next.config.ts` の `__dirname` はビルド時のみで対象外 |
| 開発サーバ起動 | `node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config` (package.json の `ts-node` スクリプト) | ESM ローダへ切替 (tsx が最有力) |
| 本番起動 | `node -r dotenv-flow/config dist/server/app.js` | `--import dotenv-flow/config` に切替 |
| 設定ファイル (CJS) | `apps/app/config/` に `migrate-mongo-config.js`, `next-i18next.config.js`, `i18next.config.js` | `.cjs` にリネーム (logger config は .ts 化済みで対象外) |
| `next.config.prod.cjs` | すでに `.cjs` | 変更不要 |
| `src/migrations/*.js` | 60 本超が `require('mongoose')` 使用 | **制約** — migrate-mongo が ESM 未対応のため CJS 維持 |

**代表パターン:**

```javascript
// 現状: routes/index.js (中央ルータロード)
module.exports = (crowi, app) => {
  const page = require('./page')(crowi, app);       // 類似 12 行
  const apiV3Router = require('./apiv3')(crowi, app);
  app.use('/_api/v3', apiV3Router);
  // ...
};

// 現状: routes/page.js (典型的ルートモジュール)
module.exports = (crowi, app) => {
  const { Page } = crowi.models;
  const actions = {};
  actions.create = async (req, res) => { ... };
  return actions;
};
```

**Effort: XL (2+ weeks)** | **Risk: High** — `routes/apiv3/index.js` 単体で 44 件の factory require+invoke。ESM strict loading 下での循環依存の顕在化リスク。

### Requirement 3: transpilePackages の削減

| Asset | 現状 | Gap |
|-------|------|-----|
| `getTranspilePackages()` | ハードコード 42 + プレフィックス 6 種 (`remark-` / `rehype-` / `hast-` / `mdast-` / `micromark-` / `unist-`) | サーバ ESM 化後に個別評価 |
| ハードコード 42 | `react-markdown` / `unified` エコシステム中心 | **要研究** — Turbopack + ESM でネイティブ解決可能か |
| プレフィックス展開 | `listPrefixedPackages` 経由で動的展開 (~99 件相当) | **要研究** — Turbopack が ESM を自然解決すれば全削除可能 |
| `experimentalOptimizePackageImports` | `@growi/*` 11 件 | 最適化目的なので維持 (CJS 回避目的ではない) |

**Effort: L (1–2 weeks)** | **Risk: Medium** — エントリごとにビルド + ランタイム検証必要。Turbopack の ESM 外部化挙動は公式ドキュメントが薄い。

### Requirement 4: pnpm.overrides のクリーンアップ

| Asset | 現状 | Gap |
|-------|------|-----|
| `@lykmapipo/common>flat` → `5.0.2` | 推移経路: `mongoose-gridfs` → `@lykmapipo/mongoose-common` → `@lykmapipo/common` | **制約** — `@lykmapipo/common` 自体は CJS。サーバ ESM 化してもこのパッケージの内部 `require()` は変わらない。Node.js 24 の `require(esm)` 次第で override 不要化できる可能性 |
| `@lykmapipo/common>mime` → `3.0.0` | 同経路 | 同上 |
| `@lykmapipo/common>parse-json` → `5.2.0` | 同経路 | 同上 |
| `axios` → `^1.15.0` | CVE セキュリティピン (CJS/ESM とは無関係) | **対象外** — Req 4 AC5 で明示的に維持 |

**Effort: S (1 day)** | **Risk: Medium** — Node.js 24 の `require(esm)` が CJS→ESM 推移解決を扱えるかに依存。

### Requirement 5: type: module 宣言と CJS 隔離

| Asset | 現状 | Gap |
|-------|------|-----|
| ルート `package.json` | `type` フィールドなし | `"type": "module"` 追加 |
| `apps/app/package.json` | `type` フィールドなし | `"type": "module"` 追加 |
| `apps/slackbot-proxy/package.json` | `type` なし | **対象外** (廃止予定) |
| `apps/app/config/*.js` | 3 ファイルが CJS (migrate-mongo-config, next-i18next.config, i18next.config) | `.cjs` へリネーム |
| `apps/app/src/migrations/` | 60+ JS マイグレーションファイル | `{ "type": "commonjs" }` を宣言した `package.json` をディレクトリ内に設置 |

**Effort: M (3–5 days)** | **Risk: Medium** — 設定ファイル名変更に伴う CLI スクリプト (migrate-mongo, nodemon) 経由の参照修正。

### Requirement 6: ビルド・テスト・ランタイム検証

| Asset | 現状 | Gap |
|-------|------|-----|
| `turbo run build` | CJS サーバ出力で成功 | ESM 出力で成功させる |
| `turbo run lint` | Biome + TypeScript | ESM 起因の型エラーが新規発生する可能性 |
| `turbo run test` | Vitest ベース | Vitest は ESM ネイティブ対応、リスク低 |
| `assemble-prod.sh` | ワークスペースルート staging + `pnpm deploy --prod` | ESM モジュールがフラット構造で解決されるか要検証 |
| `check-next-symlinks.sh` | `.next/node_modules/` シンボリックリンクの検証 | `transpilePackages` 削減後の再検証必須 |
| 本番起動 | `node -r dotenv-flow/config dist/server/app.js` | `--import dotenv-flow/config` に変更 |

**Effort: M (3–5 days)** | **Risk: Medium**

### Requirement 7: ドキュメントとコメントの整合

| Asset | 現状 | Gap |
|-------|------|-----|
| `package.json` の `// comments for dependencies` | CJS/ESM ピン理由が記述されている箇所あり | 解消済みの記述を削除 |
| `.kiro/steering/tech.md` | `transpilePackages` / 本番アセンブリを記述 | ESM 化後の内容に更新 |
| 自動ロード skill (`.claude/skills/tech-stack`, `.claude/skills/build-optimization` 等) | CJS/ESM 現状を記述した箇所あり | 同期更新 |

**Effort: S (1 day)** | **Risk: Low**

---

## 2. Research Log

### 2.1 CJS→ESM 変換のコード修正ツール

- **Context**: 82 ファイルの `module.exports`、176 箇所の `require()`、56 箇所の factory DI を一括変換したい。
- **Sources Consulted**: npm registry (`cjstoesm`, `commonjs-to-es-module-codemod`, `lebab`, `ts2esm`), GitHub issues, Total TypeScript ブログ。
- **Findings**:
  - **`cjstoesm` (wessberg)**: 静的 `require()` → `import` と `module.exports` → `export default` を扱える。`.js` 拡張子も付与する。**`require('./page')(crowi, app)` のような即時呼び出しパターンは非対応**。新しめの TypeScript で既知の不具合あり。
  - **`jscodeshift` + `commonjs-to-es-module-codemod` (azu)**: カスタム transform で拡張可能。50-100 行のカスタム transform で GROWI の 4 パターン (static require、factory exports、require+invoke、conditional require) すべてに対応可能。`--extensions ts` で TS ファイルを処理できる。
  - **`lebab`**: TypeScript 非対応、CJS 変換が限定的、メンテ停滞。不適。
  - **`ts2esm` (bennycode)**: 既存 ESM import に `.js` 拡張子を付けるだけ。require/exports 変換は**しない**。セカンドパス用途には有用。
  - **ESLint プラグイン**: `import/no-commonjs` で残存 CJS パターンを検出できる (自動修正なし)。`eslint-plugin-import-x` の extensions ルールは `.js` 拡張子の自動補完が可能。
  - **TypeScript コンパイラ**: CJS 構文自体は変換しない。`module` 設定による出力フォーマットの変更のみ。変換後の enforcement に利用可能。
- **Implications**: 単一ツールで全パターンに対応できる **jscodeshift + カスタム transform** を主戦力とし、ts2esm を拡張子補完のセカンドパス、ESLint を再発防止の enforcement に使う三段構え。

### 2.2 Node.js 24 向け tsconfig モジュール設定

- **Context**: サーバビルドは現在 `"module": "CommonJS"` / `"moduleResolution": "Node"`。ESM 出力へ切替える。
- **Sources Consulted**: TypeScript 公式ドキュメント、Total TypeScript ブログ (Matt Pocock)、Andrew Branch "NodeNext for libraries"。
- **Findings**:
  - **`"module": "NodeNext"`**: 近傍 `package.json` の `"type"` に従って ESM/CJS を per-file 出力。コンパイル時に `.js` 拡張子を enforce。
  - **`"module": "ESNext"`**: 常に ESM 構文を出力。拡張子 enforce なし。
  - **`"moduleResolution": "NodeNext"`**: Node.js ランタイムの解決に一致。`"module": "NodeNext"` と組み合わせる必要あり。
  - **`"moduleResolution": "Bundler"`**: bare specifier と拡張子省略を許容。バンドル前提コード向けで Node.js 直接実行には不適。
- **Implications**: サーバビルドは `NodeNext` / `NodeNext` を採用。Next.js フロントエンドと共有パッケージ (バンドラ前提) は従来の `ESNext` / `Bundler` を維持。

| 文脈 | module | moduleResolution | 根拠 |
|------|--------|------------------|------|
| サーバビルド (Node.js 24 直接実行) | NodeNext | NodeNext | 直接実行。コンパイル時に ESM 正当性を enforce |
| Next.js フロントエンド | ESNext | Bundler | Turbopack が解決 |
| 共有パッケージ (バンドル) | ESNext | Bundler | バンドラで消費 |

### 2.3 循環依存の静的解析

- **Context**: ESM の strict loading は、CJS が暗黙に許容していた循環 require を `ReferenceError` に変える可能性がある。
- **Sources Consulted**: `crowi/index.ts`, `routes/index.js`, `models/*`, `services/*` の直接読解。
- **Findings**:
  - **パターン A — Model がモジュールトップで Service singleton を import**: `models/user/index.js` が `configManager` と `aclService` をトップレベルで取り込み、`configManager` は動的に `models/config` をロードする。CJS の遅延評価で隠されていた循環。**最高リスク**。
  - **パターン B — Crowi → Routes → Middleware → Crowi 参照**: `crowi/index.ts` が `routes/index.js` を動的 import し、middleware ファクトリが `crowi` 引数経由で受け取る。直接の循環 import はない。factory DI のおかげで安全。
  - **パターン C — Service ↔ Crowi コールバック**: `service/app.ts:94` が `crowi.setupRoutesAtLast()` を呼び出す。コールバックループだが import 循環ではない。
  - **パターン D — 動的 require にランタイム計算パス**: `service/s2s-messaging/index.ts:60` と `service/file-uploader/index.ts:16` が `require(modulePath)(crowi)` を使用。`await import()` に変換する必要がある。
- **Implications**: パターン A はモデルを lazy 化する refactor が必須。パターン B の factory DI は安全。パターン D は `await import()` へ機械的変換可能。

### 2.4 開発サーバ起動 (ESM 対応 TS ランナー)

- **Context**: 現在 `node -r ts-node/register/transpile-only -r tsconfig-paths/register -r dotenv-flow/config` (`package.json:51`)。すべて CJS only。
- **Sources Consulted**: tsx 公式ドキュメント、ts-node ESM ドキュメント、Node.js `--experimental-strip-types` ドキュメント。
- **Findings**:
  - **tsx**: 推奨。`--import tsx` で ESM ネイティブ。`tsconfig.paths` のエイリアスを自前で解決。Node.js 24 対応。起動: `node --import tsx src/server/app.ts`。
  - **ts-node/esm**: `--loader` API は deprecated。`--import ts-node/esm` も存在するが tsx の方がシンプルかつ高速。
  - **Node.js `--experimental-strip-types`**: Node.js 22+ で利用可、24 ではデフォルト有効。ただし path alias・decorator・enum 等の高度な TS 機能は未対応。GROWI では不足。
  - **tsconfig-paths**: `-r` 経由の CJS only。ESM では tsx が自前で扱う。代替として package.json の `imports` フィールドも選択肢。
- **Implications**: `ts-node` + `tsconfig-paths` を **tsx** に一本化。path alias をツール非依存で維持。

### 2.5 本番エントリポイント

- **Context**: 現状 `node -r dotenv-flow/config dist/server/app.js`。`-r` は CJS プリロード専用。
- **Findings**:
  - `dotenv-flow` v4+ は `--import dotenv-flow/config` (ESM プリロード) をサポート。
  - Node.js 24 の `--import` フラグは `-r` の ESM 等価物。
  - 変更後コマンド: `node --import dotenv-flow/config dist/server/app.js`。
- **Implications**: 1 行変更。`package.json` の dotenv-flow バージョン確認のみ。

### 2.6 migrate-mongo の ESM 対応

- **Context**: `src/migrations/` の 60+ ファイルが `require('mongoose')` を使用。
- **Findings**:
  - migrate-mongo は内部で `require()` によりマイグレーションファイルと設定をロード。v10.x 時点で ESM マイグレーションファイル非対応。
  - Node.js 24 の `require(esm)` で CJS→ESM の `require` 解決は可能だが、migrate-mongo 自体の対応状況は未確認。
  - マイグレーションファイルは `tsconfig.build.server.json` のコンパイル対象外 (raw JS)。
- **Implications**: 最安全策は `src/migrations/package.json` に `{ "type": "commonjs" }` を置き、ディレクトリ単位で CJS 扱いとする。`config/migrate-mongo-config.js` は `.cjs` にリネーム。

### 2.7 CJS のまま残す設定ファイル

- **Context**: `apps/app/config/` に `require()` 構文の設定ファイルが 3 つ。
- **Files analyzed**:
  - `config/migrate-mongo-config.js`: 環境変数で分岐して mongoose util を require。→ `.cjs`。
  - `config/next-i18next.config.js`: i18next backend を複数 require。→ `.cjs`。
  - `config/i18next.config.js`: `@growi/core` から require。→ `.cjs`。
  - `config/logger/config.dev.ts` / `config.prod.ts`: TypeScript 化済み。**対象外**。
  - `next.config.prod.cjs`: すでに `.cjs`。変更不要。
  - `packages/pdf-converter-client/orval.config.js`: Orval code generation 設定。→ `.cjs`。
- **Implications**: `.cjs` リネームが最安全。CLI ツール互換性を確実に維持する。

### 2.8 pnpm.overrides と require(esm)

- **Context**: `flat` / `mime` / `parse-json` を CJS 版にピン (`@lykmapipo/common` のため)。
- **Findings**:
  - `@lykmapipo/common` は CJS パッケージで内部的にこれらを require。
  - Node.js 24 の `require(esm)` は CJS コードが ESM-only パッケージを require することを許容する (top-level await のみ制限)。
  - `flat` v6 / `mime` v4 / `parse-json` v7 は ESM-only だが top-level await は未使用。
- **Implications**: Node.js 24 環境下では override を 1 件ずつ削除 → `pnpm install && turbo run build` で検証する形で外せる見込み。

---

## 3. Architecture Pattern Evaluation

| Option | 概要 | 強み | リスク / 制約 | 備考 |
|--------|------|------|---------------|------|
| Big-Bang | サーバコードを 1 パスで全変換 | 一貫した状態、codemod 活用可 | 200+ ファイルの巨大 PR、レビュー困難、循環依存が一斉噴出、他開発ブロック | 200+ 変更には不向き |
| Incremental + require(esm) | ファイル単位で段階移行、CJS は `require(esm)` で ESM を参照 | 小さい PR、個別検証可能 | 長いハイブリッド期間、tsconfig フリップは結局必要、TLA 制限 | 選択可能だが遅い |
| **Phased Migration** | レイヤ単位 (5 フェーズ) で段階適用 | 各フェーズ独立にデプロイ可能、Phase 1-2 は低リスク先行、Phase 3 は codemod + 手動レビュー | PR 数が増える、Phase 3 は依然大規模 | **推奨** |

---

## 4. Design Decisions (tentative)

### Decision: Phased Migration Strategy

- **Context**: 200+ ファイルの変換。big-bang はリスク大、純粋 incremental は遅い。
- **Alternatives Considered**:
  1. Big-bang — codemod で一括
  2. File-by-file incremental + require(esm) bridge
  3. レイヤ単位の phased
- **Selected Approach**: 5 フェーズ構成 (packages → type 宣言 → サーバコード → transpilePackages → overrides/docs)
- **Rationale**: 各フェーズ独立に検証・デプロイ可能。Phase 1-2 は瑣末でも早期にマージ可能。Phase 3 (サーバコード) は jscodeshift + レビューで 1 PR、もしくはディレクトリ単位に分割可能。
- **Trade-offs**: PR 数は増えるが、各 PR が検証可能で可逆。

### Decision: jscodeshift + カスタム transform

- **Context**: 複数の CJS パターンを自動変換したい。
- **Alternatives Considered**:
  1. cjstoesm — require+invoke パターン非対応
  2. jscodeshift + custom transform — 全パターン対応
  3. 手動変換 — 200+ ファイルではエラー多発
- **Selected Approach**: jscodeshift + ~50-100 行のカスタム transform (GROWI の 4 パターン対応)
- **Rationale**: 単一ツール。サンプルファイルでテスト可能。
- **Follow-up**: 本番コードに適用する前にサンプルで transform をテストする。

### Decision: サーバビルドに NodeNext モジュール解決を採用

- **Context**: サーバコードは Node.js で直接実行 (バンドルなし)。
- **Alternatives Considered**:
  1. `module: "ESNext"` + `moduleResolution: "Bundler"` — 拡張子 enforce なし
  2. `module: "NodeNext"` + `moduleResolution: "NodeNext"` — ESM 正当性を enforce
- **Selected Approach**: `NodeNext` / `NodeNext` を `tsconfig.build.server.json` に適用。
- **Rationale**: 直接実行コードで `.js` 拡張子強制 + ESM 意味論を compile 時にチェック。ランタイムエラーの前倒し検出。

### Decision: 開発サーバに tsx を採用

- **Context**: ESM 対応 TS ランナーで path alias もサポートしたい。
- **Alternatives Considered**:
  1. ts-node/esm — loader API が deprecated
  2. tsx — モダン・高速・ESM + paths ネイティブ対応
  3. Node.js `--experimental-strip-types` — path alias 未対応
- **Selected Approach**: `ts-node` + `tsconfig-paths` を **tsx** に置換。
- **Rationale**: 単一ツールで 2 つを置換。ESM ネイティブ。tsconfig の `paths` を追加設定なしで解決。アクティブメンテナンス。

### Decision: CJS のまま残す設定は .cjs リネーム

- **Context**: CLI (migrate-mongo, nodemon, i18next) が消費する設定は `require()` 構文。
- **Alternatives Considered**:
  1. ESM 変換 — CLI ツール互換が壊れるリスク
  2. `.cjs` リネーム — 安全、CJS 意味論を明示
  3. ディレクトリ単位の `package.json` で `"type": "commonjs"` — 複雑
- **Selected Approach**: `.cjs` リネーム。ただし `src/migrations/` は本数が多いためディレクトリ単位 `"type": "commonjs"`。
- **Rationale**: Node.js が推奨する明示的手段。振る舞い変化なし、CJS 意図が自己文書化される。

---

## 5. Risks & Mitigations

- **ESM strict loading による循環依存デッドロック** — `models/user/*` がトップレベルで service singleton を import する経路を lazy 化する refactor を Phase 3 に組み込む。
- **migrate-mongo が ESM を将来もサポートしない** — `src/migrations/` を CJS で隔離し続ける前提で設計する (Req 5 AC5)。
- **transpilePackages 削減時の SSR リグレッション** — 1 エントリずつ削除 + ビルド + ランタイム検証を繰り返す。失敗時はエントリを戻す。
- **本番アセンブリの破綻** — 各フェーズ完了時に `assemble-prod.sh` のエンドツーエンド実行を入れる。
- **サードパーティ CJS パッケージの破綻** — Node.js 24 の `require(esm)` が大半のケースを救う前提。救えない場合は override を fallback として維持。
- **Turbopack の外部化挙動の未知部分** — `transpilePackages` 削減は 1 エントリ単位の段階的適用 + `.next/node_modules/` 確認 + `check-next-symlinks.sh` 実行で押さえる。

---

## 6. Research Items Carried to Design Phase

1. jscodeshift カスタム transform の具体設計 (入力パターン → 出力コードのマッピング、エッジケース)。
2. `routes/index.js` / `routes/apiv3/index.js` を factory DI から静的 import + 明示呼び出しへ変換した際の、初期化順序・循環依存の検証手段。
3. `models/user/index.js` の lazy-load 戦略 (setter 注入 / factory 関数 / getter プロパティ等)。
4. `transpilePackages` の削除順序と検証プロトコル (プレフィックスグループ一括削除 vs 1 件ずつ)。
5. Node.js 24 環境で `@lykmapipo/common` → `flat`/`mime`/`parse-json` が `require(esm)` 経由で解決されることの実測。
6. `assemble-prod.sh` が ESM モジュールをフラット `node_modules` 構造で正しく解決することの確認 (Phase 3 完了時点で本番相当ビルドを試す)。
7. `.next/node_modules/` の symlink チェーンが ESM 前提で維持されるか (`check-next-symlinks.sh` の更新の要否)。

---

## References

- [TypeScript: Choosing Compiler Options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)
- [tsx - TypeScript Execute](https://tsx.is/)
- [wessberg/cjstoesm](https://github.com/wessberg/cjstoesm)
- [azu/commonjs-to-es-module-codemod](https://github.com/azu/commonjs-to-es-module-codemod)
- [bennycode/ts2esm](https://github.com/bennycode/ts2esm)
- [Node.js: require(esm)](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require)
- [dotenv-flow ESM support](https://github.com/kerimdzhanov/dotenv-flow)
