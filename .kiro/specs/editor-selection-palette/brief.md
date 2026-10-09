# Brief: editor-selection-palette

> アンブレラ `editor-commands` の子スペック。**MVP は基盤 `editor-slash-command` に依存しない**（独立実装可。基底 `toggleMarkdownSymbol` + CM `showTooltip` + 既存 toolbar i18n のみで成立）。umbrella 所属は維持。

## Problem
テキストに書式（太字・斜体等）を適用するには、ツールバーのボタンを探してクリックするか、ショートカットを覚える必要がある。選択した文字列に対してその場で素早く操作する導線がなく、執筆フローが途切れる。Notion / Medium のような「選択するとその場に操作メニューが出る」体験が求められている。

## Current State
- 既存の純粋関数 `toggleMarkdownSymbol`（太字/斜体/インラインコード等のトグル）、`insertLinePrefix`（見出し/引用等）が**選択範囲に対する操作**として既に存在し、ツールバーから使われている。選択操作にはこれらがそのまま適合する（基盤 slash のレジストリには依存しない）。
- ラベル/アイコンは既存ツールバーの i18n キー（`toolbar.*`）と material-symbols がそのまま使える（新規 locale キー不要）。
- 選択範囲に追従して表示する浮動 UI は未実装。CodeMirror には選択位置にツールチップを出す仕組み（`@codemirror/view` の `showTooltip` 等）がある。

## Desired Outcome
- エディタで**テキストを選択する**と、選択範囲の近傍に浮動コマンドパレット（バブルメニュー）が表示される。
- パレットから操作（太字・斜体・取り消し線・インラインコード）を選ぶと、選択範囲に適用される。
- 選択解除 / Escape / フォーカス喪失でパレットが閉じる。誤表示でフローを妨げない。

## Approach
選択範囲（非空）の発生を検知して**浮動ツールバー**を選択位置に表示する CodeMirror 拡張を新設する。各操作は**既存の選択トグル純粋関数（`toggleMarkdownSymbol` / `insertLinePrefix`）を再利用**する。コマンド集合は本スペック独自に小さく宣言する（基盤 slash のレジストリには依存しない）。本スペックは「選択トリガー + 浮動 UI + 選択向けコマンド集合」を担う。autocomplete とは別系統の UI のため、基盤の補完登録点とは独立した登録機構を用いる。

## Scope
- **In**:
  - 非空選択時の浮動コマンドパレット表示（選択位置に追従）
  - 選択範囲への操作: 太字 / 斜体 / 取り消し線 / インラインコード
  - 選択解除 / Escape / フォーカス喪失での非表示ライフサイクル
  - 操作ラベルの多言語表示
- **Out**:
  - `/` トリガーのスラッシュコマンド（基盤の領域）
  - リンク化 / 見出し化 / 引用化（将来拡張）
  - 選択範囲への AI 操作（要約・書き換え等）（将来拡張）
  - ブロックレベル変換（段落→見出し等の大規模変換）（将来拡張）

## Boundary Candidates
- **選択検知 + 浮動 UI**: 非空選択の検知、ツールチップ/ウィジェットの表示位置・表示/非表示ライフサイクル。
- **選択向けコマンド集合**: 書式トグル操作の定義（本スペック独自・小さなデータ宣言。基盤 slash のレジストリには依存しない）。
- **操作アダプタ**: 既存トグル純粋関数への薄い呼び出し。

## Out of Boundary
- 基盤のスラッシュトリガー/補完ソース/レジストリ所有権（`editor-slash-command`）。
- 既存トグル関数自体の仕様変更（`markdown-utils` の領域）。
- 絵文字補完・キーバインド・グローバルホットキー。

## Upstream / Downstream
- **Upstream**: 既存の選択トグル純粋関数（`toggleMarkdownSymbol` / `insertLinePrefix`）、`@codemirror/view`（`showTooltip` / ビュー API）、`react-i18next` と既存 toolbar i18n キー。※基盤 `editor-slash-command` のレジストリには依存しない（MVP 独立）。
- **Downstream**: 選択範囲への AI 操作、追加の選択操作（定義追加で拡張）。将来 slash と操作定義を共有する場合は共通コマンド抽象への昇格を検討（roadmap の長期 seam）。

## Existing Spec Touchpoints
- **Extends/Depends**: なし（MVP は独立。基底 `toggleMarkdownSymbol` と既存 toolbar i18n を再利用するのみで、基盤 slash のレジストリには依存しない）。
- **Adjacent**: `editor-slash-command`（同一アンブレラの兄弟。将来コマンド定義を共有する可能性は roadmap の "Shared seams to watch" 参照）、`editor-keymaps`（キーバインドと競合しない）、`collaborative-editor`（操作は通常トランザクションで同期）、絵文字補完（別 UI、干渉しない）。

## Constraints
- TypeScript strict、Biome、Vitest（co-located）。
- 操作は通常の `view.dispatch` トランザクション（undo 粒度・協調編集整合を維持）。
- 浮動 UI は選択位置に正しく追従し、スクロール・折り返しでも破綻しないこと。
- ラベルは既存 i18n（react-i18next + locale JSON）に乗せ、未対応言語は既定言語へフォールバック。
