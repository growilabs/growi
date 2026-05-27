# Research & Design Decisions

---

## Summary

- **Feature**: `comment-mention`
- **Discovery Scope**: Extension (extending an existing system)
- **Key Findings**:
  - The root cause of repeated mention notification failures is the 7-day deduplication window in `upsertByActivity`. Notifications are merged when the same `(user, target, action, snapshot)` combination recurs within 7 days
  - `getMentionedUsers` is already implemented in `CommentService`. No new implementation needed
  - Deduplication can be bypassed by inserting directly via `InAppNotification.insertMany`
  - The comment renderer uses `generateSimpleViewOptions` to stack remark/rehype plugins, making new remark plugin addition straightforward
  - Editor extensions can be added via the `appendExtensions` API and the `emojiAutocompletionSettings.ts` pattern
  - The user search API `GET /_api/v3/users/?searchText=...` is already available

---

## Research Log

### Mention Notification Deduplication Problem

- **Context**: User report that notifications are not received on the second or subsequent mentions
- **Sources Consulted**: `in-app-notification.ts`, `pre-notify.ts`, `comment.js`, `activity.ts`
- **Findings**:
  - `upsertByActivity` filter: `{ user, target, action, createdAt: { $gt: lastWeek }, snapshot }`
  - `ACTION_COMMENT_CREATE` notifications for the same user on the same page within 7 days are merged via `$addToSet`
  - Subscribers (page editors) and mentioned users go through the same path, so deduplication also applies to mention notifications
- **Implications**: Mention notifications must either bypass deduplication or be separated with a distinct action type

### Adding a remark Plugin to the Comment Renderer

- **Context**: Implementation approach for visually highlighting `@username`
- **Sources Consulted**: `renderer.tsx`, `Comment.tsx`, `stores/renderer.tsx`
- **Findings**:
  - The comment renderer goes through `generateSimpleViewOptions` (`useCommentForCurrentPageOptions`)
  - Remark plugins can be added via `remarkPlugins.push(...)`
  - Existing remark plugins (`attachment.ts`, `xsv-to-table.ts`, etc.) serve as reference implementations
  - The sanitize option must be updated to allow `span` tags and `className` for XSS protection
- **Implications**: Create `apps/app/src/services/renderer/remark-plugins/mention.ts` as a new file

### CodeMirror Extension Pattern

- **Context**: Investigation of how to implement user suggestions on `@` input
- **Sources Consulted**: `emojiAutocompletionSettings.ts`, `CodeMirrorEditorComment.tsx`, `useCodeMirrorEditorIsolated`
- **Findings**:
  - The `@codemirror/autocomplete` pattern with `autocompletion` + `CompletionContext` is proven via the emoji implementation
  - Extensions can be added via the `appendExtensions` API in `CodeMirrorEditorComment.tsx`
  - `packages/editor` cannot depend on `apps/app`, so the user fetch function must be injected externally (factory pattern)
- **Implications**: Design as `createMentionCompletionExtension(fetchUsers)` and pass the fetch function from `CommentEditor.tsx`

### User Search API

- **Context**: Fetching the user list for autocomplete
- **Sources Consulted**: `apps/app/src/server/routes/apiv3/users.js`
- **Findings**:
  - `GET /_api/v3/users/?searchText=...&selectedStatusList[]=active` already exists
  - Executes prefix-match RegExp search via `searchText`
  - Authentication required (`loginRequired`)
- **Implications**: No new API needed. Reuse the existing endpoint

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: Integrate into existing notification path | Include mentioned users in `notificationTargetUsers` and pass through `upsertByActivity` | Minimal changes | 7-day deduplication suppresses repeated mentions | Current implementation, has the problem |
| B: Dedicated action type `ACTION_COMMENT_MENTION` | Add a separate action to establish an independent notification flow | Deduplication is isolated; semantically clear | Requires enum extension | Adopted |
| C: Add skip option to `upsertByActivity` | Optionally disable deduplication | Small change scope | Risk of notification spam; complicates notification model consistency | Not adopted |

---

## Design Decisions

### Decision: Use a Dedicated Action Type for Mention Notifications

- **Context**: Repeated mention notifications suppressed by 7-day deduplication
- **Selected Approach**: Add `ACTION_COMMENT_MENTION` action type to `SupportedAction` in `interfaces/activity.ts`. After saving the comment in `api.add`, insert directly to mentioned users via `insertMentionNotifications`
- **Rationale**: Preserves semantic independence of mention notifications while minimizing impact on the existing notification pipeline
- **Trade-offs**: Requires changes to `interfaces/activity.ts`, but only an enum addition with minimal impact on existing code
- **Follow-up**: Do not forget to add to `EssentialActionGroup`

