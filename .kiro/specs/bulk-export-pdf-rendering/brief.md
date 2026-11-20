# Brief: bulk-export-pdf-rendering

> スコープ注記: 本 spec は **bulk-export（PDF/HTML）のサーバ側 markdown レンダリング**を対象とする。
> Web/クライアント側レンダラ（`services/renderer`）の改修ではない。発端は PR #11288。

## Problem

一括エクスポート（bulk export）の PDF/HTML 出力が、ブラウザ印刷版（事実上の「理想」）に比べて著しく貧弱。
GFM テーブルが生 Markdown のまま／GitHub アラート・ディレクティブ未対応／本文が等幅フォール
バック等。原因は、bulk-export が GROWI 実レンダラとは**別系統の最小パイプライン**を持ち、
機能ごとに永久に追従が必要な構造であること。監査・コンプライアンス用途の bulk export は
プロダクトの正式機能（product.md）であり、低忠実度な出力はその価値を損なう。

## Current State

- サーバ側変換 [export-pages-to-fs-async.ts](apps/app/src/features/page-bulk-export/server/service/page-bulk-export-job-cron/steps/export-pages-to-fs-async.ts) は
  `remark-parse → remark-gfm → remark-html` のアドホックなパイプライン。Express サーバが
  CJS（ts-node）のため、ESM の remark 系は `dynamicImport()` 経由で読み込んでいる。
- PR #11288 はテーブル（remark-gfm）を塞ぎ、Bootstrap CSS 全量＋手書き表 CSS を `<style>` 注入。
  依然として未対応: アラート / ディレクティブ / 数式 / 絵文字 / CSV・TSV→表 / コード装飾 / フォント。
- GROWI 実レンダラ [renderer.tsx](apps/app/src/services/renderer/renderer.tsx)（`generateCommonOptions`）は
  リッチなプラグイン集合を構築するが、出力は React 要素であり、pure-ESM パッケージ＋
  `.module.scss`＋React コンポーネントを静的 import している。**実測で確認済み**: CJS の
  ts-node サーバからは `require()` できず `ERR_REQUIRE_ESM` で即死する（React/SCSS を除いた
  プラグインのみのモジュールでも同様）。ローカル .ts プラグイン（emoji / xsv-to-table /
  echo-directive 等）も ESM を静的 import しており CJS から読めない。
