# Search Filter Implementation Rules
- Brand new source code files specific to search filters must be created in `apps/app/src/features/search`. (Modifying existing shared server/service files to integrate these filters is permitted).
- Ensure all filters are compatible with the existing `SearchService` pipeline (`parseQueryString` → `resolveOperatorTerms` → `appendCriteriaForQueryString`).
- The editor resolution step must cap MongoDB queries at `EDITOR_PAGE_ID_LIMIT = 1000` page IDs to avoid query size blowout.
- ExternalUserGroup membership is resolved by approximation (member user IDs only); this is a known limitation, not a bug.
- The `group:` filter must use `{ terms: { granted_groups: [groupId, ...] } }` as its Elasticsearch clause — do not resolve to member usernames.
- Before building a `group:` clause, intersect the resolved group IDs against the requesting user's own group memberships (`userGroups` parameter); silently exclude any group the user does not belong to. A user must never be able to filter by a group they are not a member of.