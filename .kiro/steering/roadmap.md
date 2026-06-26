# Roadmap: editor-commands

エディタ上のコマンド体系（スラッシュ挿入・拡張要素・選択操作）を束ねるアンブレラ。

## Overview
GROWI の Markdown エディタ（CodeMirror 6、`packages/editor/`）に、執筆フローを止めずに要素挿入・テキスト操作を行うコマンド体系を整備する。`/` 入力による要素挿入（スラッシュコマンド）を**基盤**とし、その上に GROWI 固有の拡張要素コマンド、およびテキスト選択時に浮動メニューで操作を提示する選択パレットを積み上げる。各機能は独立して実装・レビューできる子スペックに分解し、共通のコマンド定義（レジストリ）を基盤スペックが所有する。

## Approach Decision
- **Chosen**: 基盤（`editor-slash-command`）が補完エンジン・トリガー・コマンドレジストリ・i18n 解決を所有し、拡張要素コマンドと選択パレットはその基盤を再利用する子スペックとして追加する。
- **Why**: 多くの拡張が「コマンド定義へのデータ追加」で完結する設計（Data-Driven Control / Executors take their work-set as input）にできるため、基盤を1つに集約すると拡張コストと回帰範囲が最小化する。子スペック同士は互いに独立で並列実装しやすい。
- **Rejected alternatives**:
  - 各機能を独立スペックにして基盤を重複実装 — レジストリ/補完登録が分散し、emoji 補完との統合が複数箇所で競合する。
  - 単一巨大スペックに全部入れる — 20タスク超・複数責任が混在し、レビュー単位が大きくなりすぎる。

## Scope
- **In**: エディタ内のコマンド起動（`/` 入力 / テキスト選択）と、それによる Markdown 要素の挿入・テキスト操作。コマンド定義の共有基盤。コマンドラベルの多言語表示。
- **Out**: エディタ外（閲覧モード・ページツリー等）でのコマンド、プラグインによる外部コマンド登録 API の公開、コマンドのサーバ側永続設定、GROWI 拡張要素そのものの描画（既存 remark プラグインの領域）。

## Constraints
- TypeScript strict、Biome、Vitest（テスト co-located）。
- `packages/editor` のモジュール公開面ルール（barrel / index.ts）に従う。
- 既存のグローバルホットキー `/`（検索）、絵文字オートコンプリート（`:`）、キーバインド（`editor-keymaps`）、協調編集（`collaborative-editor`）と干渉しないこと。
- 挿入・操作は通常の `view.dispatch` トランザクションとして実行し、undo の粒度を保つ。

## Boundary Strategy
- **Why this split**: 「コマンドの起動方法（トリガー/UI）」と「コマンドの中身（定義・挿入/操作ロジック）」を分離。基盤がレジストリと補完登録を一元所有し、各子スペックは定義データと固有のトリガー/UI のみを足す。これにより子スペック間の競合がなく並列実装できる。
- **Shared seams to watch**:
  - **コマンドレジストリの所有権**: 現状 `editor-slash-command` がレジストリを所有。`editor-selection-palette` は **MVP ではこのレジストリを共有せず独立**（基底 `toggleMarkdownSymbol` を直接再利用）と設計で確定済み。将来 palette と slash で操作定義を共有したくなった場合に、共通コマンド抽象への昇格を検討する（長期 seam）。
  - **アクションの意味論差**: スラッシュ挿入は「新規要素を単一トランザクションで挿入」（専用ビルダー）。選択パレットは「選択範囲をトグル/ラップ」で、**既存の `toggleMarkdownSymbol` / `insertLinePrefix` がそのまま適合**する。コマンド抽象がこの2種のアクション（新規挿入ビルダー / 選択トグル）を表現できる形にする。
  - **トリガー/登録機構の差**: emoji と slash は単一 `autocompletion()`（`use-default-extensions.ts`）に統合。選択パレットは autocomplete ではなく選択範囲に追従する浮動ツールバー（`@codemirror/view` の `showTooltip` 等）で、登録機構が異なる点に注意。

## Specs (dependency order)
- [ ] editor-slash-command -- `/` トリガーの基本コマンド挿入。補完エンジン・トリガー・コマンドレジストリ・i18n 解決の**基盤**を所有。Dependencies: none ＜既存・phase: tasks-generated。本アンブレラでは再生成不要＞
- [ ] editor-slash-extended-elements -- GROWI 固有の拡張要素（drawio / math / plantuml / lsx 等）の挿入コマンドを基盤レジストリへ追加。Dependencies: editor-slash-command
- [ ] editor-selection-palette -- テキスト選択時に浮動コマンドパレット（バブルメニュー）を表示し、選択範囲への操作（太字・斜体・取り消し線・インラインコード）を提供。Dependencies: none ＜MVP は基底 toggleMarkdownSymbol + CM tooltip + 既存 toolbar i18n のみで成立し、editor-slash-command のレジストリに依存しない。umbrella 所属は維持。リンク化/見出し化等は将来拡張＞
