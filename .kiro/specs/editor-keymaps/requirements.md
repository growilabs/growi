# Requirements Document

## Introduction

GROWI のエディタは CodeMirror 6 をベースに、4 つのキーマップモード（default, vscode, vim, emacs）をサポートしている。本仕様では以下の 2 つの目的を達成する:

1. **モジュール構成のリファクタリング**: 各キーマップモードの責務・モジュール境界を整理し、一貫性のあるクリーンなアーキテクチャにリファクタする
2. **Emacs キーバインディングの拡充**: PR #10980 で導入された Emacs markdown-mode バインディング（`C-c C-s` プレフィックス）を拡張し、本家 [jrblevin/markdown-mode](https://github.com/jrblevin/markdown-mode) を参考にした網羅的な Markdown 操作バインディングを提供する

### Priority Order

- **高優先**: Requirement 1-3 (モジュールリファクタリング) → Requirement 6-7 (save/vim 一貫性) → Requirement 8 (UI)
- **中優先**: Requirement 4 (既存 formatting bindings の維持)
- **低優先**: Requirement 5, 9 (追加 Emacs バインディング) — 本家 markdown-mode 準拠の拡充は最後に対応

### Current State (PR #10980)

- `packages/editor/src/client/services-internal/keymaps/` に vim.ts, emacs.ts が存在し、index.ts がディスパッチャ
- default と vscode は index.ts 内でインラインに処理されており、独立モジュールがない
- `toggleMarkdownSymbol` が emacs.ts 内にローカル実装されており、既存の `generateAddMarkdownSymbolCommand` / `useInsertMarkdownElements` と責務が重複
- `use-editor-shortcuts.ts` が emacs モード判定のための条件分岐を持ち、各キーマップの差異を外部から管理している
- Emacs モードでは formatting 系ショートカット（bold, italic, strikethrough, code）のみ C-c C-s で提供、リスト・引用・リンク等は未対応

### Reference: jrblevin/markdown-mode Keybindings

本家 Emacs markdown-mode の主要キーバインド（実装対象の参照用）:

**Text Styling (C-c C-s)**
| Key | Command |
|-----|---------|
| `C-c C-s i` | Italic |
| `C-c C-s b` | Bold |
| `C-c C-s c` | Inline code |
| `C-c C-s k` | `<kbd>` tag |
| `C-c C-s q` / `C-c C-s Q` | Blockquote (word / region) |
| `C-c C-s p` / `C-c C-s P` | Preformatted code block (word / region) |
| `C-c C-s C` | GFM fenced code block |
| `C-c C-s s` | Strikethrough (GROWI extension, not in original) |

**Headings (C-c C-s)**
| Key | Command |
|-----|---------|
| `C-c C-s h` / `C-c C-s H` | Auto heading (atx / setext) |
| `C-c C-s 1` ~ `C-c C-s 6` | ATX heading level 1-6 |
| `C-c C-s !` | Setext heading level 1 |
| `C-c C-s @` | Setext heading level 2 |

**Links & Images (C-c C-)**
| Key | Command |
|-----|---------|
| `C-c C-l` | Insert/edit link |
| `C-c C-i` | Insert/edit image |

**Horizontal Rule & Footnotes (C-c C-s)**
| Key | Command |
|-----|---------|
| `C-c C-s -` | Horizontal rule |
| `C-c C-s f` | Footnote |
| `C-c C-s w` | Wiki link |
| `C-c C-s t` | Table |

**Promotion & Demotion**
| Key | Command |
|-----|---------|
| `C-c C--` / `C-c LEFT` | Promote (outdent) |
| `C-c C-=` / `C-c RIGHT` | Demote (indent) |

**List Editing**
| Key | Command |
|-----|---------|
| `M-RET` / `C-c C-j` | New list item |
| `C-c UP/DOWN` | Move list item up/down |

