# Research & Design Decisions

## Summary
- **Feature**: editor-keymaps
- **Discovery Scope**: Extension (existing keymap system)
- **Key Findings**:
  - `@replit/codemirror-emacs` EmacsHandler supports multi-stroke key chains natively via `bindKey` and `addCommands`; no C-x C-s save built-in
  - Existing `toggleMarkdownSymbol` in emacs.ts duplicates logic from `useInsertMarkdownElements` hook; both perform wrap/unwrap but with different APIs (EditorView direct vs hook-based)
  - Current dispatcher (`getKeymap`) mixes mode-specific concerns (inline vscode/default construction, precedence branching in consumer)

## Research Log

### @replit/codemirror-emacs API Surface
- **Context**: Need to understand what multi-stroke bindings are possible for C-c C-s, C-c C-, C-x C-s
- **Sources Consulted**: `node_modules/@replit/codemirror-emacs/dist/index.d.ts`, compiled source
- **Findings**:
  - `EmacsHandler.bindKey(keyGroup: string, command: any)` supports pipe-separated alternatives and multi-stroke chains
  - `EmacsHandler.addCommands(commands: object)` registers named commands; command receives `{ view: EditorView }`
  - Key chain state tracked via `$data.keyChain`; intermediate keys store `null` in binding map
  - Built-in bindings include C-k (kill line), C-w (kill region), C-y (yank), C-Space (set mark), but NOT C-x C-s
  - Package version: 6.1.0
- **Implications**: C-x C-s must be explicitly registered. All proposed Emacs bindings are achievable via the existing API.

### Markdown Symbol Toggle Duplication
- **Context**: emacs.ts has `toggleMarkdownSymbol(view, prefix, suffix)` while editor-shortcuts use `useInsertMarkdownElements` hook
- **Sources Consulted**: `insert-markdown-elements.ts`, `emacs.ts`, `generate-add-markdown-symbol-command.ts`
- **Findings**:
  - `useInsertMarkdownElements` is a React hook returning `(prefix: string, suffix: string) => void`
  - `toggleMarkdownSymbol` is a pure function taking `(view: EditorView, prefix: string, suffix: string) => void`
  - Both implement wrap/unwrap toggle logic but with slightly different selection handling
  - Emacs commands receive handler object with `view` property, not a React context
  - Hook-based approach cannot be used inside `EmacsHandler.addCommands` since it's not a React component
- **Implications**: Need a shared pure function (non-hook) that both the hook and Emacs commands can use. The hook wraps the pure function; Emacs calls it directly.

### Prefix Insertion for Structural Bindings
- **Context**: Need to support blockquote, list, heading insertion from Emacs commands
- **Sources Consulted**: `insert-prefix.ts`, `insert-blockquote.ts`, `insert-numbered-list.ts`
- **Findings**:
  - `useInsertPrefix` is also a React hook: `(prefix: string, noSpaceIfPrefixExists?: boolean) => void`
  - Handles multi-line selections, indentation-aware
  - Same constraint: cannot be used inside EmacsHandler commands directly
- **Implications**: Need pure function extraction for prefix operations too, callable with EditorView directly.

### Precedence Architecture
- **Context**: Emacs/Vim use Prec.high, default/vscode use Prec.low; currently branched in consumer
- **Sources Consulted**: `use-editor-settings.ts` lines 87-99
- **Findings**:
  - Emacs/Vim use ViewPlugin DOM event handlers intercepting at keydown level
  - Must run before CodeMirror's keymap handler to avoid Mac Ctrl-* and completionKeymap conflicts
  - VSCode/default use `keymap.of()` which integrates with CodeMirror's handler directly
- **Implications**: Precedence is inherent to the keymap type. Encapsulating it in the module return value eliminates consumer branching.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: Return-object factory | Each module returns `{ extension, precedence, overrides }` | Clean interface, no consumer branching | Slightly more complex return type | Preferred |
| B: Pre-wrapped extension | Each module returns `Prec.high(extension)` directly | Simplest consumer code | Consumer loses control over precedence | Less flexible |
| C: Config registry | Central registry maps mode → config | Extensible | Over-engineering for 4 modes | Rejected |

