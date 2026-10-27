# Sourcing the wiki tree and page content (Vault adapter)

The evaluator reasons against **"the wiki"** — the page hierarchy plus the **content** of the
pages it needs to judge. Both phases need content, not just path strings:

- **Phase A** reads each candidate level's page (or, for a box page, its children's titles +
  snippets) to judge content-to-location fit.
- **Phase B** drills down from the root: at each level it lists the children (titles +
  snippets), then reads the full body of the few it keeps, to find the document's ideal home.

Keep that abstraction in your reasoning. *How* the pages are physically obtained is an adapter
detail; the judgement logic must not depend on it.

## The route: GROWI Vault (a local git clone of the wiki)

The source is **GROWI Vault** — a feature that exposes a wiki as a **bare git repo** you
`git clone` into a tree of `.md` files on disk. The path convention is:

- A page `/A/B/C` becomes the file `A/B/C.md`.
- If `/A/B/C` also has children, those live in the directory `A/B/C/`.
- So a page that has children appears **twice**: as `<name>.md` (its own body) **and** as
  `<name>/` (the directory holding its children). A **box page** (a grouping page with no real
  body — `$lsx()`-only or empty) still has a `<name>.md`, but its body says nothing; its
  identity is told by the contents of `<name>/`.

This makes every access the skill needs a plain **filesystem** operation, and it is the world
SKILL.md is written for:

| What the skill needs | On the Vault clone |
|----------------------|--------------------|
| List a node's children (Phase B descent; Phase A box identity) | `ls <name>/` |
| Read a page's own body | `read <name>.md` |
| Read a child's snippet / full body | `read <name>/<child>.md` |
| Is this a box page? | `<name>.md` body is empty / `$lsx()`-only |
| Find homes by **content**, not path string | `grep -rl "<term>" --include="*.md" .` |

Because it is just files, **content search is first-class**: `grep` over bodies finds candidate
homes the path strings alone would hide — which is exactly the recall signal Phase B needs, and
exactly the failure mode (path-string match ≠ content fit) the evaluator exists to catch.

> **Verified the route works (2026-06-30):** a fresh clone of the `public` namespace gave
> **774 `.md` files / 175 directories**. One real case was run end-to-end on it: Phase A read a
> candidate's `<name>.md` (an `$lsx()`-only box), `ls`-ed `<name>/` for its children, and read a
> child's snippet; Phase B listed the root, descended a directory, and read a kept child's full
> body; a body-`grep` for a term surfaced homes across unrelated subtrees. All three Phase A
> reads and the Phase B descent are plain `ls`/`read`; nothing needed Mongo. Don't assume any
> particular top-level layout, though — see the wiki-agnostic note below.

## Today's concrete source: the devcontainer GROWI Vault

The wiki the skill is run against is the **devcontainer GROWI** (the same instance suggest-path
is called against, so the tree and the proposals describe the same wiki). Vault lives in the
`support/mastra`-derived branches (e.g. `feat/184610-suggest-path-agentic-search`). Two
in-container processes back it:

- **vault-manager** (port `3001`) — maintains the bare repo and serves `git upload-pack`;
  `GET /health` → 200 means it is up.
- **apps/app** (port `3000`) — the GROWI app; drives the one-time bootstrap that fills the bare
  repo from MongoDB.

### Get the clone (the tree you read)

The bare repo is at `/tmp/growi-vault-repo` inside the container, with one ref **per ACL
namespace** (`refs/namespaces/{public,group-*,user-*-only-me}/refs/heads/main`). Evaluate
against the **`public`** namespace (the shared wiki). Clone it to a fixed working path
`/tmp/vault-clone`:

```bash
docker exec <container> sh -c '
  rm -rf /tmp/vault-clone && mkdir -p /tmp/vault-clone && cd /tmp/vault-clone
  git init -q
  git fetch -q file:///tmp/growi-vault-repo \
    "refs/namespaces/public/refs/heads/main:refs/heads/main"
  git checkout -q main
'
```

Then read `/tmp/vault-clone` with `ls` / `read` / `grep` per the table above. A handful of pages
with names over 255 bytes fail to check out (`File name too long`) and are skipped — the fetch
itself succeeds and all normal pages are present; note it if a case happens to land on one.

### If the Vault processes are not running

Bring them up first (the clone is only as fresh as the last bootstrap). The full, current
startup procedure (the ESM-migration fixes the dev build needs, the
`VAULT_BOOTSTRAP_ON_START=true` env, the bootstrap-state check, the long-page-name caveat) is
documented outside this skill — follow the **"GROWI Vault devcontainer setup"** runbook rather
than duplicating it here, since those fixes drift with the branch. Confirm `bootstrapState:
"done"` (read `vault_sync_state` in Mongo, or just check the clone has the expected page count)
before trusting the tree. The clone reflects the bare repo as of the last bootstrap; if the wiki
changed since, re-bootstrap, then re-clone.

## ★★ Keep it wiki-agnostic

