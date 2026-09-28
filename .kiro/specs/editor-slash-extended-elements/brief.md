# Brief: editor-slash-extended-elements

> アンブレラ `editor-commands` の子スペック。基盤 `editor-slash-command` に依存。

## Problem
`editor-slash-command`（MVP）のスラッシュコマンドは基本 Markdown 要素（見出し・リスト・引用・コードブロック・テーブル）のみを対象とする。GROWI 固有の拡張要素（drawio 作図・plantuml・lsx 動的リスト・callout 等）は `/` から挿入できず、ユーザーはツールバー・モーダル・記法の手入力に頼る必要がある。とくに drawio / lsx は「記法の雛形を置く」だけでは実用にならず、**専用エディタ（drawio モーダル）や多数のオプション（lsx）を設定する導線**が必要になる。

## Current State
- 基盤 `editor-slash-command` が、補完ソース（トリガー検出・フィルタ・`apply`）、コマンドレジストリ（データ駆動・単一ソース）、挿入ビルダー、i18n 解決を提供する。**ただし現状の `apply` は「静的テキストの単一挿入」専用**（`buildInsertion`）で、モーダル起動のような副作用アクションを表現できない。
- GROWI 拡張要素は既存の remark プラグインで**描画**される（drawio / plantuml / lsx / callout）。
- **drawio モーダルは既存**: トリガーフック `useDrawioModalForEditorActions().open(editorKey)` が `@growi/editor`（`packages/editor/src/states/modal/drawio-for-editor.ts`）にあり、モーダル本体は apps/app 側（`DrawioModal`）が atom を購読してカーソル位置を読み取り、保存時に ` ```drawio ` フェンスを `editor.dispatch` で書き戻す。**packages/editor からモーダルを起動でき、apps/app への逆依存は不要**。
- **lsx 設定 UI は存在しない**: lsx は記法のみ。オプションは prefix / num / depth / sort / reverse / filter / except（`packages/remark-lsx`）。設定モーダルは新規に作る必要がある。
- **callout は対応済み**: `:::type[label] … :::` ディレクティブ記法（`apps/app/src/features/callout`）。7 バリアント（note / tip / important / info / warning / danger / caution、真実源は `features/callout/services/consts.ts`）。スラッシュ挿入導線は未実装。

## Desired Outcome
- `/drawio` で **drawio モーダルが起動**し、作図結果が ` ```drawio ` フェンスとして挿入される（既存モーダルを再利用）。
- `/lsx` で **lsx 設定モーダル（新規）** が起動し、フォームで組み立てた `$lsx(...)` がカーソル位置に挿入される。
- `/plantuml` で plantuml フェンス雛形が `editor-slash-command` と同じ挙動（`/query` 置換 + 単一トランザクション挿入 + カーソル配置）で挿入される。
- `/callout`（およびバリアント名）で callout を**種別を選んで**挿入できる（`:::tip` 等）。
- 各コマンドのラベル/説明が多言語表示される。

## Approach
基盤のコマンドレジストリに**拡張要素コマンドの定義**を追加する。アクションの種類は2つ:
1. **静的挿入（insert）** — plantuml フェンス・callout（種別ごと）。基盤の `buildInsertion` パターンをそのまま使う純粋ビルダー。
2. **副作用起動（run）** — drawio / lsx のモーダル起動。基盤の `apply` が `/query` を削除したうえで `run` を呼び、`run` がモーダルを開く。挿入はモーダル側が `editor.dispatch` で行う。

このため**基盤 `editor-slash-command` のアクションモデルを `insert | run` の判別共用体に一般化**する（基盤の所有・本スペックの前提ゲート）。drawio / lsx の `run` は React フックでモーダルオープナー（と `editorKey`）を束縛して生成する。callout は変種リストからデータ駆動で個別コマンドを宣言する。

