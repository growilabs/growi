# Research: ai-agentic-search

本ファイルは design フェーズ着手前に行った既存コードベースとの gap 分析のうち、design.md に折り込まれていない補足事項を残す。具体的な設計判断・却下案・非自明な事実は design.md の「検討したが採らなかった案」および各コンポーネントの「設計上の決定と根拠」を参照。

## 実装アプローチの比較（Option A / B / C）

新設する 2 tool（`fullTextSearchTool` / `getPageContentTool`）をどう実装するか、3 案を比較した。

| 案 | 内容 | 採否 |
|---|---|---|
| **A. 既存 `file-search-tool.ts` のパターンを踏襲** | `tools/*.ts` に 1 ファイル 1 export、`createTool` + zod、既存 tool と同じ書式で新規作成 | **採用** |
| B. tool 共通基盤を先に抽出 | `requestContext` からの `userId` アクセスを共通ユーティリティ化、`createPageContentTool` のようなファクトリ関数を切り出す | 不採用 |
| C. ハイブリッド（A で実装 → 後で B を検討） | まず A で実装し、動作確認後に共通化を別タスクで検討 | A と実質同一のため不採用 |

**B を不採用とした根拠**: 本 spec で新設する tool は 2 個（本文取得 + 全文検索）のみであり、ファクトリ関数や共通基盤を抽出する費用対効果は薄い。抽象化のための設計コストが「agentic ループの確立」という本 spec の本筋から外れて design / tasks のスコープを膨らませるリスクの方が大きいと判断した。tool 数が増えた時点で再検討する余地は残す。

## 既知の落とし穴（design 時点で確認済み、design.md に反映済み）

以下は gap 分析時点で発見し、design.md の該当セクションに反映済みの事項。詳細はそちらを参照。

- `Page.findByIdAndViewer` / `findByPathAndViewer` は「権限なし」と「存在しない」を `null` 一本で表現する → design.md「GetPageContentTool」の `not_found_or_forbidden` 統合方針
- `findByIdAndViewer` は `includeAnyoneWithTheLink: true` を内部固定 → design.md「Security Considerations」の GRANT_RESTRICTED 受容方針
- `@mastra/core` の `RequestContext` は自動隔離機構を持たない単純な `Map` ラッパー → design.md「Post-Message Handler」のリクエストスコープ化の根拠