## Design Decisions

### Decision: Pure Function Extraction for Markdown Operations
- **Context**: Emacs commands need markdown toggle/prefix but can't use React hooks
- **Alternatives Considered**:
  1. Extract pure functions from hooks, hooks become thin wrappers
  2. Create entirely new utility functions for Emacs
  3. Use CodeMirror commands directly in Emacs module
- **Selected Approach**: Option 1 — Extract pure functions, hooks wrap them
- **Rationale**: Eliminates duplication, both hooks and Emacs commands share the same logic
- **Trade-offs**: Slight refactoring of existing hooks, but no behavioral change
- **Follow-up**: Verify existing tests still pass after extraction

### Decision: Factory Return Object Pattern
- **Context**: Need to encapsulate precedence and override declarations per keymap
- **Alternatives Considered**:
  1. Return `{ extension, precedence, overrides }` object
  2. Return pre-wrapped extension with separate metadata query
- **Selected Approach**: Option 1 — Structured return object
- **Rationale**: Single source of truth per keymap; consumer code becomes a simple loop
- **Trade-offs**: Breaking change to getKeymap interface, but internal-only API

### Decision: Override Categories for Shortcut Exclusion
- **Context**: Need to replace `if (keymapModeName === 'emacs')` hard-coding
- **Selected Approach**: Each keymap declares `overrides: ShortcutCategory[]` where categories are `'formatting' | 'navigation' | 'structural'`
- **Rationale**: New keymaps can declare their overrides without modifying shortcut registration code
- **Binding Mechanism**: `CategorizedKeyBindings` wrapper type groups `KeyBinding[]` with a `category` field, allowing `useEditorShortcuts` to filter by category match against overrides

### Decision: Emacs Submodule Split
- **Context**: emacs.ts accumulates 19+ commands spanning formatting, structural, navigation, and save — low cohesion
- **Alternatives Considered**:
  1. Single file with sections (current approach)
  2. Split into `emacs/` directory with submodules per responsibility
  3. Split by binding prefix (C-c C-s vs C-c C-)
- **Selected Approach**: Option 2 — submodules by responsibility (formatting, structural, navigation)
- **Rationale**: Each submodule has a single reason to change. Adding a new heading command only touches structural.ts. Adding navigation only touches navigation.ts.
- **Trade-offs**: More files, but each is small (<80 lines) and focused

### Decision: Relocate editor-shortcuts to services-internal
- **Context**: `editor-shortcuts/` is currently under `services/use-codemirror-editor/utils/` (public layer) but is never exported — only consumed by `stores/use-editor-shortcuts.ts`
- **Alternatives Considered**:
  1. Keep in services/, add explicit non-export marker
  2. Move to services-internal/editor-shortcuts/
  3. Inline into stores/use-editor-shortcuts.ts
- **Selected Approach**: Option 2 — move to services-internal/
- **Rationale**: Aligns actual visibility with directory convention. services/ = public API, services-internal/ = internal only. The shortcut definitions are internal implementation details that should not be importable by external consumers.
- **Trade-offs**: Requires updating import paths in use-editor-shortcuts.ts and any internal consumers
- **Follow-up**: Verify no external package imports from this path

## Risks & Mitigations
- EmacsHandler.addCommands is called at module load time (static method); ensure idempotency if module is re-imported → Mitigation: guard with registration flag
- Multi-stroke key chains may conflict with browser shortcuts on some platforms → Mitigation: Test on Mac/Windows/Linux; C-c C-s prefix is safe since C-c alone is intercepted by Emacs plugin
- Pure function extraction may subtly change selection behavior → Mitigation: Write unit tests for toggle behavior before refactoring

## References
- [@replit/codemirror-emacs](https://github.com/nicknisi/replit-codemirror-emacs) — v6.1.0, EmacsHandler API
- [jrblevin/markdown-mode](https://github.com/jrblevin/markdown-mode) — Reference for Emacs markdown-mode keybindings
- [CodeMirror 6 Keymap API](https://codemirror.net/docs/ref/#view.keymap) — Precedence and extension system
