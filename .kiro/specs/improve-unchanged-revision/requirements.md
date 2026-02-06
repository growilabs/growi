# Requirements Document

## Project Description (Input)

### Issue
- In PageRevisionTable, revisions with no actual content changes are displayed as "file without changes"
- In the old implementation, revisions with no diff from the previous revision were displayed in a simplified format
- At some version, the client stopped sending `previousRevision` when saving pages, causing the server to be unable to determine if a revision has changes

### Reference Sources
- API: `src/server/routes/apiv3/page/update-page.ts`
- Frontend logic: `src/client/components/PageEditor/PageEditor.tsx` (saveWithShortcut method)
- Frontend component: `src/client/components/PageHistory/PageRevisionTable.tsx`

### Technical Context
- The `IRevision` interface has an optional `hasDiffToPrev?: boolean` field
- The Revision model's `prepareRevision` method sets `hasDiffToPrev = body !== previousBody` only when `pageData.revision != null`
- The update-page API fetches `previousRevision` by `revisionId` from request body, and passes `previousRevision?.body ?? null` as `previousBody`
- When `revisionId` is not provided, `previousBody` becomes null, preventing accurate diff detection

## Requirements

### Requirement 1: Unchanged Revision Detection

**Objective:** As a GROWI user, I want the system to accurately detect when a page save operation produces a revision with no content changes, so that I can distinguish meaningful edits from unchanged saves in the page history.

#### Acceptance Criteria

1. When a page update request is received with revision content, the Page Update API shall retrieve the previous revision content for comparison
2. When comparing the new revision body with the previous revision body, the Page Update API shall determine if the content is identical (no diff)
3. When the new revision body is identical to the previous revision body, the Page Update API shall mark the revision with `hasDiffToPrev: false`
4. When the new revision body differs from the previous revision body, the Page Update API shall mark the revision with `hasDiffToPrev: true`
5. If the previous revision cannot be retrieved, the Page Update API shall default to `hasDiffToPrev: true` (assume changes exist)

### Requirement 2: Revision Metadata Persistence

**Objective:** As a system administrator, I want unchanged revision information to be persistently stored in the database, so that page history can be efficiently displayed without recalculating diffs on every request.

#### Acceptance Criteria

1. When a new revision is created, the Revision Model shall persist the `hasDiffToPrev` field value to the database
2. When retrieving revisions for page history, the Page Revisions API shall include the `hasDiffToPrev` field in the response
3. The `hasDiffToPrev` field shall be of type boolean or undefined (for backward compatibility with existing revisions)

### Requirement 3: Page History Display Enhancement

**Objective:** As a GROWI user, I want unchanged revisions to be displayed in a simplified format in the page history, so that I can quickly identify meaningful changes without visual clutter from unchanged saves.

#### Acceptance Criteria

1. When rendering a revision in PageRevisionTable, the component shall check the `hasDiffToPrev` field value
2. When `hasDiffToPrev` is `false`, the Revision component shall render the simplified no-diff format (showing only user picture, timestamp, and "No diff" label)
3. When `hasDiffToPrev` is `true` or `undefined`, the Revision component shall render the full revision format (showing user picture, username, timestamp, "Go to this version" link, and diff controls)
4. The simplified no-diff format shall use smaller visual space compared to the full format

### Requirement 4: Previous Revision Reference in Update Requests

**Objective:** As a frontend developer, I want the page editor to send the previous revision ID when saving pages, so that the server can accurately determine if the content has changed.

#### Acceptance Criteria

1. When the page editor initiates a save operation, the frontend shall include the current revision ID as `revisionId` in the update request
2. When the save is triggered by keyboard shortcut (saveWithShortcut), the frontend shall include the revision ID if required by configuration
3. If the revision ID is required for page updates (`isRevisionIdRequiredForPageUpdate`), the frontend shall not allow save operations without a valid revision ID

### Requirement 5: Backward Compatibility with Existing Revisions

**Objective:** As a system operator, I want the page history to gracefully handle existing revisions that do not have `hasDiffToPrev` metadata, so that the system continues to function correctly after the update without requiring data migration.

#### Acceptance Criteria

1. When a revision is retrieved without a `hasDiffToPrev` field (undefined), the PageRevisionTable shall treat it as `hasDiffToPrev: true` (assume changes exist)
2. When displaying page history containing both old revisions (without `hasDiffToPrev`) and new revisions (with `hasDiffToPrev`), the component shall render both types correctly
3. The system shall not require a database migration to populate `hasDiffToPrev` for existing revisions

### Requirement 6: API Consistency and Error Handling

**Objective:** As a backend developer, I want the page update API to handle edge cases in revision comparison gracefully, so that the system remains stable even when unexpected conditions occur.

#### Acceptance Criteria

1. If the previous revision body is null or undefined during comparison, the Page Update API shall set `hasDiffToPrev: true`
2. If an error occurs while fetching the previous revision, the Page Update API shall log the error and set `hasDiffToPrev: true`
3. When creating the first revision for a new page (no previous revision exists), the Page Update API shall not set the `hasDiffToPrev` field (leave as undefined)
4. The Page Update API shall handle both string comparison for body content and properly normalize line endings (CR/CRLF to LF) before comparison