**Outline Navigation**
| Key | Command |
|-----|---------|
| `C-c C-n` / `C-c C-p` | Next/previous heading (any level) |
| `C-c C-f` / `C-c C-b` | Next/previous heading (same level) |
| `C-c C-u` | Up to parent heading |

**Other**
| Key | Command |
|-----|---------|
| `C-c C-k` | Kill element at point |
| `C-c C-o` | Open link at point |
| `C-c C-x C-s` / `C-x C-s` | Save |

## Requirements

### Requirement 1: Uniform Keymap Module Structure

**Objective:** As a developer, I want each keymap mode to have a consistent module structure, so that adding or modifying keymaps follows a predictable pattern and reduces coupling.

#### Acceptance Criteria

1. The Editor shall provide a dedicated module file for each keymap mode (default, vscode, vim, emacs) under `keymaps/` directory.
2. When a keymap mode is loaded, the Keymap Dispatcher shall delegate to the corresponding module via the same async factory interface (`() => Promise<Extension>`).
3. The Editor shall not contain inline keymap construction logic in the dispatcher; all mode-specific logic shall reside in each mode's dedicated module.
4. Each keymap module shall encapsulate its own precedence requirement (high/low) so that the consumer does not need mode-specific branching for precedence.

### Requirement 2: Shared Markdown Formatting Utility

**Objective:** As a developer, I want markdown symbol toggling logic to be shared across keymap modules and editor shortcuts, so that formatting behavior is consistent and not duplicated.

#### Acceptance Criteria

1. The Editor shall provide a single shared utility for toggling markdown symbols (wrap/unwrap with prefix/suffix) that can be used by both keymap modules and editor shortcut hooks.
2. When the Emacs keymap module applies markdown formatting, the Editor shall use the same toggling logic as the standard editor shortcuts.
3. The Editor shall not have duplicate implementations of markdown symbol toggling in separate modules.

### Requirement 3: Keymap-Aware Shortcut Registration

**Objective:** As a developer, I want each keymap module to declare which standard shortcuts it overrides, so that the shortcut registration layer can exclude conflicts without hard-coded mode checks.

#### Acceptance Criteria

1. Each keymap module shall declare which categories of editor shortcuts it handles internally (e.g., formatting, navigation).
2. When editor shortcuts are registered, the Shortcut Registration Hook shall consult the active keymap's declared overrides to exclude conflicting bindings.
3. If a new keymap mode is added, the Shortcut Registration Hook shall not require code changes to handle the new mode's overrides.

### Requirement 4: Emacs Markdown-Mode Formatting Bindings (Existing)

**Objective:** As an Emacs user, I want C-c C-s prefix keybindings for markdown formatting, so that I can use familiar Emacs markdown-mode conventions in the GROWI editor.

#### Acceptance Criteria

1. While Emacs keymap mode is active, when the user types `C-c C-s b` or `C-c C-s B`, the Editor shall toggle bold formatting (`**`) around the selection or at the cursor.
2. While Emacs keymap mode is active, when the user types `C-c C-s i` or `C-c C-s I`, the Editor shall toggle italic formatting (`*`) around the selection or at the cursor.
3. While Emacs keymap mode is active, when the user types `C-c C-s c`, the Editor shall toggle inline code formatting (`` ` ``) around the selection or at the cursor.
4. While Emacs keymap mode is active, when the user types `C-c C-s s`, the Editor shall toggle strikethrough formatting (`~~`) around the selection or at the cursor.
5. While Emacs keymap mode is active, when the user types `C-c C-s p`, the Editor shall toggle code block formatting (` ``` `) around the selection or at the cursor.

### Requirement 5: Emacs Structural Editing Bindings

**Objective:** As an Emacs user, I want C-c prefix keybindings for structural markdown operations (lists, blockquotes, links, headings), so that I can perform all common markdown editing without leaving Emacs-style key sequences.

#### Acceptance Criteria