- bulk-export には再生成 dedup（[reuseDuplicateExportIfExists](apps/app/src/features/page-bulk-export/server/service/page-bulk-export-job-cron/steps/create-page-snapshots-async.ts#L17-L39)、
  `revisionListHash` キー）があり、レンダラのバージョンを考慮しない（今回「効かない」と
  見えた直接原因。※本 spec では対象外）。

## Desired Outcome

- bulk-export の PDF/HTML 出力が明確にリッチになり Web 表示に近づく: GFM テーブル（装飾付き）/
  GitHub アラート・ディレクティブ / 数式 / sanitize 済み HTML / 見出し ID ——ただし GROWI
  テーマの完全再現はしない。
- GROWI の実プラグイン**パッケージを再利用**し、並行再実装を持たない。将来の Markdown 機能が
  少ない追従コストで波及する。
- CSS はレンダラが実際に吐くクラスに対し `@growi/core-styles` で当てる（PR #11288 の
  「Bootstrap 全量＋手書き表 CSS」の冗長性を解消）。

## Approach

サーバ側で、bulk-export 変換の既存 `dynamicImport` パイプラインを拡張し、GROWI 実レンダラが
使う **npm ESM プラグイン一式**を組み立て、`rehype-stringify` で HTML 文字列化する:
`remark-gfm` / `remark-directive` ＋ `@growi/remark-growi-directive` ＋
`remark-github-admonitions-to-directives` / `remark-math` ＋ `rehype-katex` /
`remark-frontmatter` / `remark-rehype` / `rehype-raw` / `rehype-sanitize` / `rehype-slug`。
CSS はコンテンツにスコープした `@growi/core-styles` 由来のスタイルを当てる（手書き Bootstrap
サブセットではなく）。GROWI ローカルの .ts プラグインは**先送り**——現 CJS サーバでは読めず、
リポジトリ全体の ESM 化（`support/esm`）完了後に再利用可能になる。

**なぜこの案か**（3 条件への適合）:
- より**リッチ**: 一貫したプラグイン集合を一度に取り込む（依存は概ね導入済み）。
- より**少ない改修**（長期）: 単一パイプライン化で機能ごとの追従が不要、実パッケージを再利用。
- より**スマート**: CSS をデザインシステムから供給。実証済みの CJS/ESM 境界と戦わず尊重する。

## Scope

- **In**:
  - サーバ側 bulk-export の markdown→HTML レンダリング（`convertMdToHtml` 経路）。
  - 上記 npm ESM プラグイン一式の `dynamicImport` 組み立て、独自 `remark-html` ステップの置換。
  - `@growi/core-styles` 由来 CSS の注入（PR #11288 の全量 Bootstrap＋手書き表 CSS を置換）。
  - Web レンダラ（`generateCommonOptions`）と bulk-export のプラグイン選定・順序の**整合を
    検査する小さなテスト**（ドリフト防止）。
- **Out**:
  - リポジトリ全体の ESM 化（`support/esm`）——停止中の別施策。本 spec は現 CJS サーバ前提で動く。
  - GROWI ローカル .ts プラグイン（emoji ショートコード / CSV・TSV→表 / echo-directive 固有 /
    コード class 微調整）——ESM 化後の将来フェーズへ先送り。
  - React コンポーネント依存機能: シンタックスハイライトの色（CodeBlock）/ drawio・plantuml・
    lsx・attachment-refs のライブ描画 / NextLink 挙動。
  - GROWI テーマ・レイアウト・chrome（パンくず/サイドバー等）の完全パリティ。
  - dedup キャッシュ無効化 / `revisionListHash` のレンダラ版反映（ユーザー判断: 対象外、運用対応）。
  - pdf-converter 側レンダリング（HTML ではなく Markdown を渡す契約）——将来の方向、今回はしない。

## Boundary Candidates

- プラグインパイプライン組み立て（どのプラグインを・どの順で・どのオプションで）= レンダリングの「何を」。
- ESM-in-CJS のモジュール読み込み機構（`dynamicImport` のオーケストレーション）= 「どう読むか」。
- CSS の供給と注入（`@growi/core-styles` → コンテンツスコープの stylesheet）。
- Web レンダラと bulk-export レンダラ間のドリフトガード。

## Out of Boundary

- Web/クライアントレンダラ（`services/renderer`, `client/services/renderer`）——ドリフトテスト用に
  プラグイン選定を共有参照する以外は改修しない。
- pdf-converter マイクロサービス内部（Puppeteer / フォント）——CSS・HTML 契約に関わる範囲を除く。
- ESM 化作業そのもの。

## Upstream / Downstream

- **Upstream**: 現 CJS ts-node Express ランタイム（`dynamicImport` への制約）／既存 bulk-export
  cron パイプライン（create-snapshots → export-to-fs → request-pdf-converter → compress-upload）／
  `@growi/core-styles`／依存に導入済みの remark/rehype プラグイン群。
- **Downstream / 将来**: リポジトリ全体の ESM 化（`support/esm`、最終 commit `dae88568`）。完了後は
  GROWI ローカル .ts プラグインが読めるようになり、より完全なパリティや、レンダリングの
  pdf-converter 側への移設（Markdown 入力化）が可能になる。**本 spec はその布石**であり、設計は
  この進化を塞がない選択をすること。

## Existing Spec Touchpoints

- **Extends**: なし（bulk-export / レンダリングを扱う既存 spec は存在しない）。
- **Adjacent**: 直接の隣接なし。Web レンダラ（`services/renderer`）は参照であり spec ではない。
  `presentation` spec（スライド）は無関係。

## Constraints

- **CJS サーバランタイム**: ESM（remark/rehype/`@growi/remark-*`）や `.module.scss`／React を静的
  import するモジュールは読めない。`dynamicImport` かビルド時バンドルが必須。（実測: `ERR_REQUIRE_ESM`）
- **Turbopack 外部化 / dependencies-vs-devDependencies ルール**（tech.md）: 新たに静的 import する
  ランタイムパッケージは `dependencies` へ。`dynamicImport` するパッケージも `.next/node_modules` と
  本番 deploy で検証すること。
- **`!!! pdf-converter で Puppeteer に --no-sandbox を渡す間は HTML エスケープを無効化しないこと !!!`**
  （変換側の既存セキュリティ注記）——`rehype-sanitize`／安全な stringify を維持。
- 出力は静的 HTML ファイルのまま（pdf-converter は HTML ファイルを読み Puppeteer で描画する契約）。
- クロスプラットフォーム、コードコメントは英語、Biome、テスト co-location（リポジトリ規約）。
