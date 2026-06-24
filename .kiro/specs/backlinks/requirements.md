# Requirements Document

## Project Description (Input)

### Who has the problem
GROWI wiki users — **readers** who want to discover related content and gauge a
page's importance, and **editors** who need to see what references a page before
they change, rename, or delete it. Administrators are also affected, since they
own large, aging wikis where reference integrity degrades over time.

### Current situation
GROWI renders the **outgoing** links contained in a page's body, but provides no
way to see **incoming** links — there is no "what links here" view. As a result,
related pages drift out of mutual awareness, and editors rename or delete pages
without visibility into what links to them, silently breaking references.

### What should change
Add a **"Backlinks"** feature that shows, on each page, which other pages link to
it, and keeps that information accurate and performant as the wiki changes.

---

### Scope (delivered incrementally)
- A backlinks panel on a page listing pages that link to it, filtered by the
  viewer's read permissions (page grants).
- Backlink relationships kept in sync as pages are created, edited, and deleted,
  so backlinks are fast and accurate at scale.
- A one-time process to backfill backlinks for all pre-existing pages.
- Link integrity when a page is renamed/moved: inbound links must follow the new
  path or be clearly flagged, not silently break.
- Broken-link handling when a linked page is deleted (shown as broken, not
  silently dropped), including trash/soft-delete vs. permanent delete.
- Support for both standard Markdown links and GROWI wiki-links.

### Out of scope
- A wiki-wide health/analytics dashboard (future feature).
- Any outbound automation / webhooks.

## Introduction

This feature adds **Backlinks** to GROWI: on any page, a list of the other pages
that link to it ("what links here"). GROWI today renders a page's outgoing links
but offers no view of incoming links, so related pages drift out of awareness and
editors break references when they rename or delete pages.

Backlinks must reflect GROWI's existing behavior to be trustworthy: it must honor
the page grant/permission model (never exposing a page a viewer cannot read), stay
accurate as pages change through GROWI's normal lifecycle (create, update, move,
soft-delete to trash, restore, and permanent delete), and recognize both link
forms GROWI supports — standard Markdown links (`[text](/path)`) and wiki-links
(`[[alias>/path]]`, where the link target is the part after `>`). The
requirements below describe the complete feature; the
order of delivery is tracked separately in the implementation backlog.

## Boundary Context

- **In scope**: presenting incoming links (backlinks) per page; recognizing
  links from a page's rendered content — Markdown links, wiki-links, and raw HTML
  anchors — that target internal pages; filtering by the viewer's read permission;
  keeping backlinks current as pages are created, updated, moved/renamed,
  trashed, restored, and permanently deleted; a one-time backfill for
  pre-existing pages; indicating trashed/broken link targets.
- **Out of scope**: a wiki-wide health/analytics dashboard; outbound automation or
  webhooks; a visual link-graph; and any change to GROWI's permission model, page
  lifecycle behavior, or Markdown/wiki-link syntax.
- **Adjacent expectations**: the feature relies on — but does not own or modify —
  GROWI's page grant/permission model, its page lifecycle events
  (create/update/move/trash/restore/delete), its existing rename-redirect
  behavior, and its Markdown and wiki-link parsing. It consumes these as they are.

## Requirements

### Requirement 1: View backlinks on a page
**Objective:** As a reader, I want to see which pages link to the page I am viewing, so that I can discover related content and judge the page's importance.

#### Acceptance Criteria
1. When a user views a page, the Backlinks feature shall display the list of other pages that link to it.
2. The Backlinks feature shall treat as a link any anchor in the page's rendered content that targets an internal page, regardless of whether it was authored as a standard Markdown link (`[text](/path)`), a GROWI wiki-link (`[[alias>/path]]`, where the link target is the part after `>`), or raw HTML (`<a href="/path">`).
3. The Backlinks feature shall not treat external URLs or in-page anchors (`#…`) as links for the purpose of backlinks.
4. Because links are recognized from rendered content rather than source text, the Backlinks feature shall not treat link-like text inside code spans or code blocks as a link.
5. When a single source page links to the viewed page more than once, the Backlinks feature shall list that source page only once.
6. The Backlinks feature shall exclude a page's link to itself from that page's backlinks.
7. When no other page links to the viewed page, the Backlinks feature shall present an explicit empty state.
8. For each backlink, the Backlinks feature shall show the linking page's title and path.

### Requirement 2: Permission-aware backlinks
**Objective:** As a reader, I want backlinks limited to pages I am allowed to see, so that the feature never reveals restricted content.

#### Acceptance Criteria
1. While a user is viewing a page, the Backlinks feature shall include only linking pages that the user is permitted to read under GROWI's page grant model.
2. If a linking page is not readable by the current user, then the Backlinks feature shall omit it from both the displayed list and any count derived from it.
3. The Backlinks feature shall not reveal the title, path, or existence of any page the current user is not permitted to read.
4. When a linking page's grant changes so that it becomes readable or unreadable for a user, the Backlinks feature shall reflect that change in what the user sees.

### Requirement 3: Backlinks stay accurate and performant as pages change
**Objective:** As a reader on a large wiki, I want backlinks to stay correct and load quickly as pages change, so that the feature is reliable at scale.

#### Acceptance Criteria
1. When a page is created, the Backlinks feature shall make its links appear as backlinks on the pages it links to.
2. When a page is updated to add or remove a link, the Backlinks feature shall reflect that change in the affected pages' backlinks.
3. When a page is deleted, the Backlinks feature shall no longer present that page as an active source of backlinks.
4. The Backlinks feature shall retrieve and display a page's backlinks in interactive time (under approximately one second) on wikis containing at least 100,000 pages.

### Requirement 4: Complete backlinks for pre-existing pages
**Objective:** As an administrator, I want backlinks to cover content that existed before the feature was enabled, so that backlinks are complete rather than only reflecting recent edits.

#### Acceptance Criteria
1. Where pages existed before the Backlinks feature was enabled, the Backlinks feature shall provide a one-time process that makes the links within those pages discoverable as backlinks.
2. When the one-time process completes, the Backlinks feature shall present backlinks from pre-existing pages equivalently to backlinks created after enablement.
3. If the one-time process is run more than once, then the Backlinks feature shall not produce duplicate backlinks.

### Requirement 5: Link integrity when a page is renamed or moved
**Objective:** As an editor, I want links to a page to survive its rename or move, so that references are not silently broken.

#### Acceptance Criteria
1. When a page is renamed or moved, the Backlinks feature shall continue to associate pages that linked to the page's previous location with the page at its new location.
2. When a page that has descendant pages is moved, the Backlinks feature shall apply the same re-association to each descendant page.
3. If a reference cannot be automatically re-associated after a move, then the Backlinks feature shall surface it as a broken reference rather than silently discarding it.

### Requirement 6: Broken-link handling on deletion
**Objective:** As an editor, I want links to deleted pages surfaced as broken, so that I can find and fix them rather than have them silently disappear.

#### Acceptance Criteria
1. When a page is moved to trash (soft-deleted), the Backlinks feature shall mark references pointing to it as pointing to a trashed, recoverable page rather than removing the relationship.
2. When a page is permanently deleted, the Backlinks feature shall mark references pointing to it as broken.
3. If a trashed page is restored, then the Backlinks feature shall return references that pointed to it to a normal (non-broken) state.
4. When an editor views a page that links to a trashed or permanently deleted page, the Backlinks feature shall indicate that the link target is trashed or deleted.
