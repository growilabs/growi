# Sourcing the wiki tree (Vault adapter)

The evaluator reasons against **"the wiki tree"** — the page hierarchy plus the content
of the pages it needs to judge. Keep that abstraction in your reasoning. *How* the tree
is physically obtained is an adapter detail that will change; the judgment logic must not.

## The target abstraction: GROWI Vault

The intended source is **GROWI Vault** — a feature that exposes a user's wiki as a local
git clone, so the whole tree is a set of `.md` files on disk (`/A/B/C` → `A/B/C.md`).
When Vault exists, sourcing the tree is just reading local files: `grep`, `glob`, `read`.
That is the world the skill is written for.

**Vault is not implemented yet** (`.kiro/specs/growi-vault/` is approved but
`ready_for_implementation: false`). So today the tree comes from a live GROWI instance
through the API adapter below. When Vault lands, replace this section — and nothing in
SKILL.md should need to change.

## Today's adapter: devcontainer GROWI search/page API

The same GROWI instance that suggest-path is called against (default: the local GROWI in
the devcontainer at `http://localhost:3000`) is the tree source. This keeps the tree and
the proposals consistent — they describe the same wiki.

Auth: an admin `access_token` as `?access_token=<token>`, matching how suggest-path is
called in step 1.

### Find candidate pages by keyword (search API)

```
GET http://localhost:3000/_api/search?q=<url-encoded-keywords>&limit=<N>
```

Returns matching pages; each hit's path is at `data[i].data.path`. Use this to discover
where similar existing documents live (step 3 — "where do similar documents sit?") and to
confirm whether a proposed path corresponds to a real page.

### Read a page's body (page API)

```
GET http://localhost:3000/_api/v3/page?pageId=<id>
```

Body is at `page.revision.body`. Use this when you need a candidate page's *content* to
judge content-to-location fit, not just its path string.

### Notes / pitfalls

- The search API tolerates the gateway/redirect quirks that the listing endpoints don't;
  prefer search + page-by-id over tree-listing endpoints, which can bounce to a login
  redirect when called without a browser session.
- Judge **content fit**, not path-string similarity. A path can string-match a surface
  word in the document yet be the wrong home (this is exactly the failure mode
  suggest-path itself has). Read enough page bodies to avoid repeating that mistake as
  the evaluator.
- Encode non-ASCII query terms (Japanese paths are common). 

## If neither Vault nor a live instance is available

Then the tree must be supplied some other way (a static export, a hand-provided path
list). Say so explicitly in the report and note that the judgment was made against a
partial tree — an evaluator that silently judged against an incomplete wiki would
overstate misses.
