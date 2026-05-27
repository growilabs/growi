# Design Document: comment-mention

## Overview

This design covers the full comment mention feature in GROWI.

**Purpose**:
- Decouple mention notifications from the existing subscriber notification flow (`upsertByActivity`) and add an independent path that delivers notifications reliably on every comment post
- Improve mention usability by visually highlighting `@username` in comment body text and suggesting user candidates during comment input

**Users**: All GROWI team members, especially users who communicate via comments.

**Impact**: Modifies the backend notification pipeline (`InAppNotificationService`), comment route (`comment.js`), frontend renderer (remark plugin), and editor extension (CodeMirror autocomplete).

### Goals

- Deliver mention notifications reliably on every comment, regardless of comment or mention history (Req 1)
- Visually highlight `@username` in comment body text (Req 2)
- Provide input autocomplete by suggesting user candidates when `@` is typed (Req 3)

### Non-Goals

- Mentions by display name (`@name`)
- Mention notifications on comment edit
- Slack / global notification integration for mentions
- Mobile push notifications

---

## Architecture

### Existing Architecture Analysis

- **Notification flow**: `routes/comment.js:api.add` → `activityEvent.emit('update')` → `ActivityService` → `activityEvent.emit('updated')` → `InAppNotificationService.createInAppNotification` → `upsertByActivity`
- **Deduplication**: `upsertByActivity` merges within a 7-day window keyed on `{ user, target, action, createdAt: { $gt: lastWeek }, snapshot }`. Mentioned users go through the same path, which suppresses repeated mentions (root cause)
- **Existing getMentionedUsers**: Implemented in `CommentService`. Extracts mentions with `/\B@[\w@.-]+/g` and returns a list of IDs via `User.find`
- **Renderer**: `useCommentForCurrentPageOptions` → `generateSimpleViewOptions` → `remarkPlugins[]` / `rehypePlugins[]` structure. Easy to add plugins
- **Editor extension**: Dynamically addable via `CodeMirrorEditorComment`'s `appendExtensions` API. `emojiAutocompletionSettings.ts` is the established pattern
- **User search API**: `GET /_api/v3/users/?searchText=...&selectedStatusList[]=active` already exists

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph Backend
        CommentRoute[comment.js api.add]
        CommentService[CommentService prepareMentionNotifications]
        ActivitySvc[ActivityService]
        InAppSvc[InAppNotificationService]
        upsert[upsertByActivity dedup7days]
        insertMention[insertMentionNotifications no dedup]
    end

    subgraph Frontend_Editor
        CommentEditor[CommentEditor.tsx]
        MentionFactory[createMentionCompletionExtension]
        UserAPI[GET v3 users searchText]
    end

    subgraph Frontend_Renderer
        CommentViewOptions[generateCommentViewOptions]
        RemarkMention[remarkMentionPlugin]
        SanitizeOpt[mentionSanitizeOption]
    end

    CommentRoute --> CommentService
    CommentRoute --> ActivitySvc
    ActivitySvc --> InAppSvc
    InAppSvc --> upsert
    CommentService --> insertMention
    CommentEditor --> MentionFactory
    MentionFactory --> UserAPI
    CommentViewOptions --> RemarkMention
    CommentViewOptions --> SanitizeOpt
```

**Architecture Integration**:
- Mention notifications are processed via the independent `insertMentionNotifications` path, separate from the existing `ACTION_COMMENT_CREATE` flow, bypassing the 7-day deduplication
- The existing `getAdditionalTargetUsers` code that feeds mentioned users into the `upsertByActivity` flow is removed. Without removal, users who are both page subscribers and mention targets would receive two notifications for the same comment
- The renderer and autocomplete are additive-only changes to existing patterns; they do not violate existing boundaries
- `packages/editor` uses a factory pattern for dependency injection to avoid depending on `apps/app`
- `generateCommentViewOptions` is introduced as a new function rather than modifying `generateSimpleViewOptions` directly, preventing mention plugin leakage into regular pages, search results, and timeline views

### Technology Stack

| Layer | Choice / Version | Role | Notes |
|-------|-----------------|------|-------|
| Backend | Node.js / Express (existing) | Notification flow extension | Modifies `InAppNotificationService` |
| Data | MongoDB / Mongoose (existing) | Direct `InAppNotification` insertion | No schema changes |
| Markdown | unified / remark (existing) | `@username` AST transformation | New remark plugin added |
| Editor | CodeMirror 6 / `@codemirror/autocomplete` (existing) | `@`-triggered completion | Follows emoji pattern |
| API | `GET /_api/v3/users/` (existing) | User search | Uses `searchText` query parameter |

---

## System Flows

### Req 1: Mention Notification Flow

```mermaid
sequenceDiagram
    participant Client
    participant CommentRoute as comment.js api.add
    participant CommentService as CommentService
    participant ActivitySvc as ActivityService
    participant InAppSvc as InAppNotificationService
    participant DB as MongoDB

    Client->>CommentRoute: POST /comments.add
    CommentRoute->>DB: Comment.add()
    CommentRoute->>ActivitySvc: activityEvent.emit update ACTION_COMMENT_CREATE
    ActivitySvc->>InAppSvc: activityEvent.emit updated
    InAppSvc->>DB: upsertByActivity subscribers only
    CommentRoute->>CommentService: prepareMentionNotifications
    CommentService->>DB: User.find username in mentions
    CommentService-->>CommentRoute: { generatePreNotify, notify }
    CommentRoute->>InAppSvc: notify() → insertMentionNotifications
    InAppSvc->>DB: InAppNotification.insertMany no dedup
    InAppSvc->>Client: socketIo notificationUpdated
