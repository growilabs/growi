# Requirements Document

## Project Description (Input)
GROWI team wiki users (developers, knowledge managers) currently have no discoverable way to filter search results by user (creator or editor), page path prefix, creation/update date range, or user group. The search page supports only keyword input with sort and binary toggles (user/trash pages); narrowing by structured fields requires embedding raw query operators in the keyword field — a non-obvious power-user feature. For wikis with thousands of pages, this forces users to scroll through large result sets.

The goal is to add a **Search Filter Bar** to the GROWI search page using a Static Plugin Registry architecture. Each filter is a self-contained descriptor (`FilterPlugin<T>`) implementing URL serialization and a React control. A generic `FilterBar` container renders all registered plugins. Filter state syncs bidirectionally with URL query parameters for deep-linking and browser history. The server-side `/search` route and service layer are extended to accept and apply the new parameters.

Five concrete plugins ship with the framework: **User**, **Path**, **Created Date**, **Updated Date**, and **Group**.

- **User filter**: A single control labeled "User" (placeholder: "Search by creator or editor...") that returns pages where the selected user is either the page creator or the most recent editor.
- **Date filters**: Preset-only controls — Last 7 Days, Last 30 Days, Last 90 Days, Last Year (365 days). No free-form date input.
- **Group filter**: Returns pages whose creator is a member of the selected user group. The server resolves group membership to a list of user identifiers at query time, avoiding any Elasticsearch index schema changes.

## Requirements

### Requirement 1: Filter Bar Display
**Objective:** As a GROWI user, I want a dedicated Filter Bar on the search page, so that I can discover and apply structured filters without knowing hidden query operators.

#### Acceptance Criteria
1. While the search service is configured and reachable, the Search Page shall display the Filter Bar containing all five filter controls: User, Path, Created Date, Updated Date, and Group.
2. If the search service is not configured or is not reachable, the Search Page shall not display the Filter Bar.
3. The Search Page shall display a visual active-state indicator on each filter control that has a non-empty value applied.
4. When the user clears all active filters, the Search Page shall render all filter controls in their default empty state.
5. The Search Page shall display the Filter Bar on desktop screen widths and shall not alter the existing mobile search options modal.

---

### Requirement 2: Filter Combination Logic
**Objective:** As a GROWI user, I want to apply multiple filters simultaneously, so that I can precisely narrow search results by combining criteria.

#### Acceptance Criteria
1. When more than one filter has an active value, the Search Page shall return only pages that satisfy all active filters simultaneously (AND logic).
2. When the user clears one filter while other filters remain active, the Search Page shall immediately re-run the search applying only the remaining active filters.
3. When no filters are active, the Search Page shall return results as if the Filter Bar were not present, with no change to existing search behavior.

---

### Requirement 3: URL Parameter Synchronization
**Objective:** As a GROWI user, I want active filter state to be reflected in the browser URL, so that I can bookmark, share, and navigate back to filter-specific searches.

#### Acceptance Criteria
1. When a filter value is applied, the Search Page shall update the browser URL to include the corresponding query parameter for that filter without performing a full page reload.
2. When a filter is cleared, the Search Page shall remove the corresponding query parameter(s) from the browser URL.
3. When the search page loads with one or more filter parameters present in the URL, the Search Page shall pre-populate those filter controls and apply the filters immediately on load.
4. When the user navigates backward or forward in browser history, the Search Page shall restore the filter state (and search results) that was active at that history entry.
5. The Search Page shall preserve existing URL parameters (`q`, `sort`, `order`, `nq`, `limit`, `offset`) when adding, updating, or removing filter parameters.
6. If a URL filter parameter value is malformed or unrecognizable, the Search Page shall silently ignore that parameter and display the corresponding filter control in its default empty state.

---

### Requirement 4: User Filter
**Objective:** As a GROWI user, I want to filter search results by a specific team member, so that I can find pages that person created or last edited.

#### Acceptance Criteria
1. The Search Page shall provide a User filter control labeled "User" with the placeholder text "Search by creator or editor..." that allows the user to search for and select a GROWI user.
2. When a user is selected in the User filter, the Search Page shall display that user's display name in the filter control.
3. When the User filter is active, the Search Page shall return only pages for which the selected user is either the original creator or the most recent editor.
4. When the User filter is cleared, the Search Page shall return results without any user restriction.
5. If the user identifier in the URL parameter does not correspond to a known GROWI user, the Search Page shall display the User filter control in its default empty state.

---

### Requirement 5: Path Filter
**Objective:** As a GROWI user, I want to filter search results by page path prefix, so that I can scope my search to a specific section of the wiki hierarchy.

#### Acceptance Criteria
1. The Search Page shall provide a Path filter control that accepts a GROWI page path prefix as input.
2. When a path prefix is entered and applied, the Search Page shall return only pages whose path begins with the specified prefix.
3. While the Path filter is active, the Search Page shall display the entered prefix value in the filter control.
4. When the Path filter is cleared, the Search Page shall return results without any path restriction.

