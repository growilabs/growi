# Research Log — esm-import-convention

## Discovery scope

Extension（既存ビルドパイプラインの改修）。integration-focused discovery。外部新規依存はほぼ無し（emit 時 `.js` 付与のための小ツール 1 点のみ検討）。

## 現状パイプラインの実測（grounding）

| 観点 | 実測事実 | ソース |
|---|---|---|
| server build | `build:server = tspc -p tsconfig.build.server.json` (`module/moduleResolution: NodeNext`)。相対 import に `.js` 必須 (TS2835) | tsconfig.build.server.json |
| emit 変換 | `typescript-transform-paths` v3.5.6 が `~/`→相対へ変換し、`.js` は**ソースの値をそのまま保持**（付けも消しもしない） | dist/server/models/revision.js で実測（`~/server/util/mongoose-utils.js`→`../util/mongoose-utils.js`） |
| postbuild | `bin/postbuild-server.ts` が `transpiled/src`→`dist` へ rename し config をコピー。**emit 後処理の差し込み口が既に存在** | postbuild-server.ts |
| NodeNext プログラム | `tspc --listFiles` で apps/app/src **1142** ファイルが所属。`exclude` は root から外すだけで import 到達ファイルは所属・emit される（client `.tsx`→dead `.jsx`） | 実測 (clean source, exit 0) |
| alias 化の実態 | `~/...js` alias を持つ **740** ファイルは**全て**プログラム所属（stale 0）。所属=alias / 非所属=相対 の振り分けは正しい | クロスチェック実測 |
| client build | Turbopack。拡張子なし相対をネイティブ解決。相対 `.js`→`.ts/.tsx` の読替えのみ不可 | esm-migration codemod ヘッダ + 実機 |
| dev runner | `bin/dev-esm-resolver.mjs` が `~/`・`^/`・相対を候補拡張子 `.ts/.tsx/.js/.jsx`/`index.*` で解決。**拡張子なし・`.js` 両対応** | dev-esm-resolver.mjs L34-70 |
| lint typecheck | `tsgo --noEmit`（tsconfig.json = `moduleResolution: Bundler`）。拡張子なしを許容 | tsconfig.base.json L23 |
| Biome | v2.4.12。`noRestrictedImports` を config `.cjs` 用に使用中。「拡張子禁止」の組込ルールは無い（`useImportExtensions` は逆方向） | biome.json L154-182 |

## PoC 実証（`/tmp/esm-poc`）

拡張子なし TS ソース → `tsc`（Bundler）コンパイル成功・emit 拡張子なし → 素の `node` 起動 = `ERR_MODULE_NOT_FOUND`（問題再現）→ emit 後 `.js` 付与（`./feature`→`./feature/index.js` のディレクトリ解決含む）→ `node` 起動成功（`hello world from-barrel` / exit 0）。

**結論**: 唯一の未検証要素だった「emit 時 `.js` 付与で valid Node ESM になる」が、難所のバレル `/index.js` 解決も含め成立。

## 技術選定

### emit 時 `.js` 付与の実装方式
- **採用: postbuild の post-emit スクリプト**（`bin/postbuild-server.ts` 内、または専用 `bin/add-js-extensions.mjs`）。dist 実ファイル照合で `.js`/`/index.js`/`.jsx` を決定的に解決。PoC で実証済み。新規依存ゼロ。
- 却下: ts-patch transformer（in-process）。`typescript-transform-paths` と plugin 配列で合成できるが、ソース基準解決のため `/index`・dead `.jsx` の扱いが post-emit より複雑。決定論性で post-emit が優位。
- 却下: `ts-add-js-extension`（npm）。同等機能だが新規依存を増やすだけで、自前 ~40 行スクリプトで足りる。

### 規約強制の lint
- **採用: 自前 lint スクリプト**（`tools/lint/import-extension-guard.cjs`、`lint:*` script + CI）。repo 既存の `tools/lint/route-top-level-guard.cjs` と同方式。相対/`~/` specifier の `.js`/`.jsx` 終端を検出。AST または行ベース。
- 補完: Biome `noRestrictedImports` は path-list ベースで `.*\.js$` の一般パターンには不向き。組込 `useImportExtensions` は逆方向のため不採用。

### 一括移行 codemod
- **採用: jscodeshift ベース**（repo の `ssr-relative-to-alias.cjs` と同じ AST/helper を再利用）。value specifier の `.js`/`.jsx` 除去 + 所属ファイルの local `~/...` alias を相対へ collapse。type-only も拡張子除去（dev/Bundler で解決可）。解決先不変（振る舞い保存）。

## トレードオフの核

- 失う: NodeNext の「全 import が Node 解決可能」というコンパイル時保証（esm-migration が `tech.md` 整合で意図的に採用）。
- 回収: (a) post-emit スクリプトの決定論性、(b) **emit 後 dist に対する NodeNext `--noEmit` チェックを CI 追加**（保証をコンパイル時→成果物検証へ移送）、(c) 既存 `server:ci` 起動 smoke。
- 残リスク: dead `.tsx`→`.jsx` 内部 import が拡張子なしのままでも runtime 非到達だが、(b) のチェックが厳格だと dead emit で誤検出しうる → チェック対象を runtime 到達グラフ（`server:ci` ロード）に絞るか、`.jsx` 解決も付与スクリプトに含める。

## Revalidation Triggers（esm-migration への影響）

- 本 spec は esm-migration が確立した dual-pipeline・起動・CI 基盤に依拠。ビルド設定（`tsconfig.build.server.json` の moduleResolution、postbuild）を変更するため、esm-migration の Phase 6 ゲート（機能/認可/perf baseline）を再実行して無回帰を確認する。
