# Technical Design Document

## Overview

**Purpose**: 基盤 `editor-slash-command` のスラッシュコマンド機構の上に、GROWI 固有の拡張要素（drawio / plantuml / lsx / callout）、および基盤が対象外とした要素（リンク・テーブルビルダー）を `/` から挿入・起動するコマンドを追加する。要素は「静的テキスト挿入で足りるもの（plantuml / callout / lsx）」と「専用モーダルでの設定・編集が要るもの（drawio / リンク / テーブルビルダー）」に分かれるが、基盤のコマンドアクションは **`insert`（静的挿入）/ `run`（副作用起動）** の2種に**既に一般化・実装済み**（`SlashRunAction`）であり、本スペックはその `run` 契約を消費して各コマンドの定義・ビルダー・モーダル起動導線を足す。

**Users**: エディタで執筆する全ユーザーが、`/drawio`（作図モーダル）・`/plantuml`（フェンス挿入）・`/lsx`（`$lsx()` 挿入）・`/callout`（種別選択挿入）・`/link`（リンク編集モーダル）・テーブルビルダー（Handsontable モーダル）で GROWI 拡張要素・既存モーダルを素早く扱う。

**Impact**: 基盤のコマンド集合に拡張要素コマンドを**合流**させる。drawio / リンク / テーブルビルダーは副作用（モーダル起動）を伴うが、基盤のアクションモデル `insert | run` は**実装済み基盤が既に提供**しており、本スペックはそれを消費する（基盤の型・`apply` への変更は不要）。唯一の基盤側変更はコマンド集合の**合成点**（`use-default-extensions.ts` の注入シーム）に拡張コマンドを渡す配線のみ。drawio・リンク・テーブルビルダーは既存資産を再利用する。基盤の機構・基本コマンド・絵文字補完・描画機構（remark/rehype プラグイン）・既存モーダル本体の挙動は変更しない。

### Goals
- drawio / plantuml / lsx / callout / リンク / テーブルビルダーを、基盤と一貫した挙動（`/query` 置換・単一トランザクション・undo 整合）で挿入または起動する。
- 静的挿入（plantuml / callout / lsx）と副作用起動（drawio / リンク / テーブルビルダー）の両方を、単一のアクション抽象で表現する。
- callout を変種宣言リストからデータ駆動で生成し、種別追加を宣言の編集のみで可能にする。
- packages/editor → apps/app の逆依存を作らずにモーダルを起動する。
- リンク・テーブルビルダーは**既存モーダルを一切改修せず**、起動導線のみを追加する（drawio と同じ再利用パターン）。

### Non-Goals
- 拡張要素の描画・プレビュー（既存 remark/rehype プラグインの領域）。
- 既存 drawio モーダル本体の改修（再利用のみ）。
- lsx サーバ側 list-pages ロジックの変更（既存。本スペックは `$lsx()` 記法の静的挿入のみ）。
- math / mermaid 等、今回未選択の要素（将来拡張）。
- 基盤のトリガー検出・補完ソース・アクションモデル（`insert | run`）・レジストリ機構そのものの変更（いずれも実装済み基盤が所有）。

## Boundary Commitments

### This Spec Owns
- 拡張要素コマンドの定義（drawio / plantuml / lsx / callout×7 / リンク / テーブルビルダー の id・i18n キー・キーワード・アクション・`disallowedIn`）。ブロック要素コマンドは `disallowedIn: ['list','table']` を宣言し、リンク・lsx（インライン）は宣言しない。
- 静的挿入ビルダー（plantuml フェンス、callout ディレクティブ、lsx の `$lsx()`）。
- callout 種別リスト（`AllCallout` / `Callout` 型）の **`@growi/core` への移動**（真実源の一本化）と、apps/app 既存 consts の再エクスポート化。editor 側は `AllCallout` から `CALLOUT_VARIANTS`（絞り込み別名付き）を生成。
- drawio の `run` コマンドを、モーダルオープナーと `editorKey` を束縛して生成する React フック（合成点）。
- **リンク / テーブルビルダーの `run` コマンド**: 既存トリガーフック（`useLinkEditModalActions` / `useHandsontableModalForEditorActions`）を呼ぶだけの薄いラッパー。drawio と異なり `editorKey` の束縛が不要（下記 Architecture Integration 参照）。
- 拡張要素コマンドのラベル/説明 locale キー（`slash_command.*`）。

### Out of Boundary
- 基盤 `editor-slash-command` の補完ソース・トリガー検出・i18n 解決機構（基盤が所有）。`SlashCommand` のアクションモデル（`insert | run`）と `apply` の分岐は**実装済み基盤が既に提供**しており（`slash-command-types.ts` / `slash-command-source.ts`）、本スペックは変更しない。
- 拡張要素の描画・パース（remark/rehype プラグイン）。
- 既存 drawio モーダル本体（`DrawioModal` / `DrawioCommunicationHelper` / `replaceFocusedDrawioWithEditor`）。本スペックは起動導線（`useDrawioModalForEditorActions().open`）の呼び出しのみ追加。
- 既存 Edit Link Modal 本体（`LinkEditModal` / `getMarkdownLink` / `replaceFocusedMarkdownLinkWithEditor`）。本スペックは起動導線（`useLinkEditModalActions().open`）の呼び出しのみ追加。
- 既存 Handsontable Modal 本体（`HandsontableModal` / `getMarkdownTable` / `replaceFocusedMarkdownTableWithEditor`）。本スペックは起動導線（`useHandsontableModalForEditorActions().open`）の呼び出しのみ追加。
- lsx サーバ側 list-pages（`packages/remark-lsx/src/server`）。
- callout 描画コンポーネント（`features/callout/components/CalloutViewer`）と callout パース（`features/callout/services/callout.ts`）。本スペックは種別**名**（`AllCallout`）を参照するのみで、描画・パースは変更しない（`consts.ts` は @growi/core からの再エクスポートに置き換えるが、`AllCallout`/`Callout` の import 経路・値は不変）。
- 絵文字補完・キーバインド・グローバルホットキー。
- **画像アップロード**（Out of scope。既存の添付ボタンが React props（`onUpload`/`acceptedUploadFileType`）を apps/app 側コンポーネントから受け取る構成のため、`run(view, from)` だけでは起動を完結できない。コンポーネントレイヤでの合成方法を検討してから改めてスコープ化する設計課題）。

