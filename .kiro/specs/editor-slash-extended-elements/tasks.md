# Implementation Plan

> **前提（着手ゲート）**: 本スペックの全タスクは、基盤 `editor-slash-command` の公開インタフェースが**実装・凍結**されていることを前提とする。とくに本スペックは基盤のアクションモデル一般化に依存する:
> - `SlashCommandAction = SlashInsertAction { kind:'insert'; buildInsertion } | SlashRunAction { kind:'run'; run }`
> - `SlashCommand.action: SlashCommandAction`（旧 `buildInsertion` 直持ちからの変更）
> - 基盤 `apply` が `action.kind` で分岐（`insert` は単一 dispatch、`run` は `/query` 削除後に `run(view, from)`）
> - コマンド集合の合成点が **React レイヤ**で `[...SLASH_COMMANDS, ...useExtendedElementCommands(editorKey)]` を組め、`editorKey` を取得できること
> 別ストーリーで並行着手する場合は、基盤側でこのアクションモデルと合成点を先行実装すること（design.md「着手前提条件」参照）。

- [ ] 1. 静的挿入: ビルダー・変種・コマンド・ロケール

- [ ] 1.1 (P) plantuml / callout の挿入ビルダーを実装
  - plantuml = `@startuml`/`@enduml` を含むフェンス（カーソルは中間の空行）、callout = `:::<type>` + 空本文行 + `:::`（カーソルは本文行）を返す純粋関数を実装する
  - `calloutInsertion(type)` は種別を受けてビルダーを返す高階関数。先行する非空白テキストがある場合は区切り改行を前置する
  - 副作用を持たない（dispatch しない）
  - 観測: 各ビルダーが期待する挿入テキストとカーソル位置を返す単体テストが green（jsdom + EditorState/EditorView）
  - _Requirements: 1.3, 1.5, 4.2, 5.2, 8.1_
  - _Boundary: insertion-builders_

- [ ] 1.2 callout 種別を @growi/core へ一本化し、変種リストを生成
  - `AllCallout` / `Callout` を `apps/app/src/features/callout/services/consts.ts` から `packages/core/src/consts/callout.ts` へ移動し、core barrel から公開。apps/app の `consts.ts` は @growi/core からの**再エクスポート**に置換（既存 import 元 `callout.ts` / `CalloutViewer.tsx` は無修正で動くこと）
  - `npx changeset` を作成（@growi/core は公開パッケージ、patch 相当）
  - packages/editor 側で `AllCallout` から `CALLOUT_VARIANTS`（各種別 + 絞り込み別名 `KEYWORDS: Record<Callout, ...>`）を生成する。`Record<Callout, ...>` により種別追加時は型エラーで検出（drift テスト不要）
  - 観測: apps/app の callout 描画・パースが回帰しないこと、editor 側で7種の変種が生成され各種別が type と keywords を持つことをテストで確認。`turbo run build --filter @growi/core --filter @growi/app` 相当が green
  - _Requirements: 4.1, 4.3_
  - _Boundary: @growi/core callout consts（新規）, apps/app callout consts 再エクスポート, callout-variants_

- [ ] 1.3 静的拡張コマンド集合を宣言
  - plantuml（insert）+ callout×7（insert、`CALLOUT_VARIANTS` からデータ駆動生成）を、id・i18n キー・キーワード・action とともに宣言する
  - callout は共通キーワード `callout` を含め `/callout` で全種別が絞り込まれるようにする。未選択要素（math/mermaid）は含めない
  - 観測: plantuml と callout×7 が公開され、各 i18n キー/キーワード/action.kind='insert' を持つこと・未選択要素を含まないことをテストで確認
  - _Requirements: 1.1, 1.5, 1.6, 4.1, 4.4_
  - _Boundary: static-commands_
  - _Depends: 1.1, 1.2_

- [ ] 1.4 (P) run 用の行頭正規化ヘルパを実装
  - `ensureBlockLineStart(view, pos)`: `pos` が行頭（同一行に先行する非空白テキストがない）でなければ改行を1つ前置し、カーソルを新しい空行の先頭へ移す。行頭ならドキュメント不変。`view.dispatch` は最大1回
  - drawio/lsx（run）がモーダルを開く前に呼び、挿入されるブロック要素（フェンス / `$lsx(...)`）が独立行に置かれることを保証する（既存 drawio モーダル本体は改修しない）
  - 観測: 行頭ケースで不変、行途中ケースで改行前置＋カーソルが新行先頭へ来ることを単体テストで確認（jsdom + EditorState/EditorView）
  - _Requirements: 5.4_
  - _Boundary: ensure-block-line-start_

- [ ] 1.5 (P) 拡張要素コマンドのロケールキーを追加
  - `slash_command.drawio.*` / `plantuml.*` / `lsx.*` / `callout.<type>.*`（ラベル・説明）を en_US / ja_JP に追加する
  - 観測: 両ロケールにキーが存在し、各コマンドのラベル/説明が表示言語で解決される（未対応言語は既定言語へフォールバック）
  - _Requirements: 7.1, 7.2_
  - _Boundary: locale files_

