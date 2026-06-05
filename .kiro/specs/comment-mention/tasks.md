# Implementation Plan

## Backend: Mention Notification Pipeline

- [x] 1.1 Add a dedicated activity type for mentions
  - Add `ACTION_COMMENT_MENTION` to the `SupportedAction` enum in `interfaces/activity.ts` (required as the value stored in the `InAppNotification.action` field)
  - Add display label and icon for `ACTION_COMMENT_MENTION` in `useActionAndMsg.ts`
  - _Requirements: 1.1_

- [x] 1.2 Implement a notification insertion method for mentioned users
  - Add `insertMentionNotifications` method to `InAppNotificationService`
  - Insert directly via `InAppNotification.insertMany({ ordered: false })` without `upsertByActivity` to bypass the 7-day deduplication window (`ordered: false` prevents a single error from stopping remaining insertions)
  - Exclude `actionUserId` (the comment author) from `mentionedUserIds`
  - Send real-time notification to target users via `emitSocketIo` after insertion
  - Return early if `mentionedUserIds` is empty
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 1.3 Wire mention notification calls into the comment post API
  - Remove the code in `api.add` that feeds mentioned users into the `upsertByActivity` flow via `getAdditionalTargetUsers` (prevents double notification)
  - Call `CommentService.prepareMentionNotifications` to obtain `generatePreNotify` and `notify`
  - Call `notify()` after sending `res.json()`
  - Wrap in try-catch for silent failure so mention notification errors do not block the comment post response (log via `logger.error`)
  - _Requirements: 1.1, 1.2, 1.3_

- [x]* 1.4 Write backend unit tests
  - `insertMentionNotifications`: exclusion of the comment author, early return on empty array, socket event emission
  - _Requirements: 1.1, 1.2, 1.3_

## Frontend: Mention Visual Feedback

- [x] 2.1 Transform `@username` into highlight nodes via a remark plugin
  - Create `mention.ts` in `apps/app/src/services/renderer/remark-plugins/`
  - Traverse text nodes and transform parts matching `/\B@[\w@.-]+/g` into `mention` custom nodes
  - Output as `<span class="mention-user" data-mention="username">@username</span>` via the rehype handler
  - _Requirements: 2.1, 2.2_

- [x] 2.2 Add mention elements to the XSS sanitize configuration
  - Create `mentionSanitizeOption` to allow `span` tags and `className` / `data-mention` attributes
  - Apply via deepmerge with the existing sanitize options
  - _Requirements: 2.1_

- [x] 2.3 Integrate the mention plugin into the comment renderer
  - Create `generateCommentViewOptions` as a new function based on `generateSimpleViewOptions`
  - Add `mentionPlugin` via `remarkPlugins.push`
  - Add `mentionSanitizeOption` to the `rehypeSanitizePlugin` deepmerge
  - Switch `stores/renderer.tsx` comment preview to use `generateCommentViewOptions`
  - _Requirements: 2.1, 2.3_

- [x] 2.4 Add `.mention-user` styles
  - Add `.mention-user` class styles (highlight color, font weight, etc.) under `apps/app/src/styles/`
  - _Requirements: 2.1_

- [x]* 2.5 Write remark plugin unit tests
  - `@username` is correctly transformed in the AST
  - Edge cases: no-space consecutive text, empty string, Japanese characters
  - _Requirements: 2.1, 2.2, 2.3_

## Frontend: Mention Input Autocomplete

