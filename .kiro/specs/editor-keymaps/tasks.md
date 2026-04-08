# Implementation Plan

- [x] 1. Extract shared markdown utility functions
- [x] 1.1 Create the toggle markdown symbol utility
  - Extract the inline markdown wrap/unwrap logic from the current Emacs keymap module into a standalone pure function
  - Handle three cases: wrap selection, unwrap existing symbols, and insert empty symbols with cursor positioning
  - Ensure no React or hook dependencies — pure CodeMirror state/view operations only
  - _Requirements: 2.1, 2.3_

- [x] 1.2 (P) Create the line prefix utility
  - Extract line-prefix insertion logic into a standalone pure function alongside the toggle utility
  - Support single-line and multi-line selections, toggle-off when all lines already have the prefix
  - _Requirements: 2.1_

- [x] 1.3 Rewire existing public hooks to delegate to the new shared utilities
  - Update the insert-markdown-elements hook to become a thin wrapper calling the shared toggle function
  - Update the insert-prefix hook to delegate to the shared line-prefix function
  - Verify that existing editor behavior (bold, italic, etc. via toolbar/shortcuts) remains unchanged
  - _Requirements: 2.2, 2.3_

- [x] 2. Define keymap type system and refactor the dispatcher
- [x] 2.1 Define the keymap result interface, factory type, and shortcut category types
  - Introduce a structured return type that bundles extension, precedence wrapper, and override category declarations
  - Define the shortcut category union type and the categorized key-bindings grouping type
  - Place all types in a dedicated types module within the keymaps directory
  - _Requirements: 1.2, 1.4, 3.1_

- [x] 2.2 Simplify the keymap dispatcher to a thin router
  - Remove all inline keymap construction logic (default and vscode mode handling) from the dispatcher
  - Replace with a simple switch that delegates to each mode's factory function
  - Ensure the dispatcher returns the structured keymap result to callers
  - _Requirements: 1.2, 1.3_

- [x] 3. Create dedicated keymap modules for each mode
- [x] 3.1 (P) Create the default keymap module
  - Implement as an async factory returning the standard CodeMirror default keymap with low precedence and no overrides
  - _Requirements: 1.1_

- [x] 3.2 (P) Create the VSCode keymap module
  - Implement as an async factory returning the VSCode keymap extension with low precedence and no overrides
  - _Requirements: 1.1_

- [x] 3.3 Refactor the Vim keymap module for structural consistency
  - Move top-level side effects (key mappings like jj/jk escape, :w ex-command) inside the factory function
  - Add an idempotency guard to prevent duplicate registration on re-import
  - Return high precedence and empty overrides (Vim uses its own modal system)
  - Accept the optional onSave callback and register `:w` ex-command when provided
  - _Requirements: 1.1, 7.1, 7.2_

- [x] 4. Build the Emacs keymap module with formatting submodule
- [x] 4.1 Create the Emacs module structure and factory entry point
  - Set up the Emacs subdirectory with an index module that dynamically imports the Emacs extension
  - The factory composes all submodule registrations, registers save binding, and returns high precedence with formatting and structural overrides declared
  - _Requirements: 1.1, 1.4_

- [x] 4.2 Implement the formatting bindings submodule
  - Register C-c C-s prefix bindings for bold, italic, inline code, strikethrough, and code block
  - Delegate all formatting operations to the shared toggle-markdown-symbol utility
  - Support both lowercase and uppercase variants where specified (bold: b/B, italic: i/I)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5. Relocate editor shortcuts and introduce category-based grouping
- [x] 5.1 Move the editor-shortcuts directory from the public services layer to services-internal
  - Physically relocate the directory and update all import paths in the consuming store module (10 imports)
  - Verify build passes after relocation
  - _Requirements: 3.2_

- [x] 5.2 Wrap each shortcut group with categorized key-bindings metadata
  - Group formatting shortcuts (bold, italic, strikethrough, code) under the formatting category
  - Group structural shortcuts (numbered list, bullet list, blockquote, link) under the structural category
  - Group always-on shortcuts (multi-cursor) with null category so they are never excluded
  - _Requirements: 3.2, 3.3_