```

### Req 3: Mention Autocomplete Flow

```mermaid
sequenceDiagram
    participant User
    participant CM as CodeMirrorEditorComment
    participant Ext as MentionCompletion Extension
    participant API as GET v3 users

    User->>CM: type @ab
    CM->>Ext: completionSource trigger
    Ext->>API: fetchUsers ab debounce 300ms
    API-->>Ext: UserSuggestion list max 10
    Ext-->>CM: completion options
    CM-->>User: show dropdown
    User->>CM: select candidate
    CM-->>User: replace @ab with @username
```

---

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | Send mention notification on every comment post | `CommentService`, `InAppNotificationService` | `getMentionedUsers`, `insertMentionNotifications` | Req 1 flow |
| 1.2 | Only one notification per user for multiple mentions | `getMentionedUsers` | Deduplication via Set (existing) | Req 1 flow |
| 1.3 | Do not notify the comment author for self-mentions | `insertMentionNotifications` | Excludes `actionUserId` | Req 1 flow |
| 2.1 | Highlight valid mentions | `remarkMentionPlugin` | `mention` AST node → `span.mention-user` | — |
| 2.2 | Highlight all `@username` patterns without existence check | `remarkMentionPlugin` | No server round-trip for user existence (reduces cost) | — |
| 2.3 | Apply to both preview and post-submission display | `generateCommentViewOptions` | `remarkPlugins.push` | — |
| 3.1 | Show suggestions on `@` + 1 or more characters | `createMentionCompletionExtension` | `CompletionContext` trigger | Req 3 flow |
| 3.2 | Replace typed `@string` with `@username` on selection | `createMentionCompletionExtension` | `apply` callback | Req 3 flow |
| 3.3 | Do not show list when no candidates exist | `createMentionCompletionExtension` | Return `null` | — |
| 3.4 | Close candidate list on Escape | `@codemirror/autocomplete` | Default behavior | — |
| 3.5 | Limit candidate list to 10 items | `createMentionCompletionExtension` | `maxMatches: 10` | — |

---

## Components and Interfaces

### `SupportedAction` / `EssentialActionGroup` (modified)

- Add `ACTION_COMMENT_MENTION = 'COMMENT_MENTION'` to `interfaces/activity.ts`
  - Required for type safety as the value stored in the `InAppNotification.action` field
- Add `ACTION_COMMENT_MENTION` to `EssentialActionGroup` (`AllEssentialActions` is updated automatically)
  - `insertMentionNotifications` does not go through `initActivityEventListeners`, so this does not affect the notification generation flow itself
  - Added because `AllEssentialActions` is referenced in the notification list display and filtering logic

---

### `InAppNotificationService.insertMentionNotifications`

| Field | Detail |
|-------|--------|
| Intent | Insert notifications directly to mentioned users without deduplication |
| Requirements | 1.1, 1.3 |

**Responsibilities & Constraints**
- Uses `InAppNotification.insertMany({ ordered: false })` directly **without** `upsertByActivity` (so that a single validation error does not stop remaining insertions)
- Excludes `actionUserId` from `mentionedUserIds` (1.3)
- Sends real-time notification to target users via `emitSocketIo`
- Returns early if `mentionedUserIds` is empty

**Contracts**: Service [x]

##### Service Interface
```typescript
interface InAppNotificationService {
  insertMentionNotifications(
    mentionedUserIds: Types.ObjectId[],
    actionUserId: Types.ObjectId,
    activityId: Types.ObjectId,
    page: IPageHasId,
  ): Promise<void>;
}
```
- Preconditions: `mentionedUserIds` is a deduplicated array returned by `getMentionedUsers`
- Postconditions: Notifications are inserted for all users in `mentionedUserIds` excluding `actionUserId`, and socket events are emitted

**Implementation Notes**
- Snapshot: `generateSnapshot` is defined in `in-app-notification-utils.ts` and is not accessible from the route layer, so it is called inside `insertMentionNotifications`
- Risks: `insertMany` has no 7-day window, so high-frequency comments may increase notification volume. Acceptable because mentions are explicit user actions
- Performance: `getMentionedUsers` should return within 100ms even for 10 mentions in a single comment

---

### `remarkMentionPlugin`

| Field | Detail |
|-------|--------|
| Intent | Detect `@username` in remark AST text nodes and transform them into custom `mention` nodes |
| Requirements | 2.1, 2.2, 2.3 |

**Responsibilities & Constraints**
- **File**: `apps/app/src/services/renderer/remark-plugins/mention.ts`
- Traverses text nodes and splits out parts matching `/\B@[\w@.-]+/g`
- Transforms matches into `{ type: 'mention', value: '@username' }` custom nodes
- The corresponding rehype handler outputs `<span class="mention-user" data-mention="username">@username</span>`
- **No user existence check on the client side** (avoids server round-trip; all `@username` patterns are highlighted with the same style)

**Contracts**: — (pure remark plugin function)

**Implementation Notes**
- Sanitize: Add `{ tagNames: ['span'], attributes: { span: ['className', 'data-mention'] } }`. Limiting allowed attributes to `className` and `data-mention` only prevents XSS via arbitrary attribute injection
- Risks: If `rehype-sanitize` configuration is forgotten, `<span>` elements will be stripped

---

### `createMentionCompletionExtension`

| Field | Detail |
|-------|--------|
| Intent | CodeMirror Extension factory that asynchronously fetches user candidates and provides suggestions triggered by `@` input |
| Requirements | 3.1, 3.2, 3.3, 3.4, 3.5 |

**Responsibilities & Constraints**
- **File**: `packages/editor/src/client/services/mentionAutocompletionSettings.ts`
- Triggers on one or more characters after `@` (trigger detection via `/(?<!\w)@[\w.-]+$/`)
  - Character class aligned with `remarkMentionPlugin` pattern `/\B@[\w@.-]+/g` (includes `.` and `-`)
- Retrieves user list via the externally injected `fetchUsers` callback
- Replaces the typed `@string` with `@username` on candidate selection
- Limits maximum candidates to `maxMatches: 10` (3.5)
- Closes the candidate list on Escape / focus loss (`@codemirror/autocomplete` default behavior satisfies 3.4)

**Contracts**: Service [x]

##### Service Interface
```typescript
interface UserSuggestion {
  username: string;
  name: string;
}