The verified clone above is **one** wiki (an OSS-demo dataset whose top level is
`GROWI改善案/`, `GROWI村議議事録/`, `user/`, … — **not** a `/資料`-rooted layout, and there is
**no** `/資料` tree in it). Do **not** hard-code that layout, or any path string, into the
judgement. The Vault clone is just "the tree as files"; **infer this wiki's organization from
the tree you actually see**, exactly as SKILL.md requires. The filing convention differs per
wiki; the access mechanism (`ls`/`read`/`grep`) does not.

## Fallback: devcontainer MongoDB direct-read

Use this **only** when the Vault clone is unavailable (vault-manager down and can't be brought
up, bare repo missing, bootstrap never completed). It reads the **same** GROWI instance's data
straight from MongoDB, so the wiki it describes is identical to what Vault would expose — it is a
lower-level access path to the same tree, not a different wiki. (suggest-path itself, in Step 0,
still needs a reachable endpoint — MCP or the HTTP route — regardless of which source you use
here.)

### Where the data lives

- **`pages` collection** — one doc per page. Fields: `path` (full path, e.g. `/A/B/C`), `_id`,
  `revision` (ObjectId of the current revision), `descendantCount`, `isEmpty` (a box page that
  exists only to group children), `grant`.
- **`revisions` collection** — `body` (the Markdown) lives at the doc whose `_id` equals the
  page's `revision`. A page whose body is just `$lsx()` (or `isEmpty: true`) is a **box** — read
  its children to learn what it groups.

A **box page** = `isEmpty: true`, or a non-existent intermediate path (a `/A/B/C` page with no
`/A/B` doc), or a page whose body is only `$lsx(...)`.

### Running queries from the host

`mongosh` is not installed; use the **bundled MongoDB driver via `node`**, run inside the
container with `docker exec`. Author the script on the host (where `mongo` does not resolve as a
hostname), then run it in the container (where it does).

```bash
# Git Bash on the host: MSYS_NO_PATHCONV=1 stops Git Bash from mangling the in-container
# absolute path (//tmp/...). Write the script into the container, then run it there.
MSYS_NO_PATHCONV=1 docker exec <container> node //tmp/your-query.js
```

> **⚠ driver path drift.** The driver path is pnpm-hashed and changes with the lockfile. Glob
> the actual dir inside the container before hard-coding it:
> `ls -d /workspace/growi/node_modules/.pnpm/mongodb@*/node_modules/mongodb`. (As of
> 2026-06-30 the hoisted driver was `mongodb@4.17.2`; older notes show `mongodb@6.8.0` and
> `/workspace/growi-vault/...` — both stale.)

Connection string (replica set is required):

```
mongodb://mongo:27017/growi?replicaSet=rs0
```

### Access pattern 1 — a candidate's page + its children (Phase A, box identity)

```js
const { MongoClient } = require('/workspace/growi/node_modules/.pnpm/mongodb@<ver>_<hash>/node_modules/mongodb');
const SNIPPET = 120; // chars

async function main() {
  const client = new MongoClient('mongodb://mongo:27017/growi?replicaSet=rs0');
  await client.connect();
  const db = client.db('growi');
  const pages = db.collection('pages');
  const revisions = db.collection('revisions');

  const path = process.argv[2];

  const page = await pages.findOne({ path });
  const body = page?.revision ? (await revisions.findOne({ _id: page.revision }))?.body : null;

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
→ descend into the best". The child-listing is pattern 1's `children` block; reading a kept
child's **full body** is `revisions.findOne({ _id: child.revision }).body` (no `.slice`). Start
the descent from the root by listing top-level pages (`path` matching `^/[^/]+$`). Phase A and
Phase B share this access — read a node's children once and reuse it.

### Notes / pitfalls (fallback)

- **Escape the path for the regex.** Paths are full of non-ASCII (Japanese) and may contain
  regex metacharacters. Use a **metachar-only** escape (as above) — do **not** use
  `RegExp.escape()` for a Mongo-bound pattern: it encodes non-ASCII whitespace as `\uXXXX`,
  which MongoDB's PCRE2 rejects (`code 51091`). See the repo's `mongodb-regex` rule.
- **Judge content fit, not path-string similarity.** A path can string-match a surface word yet
  be the wrong home — exactly suggest-path's own failure mode. Read enough bodies (snippets for
  breadth, full bodies for the few you descend into).
- **Boxes are common** — a large share of candidate levels are `$lsx()`-only / empty grouping
  pages. Don't judge a box from its path name; read its children.
- **Server-running is not required for this fallback** — it reads Mongo directly, so it works
  whether or not the dev web server is up.

## If neither Vault nor the devcontainer Mongo is available

Then the tree must be supplied some other way (a static export, a hand-provided path list +
bodies). Say so explicitly in the report and note that the judgement was made against a partial
tree — an evaluator that silently judged against an incomplete wiki would overstate both misses
and ×'s (and Phase B could not run, so the ○-vs-△ split would be unreliable).
