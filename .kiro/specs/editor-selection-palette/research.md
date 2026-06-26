# Research & Design Decisions: editor-selection-palette

## Summary
- **Feature**: `editor-selection-palette`（アンブレラ `editor-commands` の子スペック）
- **Discovery Scope**: Extension（既存 CodeMirror エディタへの浮動 UI 追加）
- **Key Findings**:
  - `@codemirror/view ^6.42.1` が `showTooltip` facet と `Tooltip` 型を提供。選択監視は `EditorView.updateListener` / `StateField` の既存パターンが使える。選択駆動の浮動 UI は「StateField → showTooltip」パターンで実現可能。
  - 既存ツールバー（`TextFormatTools.tsx`）が `toolbar.bold` / `toolbar.italic` / `toolbar.strikethrough` / `toolbar.code` の i18n キーと `material-symbols-outlined` アイコンを既に使用。**パレットはこれらを再利用でき、新規 locale キーは不要**。
  - `toggleMarkdownSymbol(view, prefix, suffix)`（`markdown-utils`）が**トグル（適用/解除）**を実装済み。これは**基底ユーティリティで、基盤 `editor-slash-command` とは独立**。
  - **重要**: 上記により、パレットは「基底 `toggleMarkdownSymbol` + 既存 toolbar i18n + CM tooltip」だけで成立する。**MVP では基盤 `editor-slash-command` のコマンドレジストリに依存しない**。

## 検証済みの事実（コードベース実機確認）
- **tooltip API**: `@codemirror/view ^6.42.1`（`showTooltip` / `Tooltip` 利用可）。
- **選択監視パターン**: `EditorView.updateListener` + `update.selectionSet`（`unified-merge-view`, `use-show-table-icon` で使用実績）、`StateField`（複数箇所で使用）。
- **トグル関数**: `packages/editor/src/client/services-internal/markdown-utils/toggle-markdown-symbol.ts` の `toggleMarkdownSymbol(view, prefix, suffix)`。選択範囲が既に prefix/suffix で囲まれていれば解除、なければ付与。`view.dispatch` で通常トランザクションを発行。
- **i18n/アイコン**: `TextFormatTools.tsx` が `useTranslation('translation')` + `t('toolbar.bold')` 等 + `material-symbols-outlined`（`format_bold` 等）を使用。

## Requirement-to-Asset Map（ギャップタグ: Missing / Unknown / Constraint）

| Req | 必要技術要素 | 既存資産 | ギャップ |
|-----|-------------|----------|----------|
| 1.1, 1.2 | 非空選択で表示・空で非表示 | `showTooltip` + `StateField`、`selectionSet` | **Missing**: 選択駆動の tooltip StateField（新規） |
| 1.3 | 選択位置に追従 | CM tooltip は位置アンカーで自動再配置 | なし（標準挙動） |
| 1.4 | 操作のラベル/アイコン表示 | toolbar の i18n キー・material-symbols | **Missing**: パレット DOM ビルダー（新規）。i18n キーは再利用 |
| 2.1, 2.2 | 書式の適用/解除（トグル） | `toggleMarkdownSymbol`（基底・実在） | なし（再利用） |
| 2.3, 2.4 | 通常トランザクション・undo | `toggleMarkdownSymbol` が dispatch | なし |
| 3.1 | 選択解除で閉じる | StateField が null を返す | なし（field ロジック） |
| 3.2 | Escape で閉じる | keymap | **Missing**: Escape 時に閉じる（dismiss）機構。**Constraint**: パレット非表示時は Escape を消費せず通過させる |
| 3.3 | フォーカス喪失で閉じる | `domEventHandlers` blur | **Missing**: blur で閉じる機構 |
| 4.1, 4.2 | ラベル i18n・フォールバック | react-i18next + 既存 toolbar キー | **Constraint**: 拡張は非React→フックで `t` を注入 |
| 5.1 | slash/emoji と共存 | 別系統（tooltip ≠ autocomplete） | なし（独立拡張で干渉しない） |
| 5.2 | キーバインド不変 | — | **Constraint**: Escape 以外のキーを追加せず、Escape もパレット表示時のみ消費 |
| 5.3 | 協調編集整合 | 通常トランザクション | なし |

## 実装アプローチ評価

- **Option A（基盤レジストリを共有）**: パレット操作を基盤 `editor-slash-command` のレジストリ経由で取得。❌ slash の挿入コマンドと選択トグルは意味論が異なり、基盤未実装への依存が生じる。MVP には過剰結合。
- **Option B（独立モジュール・基底ユーティリティ再利用）＝推奨**: パレットは自前の小さな操作集合（4 操作）をデータ宣言し、`toggleMarkdownSymbol`（基底）と既存 toolbar i18n を再利用。基盤 slash レジストリに依存しない。✅ 独立実装・並行開発可・結合最小。
- **Option C（共通コマンド抽象を新設）**: slash と palette を統べる共通コマンド型を先に作る。❌ MVP には過剰。将来 palette に多数の操作や slash 共有が必要になったら検討。

→ **推奨 = Option B**。

## Design Decisions