- [ ] 2. 副作用起動: drawio / lsx モーダル導線

- [ ] 2.1 lsx モーダルのトリガーフックを実装（packages/editor）
  - `drawio-for-editor.ts` に倣い、`{ isOpened, editorKey }` の atom と `useLsxModalForEditorStatus` / `useLsxModalForEditorActions`（open/close）を実装する
  - 観測: `open(editorKey)` で状態が立ち、`close()` でクリアされることを単体テストで確認
  - _Requirements: 1.4, 3.1, 3.6_
  - _Boundary: states/modal/lsx-for-editor_

- [ ] 2.2 (P) `$lsx(...)` 文字列ビルダーを実装（apps/app）
  - フォーム値（prefix/num/depth/sort/reverse/filter/except）から `$lsx(...)` を組み立てる純粋関数。空・既定値は出力せず、全空なら `$lsx()`、`reverse=true` のときのみ付与
  - 観測: 代表的なオプション組合せで期待文字列、全空で `$lsx()`、`reverse=false` 非出力を単体テストで確認
  - _Requirements: 3.2, 3.3, 3.4_
  - _Boundary: build-lsx-notation_

- [ ] 2.3 lsx 設定モーダル UI を実装（apps/app）
  - `useLsxModalForEditorStatus` を購読し、`useCodeMirrorEditorIsolated(editorKey)` で view を取得。フォーム（prefix/num/depth/sort/reverse/filter/except）+ 確定で `buildLsxNotation` → `view.dispatch` で挿入。キャンセルで挿入しない
  - drawio モーダルと同じマウント箇所に登録。ラベルは i18n（`lsx_modal.*`）
  - 観測: モーダルが開閉し、確定で `$lsx(...)` が挿入、キャンセルで未挿入であることを確認（コンポーネントテスト + 手動スモーク）
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - _Boundary: LsxModal, markdown-lsx-util-for-editor_
  - _Depends: 2.1, 2.2_

- [ ] 2.4 drawio/lsx の run コマンド合成フックを実装
  - `useExtendedElementCommands(editorKey)` を実装。drawio/lsx の `run` は `ensureBlockLineStart(view, from)` で行頭正規化してから、それぞれ `useDrawioModalForEditorActions().open(editorKey)` / `useLsxModalForEditorActions().open(editorKey)` を呼ぶ。`STATIC_EXTENDED_COMMANDS` と合成して返す
  - 観測: drawio/lsx コマンドが `kind:'run'` を持ち、`run(view, from)` で（行途中なら行頭正規化後に）対応オープナーが `editorKey` 付きで呼ばれること（モックで検証）。返り値に plantuml/callout も含むこと
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.4, 5.4_
  - _Boundary: use-extended-element-commands_
  - _Depends: 1.3, 1.4, 2.1_

- [ ] 3. 統合: 基盤コマンド集合への合流

- [ ] 3.1 拡張コマンドを基盤の有効コマンド集合へ合流（React 合成点）
  - 合成点（`use-default-extensions` 相当）で `editorKey` を取得し、`[...SLASH_COMMANDS, ...useExtendedElementCommands(editorKey)]` を `resolveSlashCommands(t, ...)` に渡す（基盤 core は拡張を import しない＝依存逆転なし）
  - 観測: エディタ起動時に `/drawio` `/plantuml` `/lsx` `/callout` が基本コマンドと同一の補完メニューに現れ、絵文字補完（`:`）と同時に機能する
  - _Requirements: 6.1, 6.2, 8.2_
  - _Depends: 2.4_
  - _Boundary: コマンド集合合成点（基盤側）_

- [ ] 4. 検証

- [ ] 4.1 統合・スモーク検証
  - `/uml` で plantuml、`/warn` で warning callout が絞り込まれること、plantuml/callout 選択で `/query` が置換され単一トランザクションで挿入され undo 1 回で復元すること
  - `/drawio` `/lsx` 選択で `/query` が削除されモーダルが起動し、drawio 保存で ` ```drawio ` フェンス、lsx 確定で `$lsx(...)` が挿入されること、キャンセルで未挿入であることを実アプリで確認
  - **行の途中（例 `図: /drawio`）で起動しても、挿入されるブロックが独立行に置かれ描画が壊れないこと**（行頭正規化）を確認
  - 既存 drawio モーダルのツールバー起動・書き戻しが回帰しないこと
  - 観測: 上記シナリオが統合テスト/手動スモークで再現し、`turbo run lint/test/build --filter @growi/app` 相当が green
  - _Requirements: 1.2, 1.4, 4.4, 5.1, 5.2, 5.3, 5.4, 6.2, 6.3, 8.2, 8.3_
  - _Depends: 3.1_
