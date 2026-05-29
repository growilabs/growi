# Requirements Document

## Introduction

This feature improves the comment mention functionality in GROWI. Currently, `@username` notifications are suppressed for repeated mentions within a 7-day window due to the `upsertByActivity` deduplication logic, and the lack of visual feedback or autocomplete makes the user experience insufficient. This spec implements both reliable mention notifications and improved usability through visual highlighting and autocomplete.

## Requirements

### Requirement 1: Reliable Mention Notification Delivery

**Objective:** As a comment author, I want mentioned users to always receive a notification whenever they are mentioned, regardless of whether they have previously commented on the page or been mentioned before. This ensures mention notifications work reliably independent of comment or mention history.

#### Acceptance Criteria

1. When a comment contains `@username`, the GROWI shall send a notification to that user every time the comment is posted, regardless of their past comment or mention history on the page
2. When a comment contains multiple mentions of the same user, the GROWI shall send only one notification to that user
3. If the mentioned user is the same as the comment author, the GROWI shall not send a notification to that user

---

### Requirement 2: Mention Visual Feedback

**Objective:** As a comment reader, I want mentions (`@username`) in comment body text to be visually distinguishable. This allows me to immediately verify that a mention is working correctly.

#### Acceptance Criteria

1. When a comment is displayed, the GROWI shall render `@username` patterns in the comment body with a style distinct from regular text (highlight color, emphasis, etc.)
2. The GROWI shall apply the same highlight style to all strings matching the `@username` pattern
3. The GROWI shall apply the mention display style to both the comment preview and the post-submission display

---

### Requirement 3: Mention Input Autocomplete

**Objective:** As a comment author, I want user suggestions to appear when I type `@`. This makes it easier to enter accurate usernames.

#### Acceptance Criteria

1. When a user types `@` followed by one or more characters in the comment editor, the GROWI shall display a list of user candidates whose `username` starts with the entered text
2. If the character immediately before `@` is a non-whitespace character (e.g., an email address format like `foo@example.com`), the GROWI shall not display the candidate list
3. When a user selects a candidate from the list, the GROWI shall replace the typed `@string` with the selected user's `@username`
4. If no matching users exist for the candidate list, the GROWI shall not display the candidate list
5. When a user presses the `Escape` key, the GROWI shall close the candidate list
6. The GROWI shall limit the number of users displayed in the candidate list to 10

---

### Requirement 4: Autocomplete Facility / Source Responsibility Separation (post-implementation refactor)

> **Status:** This requirement was added during reviewer validation **after** Requirements 1–3 were implemented and merged. It captures an architectural coupling discovered during review. Requirements 1–3 remain done; only this requirement is new work for the implementer.

**Objective:** As a maintainer, I want the generic CodeMirror autocomplete facility to be a shared, standalone editor capability, and each feature (emoji, mention) to contribute only its own completion *source*, so that features stay independent and removing or disabling one feature does not silently break another.

#### Background / Problem (current state)

- In CodeMirror, `autocompletion()` is the **generic facility** that installs the completion UI/state. Completion **sources** are independent and contributed either via `override: [...]` or via language data (`markdownLanguage.data.of({ autocomplete })`).
- Today the **only** `autocompletion()` call in `packages/editor` lives inside `emojiAutocompletionSettings` (`packages/editor/src/client/services-internal/extensions/emojiAutocompletionSettings.ts`). `defaultExtensions` (`use-default-extensions.ts`) includes `emojiAutocompletionSettings`, so the generic facility is present **only transitively via emoji**.
- The mention extension (`createMentionCompletionExtension`, `packages/editor/src/client/services/mentionAutocompletionSettings.ts`) registers **only** a language-data source (`markdownLanguage.data.of`); it does **not** install `autocompletion()`. As a result, mention completion has an **implicit, undeclared runtime dependency on the emoji extension being loaded**.
- **Risk:** removing/disabling emoji would silently disable the mention dropdown — with no compile error and no failing test. This inverts the intended responsibility boundary (emoji and mention should be independent peers, both depending only on the shared facility).

#### Should-be (target)

- `autocompletion()` is registered **exactly once** as a standalone shared default extension (in `defaultExtensions` or an equivalent shared module), independent of any specific feature.
- `emojiAutocompletionSettings` contributes only emoji-specific config (its `addToOptions` glyph renderer) plus the emoji completion source.
- `mentionAutocompletionSettings` continues to contribute only the mention completion source (no change expected).
- emoji and mention become **peer, independent consumers** of the shared facility; neither depends on the other.

#### Acceptance Criteria (implementation-level)

1. The generic `autocompletion()` extension SHALL be registered exactly once as a standalone shared extension in `defaultExtensions` (or an equivalent shared module), and SHALL NOT be bundled inside `emojiAutocompletionSettings`.
2. The mention completion source SHALL NOT depend on the emoji extension. Specifically, when the emoji extension is removed from the editor configuration, the mention completion dropdown (`@` trigger) SHALL still function.
3. The emoji extension SHALL retain its emoji-specific rendering (`addToOptions` glyph) and its own completion source, contributed via `markdownLanguage.data.of`.
4. emoji completion (`:` trigger) and mention completion (`@` trigger) SHALL both function simultaneously in the comment editor, with neither source suppressing the other (no reintroduction of `override`-based single-source registration).
5. Removing the shared `autocompletion()` facility from defaults SHALL disable completion for **both** features equally — proving the facility is the single shared dependency, not emoji.
6. **(Preserved improvement — must keep)** emoji completion SHALL fire only within the markdown language context and SHALL NOT fire inside fenced code blocks (e.g. ```` ```js ````). This behavior was introduced when emoji migrated from `override` to a language-data source; it is **intentional and SHALL be preserved**. A regression test SHOULD assert that emoji completion does not trigger inside a fenced code block.
7. The main page editor (which also consumes `defaultExtensions`) SHALL retain working emoji completion after the refactor, with no regression other than the intentional code-block behavior in AC 6.

#### Non-functional / Constraints

- `packages/editor` MUST NOT gain a dependency on `apps/app` (existing architectural constraint).
- `turbo run build --filter @growi/app` MUST stay green, and the full `@growi/editor` and `@growi/app` test suites MUST stay green.
- CodeMirror merges multiple `autocompletion()` configs, so a base `autocompletion()` in defaults plus emoji's `autocompletion({ addToOptions })` is valid and the configs combine — leverage this rather than forcing a single config.

#### Notes for Implementer

- emoji autocompletion currently has **no automated test** (pre-existing gap). Add regression coverage where feasible, in particular for AC 2 (mention works without emoji), AC 4 (both coexist), and AC 6 (no emoji completion in code blocks).
- See `research.md` → "Gap Analysis: Autocomplete Facility / Source Separation" for the requirement-to-asset map, options (A/B/C), and effort/risk.