### Decision: Render Mentions via a remark Plugin

- **Context**: Visual highlighting of `@username` in comment body text
- **Selected Approach**: Create a new remark plugin as `apps/app/src/services/renderer/remark-plugins/mention.ts` and add it to `generateCommentViewOptions`
- **Rationale**: Fits naturally into the existing rendering pipeline. The same plugin is applied to both preview and post-submission display, maintaining consistency
- **Trade-offs**: Requires `rehype-sanitize` configuration changes to allow `span` and `data-mention` attributes

### Decision: Inject Autocomplete Extension via Factory Pattern

- **Context**: Avoid introducing GROWI API dependencies into the CodeMirror extension in `packages/editor`
- **Selected Approach**: Define factory function `createMentionCompletionExtension(fetchUsers)` in `packages/editor`. Initialize by passing a callback that calls the GROWI API from `CommentEditor.tsx`
- **Rationale**: Maintains package dependency direction. `packages/editor` does not need to know about `apps/app`
- **Trade-offs**: Requires implementing the fetch function on the `CommentEditor.tsx` side

### Decision: Why `@` Is Included in the remark Plugin Regex

- **Context**: Why `@` appears in the character class of `remarkMentionPlugin`'s regex `/\B@[\w@.-]+/g`
- **Selected Approach**: The existing `CommentService.getMentionedUsers` implementation (referenced by the notification logic) uses the same `/\B@[\w@.-]+/g`, so it was followed for consistency
- **Rationale**: A mismatch between the notification logic and the remark plugin match targets would cause cases where a notification arrives but no highlight appears (or vice versa). Consistency with the existing implementation was prioritized
- **Trade-offs**: Consecutive mentions without spaces (e.g., `@user@other`) become a single match, but this is not expected to occur in practice

---

## Post-Implementation Discoveries

### Debounce Logic Moved Inside the Extension

- **Original design**: The `fetchUsers` debounce (300ms) was intended to be implemented in `CommentEditor.tsx` using `useMemo(() => debounce(fetchFn, 300), [])`
- **Actual implementation**: Debounce was incorporated into the completion source closure inside `mentionAutocompletionSettings.ts` (using a `setTimeout` + `pendingResolve` cancellation pattern)
- **Reason**: CodeMirror's `CompletionContext` requires abort detection, which is more reliably controlled internally than with an external debounce

### Addition of `mentionDecorationSettings.ts`

- Not included in the original design, but `mentionDecorationSettings.ts` was added to provide real-time `@username` highlighting in the editor while typing
- `CommentEditor.tsx` registers both `mentionDecorationSettings` (decoration) and `createMentionCompletionExtension` (completion)

### Module Placement Changed

- The design originally planned placement in `packages/editor/src/client/services-internal/extensions/`, but the module was placed in `packages/editor/src/client/services/` (public) so it could be imported from `CommentEditor.tsx` in `apps/app`

---

## Risks & Mitigations

- Missing `EssentialActionGroup` entry for `ACTION_COMMENT_MENTION` → Explicitly noted in implementation tasks
- Missing self-mention filter in mention notifications → Implemented as `actionUserId` exclusion inside `insertMentionNotifications`
- XSS via missing sanitize option in remark plugin → Verified by unit tests for the sanitize option
- API rate limiting / performance for autocomplete → Debounce (300ms) included in the implementation

---

## References

- `apps/app/src/server/routes/comment.js` — Comment API route handler
- `apps/app/src/server/service/comment.ts` — `getMentionedUsers` / `prepareMentionNotifications` implementation
- `apps/app/src/server/service/in-app-notification.ts` — `upsertByActivity` deduplication logic
- `apps/app/src/server/service/pre-notify.ts` — Notification target user collection
- `apps/app/src/interfaces/activity.ts` — `SupportedAction`, `EssentialActionGroup` definitions
- `packages/editor/src/client/services-internal/extensions/emojiAutocompletionSettings.ts` — Reference implementation for autocomplete
- `apps/app/src/client/services/renderer/renderer.tsx` — `generateSimpleViewOptions` / `generateCommentViewOptions`
- `apps/app/src/server/routes/apiv3/users.js` — User search API