1. While Emacs keymap mode is active, when the user types `C-c C-s q`, the Editor shall insert or toggle a blockquote prefix (`>`) on the current line, consistent with markdown-mode `markdown-insert-blockquote`.
2. While Emacs keymap mode is active, when the user types `C-c C-l`, the Editor shall insert a markdown link template (`[]()`) around the selection or at the cursor, consistent with markdown-mode `markdown-insert-link`.
3. While Emacs keymap mode is active, when the user types `C-c C-s -`, the Editor shall insert a horizontal rule (`---`) at the current line, consistent with markdown-mode `markdown-insert-hr`.
4. While Emacs keymap mode is active, when the user types `C-c C-s h`, the Editor shall insert an ATX heading with auto-determined level based on context, consistent with markdown-mode `markdown-insert-header-dwim`.
5. While Emacs keymap mode is active, when the user types `C-c C-s 1` through `C-c C-s 6`, the Editor shall insert or replace the corresponding heading level (`#` through `######`) at the beginning of the current line.
6. While Emacs keymap mode is active, when the user types `C-c C-j`, the Editor shall insert a new list item appropriate to the current list context (bullet or numbered).
7. While Emacs keymap mode is active, when the user types `C-c C-s C`, the Editor shall insert a GFM-style fenced code block with language specifier prompt.

### Requirement 6: Emacs Save Binding

**Objective:** As an Emacs user, I want `C-x C-s` to save the page, so that the standard Emacs save keybinding works in the GROWI editor.

#### Acceptance Criteria

1. While Emacs keymap mode is active, when the user types `C-x C-s`, the Editor shall invoke the save action (same as the existing onSave callback used by Vim's `:w`).
2. If no save callback is provided, the Editor shall silently ignore `C-x C-s` without error.

### Requirement 7: Vim Keymap Module Consistency

**Objective:** As a developer, I want the Vim keymap module to follow the same structural pattern as other keymap modules, so that the codebase is consistent.

#### Acceptance Criteria

1. The Vim keymap module shall follow the same factory interface pattern as all other keymap modules.
2. The Vim keymap module shall encapsulate its top-level side effects (e.g., `Vim.map` calls) within the factory function rather than at module scope.

### Requirement 8: Keymap Selection UI Consistency

**Objective:** As a user, I want the keymap selector UI to accurately represent all available keymap modes, so that I can choose my preferred editing style.

#### Acceptance Criteria

1. The Keymap Selector shall display all registered keymap modes with appropriate labels and icons.
2. When the user selects a keymap mode, the Editor shall switch to that mode without requiring a page reload.
3. The Editor shall persist the selected keymap mode across sessions.

### Requirement 9: Emacs Extended Markdown-Mode Bindings

**Objective:** As an Emacs power user, I want additional markdown-mode keybindings for navigation, promotion/demotion, and advanced editing, so that the GROWI editor feels as close to native Emacs markdown-mode as possible.

#### Acceptance Criteria

1. While Emacs keymap mode is active, when the user types `C-c C--`, the Editor shall promote (outdent) the current element (heading level decrease or list outdent).
2. While Emacs keymap mode is active, when the user types `C-c C-=`, the Editor shall demote (indent) the current element (heading level increase or list indent).
3. While Emacs keymap mode is active, when the user types `C-c C-n` / `C-c C-p`, the Editor shall navigate to the next/previous heading.
4. While Emacs keymap mode is active, when the user types `C-c C-f` / `C-c C-b`, the Editor shall navigate to the next/previous heading at the same level.
5. While Emacs keymap mode is active, when the user types `C-c C-u`, the Editor shall navigate up to the parent heading.
6. While Emacs keymap mode is active, when the user types `C-c C-k`, the Editor shall kill (delete) the element at point and add text content to the clipboard.
7. While Emacs keymap mode is active, when the user types `C-c C-i`, the Editor shall insert a markdown image template (`![]()`).
8. While Emacs keymap mode is active, when the user types `C-c C-s t`, the Editor shall insert a markdown table template.
9. While Emacs keymap mode is active, when the user types `C-c C-s f`, the Editor shall insert a footnote marker and definition pair.