### Allowed Dependencies
- 基盤の型/契約: `SlashCommand`（`disallowedIn` / `syntaxHint` を含む）、`SlashCommandAction`（`insert | run`）、`SlashInsertion`（`{ insert, cursorOffset, replaceFromOffset? }`）。
- `@growi/core`: callout 種別の真実源 `AllCallout` / `Callout`（本スペックで core へ移動）。packages/editor・apps/app とも既に @growi/core に依存済み。
- `@codemirror/view`（`EditorView`）。
- 既存 drawio トリガーフック: `useDrawioModalForEditorActions`（`packages/editor/src/states/modal/drawio-for-editor.ts`）。
- 既存リンク編集ユーティリティ: `useLinkEditModalActions`（`packages/editor/src/states/modal/link-edit.ts`）、`getMarkdownLink` / `replaceFocusedMarkdownLinkWithEditor`（`packages/editor/src/client/services-internal/link-util/markdown-link-util.ts`）。
- 既存テーブルビルダー トリガーフック: `useHandsontableModalForEditorActions`（`packages/editor/src/states/modal/handsontable.ts`）。
- i18n: 基盤の `resolveSlashCommands(t, commands)` 経由でラベル解決（本スペックは locale キーを足すのみ）。
- 依存方向: `builders/variants → 基盤の型` / `static commands → builders + 基盤の型` / `run commands フック → 基盤の型 + モーダルオープナー` / `合成点（React 登録レイヤ）→ 基盤コマンド + 拡張コマンド`。拡張モジュールは基盤の core 定義を import しない（基盤が拡張を知らない＝逆転なし）。apps/app は editor 側モーダルフックを購読するのみ（packages/editor → apps/app の逆依存なし）。

### Revalidation Triggers
- 基盤の `SlashCommand` / `SlashCommandAction` / `SlashInsertion` 契約変更。
- コマンド集合の**合成点**の構造変更（React 登録レイヤの合成方法、`editorKey` の受け渡し）。
- 既存 drawio トリガーフック（`useDrawioModalForEditorActions`）のシグネチャ変更。
- 既存リンク編集 / テーブルビルダー トリガーフック（`useLinkEditModalActions` / `useHandsontableModalForEditorActions`）またはユーティリティ（`getMarkdownLink` / `replaceFocusedMarkdownLinkWithEditor` / `getMarkdownTable` / `replaceFocusedMarkdownTableWithEditor`）のシグネチャ変更。
- `@growi/core` の `AllCallout` の変種追加・削除（editor 側 `KEYWORDS` の `Record<Callout, …>` が型エラーで検出。別名の追記が必要）。
- remark-lsx のオプション仕様変更（ユーザーが `$lsx()` のカッコ内に手入力するオプションに影響するのみ。本スペックは `$lsx()` を静的挿入するだけなので build-time の影響はない）。
- locale キー命名（`slash_command.*`）の変更。

### 着手前提条件 (Prerequisites)
- **基盤インタフェースは実装済み（充足済み・確認のみ）**: 下記 1–3 は実装済み基盤 `editor-slash-command` が既に提供しており、本スペックは**消費するだけ**（新たな基盤変更なし）。着手前に現物で存在確認すればよい。
  1. `SlashCommandAction` 型 = `SlashInsertAction { kind:'insert'; buildInsertion } | SlashRunAction { kind:'run'; run }` — 実装済み（`slash-command-types.ts`、公開バレルから export 済み）。
  2. `SlashCommand` が `action: SlashCommandAction` を持つ — 実装済み（`slash-command-definitions.ts` の全コマンドが `action` 形式）。
  3. 基盤 `apply` が `action.kind` で分岐: `insert` は単一 `dispatch`（削除+挿入+カーソル）、`run` は `/query` 削除（単一 `dispatch`）後に `run(view, from)` を呼ぶ — 実装済み（`slash-command-source.ts` の `applyCommand`）。
- **唯一の未達（本スペックで対応する基盤側配線）**: コマンド集合の合成点 `use-default-extensions.ts` は現状 `resolveSlashCommands(t)` を基盤コマンドのみで呼ぶ。`resolveSlashCommands(t, commands)` / `createSlashCommandSource(commands)` は既に work-set を引数化済みのため、**合成点に拡張コマンドを渡す注入シームを開けること**、および合成点が `editorKey` を取得できること（drawio の run 用）だけが残作業（Task 3.1）。

## Architecture