---

### Requirement 6: Created Date Filter
**Objective:** As a GROWI user, I want to filter search results by page creation date using quick presets, so that I can find recently created or historically created pages without manually entering date ranges.

#### Acceptance Criteria
1. The Search Page shall provide a Created Date filter control offering exactly four preset options: Last 7 Days, Last 30 Days, Last 90 Days, and Last Year (365 days).
2. When a preset is selected, the Search Page shall return only pages created within the corresponding time window ending at the current moment.
3. While a Created Date preset is active, the Search Page shall display the selected preset label in the filter control.
4. When the Created Date filter is cleared, the Search Page shall return results without any creation-date restriction.
5. When the search page loads with a Created Date preset parameter in the URL, the Search Page shall pre-select and apply that preset immediately.
6. If the Created Date preset value in the URL does not correspond to a recognized preset, the Search Page shall silently ignore it and display the filter control in its default empty state.

---

### Requirement 7: Updated Date Filter
**Objective:** As a GROWI user, I want to filter search results by the date pages were last updated using quick presets, so that I can find recently modified or stale pages without manually entering date ranges.

#### Acceptance Criteria
1. The Search Page shall provide an Updated Date filter control offering exactly four preset options: Last 7 Days, Last 30 Days, Last 90 Days, and Last Year (365 days).
2. When a preset is selected, the Search Page shall return only pages last updated within the corresponding time window ending at the current moment.
3. While an Updated Date preset is active, the Search Page shall display the selected preset label in the filter control.
4. When the Updated Date filter is cleared, the Search Page shall return results without any update-date restriction.
5. When the search page loads with an Updated Date preset parameter in the URL, the Search Page shall pre-select and apply that preset immediately.
6. If the Updated Date preset value in the URL does not correspond to a recognized preset, the Search Page shall silently ignore it and display the filter control in its default empty state.

---

### Requirement 8: Group Filter
**Objective:** As a GROWI user, I want to filter search results by user group, so that I can find pages authored by members of a specific team or project group.

#### Acceptance Criteria
1. The Search Page shall provide a Group filter control that allows the user to search for and select a GROWI user group as the filter criterion.
2. When a group is selected, the Search Page shall display the selected group's name in the filter control.
3. When the Group filter is active, the Search Page shall return only pages whose original creator is a member of the selected user group.
4. When the Group filter is cleared, the Search Page shall return results without any group restriction.
5. If the group identifier in the URL parameter does not correspond to a known GROWI user group, the Search Page shall display the Group filter control in its default empty state.

---

### Requirement 9: Server-Side Filter Application
**Objective:** As a GROWI operator, I want the search API to accept and correctly apply the new filter parameters, so that client-side filter selections translate into accurate, narrowed search results.

#### Acceptance Criteria
1. When one or more filter controls are active, the Search Page shall include the corresponding filter parameters in the search request sent to the server.
2. The Search API shall accept a user filter parameter and return only pages where the specified user is either the original creator or the most recent editor of the page.
3. The Search API shall accept a path prefix parameter and return only pages whose path begins with the specified prefix.
4. The Search API shall accept a date preset parameter for creation date and translate the selected preset into the corresponding date range relative to the time of the request before applying it to search results.
5. The Search API shall accept a date preset parameter for update date and translate the selected preset into the corresponding date range relative to the time of the request before applying it to search results.
6. The Search API shall accept a group filter parameter, resolve the full list of user identifiers who are members of that group at query time, and return only pages whose original creator is among those members.
7. When filter parameters are absent from a search request, the Search API shall return results identical to current behavior, with no regression.
8. When multiple filter parameters are present, the Search API shall combine their effects using AND logic, further narrowing results beyond the keyword match.
9. If a user or group parameter value is not a valid GROWI user or group identifier, the Search API shall return an empty result set or a descriptive error response rather than a server error.
10. The Search API shall not modify or reinterpret the existing `q`, `sort`, `order`, `nq`, `limit`, or `offset` parameters when filter parameters are also present.

---

## Boundary Context
- **In scope**: Filter Bar display on the search page; User (creator OR editor), Path, Created Date (preset), Updated Date (preset), and Group (by creator membership) filter controls; URL query parameter sync for all filter state; server-side acceptance and application of filter parameters; AND-logic combination of active filters
- **Out of scope**: Free-form date range inputs (only presets are in scope); Tag filter UI; saved or named filter sets; mobile-specific FilterBar layout (the existing mobile search options modal is not changed); admin configuration of filters; changes to the Elasticsearch index schema; modifications to the existing `?q=` keyword parameter format or the existing sort/order/pagination controls; filtering pages by which groups they are *granted to* (the Group filter targets creator membership, not page grants)
- **Adjacent expectations**: When no filters are active, the search API must return results identical to current behavior. The existing keyword matching, sort, order, and pagination controls must function correctly alongside any active filters. URL parameters `q`, `sort`, `order`, `nq`, `limit`, and `offset` must remain unaffected by filter operations.