## Scope
- **In**:
  - drawio スラッシュコマンド → 既存 drawio モーダル起動（run）
  - lsx スラッシュコマンド → **新規 lsx 設定モーダル**起動（run）。モーダル UI（apps/app）・editor 側トリガーフック（packages/editor）・`$lsx(...)` 文字列ビルダー・エディタ書き戻し
  - plantuml スラッシュコマンド → フェンス雛形の静的挿入（insert）
  - callout スラッシュコマンド → 7 バリアントを種別ごとに選んで静的挿入（insert）。変種は宣言リストからデータ駆動
  - 上記コマンドの定義データ・i18n キー・基盤コマンド集合への合流（React 合成点）
- **Out**:
  - 拡張要素の**描画**（既存 remark プラグインの領域）
  - 既存 drawio モーダル**本体の改修**（再利用のみ。本スペックは起動導線を足す）
  - lsx の**サーバ側 list-pages ロジック**（既存。本スペックはフォーム→記法文字列の生成のみ）
  - math / mermaid 等、今回未選択の要素（将来拡張）
  - テンプレート挿入（別構想）
  - 補完エンジン・トリガー検出・レジストリ機構そのもの（基盤の所有。ただしアクションモデルの一般化は基盤の前提ゲートとして本スペックが要求）

## Boundary Candidates
- **拡張要素コマンド定義（静的）**: plantuml・callout（×7）の id・i18n キー・キーワード・insert ビルダー。
- **拡張要素コマンド定義（React 合成）**: drawio・lsx の run コマンドを、モーダルオープナーと `editorKey` を束縛して生成するフック。
- **lsx 設定モーダル**: フォーム（prefix/num/depth/sort/reverse/filter/except）→ `$lsx(...)` 文字列ビルダー → エディタ書き戻し。editor 側トリガーフック（atom）＋ apps/app 側 UI。
- **callout 変種リスト**: 7 種を宣言したデータ（packages/editor）。`features/callout` の真実源と整合を保つ（drift 注意）。

## Out of Boundary
- 基盤の補完ソース/トリガー/レジストリ機構/登録点（`editor-slash-command` が所有）。**例外**: アクションモデル（`insert | run`）の一般化は基盤側の変更だが、本スペックの実装前提ゲートとして要求する。
- 拡張要素の描画・パース（remark プラグイン）。
- グローバルホットキー・キーバインド・絵文字補完。
- drawio モーダル本体・lsx サーバ list-pages・callout 描画コンポーネント。

## Upstream / Downstream
- **Upstream**: `editor-slash-command`（レジストリ・補完ソース・`apply`・i18n 解決・挿入ビルダーのパターン、アクションモデル）、既存 drawio モーダル（`useDrawioModalForEditorActions` / `DrawioModal` / `replaceFocusedDrawioWithEditor`）、remark-lsx のオプション仕様、`features/callout` の変種定義。
- **Downstream**: さらなる拡張要素コマンド・モーダルの追加（定義データ追記 + 必要なら run コマンド追加）。

## Existing Spec Touchpoints
- **Extends**: `editor-slash-command` のコマンドレジストリにデータを追加し、**アクションモデルを `run` に拡張**して機能拡張する。
- **Adjacent**: 拡張要素の remark プラグイン（描画側、重複しない）、drawio モーダル（再利用）。

## Constraints
- TypeScript strict、Biome、Vitest（co-located）。
- 静的挿入は単一トランザクション・通常の `view.dispatch`（undo 粒度・協調編集整合を維持）。run コマンドは `/query` 削除を単一トランザクションで行い、モーダルの挿入は別トランザクション（モーダル操作という別ユーザー操作のため許容）。
- ラベル/説明は既存 i18n（react-i18next + locale JSON）に乗せ、未対応言語は既定言語へフォールバック。
- packages/editor は apps/app に逆依存しない。drawio/lsx モーダルは editor 側トリガーフック（atom）経由で起動し、UI 本体は apps/app に置く。
