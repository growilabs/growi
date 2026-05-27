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