- [x] 3.1 Create a CodeMirror mention completion extension factory
  - Create `mentionAutocompletionSettings.ts` in `packages/editor/src/client/services/`
  - Use `@codemirror/autocomplete` with `autocompletion` + `CompletionContext`
  - Configure trigger regex to fire on one or more characters after `@` (`/(?<!\w)@[\w.-]+$/`)
  - Use an externally injected `fetchUsers` callback to avoid introducing `apps/app` dependency into `packages/editor`
  - Replace the entire `@string` with `@username` on candidate selection
  - Limit to maximum 10 candidates (`maxMatches: 10`)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3.2 Wire the completion extension into the comment editor
  - Implement the `fetchUsers` function in `CommentEditor.tsx` (`/_api/v3/users/?searchText=...`)
  - Generate `createMentionCompletionExtension(fetchUsers)` inside `useEffect` and register via `codeMirrorEditor?.appendExtensions`
  - _Requirements: 3.1, 3.2, 3.5_

- [x]* 3.3 Write completion extension unit tests
  - `@a` triggers the extension; `a` does not
  - Maximum count limit (10) works correctly
  - String replacement on candidate selection is correct
  - _Requirements: 3.1, 3.2, 3.3, 3.5_

## Editor: Autocomplete Facility / Source Separation (Requirement 4)

- [ ] 4.1 Promote the shared autocomplete facility to a standalone editor default and reduce the emoji extension to emoji-specific config
  - Register the generic `autocompletion()` facility once as a standalone shared default extension, independent of any feature, placed before the emoji extension in the defaults
  - Remove the `icons: false` option from the emoji extension's own `autocompletion()` call so that flag is owned solely by the shared base; the emoji extension keeps only its glyph renderer (`addToOptions`) and its `markdownLanguage.data.of` source
  - Export the emoji completion source function (rename the internal `emojiAutocompletion` to `emojiCompletionSource` and export it) so regression tests can exercise it directly — this is the only production export change and belongs with the refactor, keeping the test task free of production edits
  - Observable: `turbo run build --filter @growi/editor` stays green; in the comment editor both `:` emoji completion and `@` mention completion still appear, and the shared `autocompletion()` is no longer nested inside the emoji extension
  - _Requirements: 4.1, 4.3, 4.7_
  - _Boundary: use-default-extensions, emojiAutocompletionSettings_

- [ ]* 4.2 Add regression tests proving facility/source decoupling
  - **Coexistence (AC 4.4)** — in a new spec beside the emoji extension: call the exported emoji source with a `:smi` context and expect a non-null result, and separately call the mention source factory with an `@ab` context and expect a non-null result, proving neither source suppresses the other
  - **Code-block scoping (AC 4.6)** — in the same new spec: assert the emoji source is excluded from fenced code blocks. The sublanguage MUST be nested **synchronously** — do NOT use `codeLanguages: languages` (async load; will not nest in a sync unit test and the assertion will fail, verified during design validation). Build a synchronous stub sublanguage instead:
    ```typescript
    const stubParser = StreamLanguage.define({ token: (s) => { s.next(); return null; } });
    const jsDesc = LanguageDescription.of({ name: 'javascript', alias: ['js'], support: new LanguageSupport(stubParser) });
    const state = EditorState.create({ doc: '```js\n:smi\n```\n\n:smi', extensions: [
      markdown({ base: markdownLanguage, codeLanguages: [jsDesc] }),
      emojiAutocompletionSettings,
    ]});
    ```
    Then assert `state.languageDataAt<CompletionSource>('autocomplete', pos)` (an `EditorState` instance method from `@codemirror/state`) does NOT contain the emoji source at a position inside the ` ```js ``` ` block but DOES at a normal markdown position. (`StreamLanguage`, `LanguageSupport`, `LanguageDescription` come from `@codemirror/language`.)
  - **Mention independence (AC 4.2)** — add a case to the existing mention spec asserting the mention source returns completions when no emoji extension is present in the editor state, locking the no-hidden-dependency guarantee
  - Observable: `pnpm vitest run emojiAutocompletionSettings` and `pnpm vitest run mentionAutocompletionSettings` both pass, including the new code-block scoping and mention-independence cases
  - _Requirements: 4.2, 4.4, 4.6_
  - _Depends: 4.1_
  - _Boundary: emojiAutocompletionSettings.spec, mentionAutocompletionSettings.spec_