- [x] 6. Refactor store layer for data-driven shortcut registration
- [x] 6.1 Update the editor shortcuts store to use category-based exclusion
  - Replace the hard-coded emacs mode check with data-driven filtering using the override categories from the keymap result
  - Change the parameter from keymap mode name to an array of shortcut categories to exclude
  - Filter categorized binding groups: include groups with null category always, exclude groups whose category appears in the overrides
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 6.2 Simplify the editor settings store to use keymap result metadata
  - Remove the standalone precedence-determination function
  - Apply precedence directly from the keymap result's encapsulated precedence wrapper
  - Pass the keymap result's override declarations to the editor shortcuts store
  - _Requirements: 1.4_

- [x] 7. Implement Emacs structural editing bindings
- [x] 7.1 (P) Implement blockquote, link, and horizontal rule bindings
  - Register C-c C-s q for blockquote toggle using the shared line-prefix utility
  - Register C-c C-l for markdown link insertion using the shared toggle utility
  - Register C-c C-s - for horizontal rule insertion
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 7.2 (P) Implement heading bindings
  - Register C-c C-s h for auto-determined heading level insertion
  - Register C-c C-s 1 through C-c C-s 6 for explicit heading level insertion using the line-prefix utility
  - _Requirements: 5.4, 5.5_

- [x] 7.3 (P) Implement list item and fenced code block bindings
  - Register C-c C-j for context-aware new list item insertion (detect bullet vs numbered from current context)
  - Register C-c C-s C (shift-c) for GFM fenced code block insertion
  - _Requirements: 5.6, 5.7_

- [x] 8. Implement Emacs save binding
  - Register C-x C-s as a two-stroke key sequence that invokes the onSave callback passed to the Emacs factory
  - Silently ignore the binding when no save callback is provided
  - Verify the same save mechanism used by Vim's :w command
  - _Requirements: 6.1, 6.2_

- [x] 9. Implement Emacs extended navigation and editing bindings
- [x] 9.1 (P) Implement heading navigation bindings
  - Register C-c C-n / C-c C-p to navigate to the next/previous heading at any level
  - Register C-c C-f / C-c C-b to navigate to the next/previous heading at the same level
  - Register C-c C-u to navigate up to the parent heading
  - Use regex-based heading detection to scan document structure
  - _Requirements: 9.3, 9.4, 9.5_

- [x] 9.2 (P) Implement promotion and demotion bindings
  - Register C-c C-- to promote (outdent) the current element: decrease heading level or outdent list item
  - Register C-c C-= to demote (indent) the current element: increase heading level or indent list item
  - Detect element type at cursor to apply the appropriate operation
  - _Requirements: 9.1, 9.2_

- [x] 9.3 (P) Implement kill, image, table, and footnote bindings
  - Register C-c C-k to kill (delete) the element at point and copy its text content to the clipboard
  - Register C-c C-i to insert a markdown image template
  - Register C-c C-s t to insert a markdown table template
  - Register C-c C-s f to insert a footnote marker and definition pair
  - _Requirements: 9.6, 9.7, 9.8, 9.9_

- [x] 10. Integration verification and UI consistency check
- [x] 10.1 Verify keymap selection UI displays all modes correctly
  - Confirm the keymap selector shows all four modes with appropriate labels
  - Verify switching between modes applies immediately without page reload
  - Confirm the selected mode persists across sessions via existing storage mechanism
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 10.2 Add integration tests for keymap mode switching and shortcut exclusion
  - Test that formatting shortcuts are excluded in Emacs mode but present in default mode
  - Test that mode switching preserves document content
  - Test that C-x C-s triggers save in Emacs mode and :w triggers save in Vim mode
  - _Requirements: 1.4, 3.2, 6.1_

- [ ]* 10.3 (P) Add E2E tests for Emacs keybindings
  - Extend the existing Playwright editor test pattern to cover Emacs formatting bindings (C-c C-s b for bold, etc.)
  - Cover at least one structural binding (C-c C-l for link) and one navigation binding (C-c C-n for next heading)
  - _Requirements: 4.1, 5.2, 9.3_
