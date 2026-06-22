# Implementation Plan

- [x] 1. Define member DTO types
  - Define three types in `apps/app/src/interfaces/user-group-member.ts`: `IUserGroupMember` (username/name), `RelatedGroupsMembers` (groupId → member array), `IResRelatedGroupsMembers` (API response type)
  - Verify TypeScript compiles successfully
  - _Requirements: 1.2, 3.4_

- [ ] 2. Core: Backend service and frontend hook
- [x] 2.1 (P) Implement the service to fetch active members by group and write unit tests
  - Create a service function in `apps/app/src/server/service/user-group/fetch-active-members-by-group.ts` that accepts a set of groups of both internal/external types and fetches their directly-belonging members, projecting only active users and only name/username fields
  - Only reference relations for the input groups; do not include members of parent or descendant groups
  - Unit tests (`fetch-active-members-by-group.spec.ts`): mixed internal+external groups correctly bundle members by groupId, inactive users are excluded, returned fields are name/username only (no email etc.), groups with no members return an empty array
  - `pnpm vitest run fetch-active-members` passes green
  - _Requirements: 1.2, 1.3, 2.2, 2.3, 3.4_
  - _Boundary: Backend/Service_

- [x] 2.2 (P) Add a frontend hook to lazily fetch the member map only when the modal is visible
  - Add the new hook next to the existing group-related hooks in `apps/app/src/stores/user.tsx`
  - While the argument is false, no request is sent; once true, calls the member fetch endpoint (`/user/related-groups/members`)
  - Return type is the SWR response type of `RelatedGroupsMembers`
  - TypeScript compiles successfully and the hook is exported from the file
  - _Requirements: 1.1_
  - _Boundary: Frontend/Store_

- [ ] 3. Integration: API route and GrantSelector UI
- [x] 3.1 (P) Implement the API endpoint to return the session user's group members and write integration tests
  - Create `apps/app/src/server/routes/apiv3/user/get-related-groups-members.ts` using the same factory pattern and same authorization (`accessTokenParser([SCOPE.READ.USER_SETTINGS.INFO], { acceptLegacy: true })` + `loginRequiredStrictly`) as the sibling endpoint (`get-related-groups.ts`)
  - Derive the group set server-side from the session (`getUserRelatedGroups(req.user)`), call the service, and return `res.apiv3({ membersByGroupId })`
  - Register the `/related-groups/members` route in `apps/app/src/server/routes/apiv3/user/index.ts`
  - Handler integration tests (supertest + mocks): returns 401 when not logged in; returns 200 for a logged-in general user with only the user's own groups in the map
  - _Requirements: 1.1, 2.1, 3.1, 3.2, 3.3, 3.5_
  - _Boundary: Backend/API_
  - _Depends: 2.1_

- [x] 3.2 (P) Implement per-group member list display and i18n labels in GrantSelector
  - Replace the L338 TODO in `apps/app/src/client/components/PageEditor/EditorNavbarBottom/GrantSelector.tsx`; use the modal open/close state (`isSelectGroupModalShown`) as the hook enable condition
  - For each group the user belongs to (`userRelatedGroups`), render the member name list corresponding to the groupId (fall back to `username` when `name` is empty)
  - Inside `<button>` elements, use only inline/inline-block elements (`<span>`, `<small>`, etc.); do not add block elements or interactive elements
  - When the only member matches the current user's `username`, display the i18n "only yourself" text
  - Do not add anything to the non-belonging group (`nonUserRelatedGrantedGroups`) section
  - Add the required translation keys to the `user_group` section of `apps/app/public/static/locales/en_US/translation.json` and `ja_JP/translation.json`
  - Opening the modal shows members under each group, and the "only yourself" text appears for groups where the user is the sole member
  - _Requirements: 1.1, 1.2, 1.4, 3.2_
  - _Boundary: Frontend/UI, i18n_
  - _Depends: 2.2_

- [x]* 4.1 Manual E2E verification of member display in GrantSelector (optional)
  - Start the dev server and open the GrantSelector modal in the editor for a group-limited page
  - Members (name) are displayed under belonging groups
  - The "only yourself" text appears for groups where the user is the only member
  - Members are not displayed for groups in `nonUserRelatedGrantedGroups`
  - _Requirements: 1.1, 1.2, 1.4, 3.1, 3.2_
