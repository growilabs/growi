# Brief: editor-slash-command

## Problem
GROWI の Markdown エディタで、テーブル・コードブロック・リストなどの要素を挿入するには、現状ツールバーのボタンを探してクリックする必要がある。キーボードから手を離す操作が挿入のたびに発生し、執筆フローが途切れる。マウス操作に不慣れなユーザーや、Notion / Slack 風のスラッシュコマンドに慣れたユーザーにとって、要素挿入の体験が遅い。

## Current State
- エディタは CodeMirror 6 ベース（`packages/editor/`）。
- 要素挿入はツールバーのボタン経由で、内部的には再利用可能な pure 関数を呼んでいる:
  - 太字/斜体/インラインコード等: `toggleMarkdownSymbol`（`services-internal/markdown-utils/toggle-markdown-symbol.ts`）
  - 見出し/リスト/引用: `insertLinePrefix`（`services-internal/markdown-utils/insert-line-prefix.ts`）
  - コードブロック: `makeTextCodeBlock`（`services-internal/editor-shortcuts/make-text-code-block.ts`）
  - テーブル行: `insert-new-row-to-table-markdown.ts`
- 絵文字オートコンプリートが `@codemirror/autocomplete` を使って実装済み（`services-internal/extensions/emojiAutocompletionSettings.ts`、`:` トリガー）。スラッシュコマンドはこれとほぼ同型のパターンで実現できる。
- スラッシュコマンド / メンション系の機能はエディタ内に存在しない（グリーンフィールド）。

## Desired Outcome
- エディタのテキスト入力中に `/` を入力するとコマンドメニュー（ポップアップ）が表示される。
- 続けて文字を入力（例: `/table`、`/tab`）すると候補が絞り込まれ、キーボード（矢印 + Enter）またはクリックで選択できる。
- 選択すると対応する Markdown 要素が即座に挿入され、`/` と入力したクエリ文字列は消える。
- 候補が無い・Escape・選択せずに離れた場合はメニューが閉じ、入力した `/` テキストはそのまま残る（誤爆しない）。

## Approach
`@codemirror/autocomplete` をベースに、既存の `emojiAutocompletionSettings.ts` と同型の補完拡張（例: `slashCommandCompletionSettings`）を新設する。`/` を行頭または空白直後で入力したときにのみ発火するトリガー条件を定義し、各コマンドの `apply` で既存の pure 挿入関数（`toggleMarkdownSymbol` / `insertLinePrefix` / `makeTextCodeBlock` / テーブル挿入）を呼び出す。挿入時に `/query` テキストを置換して消す。拡張は `use-default-extensions.ts` の `appendExtensions()` 経由で登録する。

選定理由: 同じライブラリが同コードベースで稼働実績があり、フィルタリング・キーボード操作・ポップアップ表示・閉じる挙動が標準で得られるため、カスタムウィジェットより実装量・保守コストが小さい。

## Scope
- **In**:
  - `/` 入力でのコマンドメニュー表示（エディタテキスト内のみ）
  - 基本 Markdown 要素の挿入コマンド: 見出し（H1–H3）、箇条書きリスト、番号付きリスト、チェックボックス（タスクリスト）、引用、コードブロック、テーブル
  - 入力文字によるコマンド絞り込み（フィルタリング）
  - キーボード操作（矢印 / Enter / Escape）とクリック選択
  - テーブルは **プレーンな Markdown テーブル（ヘッダ + 区切り行）を即挿入**
  - 既存 pure 挿入関数の再利用
- **Out**:
  - GROWI 固有の拡張要素（drawio、math、lsx、テンプレート等）の挿入コマンド ※将来拡張
  - テーブル挿入時の Handsontable モーダル起動 ※将来拡張
  - スラッシュコマンドのユーザーカスタマイズ / 並び順設定
  - エディタ外（ビューモード等）での発火

## Boundary Candidates
- **トリガー判定**: どの入力位置で `/` をコマンド開始とみなすか（行頭・空白直後のみ等）の純粋な判定ロジック。
- **コマンド定義（レジストリ）**: 各コマンドの「ラベル / 説明 / アイコン / 絞り込みキーワード / 挿入アクション」を宣言したデータ。executor（補完拡張）はこの集合を入力として受け取る（coding-style の "Executors take their work-set as input" に準拠）。
- **挿入アクション**: 既存 pure 関数への薄いアダプタ（`/query` 置換 + 挿入）。
- **CodeMirror 拡張の組み立て**: `@codemirror/autocomplete` への登録・トリガー条件・レンダリング。

## Out of Boundary
- グローバルホットキーの挙動（`/` = 検索）— `hotkeys` スペックの領域。スラッシュコマンドはエディタテキスト内に閉じ、グローバル `/` を奪わない。
- キーバインド体系（Ctrl+B 等）— `editor-keymaps` スペックの領域。`/` をキーマップにはバインドせず、入力ベースで発火させる。
- AI によるパス/内容提案 — `suggest-path` スペックの領域（直交）。

## Upstream / Downstream
- **Upstream**: 既存の pure 挿入関数群（markdown-utils / editor-shortcuts / table）、`@codemirror/autocomplete`、`emojiAutocompletionSettings.ts`（パターンの参照元）、`appendExtensions()` / `use-default-extensions.ts`。
- **Downstream**: GROWI 拡張要素（drawio/math/template）のコマンド追加、テーブルの Handsontable モーダル連携、コマンドのユーザーカスタマイズ。いずれも本スペックのコマンドレジストリにデータを足す形で拡張できる。

## Existing Spec Touchpoints
- **Extends**: なし（新規スペック）
- **Adjacent**:
  - `hotkeys` — グローバル `/`（検索）と発火コンテキストが衝突しないよう注意。
  - `editor-keymaps` — キーバインドではなく入力ベースで実装し、領域を分離。
  - `collaborative-editor` — Yjs 協調編集と同じ CodeMirror ビュー上で動くため、挿入が共同編集の整合性を壊さないこと（通常の編集トランザクションとして実行されれば問題なし）。
  - `suggest-path` — 直交、重複なし。

## Constraints
- TypeScript strict、Biome、Vitest（テスト co-located）。
- `packages/editor` のモジュール公開面ルール（barrel / index.ts）に従う。
- スラッシュコマンドは **エディタのテキスト入力中のみ** 発火し、グローバルホットキー `/`（検索）と競合しないこと。
- 既存の絵文字オートコンプリート（`:` トリガー）と同時に存在しても干渉しないこと。
- 国際化（i18n）: コマンドのラベル / 説明は将来的に多言語対応できる構造にする（MVP では既存の i18n 仕組みに乗せる）。
