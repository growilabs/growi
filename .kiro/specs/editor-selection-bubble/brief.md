# Brief: editor-selection-bubble

> アンブレラ `editor-commands` の子スペック。**基盤 `editor-slash-command` に依存しない**（独立実装可。基底 `toggleMarkdownSymbol` + 既存 toolbar i18n/アイコン + 閲覧ページの「Comment」バブルの見た目・位置合わせを再利用して成立）。umbrella 所属は維持。

## Story
[editor-bubble] エディタでテキストを選択すると、バブルメニューが出て、太字・斜体・取り消し線・インラインコードを適用できる

## Problem
テキストに書式（太字・斜体等）を適用するには、ツールバーのボタンを探してクリックするか、ショートカットを覚える必要がある。選択した文字列に対してその場で素早く操作する導線がなく、執筆フローが途切れる。一方、閲覧ページでは本文を選択すると「Comment」バブルが出る体験が既にあり、編集画面だけ「選択してもその場に何も出ない」状態になっている。

## Current State
- 既存の純粋関数 `toggleMarkdownSymbol`（太字/斜体/インラインコード等のトグル）が**選択範囲に対する操作**として既に存在し、ツールバーから使われている。
- 編集画面下部ツールバー（`packages/editor` の `TextFormatTools`）が、各書式に material-symbols のアイコン（`format_bold` / `format_italic` / `format_strikethrough` / `code`）と i18n キー（`toolbar.*`）を使っている。新規 locale キーは不要。
- 閲覧ページの「Comment」バブル（`inline-comment` の `SelectionActionButton` + `SelectionPopover`）が、選択に追従する浮動 UI の見た目と位置合わせを既に確立している:
  - 見た目: Bootstrap `btn btn-sm shadow-sm` + 全テーマ共通の `--bs-*` 変数による配色上書き（`SelectionActionButton.module.scss`）。
  - 位置: 選択範囲のカーソル側の端の上・その端を中心（後方向選択なら先頭側の端）、上に余白がなければ下へ反転、表示領域からはみ出さないようずらす、選択範囲から 8px 離す。
- ただし「Comment」バブルは `apps/app` 側の React コンポーネントで、`packages/editor` からは直接参照できない。エディタ内（CodeMirror）で選択に追従する浮動 UI は未実装。

## Desired Outcome
- エディタで**テキストを選択する**と、「Comment」バブルと同じ見た目・同じ位置合わせでバブルメニューが表示される。
- バブルメニューの各ボタンは、編集画面下部ツールバーと同じアイコンで太字・斜体・取り消し線・インラインコードを表し、選ぶと選択範囲に適用/解除される。
- 選択解除 / Escape / フォーカス喪失でバブルメニューが閉じる。誤表示でフローを妨げない。

## Approach
選択範囲（非空）の発生を検知してバブルメニューを選択位置に表示する CodeMirror 拡張を新設する。各操作は**既存の選択トグル純粋関数（`toggleMarkdownSymbol`）を再利用**し、アイコン・操作名はツールバーと同じものを用いる。見た目と位置合わせは「Comment」バブルを基準とし、二重管理で見た目がずれないよう、共有の仕方（スタイルの共通化か複製か、位置計算の方式）は設計フェーズで決める。コマンド集合は本スペック独自に小さく宣言する（基盤 slash のレジストリには依存しない）。

## Scope
- **In**:
  - 非空選択時のバブルメニュー表示（選択位置に追従）
  - 「Comment」バブルと同じ見た目・同じ位置合わせ
  - ツールバーと同じアイコン
  - 選択範囲への操作: 太字 / 斜体 / 取り消し線 / インラインコード
  - 選択解除 / Escape / フォーカス喪失での非表示ライフサイクル
  - 操作名（ツールチップ・読み上げ名）の多言語表示
- **Out**:
  - `/` トリガーのスラッシュコマンド（基盤の領域）
  - リンク化 / 見出し化 / 引用化（将来拡張）
  - 選択範囲への AI 操作（要約・書き換え等）（将来拡張）
  - ブロックレベル変換（段落→見出し等の大規模変換）（将来拡張）
  - 編集画面からのインラインコメント投稿
  - 「Comment」バブル・ツールバー自体の見た目/挙動の変更

## Boundary Candidates
- **選択検知 + 浮動 UI**: 非空選択の検知、バブルメニューの表示位置（カーソル側の端・反転・はみ出し回避）・表示/非表示ライフサイクル。
- **見た目**: 「Comment」バブルと共有する配色・枠・影・ホバー/押下表現。
- **選択向けコマンド集合**: 書式トグル操作の定義（本スペック独自・小さなデータ宣言。アイコン・操作名はツールバーと同一）。
- **操作アダプタ**: 既存トグル純粋関数への薄い呼び出し。

## Out of Boundary
- 基盤のスラッシュトリガー/補完ソース/レジストリ所有権（`editor-slash-command`）。
- 既存トグル関数自体の仕様変更（`markdown-utils` の領域）。
- 「Comment」バブルの機能（コメント作成フロー）。
- 絵文字補完・キーバインド・グローバルホットキー。

## Upstream / Downstream
- **Upstream**: 既存の選択トグル純粋関数（`toggleMarkdownSymbol`）、`@codemirror/view`、`react-i18next` と既存 toolbar i18n キー、ツールバーのアイコン、「Comment」バブルの見た目・位置合わせ。
- **Downstream**: 選択範囲への AI 操作、追加の選択操作（定義追加で拡張）。将来 slash と操作定義を共有する場合は共通コマンド抽象への昇格を検討（roadmap の長期 seam）。

## Existing Spec Touchpoints
- **Extends/Depends**: なし（基盤 slash のレジストリには依存しない）。
- **Adjacent**:
  - `inline-comment`（「Comment」バブルが見た目・位置合わせの基準。見た目の共通化を選ぶ場合はスタイルの置き場所が変わるが、コメント機能の契約は変えない）。
  - `editor-slash-command`（同一アンブレラの兄弟。将来コマンド定義を共有する可能性は roadmap の "Shared seams to watch" 参照）。
  - `editor-keymaps`（キーバインドと競合しない）、`collaborative-editor`（操作は通常トランザクションで同期）、絵文字補完（別 UI、干渉しない）。

## Constraints
- TypeScript strict、Biome、Vitest（co-located）。
- `packages/editor` は `apps/app` を参照できない（依存方向）。
- 操作は通常の `view.dispatch` トランザクション（undo 粒度・協調編集整合を維持）。
- バブルメニューは選択位置に正しく追従し、スクロール・折り返しでも破綻しないこと。
- 全 16 テーマ × ライト/ダークで「Comment」バブルと同じ配色になること。
- ラベルは既存 i18n（react-i18next + locale JSON）に乗せ、未対応言語は既定言語へフォールバック。