### Decision: MVP では基盤 `editor-slash-command` に依存しない（独立実装）
- **Context**: roadmap は editor-selection-palette を「Dependencies: editor-slash-command」としていたが、これは「共有レジストリ」を前提とした想定。
- **Findings**: パレットは基底 `toggleMarkdownSymbol` + 既存 toolbar i18n + CM tooltip で完結し、slash レジストリを必要としない。
- **Selected Approach**: パレットは独立モジュールとして実装。基盤 slash の実装を待たずに着手可能。
- **Trade-offs**: 将来 palette と slash で操作定義を共有したくなった場合、共通コマンド抽象への寄せが別途必要（roadmap "Shared seams to watch" の長期検討事項）。
- **Follow-up**: roadmap の本スペックの依存を「Dependencies: none（MVP・umbrella 概念上の所属は維持）」に更新することを推奨。

### Decision: 選択駆動 tooltip（StateField → showTooltip）
- **Selected Approach**: 各トランザクションで選択範囲と dismiss/blur 状態から `Tooltip | null` を算出する `StateField` を持ち、`showTooltip` facet に供給。`create(view)` でパレット DOM を構築。
- **Rationale**: CM 標準の cursor-tooltip パターン。位置追従（Req 1.3）が標準で得られる。

### Decision: 操作はデータ宣言、i18n キーは toolbar.* を再利用
- **Selected Approach**: `PALETTE_OPERATIONS`（bold/italic/strikethrough/code）を `{ id, labelKey, icon, prefix, suffix }` で宣言。labelKey は既存 `toolbar.bold` 等。
- **Rationale**: 新規 locale キー不要、ツールバーと表記一貫。データ駆動で操作追加が容易。

## Risks & Mitigations
- **Escape のキー競合** — パレット非表示時にも Escape を消費すると既存挙動を壊す。→ keymap はパレット表示時のみ `true` を返し、非表示時は `false`（通過）。
- **blur と再フォーカス** — クリック操作の瞬間に blur 扱いで閉じないよう、パレット内クリックは blur 対象から除外する（実装時に確認）。
- **i18n 実行時切替** — フックで `t` を注入するため、言語切替は再構成が必要。MVP は初期言語で解決（slash と同方針）。

## Design Synthesis
- **Generalization**: パレット操作は `toggleMarkdownSymbol` の (prefix, suffix) の特殊化に過ぎず、データ宣言で表現できる（新抽象不要）。
- **Build vs Adopt**: tooltip = CM `showTooltip` を adopt、書式適用 = 基底 `toggleMarkdownSymbol` を adopt、i18n/アイコン = 既存 toolbar を adopt。新規作成は「選択駆動 field + パレット DOM + 開閉ライフサイクル」のみ。
- **Simplification**: 基盤 slash レジストリへの依存を排し、独立実装に単純化。新規依存ライブラリゼロ。

## References
- `@codemirror/view` `showTooltip` / `Tooltip`、`@codemirror/state` `StateField` / `StateEffect`
- `packages/editor/src/client/services-internal/markdown-utils/toggle-markdown-symbol.ts`
- `packages/editor/src/client/components-internal/CodeMirrorEditor/Toolbar/TextFormatTools.tsx`（i18n キー・アイコンの参照元）
- `.kiro/steering/roadmap.md`（アンブレラ・共有 seam）

---

# Gap Analysis 追検証（`/kiro-validate-gap` 再実行・blur/focus リスクの確定）

設計の Risks「blur で閉じる vs パレット内クリックで閉じない」を実コードで検証した。

## 検証結果
- **`showTooltip` の既存利用はエディタ内にゼロ**（`grep showTooltip packages/editor/src` → 0 件）。インタラクティブな浮動 UI の focus/blur 処理は前例がなく、本スペックで**明示的に実装する必要がある**（グリーンフィールド）。
- **`toggleMarkdownSymbol` は末尾で `view.focus()` を呼ぶ**（`toggle-markdown-symbol.ts:32`）。→ パレットのボタンで書式適用後、フォーカスはエディタへ自動的に戻る。
- **focus 判定の前例あり**: `y-rich-cursors/local-cursor.ts:29` が `view.hasFocus && view.dom.ownerDocument.hasFocus()` で「真にフォーカスを失ったか」を判定。blur クローズ判定にこのパターンを流用できる。

## 確定する実装方針（設計の Risks を解消）
- **パレット内クリックで閉じない**: パレット DOM のボタンに `mousedown` の `preventDefault()` を付け、クリック時にエディタが blur しないようにする（CM の標準対処）。これにより blur クローズ（Req 3.3）とボタン操作（Req 2.1）が両立する。
- **blur クローズ**: 真の blur（ドキュメント側でフォーカスが外れた）でのみ `dismissPaletteEffect(true)` を発行する（`document.hasFocus()` 併用）。
- 適用後の再フォーカスは `toggleMarkdownSymbol` 内の `view.focus()` に委ねる（追加実装不要）。

## 状態
- 本スペックのギャップ・リスクは解消。残ギャップなし。新規依存ゼロ。
- roadmap 反映推奨（依存 none 化）は design.md「roadmap への反映推奨」のとおり未対応のまま（ユーザー判断待ち）。
