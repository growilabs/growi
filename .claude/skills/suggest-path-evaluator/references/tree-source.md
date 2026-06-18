# Sourcing the wiki tree and page content (Vault adapter)

The evaluator reasons against **"the wiki"** — the page hierarchy plus the **content** of the
pages it needs to judge. Both phases need content, not just path strings:

- **Phase A** reads each candidate level's page (or, for a box page, its children's titles +
  snippets) to judge content-to-location fit.
- **Phase B** drills down from the root: at each level it lists the children (titles +
  snippets), then reads the full body of the few it keeps, to find the document's ideal home.

Keep that abstraction in your reasoning. *How* the pages are physically obtained is an adapter
detail that will change; the judgement logic must not.

## The target abstraction: GROWI Vault

The intended source is **GROWI Vault** — a feature that exposes a user's wiki as a local git
clone, so the whole tree is a set of `.md` files on disk (`/A/B/C` → `A/B/C.md`). When Vault
exists, sourcing the tree is just reading local files: `grep`, `glob`, `read`; listing a node's
children is listing a directory; reading a body is reading a file. That is the world the skill
is written for.

**Vault is not implemented yet** (`.kiro/specs/growi-vault/` is approved but
`ready_for_implementation: false`). So today the pages come from the live GROWI instance's
MongoDB through the adapter below. When Vault lands, replace this section — and nothing in
SKILL.md should need to change.

## Today's adapter: devcontainer GROWI via MongoDB direct-read

The pages come straight from MongoDB in the **devcontainer** — the same GROWI instance
suggest-path is called against (so the wiki and the proposals describe the same wiki). This
replaces the previous HTTP adapter: the dev server on `http://localhost:3000` is **not reliably
up** (and the listing endpoints bounce to a login redirect without a browser session), but the
Mongo data is present and queryable regardless of whether the web server is running.

> **Data presence (verified 2026-06-18):** `pages` ≈ 1612, `revisions` ≈ 13564, ~280 pages
> under the `/資料` area. Enough to drill down and judge content fit.

### Where the data lives

- **`pages` collection** — one doc per page. Fields you need: `path` (full path, e.g. `/A/B/C`),
  `_id`, `revision` (ObjectId pointing at the current revision), `descendantCount`, `isEmpty`
  (an empty/box page that exists only to group children), `grant`.
- **`revisions` collection** — `body` (the Markdown) lives here, at the doc whose `_id` equals
  the page's `revision`. A page whose `revision` body is just `$lsx()` (or `isEmpty`) is a
  **box** — read its children to learn what it groups.

A **box page** in SKILL.md = `isEmpty: true`, or a non-existent intermediate path (a `/A/B/C`
page with no `/A/B` doc), or a page whose body is only `$lsx(...)`.

### Running queries from the host

`mongosh` is not installed; use the **bundled MongoDB driver via `node`**, executed inside the
devcontainer with `docker exec`. Author the script on the host (where `mongo` does not resolve
as a hostname), then run it in the container (where it does).

```bash
# Git Bash on the host: MSYS_NO_PATHCONV=1 stops Git Bash from mangling the in-container
# absolute path (//tmp/...). Write the script to the container's /tmp, then run it there.
MSYS_NO_PATHCONV=1 docker exec <container> node //tmp/your-query.js
```

The driver lives under the app's pnpm store **in the current container layout**:

```
/workspace/growi/node_modules/.pnpm/mongodb@6.8.0_<hash>/node_modules/mongodb
```

> **⚠ driver path drift.** The path is `/workspace/growi/...` in the current container. Older
> notes (and the repo's `devcontainer.md`) show `/workspace/growi-vault/...` — that is **stale**.
> Glob the actual `.pnpm/mongodb@*/node_modules/mongodb` dir inside the container before
> hard-coding the hash; pnpm hashes change with lockfile updates.

Connection string (replica set is required):

```
mongodb://mongo:27017/growi?replicaSet=rs0
```

### Access pattern 1 — a candidate's page + its children (Phase A, box identity)

Given a candidate path, fetch the page, its body, and (if it is a box) its direct children with
snippets:

```js
const { MongoClient } = require('/workspace/growi/node_modules/.pnpm/mongodb@6.8.0_<hash>/node_modules/mongodb');
const SNIPPET = 120; // chars; measured light (~505 chars/case avg across a candidate's levels)

async function main() {
  const client = new MongoClient('mongodb://mongo:27017/growi?replicaSet=rs0');
  await client.connect();
  const db = client.db('growi');
  const pages = db.collection('pages');
  const revisions = db.collection('revisions');

  const path = process.argv[2];

  // the candidate page itself + its body
  const page = await pages.findOne({ path });
  const body = page?.revision ? (await revisions.findOne({ _id: page.revision }))?.body : null;

  // its direct children (one level down), with snippets — to read a box's identity
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // metachar-only escape (PCRE2-safe)
  const children = await pages
    .find({ path: new RegExp(`^${escaped}/[^/]+$`) })
    .project({ path: 1, revision: 1, isEmpty: 1 })
    .limit(60)
    .toArray();
  const withSnippets = await Promise.all(children.map(async (c) => ({
    path: c.path,
    isEmpty: c.isEmpty,
    snippet: c.revision ? ((await revisions.findOne({ _id: c.revision }))?.body ?? '').slice(0, SNIPPET) : '',
  })));

  console.log(JSON.stringify({ path, isEmpty: page?.isEmpty, body: body?.slice(0, 400), children: withSnippets }, null, 2));
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

### Access pattern 2 — list a node's children (Phase B, beam descent)

The descent is "list current node's children → keep the plausible ones → read their full bodies
→ descend into the best". The child-listing is the same query as pattern 1's `children` block
(one level down, with snippets); reading a kept child's **full body** is
`revisions.findOne({ _id: child.revision }).body` (no `.slice`). Start the descent from the root
by listing top-level pages (`path` matching `^/[^/]+$`).

Reuse pattern 1's `children` read at each level — Phase A and Phase B share this access.

### Notes / pitfalls

- **Escape the path for the regex.** Paths are full of non-ASCII (Japanese) and may contain
  regex metacharacters. Use a **metachar-only** escape (as above) — do **not** use
  `RegExp.escape()` for a Mongo-bound pattern: it encodes non-ASCII whitespace as `\uXXXX`, which
  MongoDB's PCRE2 rejects (`code 51091`). See the repo's `mongodb-regex` rule. The metachar-only
  escape passes non-ASCII through literally and is PCRE2-safe.
- **Judge content fit, not path-string similarity.** A path can string-match a surface word in
  the document yet be the wrong home — exactly suggest-path's own failure mode. Read enough
  bodies (snippets for breadth, full bodies for the few you descend into) to avoid repeating that
  mistake as the evaluator.
- **Boxes are common** — a large share of candidate levels are `$lsx()`-only / empty grouping
  pages. Don't judge a box from its path name; read its children.
- **Server-running is not required.** This adapter reads Mongo directly, so it works whether or
  not the dev web server is up. (suggest-path itself, in Step 0, does need a reachable endpoint —
  MCP or the HTTP route; if the server is down, get the proposals via MCP.)

## If neither Vault nor the devcontainer Mongo is available

Then the tree must be supplied some other way (a static export, a hand-provided path list +
bodies). Say so explicitly in the report and note that the judgement was made against a partial
tree — an evaluator that silently judged against an incomplete wiki would overstate both misses
and ×'s (and Phase B could not run, so the ○-vs-△ split would be unreliable).