### Existing Architecture Analysis
- 基盤（**実装済み**）は `slash-command/` 配下に型・定義・ビルダー・source・resolve を持ち、`use-default-extensions.ts` で emoji と統合した単一 `autocompletion()` を登録する。アクションは既に `insert`（静的挿入）/ `run`（副作用起動、`SlashRunAction`）の2種を提供済みで、`applyCommand` が `action.kind` で分岐する。`SlashCommand` は `disallowedIn`（list/table のコンテキスト除外）と `syntaxHint` も持つ。
- **drawio モーダルは既存**（実機確認済み）:
  - トリガーフック `useDrawioModalForEditorActions().open(editorKey)` が `@growi/editor`（`packages/editor/src/states/modal/drawio-for-editor.ts`）にあり、atom に `{ isOpened, editorKey }` を立てるだけ。
  - モーダル本体 `DrawioModal`（apps/app）が atom を購読し、`useCodeMirrorEditorIsolated(editorKey)` で `EditorView` を取得、保存時に `replaceFocusedDrawioWithEditor(editor, xml)` で ` ```drawio ` フェンスを `editor.dispatch`（`apps/app/src/client/components/PageEditor/markdown-drawio-util-for-editor.ts`）。
  - → **packages/editor から `open(editorKey)` を呼べばモーダルが起動し、挿入はモーダルが行う**。apps/app への逆依存は不要。
- **lsx は `$lsx()` 記法のみ**（`packages/remark-lsx`。記法 `$lsx(/path, num=, depth=, sort=, reverse=, filter=, except=)`）: `$lsx()` は `@growi/remark-growi-directive` の Text/Leaf ディレクティブ（**インライン要素**）であり、drawio（フェンス）・callout（`:::` コンテナ）のようなハードブロックではない。したがってモーダルは設けず、`$lsx()` を静的挿入してカーソルをカッコ内（`(` の直後）に置くだけでよい（オプションはユーザーが記法で手入力する）。
- **callout は対応済み**: `:::type[label] … :::`（`apps/app/src/features/callout`）。7 種（note/tip/important/info/warning/danger/caution、`features/callout/services/consts.ts`）。挿入は静的テキストで足りる。
- **Edit Link Modal は既存**（実機確認済み）:
  - トリガーフック `useLinkEditModalActions().open(defaultMarkdownLink, onSave)` が `@growi/editor`（`packages/editor/src/states/modal/link-edit.ts`）にある。drawio と異なり `editorKey` ではなく **`Linker` と保存コールバックを直接渡す**（モーダル側は `EditorView` を持たず、渡された `onSave` を呼ぶだけ）。
  - `run(view, from)` は `getMarkdownLink(view)` でカーソル位置の既存リンク（無ければ空）を読み、`onSave = (linkText) => replaceFocusedMarkdownLinkWithEditor(view, linkText)` を束縛して `open(defaultMarkdownLink, onSave)` を呼ぶ。両ユーティリティは既存（`markdown-link-util.ts`）。
  - → **`view`/`from` は `run` の引数からそのまま使え、`editorKey` の束縛が不要**。drawio より合成が単純（React フックは `useLinkEditModalActions()` の呼び出しのみ）。
  - リンクは**インライン要素**なので、drawio のような行頭正規化（`ensureBlockLineStart`）は不要（`図: /link` のように行の途中で起動しても、その位置にインラインでリンクが挿入されるのが正しい挙動）。
- **Handsontable Modal（テーブルビルダー）は既存**（実機確認済み）:
  - トリガーフック `useHandsontableModalForEditorActions().open(editor?: EditorView)` が `@growi/editor`（`packages/editor/src/states/modal/handsontable.ts`）にある。drawio と同様 atom に `{ isOpened, editor }` を立てるだけ。
  - モーダル本体 `HandsontableModal`（apps/app）がこの atom を購読し、`isOpenedForEditor` のときは渡された `editor: EditorView` を直接使う（`useCodeMirrorEditorIsolated(editorKey)` 経由の解決は不要）。開時に `getMarkdownTable(editor)` でカーソル位置の既存テーブルを初期値にし、保存時に `replaceFocusedMarkdownTableWithEditor(editor, table)` で書き戻す（`apps/app/src/client/components/PageEditor/markdown-table-util-for-editor.ts`）。
  - → **`open(view)` を呼べばよく、`editorKey` の束縛が不要**（drawio より合成が単純）。
  - `replaceFocusedMarkdownTableWithEditor` は「テーブルの開始/終了位置」を対象に置換するのみで、**新規テーブル挿入時に先行段落との間の空行を保証しない**（GFM は空行なしのテーブルを段落として吸収する）。そのため drawio と同様に、`run` はモーダルを開く前に `ensureBlockLineStart(view, from)` を呼ぶ（テーブルはブロック要素のため必要。リンクとの違いはここ）。

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph extended_module[packages/editor 拡張モジュール]
        Variants[callout variants 宣言リスト]
        StaticBuilders[insertion builders<br/>plantuml / callout / lsx]
        StaticCommands[static commands<br/>plantuml + callout×7 + lsx]
        RunHook[useExtendedElementCommands フック<br/>drawio / link / table-builder の run 合成]
        LineStart[ensureBlockLineStart<br/>drawio / table-builder が使用]
    end
    subgraph foundation[基盤 editor-slash-command]
        Types[SlashCommand / SlashCommandAction / SlashInsertion]
        BasicCommands[basic slash commands]
        Apply[source.apply insert|run 分岐]
    end
    subgraph appside[apps/app]
        DrawioModal[既存 DrawioModal 再利用]
        LinkModal[既存 LinkEditModal 再利用]
        TableModal[既存 HandsontableModal 再利用]
    end
    DrawioTrigger[既存 useDrawioModalForEditorActions]
    LinkTrigger[既存 useLinkEditModalActions]
    TableTrigger[既存 useHandsontableModalForEditorActions]
    Compose[React 合成点 use-default-extensions]

    StaticBuilders --> Types
    StaticCommands --> StaticBuilders
    StaticCommands --> Types
    StaticCommands --> Variants
    RunHook --> Types
    RunHook --> DrawioTrigger
    RunHook --> LinkTrigger
    RunHook --> TableTrigger
    RunHook --> LineStart
    Compose --> BasicCommands
    Compose --> StaticCommands
    Compose --> RunHook
    Apply --> RunHook
    DrawioModal --> DrawioTrigger
    LinkModal --> LinkTrigger
    TableModal --> TableTrigger
```

**Architecture Integration**:
- **Selected pattern**: 拡張コマンドを独立モジュール化し、**React 合成点**で基盤コマンドと結合（基盤 core は拡張を知らない）。静的コマンド（plantuml / callout / lsx）はデータ宣言、副作用コマンド（drawio/リンク/テーブルビルダー）はモーダルオープナーを束縛するフックで生成。
- **アクション一般化**: 基盤 `apply` が `insert | run` を分岐。`run` により「モーダル起動」を汎用的に表現（基盤は drawio/リンク/テーブルビルダーを知らず、`run` 関数を呼ぶだけ）。
- **drawio / リンク / テーブルビルダー = 既存資産再利用 / lsx = 静的インライン挿入**: drawio/リンク/テーブルビルダーは editor 側トリガーフック（atom）＋ apps/app 側 UI＋書き戻しユーティリティを再利用する。lsx は `$lsx()`（インラインディレクティブ）を静的挿入するだけで、モーダル・atom・書き戻しユーティリティを必要としない（plantuml/callout と同じ insert アクション）。
- **`editorKey` 束縛は drawio のみ必要**: drawio のトリガーは `open(editorKey)` を要求するため、合成フックが `editorKey` を束縛する。リンク（`open(defaultMarkdownLink, onSave)`）・テーブルビルダー（`open(editor?: EditorView)`）は `run(view, from)` が受け取る `view` をそのまま渡せるため、`editorKey` の束縛が不要（合成が単純）。
- **行頭正規化（`ensureBlockLineStart`）が要るのはブロック要素のみ**: drawio（フェンス）・テーブルビルダー（表）はブロック要素なので、モーダルを開く前に呼ぶ。リンク・lsx はインライン要素なので不要（行の途中で起動してもその位置に挿入されるのが正しい）。
- **コンテキスト除外（`disallowedIn`）も要るのはブロック要素のみ**: 基盤は `disallowedIn` × `activeContextsAt`(list/table) で、リスト項目内・テーブルセル内での候補を除外する（基本コマンドの heading/codeBlock/table と同じ）。拡張のブロック要素コマンド（drawio / テーブルビルダー / plantuml / callout×7）はいずれも `disallowedIn: ['list','table']` を宣言する。これは行頭正規化とは別の防御で、`ensureBlockLineStart` が改行を前置してもテーブルセル内は空行を持てず壊れるため、そもそも候補に出さないことが必要。リンク・lsx（インライン）は宣言しない（テーブルセル内・リスト項目内でも挿入可）。
- **Steering compliance**: データ駆動（callout 変種・コマンド集合）、pure function 抽出（静的ビルダー・`$lsx` ビルダー）、barrel 最小公開、Executors take their work-set as input（合成点が集合を受け取る）。

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Frontend (editor) | 基盤 `editor-slash-command`（同一パッケージ） | コマンド機構・補完・apply（insert/run）・i18n 解決 | アクションモデル（insert/run）は実装済み基盤が提供。消費するのみ |
| Frontend (editor) | `@codemirror/view`（既存） | `EditorView`・`buildInsertion` の型 | 静的ビルダーは view 未使用 |
| Frontend (editor) | Jotai（既存） | drawio/リンク/テーブルビルダー モーダルのトリガー atom | いずれも既存フックを再利用 |
| Frontend (i18n) | `react-i18next` + locale JSON（既存） | ラベル/説明 | `slash_command.*` キー追加 |
| Data / Storage | なし | — | 永続化なし |

新規依存ライブラリは**なし**。

## File Structure Plan

### Directory Structure

```
# packages/editor 側
packages/editor/src/client/services-internal/slash-command/extended-elements/
├── index.ts                          # barrel: 静的コマンド集合 + useExtendedElementCommands を公開
├── callout-variants.ts               # CALLOUT_VARIANTS: @growi/core の AllCallout から生成（+ 別名キーワード KEYWORDS）
├── insertion-builders.ts             # plantumlInsertion / calloutInsertion(type) / lsxInsertion（純粋）
├── ensure-block-line-start.ts        # run 用: from が行頭でなければ改行を前置しカーソルを新行へ（Req 5.4）
├── static-commands.ts                # plantuml + callout×7 + lsx（insert アクション。callout は変種リストから生成）
├── use-extended-element-commands.ts  # React フック: drawio の run コマンド + 静的コマンドを合成して返す
├── insertion-builders.spec.ts
├── static-commands.spec.ts           # plantuml/callout/lsx 定義の健全性 + callout 変種網羅・未選択要素非含有
└── use-extended-element-commands.spec.ts  # run コマンドがオープナーを editorKey 付きで呼ぶ

# drawio（drawio-for-editor.ts）・リンク（link-edit.ts）・テーブルビルダー（handsontable.ts）用の
# トリガーフックは既存のため新規ファイルなし。use-extended-element-commands.ts が既存フックを呼ぶだけ（再利用パターン）。
# lsx は `$lsx()` の静的挿入のみ（insert アクション）で、モーダル・atom・書き戻しユーティリティを新規作成しない。
```

### New / Modified Files（callout 真実源の @growi/core 移動）
- `packages/core/src/consts/callout.ts`（新規）— `AllCallout` / `Callout` を apps/app から移設。core barrel（`consts` / index）から公開。**@growi/core は公開パッケージのため `npx changeset` が必要**（bump は patch 相当）。
- `apps/app/src/features/callout/services/consts.ts`（変更）— 自前宣言をやめ `export { AllCallout, type Callout } from '@growi/core/...'` の再エクスポートに置換（既存 import 元 `callout.ts` / `CalloutViewer.tsx` は無修正）。

### Modified Files
- 基盤の**コマンド集合合成点**（`use-default-extensions.ts`）— **本スペックで変更する唯一の基盤ファイル**。`[...SLASH_COMMANDS, ...useExtendedElementCommands(editorKey)]` を `resolveSlashCommands(t, ...)` に渡す注入シームを開け、合成点が `editorKey` を取得できるよう配線する（drawio 用。リンク/テーブルビルダーは `view` で足りる）。`resolveSlashCommands(t, commands)` / `createSlashCommandSource(commands)` は既に work-set 引数化済みのため、型・`apply` は不変。
- 基盤の `slash-command-types.ts` / `slash-command-source.ts` — **変更なし**（`SlashCommandAction`（`insert | run`）と `apply` の分岐は実装済み。本スペックは消費するのみ）。
- `apps/app/public/static/locales/en_US/translation.json` / `ja_JP/translation.json` — `slash_command.drawio.*` / `plantuml.*` / `lsx.*` / `callout.<type>.*` キー追加。
  - **リンク/テーブルビルダーの新規キー（`slash_command.link.*` / `tableBuilder.*`）は GROWI がサポートする全ロケール（`en_US`/`ja_JP`/`fr_FR`/`ko_KR`/`zh_CN`）に追加する**（基盤の Req 7.3 に合わせる。drawio/lsx/callout の既存キーが en/ja のみである点は本スペックの既存スコープであり、本追記の対象外）。

## System Flows

### 静的挿入フロー（plantuml / callout / lsx）
基盤の挿入フローと同一。`apply` が `action.buildInsertion(view, from)` の `{ insert, cursorOffset, replaceFromOffset? }` から置換レンジ（既定は `/query` の `[from,to]`、`replaceFromOffset` があればその分だけ手前へ拡張）を置き換える単一 `dispatch` を発行。
- plantuml / callout はブロック要素のため、先行する非空白テキストがある場合はビルダーが区切り改行を前置する。
- **lsx は `$lsx()`（インラインディレクティブ）を挿入する**ため、区切り・行頭正規化を一切行わない位置非依存の挿入で、カーソルを `(` の直後に置く（`{ insert: '$lsx()', cursorOffset: '$lsx('.length }`）。行の途中・テーブルセル内・リスト項目内でもそのまま挿入できる。

### 副作用起動フロー（drawio）

```mermaid
sequenceDiagram
    participant U as User
    participant S as slash command source (基盤 apply)
    participant V as EditorView
    participant A as atom (drawio for editor)
    participant M as Modal (DrawioModal)

    U->>S: "/drawio" を選択
    S->>V: dispatch({changes:{from,to,insert:''}, selection:{anchor:from}})  // /query 削除（単一transaction）
    S->>S: action.run(view, from)
    S->>V: ensureBlockLineStart(view, from)  // 行頭でなければ改行を前置（ブロックを独立行へ）
    S->>A: open(editorKey)
    A-->>M: isOpened=true を購読
    M->>V: useCodeMirrorEditorIsolated(editorKey) で view 取得
    U->>M: 作図して確定
    M->>V: dispatch({changes:{from:pos,to:pos,insert: ```drawio…```}})  // 別transaction（行頭に挿入）
    M->>A: close()
    V-->>U: 要素挿入
```

- `run` は基盤の `apply` から呼ばれ、`editorKey` は合成フックが束縛済み。
- **行頭正規化（Req 5.4）**: スラッシュコマンドは「行頭または空白直後」で発火するため、`図: /drawio` のように行の途中でも起動しうる。この場合 `/query` 削除後のカーソルは行の途中に残り、モーダルが挿入する ` ```drawio ` フェンスが先行テキストと同一行に連結して**ブロックとして描画されない**。これを防ぐため、drawio の `run` はモーダルを開く**前**に共有ヘルパ `ensureBlockLineStart(view, from)` を呼び、`from` が行頭でなければ改行を前置してカーソルを新しい空行へ移す。以降モーダルはその行頭位置に挿入する（テーブルビルダーも同じ理由で呼ぶ）。
  - **配置理由**: 行頭正規化を**拡張側の `run` に置く**ことで、基盤 `apply` は「run は副作用」以上を仮定せず汎用のまま保て、かつ既存 drawio モーダル本体（out of boundary）を改修せずに drawio（およびテーブルビルダー）を正しくできる。
  - **トレードオフ**: `ensureBlockLineStart` は起動前に改行を挿入するため、モーダルを**キャンセル**すると空行が1行残りうる（許容。MVP）。
- `/query` 削除（基盤・単一トランザクション・undo 可）と行頭正規化・モーダルの挿入はそれぞれ別トランザクション。キャンセル時はモーダル挿入が発生しない（`/query` 削除＋場合により空行が残るのみ）。
- **リンク / テーブルビルダーも同じ `run` フロー**に従うが、上図と2点だけ異なる: (1) オープナーに `editorKey` ではなく `run` が受け取る `view` を直接渡す（`useCodeMirrorEditorIsolated` による再解決が不要）、(2) テーブルビルダー（ブロック）は `ensureBlockLineStart` を呼ぶが、**リンク（インライン）は呼ばない**（行の途中で起動してもその位置に挿入されるのが正しい。Req 9.1）。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | drawio/plantuml/lsx/callout 提供 | static-commands, use-extended-element-commands | コマンド集合 | 合成 |
| 1.2 | drawio モーダル起動 | use-extended-element-commands | `run` → drawio open | 副作用起動 |
| 1.3 | plantuml フェンス挿入 | insertion-builders | `plantumlInsertion` | 静的挿入 |
| 1.4 | lsx 挿入 | insertion-builders, static-commands | `lsxInsertion` | 静的挿入 |
| 1.5 | callout 挿入 | static-commands, insertion-builders | `calloutInsertion` | 静的挿入 |
| 1.6 | リンクコマンド提供・起動 | use-extended-element-commands, 既存 LinkEditModal | → Req 9 参照 | 副作用起動 |
| 1.7 | テーブルビルダーコマンド提供・起動 | use-extended-element-commands, 既存 HandsontableModal | → Req 10 参照 | 副作用起動 |
| 1.8 | 未選択要素（math/mermaid/画像）は非提供 | static-commands / フック | 定義から除外 | — |
| 2.1–2.4 | drawio 起動・書き戻し・キャンセル・逆依存なし | use-extended-element-commands, 既存 DrawioModal | `useDrawioModalForEditorActions` | 副作用起動 |
| 3.1–3.3 | lsx の静的挿入・単一transaction・インライン（行頭正規化/`disallowedIn` なし） | insertion-builders, static-commands | `lsxInsertion` | 静的挿入 |
| 4.1–4.4 | callout 種別別・記法・データ駆動・絞り込み | callout-variants, static-commands | `CALLOUT_VARIANTS` | 静的挿入 |
| 5.1 | `/query` 削除 | 基盤 apply（再利用） | — | 両 |
| 5.2 | 静的挿入のカーソル/単一transaction/undo | insertion-builders + 基盤 apply | `SlashInsertion` | 静的挿入 |
| 5.3 | run は削除単一transaction後に起動 | 基盤 apply（run 分岐・実装済み） | `SlashRunAction`（実装済み・消費） | 副作用起動 |
| 5.4 | run は挿入位置を行頭へ正規化 | ensure-block-line-start, use-extended-element-commands | `ensureBlockLineStart` | 副作用起動 |
| 6.1–6.3 | 同一メニュー・絞り込み・起動条件 | 合成点 + 基盤 source | active command set | 起動 |
| 6.4 | list/table 内でブロック系拡張を除外 | 各拡張コマンドの `disallowedIn` + 基盤 `activeContextsAt` | `disallowedIn: ['list','table']` | 起動 |
| 7.1–7.2 | ラベル/説明 i18n・フォールバック | 各コマンド i18n キー + 基盤 resolve | locale JSON | — |
| 8.1 | 挿入/起動のみ・描画は既存機構 | insertion-builders / run | — | — |
| 8.2 | 絵文字/基本コマンドと共存 | 合成点（同一 autocompletion） | — | — |
| 8.3 | 既存 drawio モーダル不変 | use-extended-element-commands | 起動導線追加のみ | — |
| 8.4 | 既存 Edit Link Modal / Handsontable Modal 不変 | use-extended-element-commands | 起動導線追加のみ | — |
| 9.1–9.4 | リンクモーダル起動・書き戻し・キャンセル・逆依存なし | use-extended-element-commands, 既存 LinkEditModal | `useLinkEditModalActions`, `getMarkdownLink` | 副作用起動（インライン、行頭正規化なし） |
| 10.1–10.5 | テーブルビルダー起動・書き戻し・キャンセル・逆依存なし・基盤 table との共存 | use-extended-element-commands, 既存 HandsontableModal | `useHandsontableModalForEditorActions` | 副作用起動（ブロック、行頭正規化あり） |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies (P0/P1) | Contracts |
|-----------|--------------|--------|--------------|--------------------------|-----------|
| callout-variants | data | callout 変種の宣言リスト | 4.1, 4.3 | — | State |
| insertion-builders | logic | plantuml/callout/lsx の雛形（純粋） | 1.3, 1.5, 3.1, 3.2, 4.2, 5.2, 8.1 | 基盤 SlashInsertion 型 (P0) | Service |
| static-commands | data | plantuml + callout×7 + lsx（insert） | 1.1, 1.4, 1.5, 1.8, 3.1, 3.3, 4.1, 4.4 | builders (P0), variants (P0), 基盤 SlashCommand 型 (P0) | State |
| use-extended-element-commands | integration/logic | drawio/リンク/テーブルビルダー の run + 静的コマンド合成 | 1.1, 1.2, 2.1, 2.4, 9.1, 9.4, 10.1, 10.4 | drawio トリガー (P0), リンクユーティリティ (P0), テーブルビルダー トリガー (P0), static-commands (P0), ensure-block-line-start (P0) | Service |
| ensure-block-line-start | logic | run の挿入位置を行頭へ正規化（ブロック要素のみ使用） | 5.4 | `@codemirror/view` (P0) | Service |
| コマンド集合合成点（基盤側・変更） | integration | 拡張集合を基本コマンドへ合流 | 6.1, 8.2 | use-extended-element-commands (P0), 基盤 (P0) | Service |

### data

#### callout-variants
| Field | Detail |
|-------|--------|
| Intent | callout 変種をデータ宣言（種別 + 絞り込み別名） |
| Requirements | 4.1, 4.3 |

**Contracts**: State [x]

種別の**真実源は `@growi/core` に一本化**する。callout の種別リスト（`AllCallout` / `Callout` 型）は元々 `apps/app/src/features/callout/services/consts.ts` にあったが、これを `@growi/core`（`packages/core/src/consts/callout.ts`）へ移動し、apps/app の描画側と packages/editor のスラッシュコマンド側が**同一の定義を import** する（二重管理・drift を解消）。別名キーワード（`warn` 等）はスラッシュコマンド固有の絞り込み UX なので editor 側に持つ。

```typescript
// @growi/core（真実源。apps/app 描画側と共有）
export const AllCallout = ['note','tip','important','info','warning','danger','caution'] as const;
export type Callout = (typeof AllCallout)[number];

// packages/editor 側: AllCallout から変種メタ（絞り込み別名）を付与して宣言
import { AllCallout, type Callout } from '@growi/core'; // 実際の import 経路は core barrel に従う

const KEYWORDS: Record<Callout, readonly string[]> = {
  note: ['note'], tip: ['tip', 'hint'], important: ['important'],
  info: ['info', 'information'], warning: ['warning', 'warn'],
  danger: ['danger'], caution: ['caution'],
};
export interface CalloutVariant { readonly type: Callout; readonly keywords: readonly string[]; }
export const CALLOUT_VARIANTS: readonly CalloutVariant[] =
  AllCallout.map((type) => ({ type, keywords: [type, ...KEYWORDS[type]] }));
```
- **Single source of truth**: 種別の追加/削除は `@growi/core` の `AllCallout` の1箇所編集で完結し、描画側・スラッシュコマンド側の両方へ自動的に波及する（editor 側 `KEYWORDS` は `Record<Callout, …>` のため、型で網羅漏れを検出できる）。drift テストは不要。

### logic

#### insertion-builders
| Field | Detail |
|-------|--------|
| Intent | plantuml/callout/lsx の雛形（`SlashInsertion`）を返す純粋関数 |
| Requirements | 1.3, 1.5, 3.1, 3.2, 4.2, 5.2, 8.1 |

**Contracts**: Service [x]

```typescript
import type { EditorView } from '@codemirror/view';
import type { SlashInsertion } from '../slash-command-types'; // 基盤の型

// いずれも基盤の buildInsertion 契約 (view, from) => SlashInsertion に適合する。

// plantuml フェンス（@startuml/@enduml）。カーソルは中間の空行
export const plantumlInsertion: (view: EditorView, from: number) => SlashInsertion;

// callout ディレクティブ。`:::<type>` + 改行 + 本文行(空) + 改行 + `:::`。カーソルは本文行
export const calloutInsertion: (type: CalloutVariant['type']) => (view: EditorView, from: number) => SlashInsertion;

// lsx インラインディレクティブ。常に `$lsx()` を返し、カーソルを `(` の直後に置く（位置非依存）
export const lsxInsertion: (view: EditorView, from: number) => SlashInsertion;
// 実装は view/from に依存せず一定: { insert: '$lsx()', cursorOffset: '$lsx('.length }
```

- **雛形（確定）**:
  - plantuml: ` ```plantuml ` + 改行 + `@startuml` + 改行 + 空行 + `@enduml` + 改行 + ` ``` `。カーソルは中間の空行。
  - callout: `:::<type>` + 改行 + 空行（本文） + 改行 + `:::`。カーソルは本文の空行。
  - lsx: `$lsx()`。カーソルは `(` の直後（`cursorOffset = '$lsx('.length`）。
- **Preconditions**: `from` は `/` の位置。
- **Postconditions**: `{ insert, cursorOffset }`（`from` 相対）を返す。本スペックのビルダーはいずれも置換レンジを手前へ広げないため `replaceFromOffset` は使わない。`view.dispatch` しない。
- **行頭/行中の出し分け**: 基盤 design の方針に従い、ブロック要素は先行する非空白テキストがある場合に区切り（改行/空行）を前置する。callout / plantuml はブロック要素のため、先行行が非空のとき改行を前置する（テストで固定）。**lsx はインライン要素のため区切りを前置しない**（常に同一のインライン挿入で、`view`/`from` を参照しない）。
- **Invariants**: 副作用なし。

#### use-extended-element-commands
| Field | Detail |
|-------|--------|
| Intent | drawio/リンク/テーブルビルダー の `run` コマンドを生成し、静的コマンドと合成して返す React フック |
| Requirements | 1.1, 1.2, 2.1, 2.4, 9.1, 9.4, 10.1, 10.4 |

**Contracts**: Service [x]

```typescript
import type { EditorView } from '@codemirror/view';
import { useDrawioModalForEditorActions } from '../../../states/modal/drawio-for-editor';
import { useLinkEditModalActions } from '../../../states/modal/link-edit';
import { useHandsontableModalForEditorActions } from '../../../states/modal/handsontable';
import {
  getMarkdownLink,
  replaceFocusedMarkdownLinkWithEditor,
} from '../../link-util/markdown-link-util';
import { ensureBlockLineStart } from './ensure-block-line-start';
import type { SlashCommand } from '../slash-command-types';

export const useExtendedElementCommands = (editorKey: string): readonly SlashCommand[] => {
  const { open: openDrawio } = useDrawioModalForEditorActions();
  const { open: openLink } = useLinkEditModalActions();
  const { open: openTableBuilder } = useHandsontableModalForEditorActions();
  return useMemo(() => [
    { id: 'drawio', labelKey: 'slash_command.drawio.label', descriptionKey: 'slash_command.drawio.description',
      keywords: ['diagram', 'draw'],
      // ブロック要素: リスト項目内・テーブルセル内では構造を壊すため候補に出さない（基盤の disallowedIn）
      disallowedIn: ['list', 'table'],
      // 行頭正規化してからモーダルを開く（Req 5.4） — editorKey を束縛する必要がある（drawio 固有）
      action: { kind: 'run', run: (view: EditorView, from: number) => { ensureBlockLineStart(view, from); openDrawio(editorKey); } } },
    { id: 'link', labelKey: 'slash_command.link.label', descriptionKey: 'slash_command.link.description',
      keywords: ['url', 'href'],
      // インライン要素: disallowedIn なし（リスト項目内・テーブルセル内でも挿入可）。
      // 行頭正規化も不要（Req 9.1）。editorKey も不要 — `view` を直接渡す
      action: { kind: 'run', run: (view: EditorView) => {
        openLink(getMarkdownLink(view), (linkText) => replaceFocusedMarkdownLinkWithEditor(view, linkText));
      } } },
    { id: 'tableBuilder', labelKey: 'slash_command.tableBuilder.label', descriptionKey: 'slash_command.tableBuilder.description',
      keywords: ['table', 'grid', 'builder'],
      disallowedIn: ['list', 'table'], // ブロック要素（Markdown テーブル）
      // テーブルはブロック要素なので行頭正規化が必要（Req 10.1）。editorKey は不要 — `view` を直接渡す
      action: { kind: 'run', run: (view: EditorView, from: number) => { ensureBlockLineStart(view, from); openTableBuilder(view); } } },
    ...STATIC_EXTENDED_COMMANDS, // plantuml + callout×7 + lsx
  ], [editorKey, openDrawio, openLink, openTableBuilder]);
};
```
- **Preconditions**: `editorKey` は現在のエディタインスタンスのキー（合成点が取得。drawio のみが使用）。
- **Postconditions**: drawio/テーブルビルダーの `run` は `ensureBlockLineStart(view, from)` で挿入位置を行頭へ正規化したうえでオープナーを呼ぶ（ブロック要素）。リンクの `run` は正規化せず `view` をそのまま使う（インライン要素）。drawio は `editorKey` を渡し、リンク/テーブルビルダーは `view`（または `getMarkdownLink(view)` 等の派生値）を渡す — いずれも挿入自体はモーダル/コールバックがカーソル位置に対して行う。lsx は `run` を持たず `STATIC_EXTENDED_COMMANDS` 側の insert コマンドとして合流する。
- **Invariants**: `STATIC_EXTENDED_COMMANDS`（plantuml + callout + lsx）は副作用を持たないデータ。

#### ensure-block-line-start
| Field | Detail |
|-------|--------|
| Intent | run コマンドがモーダルを開く前に、ブロック要素の挿入位置を行頭へ正規化する（Req 5.4）。**ブロック要素（drawio/テーブルビルダー）のみ使用**し、インライン要素（リンク/lsx）は使わない |
| Requirements | 5.4 |

**Contracts**: Service [x]

```typescript
import type { EditorView } from '@codemirror/view';

/**
 * `pos` が行頭（同一行に先行する非空白テキストがない）でなければ、`pos` に改行を挿入して
 * カーソルを新しい空行の先頭へ移す。行頭ならなにもしない。以降のブロック挿入が独立行に置かれることを保証する。
 */
export const ensureBlockLineStart: (view: EditorView, pos: number) => void;
```
- **Preconditions**: `pos` は `/query` 削除後のカーソル位置（＝ 基盤 `apply` の `from`）。
- **Postconditions**: 行頭でなければ `\n` を1つ挿入しカーソルを新行先頭へ。行頭ならドキュメント不変。
- **Invariants**: `view.dispatch` を最大1回。既存 drawio モーダル本体には手を入れない（正規化はこのヘルパに閉じる）。
- **Trade-off**: 起動前に挿入するため、モーダルキャンセル時に空行が残りうる（許容・MVP）。

#### static-commands
| Field | Detail |
|-------|--------|
| Intent | plantuml + callout×7 + lsx の insert コマンドを宣言 |
| Requirements | 1.1, 1.4, 1.5, 1.8, 3.1, 3.3, 4.1, 4.4 |

```typescript
export const STATIC_EXTENDED_COMMANDS: readonly SlashCommand[] = [
  { id: 'plantuml', labelKey: 'slash_command.plantuml.label', descriptionKey: 'slash_command.plantuml.description',
    keywords: ['uml', 'sequence'],
    disallowedIn: ['list', 'table'], // フェンスはブロック要素（基盤 codeBlock と同じ扱い）
    action: { kind: 'insert', buildInsertion: plantumlInsertion } },
  ...CALLOUT_VARIANTS.map((v) => ({
    id: `callout-${v.type}`,
    labelKey: `slash_command.callout.${v.type}.label`,
    descriptionKey: `slash_command.callout.${v.type}.description`,
    keywords: ['callout', ...v.keywords],
    disallowedIn: ['list', 'table'], // `:::` ディレクティブはブロック要素
    action: { kind: 'insert', buildInsertion: calloutInsertion(v.type) } as const,
  })),
  { id: 'lsx', labelKey: 'slash_command.lsx.label', descriptionKey: 'slash_command.lsx.description',
    keywords: ['ls', 'list', 'pages', 'tree'], // id が `lsx` なので `/ls`・`/lsx` の双方が前方一致で到達
    // インライン要素（$lsx() は Text/Leaf ディレクティブ）: disallowedIn を宣言しない（テーブルセル内・リスト項目内でも挿入可）
    action: { kind: 'insert', buildInsertion: lsxInsertion } },
];
```
- **Constraints**: callout は `CALLOUT_VARIANTS` からデータ駆動で生成（4.3）。`callout` を共通キーワードに含め `/callout` で全種別が絞り込まれる（4.4）。lsx は id `lsx`・`kind:'insert'`・`disallowedIn` なしのインライン挿入で、`/ls`・`/lsx` の双方から到達する（1.4, 3.1, 3.3）。未選択要素（math/mermaid）は含めない（1.8）。

### integration

#### コマンド集合合成点（基盤側・注入シームのみ）
| Field | Detail |
|-------|--------|
| Intent | 拡張コマンドを基本コマンドへ合流し、単一 `autocompletion()` に乗せる。基盤変更は本合成点の注入シームに限る（型・`apply` は不変） |
| Requirements | 6.1, 8.2 |

**Implementation Notes**
- 変更範囲: 基盤の `resolveSlashCommands(t, commands = SLASH_COMMANDS)` と `createSlashCommandSource(commands)` は**既に work-set を引数で受ける**。現状の `use-default-extensions.ts` は `resolveSlashCommands(t)` を基盤コマンドのみで呼ぶため、**変更点はこの呼び出しに拡張コマンドを渡す注入シームを開ける1点のみ**（基盤の型・`apply`・source ロジックは触らない）。
- Integration: React レイヤで `const extended = useExtendedElementCommands(editorKey);` → `resolveSlashCommands(t, [...SLASH_COMMANDS, ...extended])` → `createSlashCommandSource(...)`。
- `editorKey` の取得（要確認）: 合成点（`use-default-extensions.ts`）が現状 `editorKey` を受け取れるかは未確認。受け取れない場合、`editorKey` を合成点まで通す配線が drawio の run に必須となる（リンク/テーブルビルダーは `view`、lsx は insert のため不要）。**実装タスク（3.1）で `use-default-extensions.ts` の現行シグネチャを確認し、必要なら `editorKey` を渡す配線を追加する**（drawio の `DiagramButton` が `editorKey` を prop で受けるのと同経路）。
- Validation: `/drawio`・`/lsx`・`/plantuml`・`/callout` が基本コマンドと同一メニューに現れ、絵文字補完と共存することをスモーク確認。drawio 選択でモーダルが開くこと、lsx 選択で `$lsx()` がインライン挿入されカーソルがカッコ内に来ること。リスト項目内・テーブルセル内でブロック系拡張コマンドが候補に出ないこと（`disallowedIn`）、同じ位置で lsx・リンクは候補に出ること。

## Error Handling
- 静的挿入（plantuml/callout/lsx）は静的文字列のため失敗経路なし（`buildInsertion` は常に有効な `SlashInsertion` を返す）。lsx は常に `$lsx()` を返す位置非依存の挿入で、オプションの妥当性はユーザーが手入力した文字列をサーバ側 list-pages が評価する（本スペックは `$lsx()` の挿入のみ）。
- run コマンド: `/query` 削除は基盤の単一トランザクション。ブロック要素（drawio/テーブルビルダー）で行の途中で起動された場合は `ensureBlockLineStart` が改行を1つ前置してブロックを独立行へ置く（Req 5.4）。リンク・lsx（インライン）はこの正規化を行わない。モーダル起動失敗・キャンセルはモーダル側の責務で、エディタには `/query` 削除（＋ブロック要素の場合は場合により空行1つ）のみが残る（要素は挿入されない）。
- リンクモーダル: カーソル位置に既存リンクが無い場合、`getMarkdownLink` は空の `Linker` を返し、モーダルは新規作成フォームとして開く（既存挙動、変更なし）。
- テーブルビルダー: カーソル位置に既存テーブルが無い場合、`getMarkdownTable` は `undefined` を返し、モーダルは空のテーブルから開始する（既存挙動、変更なし）。
- トリガー外・一致なし・キャンセルは基盤の Error Handling に従う。

## Testing Strategy

### Unit Tests
1. `plantumlInsertion`: `@startuml/@enduml` を含むフェンスを返し、カーソルが中間の空行（1.3, 5.2）。
2. `calloutInsertion('warning')` 等: `:::warning` … `:::` を返し、カーソルが本文行（1.5, 4.2, 5.2）。各種別で記法が正しいこと。
3. `CALLOUT_VARIANTS` / `STATIC_EXTENDED_COMMANDS`: 7 種の callout コマンドが生成され、各 id・i18n キー・`callout` 共通キーワードを持つこと。plantuml と lsx が含まれ、lsx は id `lsx`・`kind:'insert'`・`disallowedIn` 未宣言でキーワード `ls`/`lsx` から絞り込めること。未選択要素（math/mermaid）を含まないこと（1.1, 1.4, 1.8, 3.1, 3.3, 4.1, 4.3, 4.4）。
4. `useExtendedElementCommands`: drawio コマンドが `kind:'run'` を持ち、`run()` 呼出で `openDrawio` が `editorKey` 付きで呼ばれること（モックフックで検証）（1.2, 2.1）。リンクコマンドの `run()` 呼出で `getMarkdownLink(view)` が読まれ `openLink` が呼ばれ、その `onSave` 実行で `replaceFocusedMarkdownLinkWithEditor(view, linkText)` が呼ばれること（9.1, 9.2, 9.4）。テーブルビルダーコマンドの `run()` 呼出で `ensureBlockLineStart` が先に走り `openTableBuilder(view)` が `view` 付きで呼ばれること（10.1, 10.4）。
5. `lsxInsertion`: `view`/`from` によらず常に `$lsx()` を返し、`cursorOffset` が `(` の直後（`'$lsx('.length`）であること。区切り改行を前置しないこと（3.1, 3.2）。
6. `ensureBlockLineStart`: `pos` が行頭のときはドキュメント不変、行の途中（先行非空白あり）のときは改行を1つ前置しカーソルが新行先頭へ来ること（5.4）（jsdom + EditorState/EditorView）。
7. `STATIC_EXTENDED_COMMANDS` / 全コマンド集合: リンク・テーブルビルダーの id・i18n キー・キーワードが揃い、drawio/リンク/テーブルビルダーがいずれも `kind:'run'`、lsx が `kind:'insert'` であること。基盤の `table` コマンドと `tableBuilder` コマンドが**別 id として共存**すること（10.5）。

### Integration Tests
1. 合成点経由で `/drawio` `/plantuml` `/lsx` `/callout` が基本コマンドと同一の補完メニューに現れ、`/uml` で plantuml、`/warn` で warning callout が絞り込まれる（6.1, 6.2, 4.4）。
2. plantuml/callout/lsx 選択時、基盤 `apply` により `/query` が置換され単一トランザクションで挿入、undo 1 回で復元（5.1, 5.2, 3.2）。lsx は `$lsx()` が挿入されカーソルがカッコ内に来て、行の途中・テーブルセル内でも改行が入らないこと（3.1, 3.3）。
3. drawio/テーブルビルダー選択時、`/query` が削除され（単一トランザクション）、行の途中で起動した場合は行頭正規化が入ったうえで対応モーダルの起動 atom が立つこと（5.3, 5.4, 1.2, 10.1）。
4. リンク選択時、`/query` が削除され（単一トランザクション）、行の途中で起動しても行頭正規化されず**その位置に** Edit Link Modal 起動 atom が立つこと（9.1）。
5. 拡張コマンドが絵文字補完（`:`）と同時に機能する（8.2）。
6. 既存 drawio モーダル・Edit Link Modal・Handsontable Modal のツールバー起動・書き戻しが回帰しないこと（8.3, 8.4）。

### E2E/UI Tests（任意）
1. `/drawio` 選択 → drawio モーダルが開き、保存で ` ```drawio ` フェンスが挿入される（1.2, 2.2）。
2. `/lsx`（`/ls`）選択 → `$lsx()` が挿入されカーソルがカッコ内（`(` の直後）に来る（モーダルは開かない）（1.4, 3.1）。
3. `/callout` で全種別が候補表示され、`tip` 選択で `:::tip` が挿入されカーソルが本文行に来る（4.1, 4.2, 4.4）。
4. `/link` 選択 → Edit Link Modal が開き、確定でリンクがカーソル位置（行の途中でもその位置）に挿入される（9.1, 9.2）。
5. テーブルビルダーコマンド選択 → Handsontable Modal が開き、行列を設定して確定すると Markdown テーブルが挿入される。基盤の `table` コマンド（プレーンな2列テーブル即挿入）も別途選べ、両者が共存する（10.1, 10.2, 10.5）。
