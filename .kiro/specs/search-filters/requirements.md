# Requirements Document

## Project Description (Input)

GROWI team wiki users currently have no way to narrow search results by page author, last editor, or user group membership without knowing opaque internal query syntax. The search service already supports inline operators (`prefix:`, `tag:`) that are extracted directly from the `?q=` query string in `parseQueryString()`. This feature extends that mechanism with three new operators: `author:`, `editor:`, and `group:`, so users can type structured filters directly into the existing search box with no new UI components.

## Boundary Context

- **In scope**: Three new inline search operators (`author:`, `editor:`, `group:`) and their negation variants (`-author:`, `-editor:`, `-group:`); server-side parsing, name resolution, and filter application; graceful handling of unknown usernames and group names
- **Out of scope**: New UI components, filter bars, or dedicated filter controls; new URL parameters beyond `?q=`; changes to existing `prefix:`, `tag:`, `-word`, or phrase operators; date-based operators (planned for a future iteration); changes to the Elasticsearch index schema or mappings; mobile-specific search UI changes
- **Adjacent expectations**: The existing `parseQueryString()` and Elasticsearch query pipeline are extended without changing their current behavior; all existing operator semantics remain unchanged

## Requirements

### Requirement 1: Author Filter Operator

**Objective:** As a GROWI user, I want to type `author:username` in the search box so that I can find pages created by a specific team member.

#### Acceptance Criteria

1. When a user submits a search query containing `author:<username>`, the Search Service shall return only pages whose creator has that username.
2. When `author:<username>` is combined with free-text keywords (e.g., `author:jim weekly report`), the Search Service shall return only pages created by that user that also match the remaining keywords.
3. The Search Service shall treat the `author:` token as a filter and shall not include it as a keyword in full-text or relevance scoring.
4. If the `author:` token has no value (e.g., `author:`), the Search Service shall ignore that token and apply no author filter.

---

### Requirement 2: Editor Filter Operator

**Objective:** As a GROWI user, I want to type `editor:username` in the search box so that I can find pages last edited by a specific team member.

#### Acceptance Criteria

1. When a user submits a search query containing `editor:<username>`, the Search Service shall return only pages whose most recent editor has that username.
2. When `editor:<username>` is combined with free-text keywords, the Search Service shall return only pages last edited by that user that also match the remaining keywords.
3. The Search Service shall treat the `editor:` token as a filter and shall not include it as a keyword in full-text or relevance scoring.
4. If the `editor:` token has no value, the Search Service shall ignore that token and apply no editor filter.

---

### Requirement 3: Group Filter Operator

**Objective:** As a GROWI user, I want to type `group:groupname` in the search box so that I can find pages authored by members of a specific team or group.

#### Acceptance Criteria

1. When a user submits a search query containing `group:<groupname>`, the Search Service shall return only pages whose creator is a member of the user group with that name.
2. When `group:<groupname>` is combined with free-text keywords, the Search Service shall return only pages matching both the group membership criterion and the remaining keywords.
3. The Search Service shall treat the `group:` token as a filter and shall not include it as a keyword in full-text or relevance scoring.
4. If the `group:` token has no value, the Search Service shall ignore that token and apply no group filter.

---

### Requirement 4: Negation Variants

**Objective:** As a GROWI user, I want to prefix any new operator with `-` so that I can exclude pages matching that criterion from my results.

#### Acceptance Criteria

1. When a user submits `-author:<username>`, the Search Service shall exclude all pages created by that user from the results.
2. When a user submits `-editor:<username>`, the Search Service shall exclude all pages whose most recent editor has that username from the results.
3. When a user submits `-group:<groupname>`, the Search Service shall exclude all pages whose creator is a member of that group from the results.
4. When negation operators are combined with positive operators or keywords, the Search Service shall apply all constraints simultaneously.

---

### Requirement 5: Operator Combination and Coexistence

**Objective:** As a GROWI user, I want to combine the new operators with each other and with existing operators so that I can construct precise queries in a single search box.

#### Acceptance Criteria

1. When multiple different operator types are active in one query (e.g., `author:jim group:dev-team`), the Search Service shall require a page to satisfy every active filter in order to appear in results (AND logic across operator types).
2. When new operators are combined with existing operators (`prefix:`, `tag:`), the Search Service shall apply all constraints and return only pages satisfying every active constraint.
3. When new operators are combined with free-text keywords, the Search Service shall apply both the operator filters and full-text keyword matching.
4. The Search Service shall leave the behavior of existing operators (`prefix:`, `-prefix:`, `tag:`, `-tag:`, quoted phrases, negated keywords) unchanged when the new operators appear in the same query.

---

### Requirement 6: Unknown Identifier Handling

**Objective:** As a GROWI user, I want the search to respond predictably when I use a username or group name that does not exist, so that I receive a clear empty result rather than an error.

#### Acceptance Criteria

1. If the username in an `author:` operator does not match any known GROWI user, the Search Service shall return an empty result set rather than an error response.
2. If the username in an `editor:` operator does not match any known GROWI user, the Search Service shall return an empty result set rather than an error response.
3. If the group name in a `group:` operator does not match any known GROWI user group, the Search Service shall return an empty result set rather than an error response.
4. If a group exists but has no members, the Search Service shall return an empty result set for queries using that `group:` operator.