type FetchUsersFn = (query: string) => Promise<UserSuggestion[]>;

function createMentionCompletionExtension(fetchUsers: FetchUsersFn): Extension;
```
- Preconditions: `fetchUsers` is an async function that returns prefix-matched users for a given `query` string
- Postconditions: Return value is an `Extension` registerable via `appendExtensions` in CodeMirror

**Implementation Notes**
- Risks: `packages/editor` must not depend on `apps/app`. Define the `fetchUsers` type inside `packages/editor` and keep the implementation in `apps/app`

---

### `generateCommentViewOptions` (new)

A comment-specific renderer options generator built on top of `generateSimpleViewOptions`, with `remarkMentionPlugin` and `mentionSanitizeOption` added. Since it is used for both comment preview and post-submission display, it satisfies Req 2.3 automatically. Implemented as an independent function rather than modifying `generateSimpleViewOptions` directly to prevent mention plugin leakage into regular pages, search results, and timeline views.

---

## Data Models

This feature involves no data model changes.

- **`InAppNotification`**: No changes. `insertMentionNotifications` inserts according to the existing schema
- **`User`**: No changes. Searched by `username` field

---

## Error Handling

**Mention notification failure (backend)**
- If `getMentionedUsers` or `insertMentionNotifications` throws, the comment post response has already been sent, so only `logger.error` is recorded and the failure is silent

**User search API failure (frontend autocomplete)**
- If `fetchUsers` fails, CompletionContext returns `null` and the completion list is hidden (3.3)
- No error display to the user (autocomplete is a convenience feature only)

**remark plugin processing error**
- Use try-catch inside the plugin so that a failed node passes through unchanged, preventing the entire comment rendering from failing

### Monitoring

- Log `logger.info` with the number of target users on each `insertMentionNotifications` call
- Log `logger.warn` on the client side if `fetchUsers` response time exceeds 500ms
