# growi-vault-manager

Exports GROWI pages to a git repository (vault) in Markdown format.

---

## Path-to-Filename Mapping Rules

`VaultPathMapper` converts a GROWI page path into a deterministic git-tree file path. The same page path always produces the same file path, so the vault can reconstruct any file path from a page record without a reverse-index collection. The last two rules below (case collision and length) are applied per vault view when the view's tree is composed, because whether a name collides depends on which pages the view contains.

These rules are versioned (v1) and are **immutable after the first release**.

> The length rule was added in v1.0.1 ([#11596](https://github.com/growilabs/growi/issues/11596)). It leaves every name that already fitted in 255 bytes byte-for-byte unchanged, so an existing clone only sees the names that no client could check out before. Lowering the 255-byte budget later would rename names that work today, and is therefore treated as a breaking change.

### Encoding rules (applied in order)

| Rule | Trigger | Transform |
|------|---------|-----------|
| Windows reserved characters | `<` `>` `:` `"` `/` `\` `\|` `?` `*` appear in a segment | Percent-encode each character (e.g. `<` → `%3C`, `*` → `%2A`) |
| Control characters | U+0000–U+001F or U+007F (DEL) appear in a segment | Percent-encode each character |
| Leading / trailing spaces | Segment starts or ends with a space | Percent-encode the space (`%20`) |
| Windows reserved filename | Segment stem matches `CON`, `PRN`, `AUX`, `NUL`, `COM0-9`, `LPT0-9` (case-insensitive) | Prepend `_` to the segment (e.g. `CON` → `_CON`) |
| Case collision (collision-only) | Two or more page paths in the same vault view differ only in case within the same directory (e.g. `/Foo` and `/foo` both exist) | Append `__<hash8>` suffix to the **last** filename component before the `.md` extension for **each colliding path**, where `hash8` is the first 8 characters of `sha1(<file path before the suffix>)` |
| Name longer than 255 bytes (length-only) | A filename component is longer than 255 UTF-8 bytes — the per-component limit on ext4 / APFS. A Japanese page title reaches it at 85 characters | Shorten the component (cutting only on character boundaries) and append the same `__<hash8>` suffix, so that the whole name fits in 255 bytes |
| Orphan pages | Path is `/trash` or starts with `/trash/` | Prefix the entire relative path with `_orphaned/` |
| Extension | All pages | Append `.md` to the final filename component |

> **Case collision is reactive**: the suffix is added only when a collision actually exists and disappears automatically if the collision resolves (e.g. one of the conflicting pages is deleted or its access grant changes).

> **Shortening applies to the finished name**: the 255-byte budget is checked against the name *including* its suffix and extension, because the 10-byte `__<hash8>` can by itself push a name that would otherwise fit over the limit. A name that already fits is never rewritten. Two shortened names that begin with the same characters stay distinct, because their hashes are taken from their full (pre-shortening) paths.

### Examples

| GROWI page path | Condition | Resulting file path |
|----------------|-----------|---------------------|
| `/normal/page` | — | `normal/page.md` |
| `/Sandbox/Markdown` | no collision | `Sandbox/Markdown.md` |
| `/Sandbox` | no collision; has child pages | `Sandbox.md` (folder `Sandbox/` coexists) |
| `/Foo` | `/Foo` and `/foo` both exist in same view | `Foo__daf05ac8.md` (`daf05ac8` = `sha1('Foo.md')[0..7]`) |
| `/foo` | `/Foo` and `/foo` both exist in same view | `foo__3f9791a2.md` (`3f9791a2` = `sha1('foo.md')[0..7]`) |
| `/ああ…あ` (85 Japanese characters) | name would be 258 bytes | `ああ…あ__17e5a70f.md` — first 80 characters kept (240 bytes), 253 bytes in total |
| `/CON/notes` | — | `_CON/notes.md` |
| `/page<name` | — | `page%3Cname.md` |
| `/page*name` | — | `page%2Aname.md` |
| `/trash/old-page` | — | `_orphaned/trash/old-page.md` |
| `/trash/A/B` | no collision | `_orphaned/trash/A/B.md` |

> **Note on `/`**: The forward-slash is GROWI's path separator and is split into segments before encoding. A literal `/` that appears inside a segment would be encoded as `%2F`, but GROWI path semantics make this impossible in practice.

> **Note on parent pages with children**: A page that has child pages does **not** produce a `README.md` inside a folder. Instead, the page's own content is stored as `<name>.md` alongside the `<name>/` folder that contains its children (e.g. `Sandbox.md` next to `Sandbox/`).

### `mapPrefix` (directory prefix variant)

`mapPrefix(pagePath)` applies the same segment encoding and reserved-name prefixing but does **not** append `.md` and does **not** add the `__<hash8>` suffix. It is used for rename-prefix and grant-change-prefix instructions where only the directory portion matters.

---

## Excluding `/user` pages from a clone

To clone a vault without the personal pages stored under `user/`:

```bash
git clone --filter=sparse:oid=ab678fd8055db49e954e61acfdb76add2a6291b9 --no-checkout <url> my-growi-vault
cd my-growi-vault
git sparse-checkout init --no-cone
printf '/*\n!/user\n' | git sparse-checkout set --stdin
git checkout HEAD
```

Both halves are needed, and they do different jobs:

- **`--filter=sparse:oid=<object name>` is what shrinks the transfer.** It names a blob in the repository holding the pattern set `/*` and `!/user`, and the server applies those patterns before building the pack — the excluded page bodies are never sent. Measured on a 20,000-page view with a quarter of the pages under `user/`: 6.3 MB → 4.8 MB, in a single request.
- **`git sparse-checkout` decides what lands in your working tree.** On its own it transfers nothing less; combined with the filter it also has to be set to the *same* patterns, so your checkout never asks for a page body the server left out.

The object name is fixed: it is the content address of those exact patterns, so it only changes if the published pattern set does. The server keeps the blob anchored to a ref of its own so garbage collection cannot remove it.

Two details of the sparse-checkout call are easy to get wrong:

- **`--no-cone` is required.** Cone mode cannot express an exclusion, so `git sparse-checkout set '/*' '!/user'` fails with `fatal: specify directories rather than patterns (no leading slash)`, and the `git checkout` that follows then leaves you with an *empty* working tree rather than one without `user/`.
- **Pass the patterns on stdin.** On Git Bash (MSYS) an argument that looks like an absolute path is rewritten before git ever sees it, which mangles `!/user`. Reading from `--stdin` sidesteps that, and also avoids per-shell quoting differences.

### What the filtered clone can and cannot do afterwards

The clone is a partial clone: git records `remote.origin.promisor=true` and `remote.origin.partialclonefilter` locally. Ordinary work inside it (`git status`, `git log`, `git pull`, grepping the checked-out files) behaves normally.

What it cannot do is obtain the excluded pages later. The server never lets a client ask for an object by name, so a command that needs one of those bodies stops at:

```console
error: Server does not allow request for unadvertised object <object name>
fatal: could not fetch <object name> from promisor remote
```

If you need the personal pages, take a fresh clone without the filter.

### Other filters are refused

`sparse:oid` with a published pattern set is the only filter this server serves. Anything else — `blob:none`, `blob:limit`, `tree:<n>`, `object:type`, `combine:`, or a `sparse:oid` naming some other object — is refused when the clone starts:

```console
$ git clone --filter=blob:none <url> my-growi-vault
fatal: remote error: vault: unsupported partial-clone filter; this server serves only --filter=sparse:oid=<published spec> (see the vault-manager README)
```

Those filters all work the same way: the server sends a pack with the file bodies left out, and the client then fetches each missing object **by name** as it needs it. Naming objects is exactly what a client is not allowed to do here (a view scopes which refs it can see, not which objects exist), so such a clone would break at its first checkout rather than at the clone. It is refused up front instead.

### `--depth=1`

A shallow clone works but saves little: each view's history is squashed to a single parentless commit whenever it exceeds `VAULT_SQUASH_COMMIT_THRESHOLD` commits (default 1000) or `VAULT_SQUASH_AGE_HOURS` (default 1), so there is not much history to omit in the first place. What dominates the transfer is the current snapshot, not the history.

---

## MVP Scope Limitations

The following items are **not supported** in the current MVP:

- **`git push` (write-back)** — the vault is read-only; changes made to Markdown files in the vault are not written back to GROWI.
- **Attachments** — binary files attached to pages are not exported.
- **Per-page metadata** — comments, likes, bookmarks, tags, and similar social/annotation metadata are not exported.
- **Revision history before feature activation** — only revisions created after the vault feature is enabled are captured; pre-existing history is not back-filled.
- **Drafts and unpublished pages** — only published pages are exported to the vault.
- **Partial-clone filters other than the published `sparse:oid` specs** — `blob:none`, `blob:limit`, `tree:<n>`, `object:type` and `combine:` are refused when the clone starts, because each of them leaves the client to fetch objects by name afterwards and the server does not serve those requests (see above).
- **Client-chosen exclusion patterns** — the transfer can only be narrowed by a pattern set the server publishes; there is currently one (`user/` excluded).
- **Fetching an excluded page into a filtered clone** — the server never serves a request for an object by name, so the pages a filter left out cannot be obtained later. Take a fresh clone without the filter instead.

### Known limitation: long paths on Windows

Individual filenames are kept within 255 bytes (see the mapping rules above), but Windows additionally limits a **whole** path to 260 characters unless long paths are enabled. A deeply nested page tree can exceed that even when every single name is short, and `git checkout` aborts the entire operation on the first path it cannot create. Clients on Windows should enable long paths before cloning:

```bash
git config --global core.longpaths true
```

---

## Docker image (DHI multi-stage build)

The `apps/growi-vault-manager/docker/Dockerfile` has been refactored to align with `apps/app/docker/Dockerfile`. The new build is a **5-stage multi-stage build** (`base` → `pruner` → `deps` → `builder` → `release`). The build stages run on the official `node:24-bookworm` image, and only the `release` stage runs on a [Docker Hardened Image](https://hub.docker.com/u/dhi) (`dhi.io/node:24-debian13-dev`). Because `vault-manager` spawns `git upload-pack` at runtime (see Requirement 10.3), the runtime stage uses the DHI **dev** variant so it retains a `git` binary (v2.30+). (Build stages stay on the official image because `corepack`'s global `pnpm` shim is not executable on the DHI dev image.)

Highlights of the refactor:

- `base` / `pruner` / `deps` / `builder` / `release` stages, with `turbo prune @growi/vault-manager --docker` driving the monorepo subset.
- `pnpm` activated via `corepack enable` (version pinned by the workspace `packageManager` field), with a cache-mounted `pnpm` store (`--mount=type=cache,id=pnpm,target=/pnpm/store`) — same approach as `apps/app/docker/Dockerfile`.
- A dedicated `Dockerfile.dockerignore` to shrink the build context.
- OCI standard labels (`org.opencontainers.image.source`, `title`, `description`, `vendor`, `authors`) on the release stage.
- **Non-root runtime**: `docker/docker-entrypoint.ts` (run via Node 24 type stripping) creates and chowns the bare repo on the shared `/data` volume as root, then drops to the `node` user (uid/gid 1000) via native `process.setuid/setgid` before exec'ing the app. This keeps `vault-manager` and `apps/app` on a single uid so they can share the `/data` volume (Requirement 10.3); no `gosu`/`setpriv` binary is needed.

### Releasing

The image is released through changesets, the same flow `@growi/core` and `@growi/pluginkit` use — there is no release branch and no RC version marker.

1. In the PR that changes `apps/growi-vault-manager/**` (or `packages/core` / `packages/logger`, which are compiled into the image), run `npx changeset` and give `@growi/vault-manager` a `patch` / `minor` / `major` bump. Update the "Supported tags" list in `docker/README.md` in the same PR — changesets does not manage that file.
2. Merging that PR makes changesets open or update a **Release Subpackages** PR against `master`, which bumps `package.json` and writes `CHANGELOG.md`.
3. Merging the Release Subpackages PR publishes the image. `.github/workflows/release-vault.yml` watches pushes to `master` that touch `apps/growi-vault-manager/package.json`, publishes when the version is a stable one with no `vault-manager/v<version>` tag yet, and creates that tag afterwards.

Because the gate is "stable version, not tagged yet", a push that edits `package.json` without releasing does nothing, and the same version can never be published twice.

### Cross-repository impact: `growi-docker-compose`

The separate [`growi-docker-compose`](https://github.com/growilabs/growi-docker-compose) repository consumes the published image, as an opt-in override in [`examples/growi-vault`](https://github.com/growilabs/growi-docker-compose/tree/master/examples/growi-vault). When the image is republished with a new major/minor, that override pins the tag and has to be updated there in a separate PR.

### CI compatibility: `.github/workflows/ci-vault.yml`

The Dockerfile refactor has **no direct effect** on `.github/workflows/ci-vault.yml`. The integration-test workflow does not run `docker build` against this Dockerfile; instead it:

1. Installs dependencies with `pnpm install --frozen-lockfile`.
2. Builds the package with `turbo run build --filter @growi/vault-manager`.
3. Launches the manager directly via `node dist/index.js` (alongside a `mongo:6.0` replica-set container started ad-hoc for change streams).
4. Runs `RUN_VAULT_INTEG=true` integration tests against `http://localhost:3001`.

Because the workflow never builds or runs the Dockerfile, changes to `Dockerfile` / `Dockerfile.dockerignore` cannot regress this CI job. Adding a `docker build` regression step to CI was considered and deferred; if it is added later, that change must be tracked as a new subtask of task 18.

### Manual verification checklist

Until `docker build` is wired into CI, the DHI-based image is verified manually. Run the following inside the devcontainer (or any host with Docker) after changes that touch `Dockerfile` / `Dockerfile.dockerignore`:

1. **Build the image** from the repository root:

   ```bash
   docker build -f apps/growi-vault-manager/docker/Dockerfile -t growi-vault-manager:local .
   ```

2. **Confirm the runtime has `git` v2.30+**:

   ```bash
   docker run --rm growi-vault-manager:local git --version
   ```

3. **Start the image** with the same env vars used by `ci-vault.yml`, pointing at a MongoDB replica set reachable from the container (e.g. a `mongo:6.0 --replSet rs0` container on the same Docker network):

   ```bash
   docker run --rm -p 3001:3001 \
     -e NODE_ENV=production \
     -e MONGO_URI='mongodb://<host>:27017/growi-vault-integ?replicaSet=rs0' \
     -e VAULT_MANAGER_INTERNAL_SECRET='test-secret-for-integration' \
     -e VAULT_REPO_PATH=/var/lib/growi-vault \
     growi-vault-manager:local
   ```

4. **Check `/health` returns 200**:

   ```bash
   curl -fsS http://localhost:3001/health
   ```

5. **Run the integration suite against the running image**:

   ```bash
   RUN_VAULT_INTEG=true \
   VAULT_MANAGER_BASE_URL=http://localhost:3001 \
   VAULT_MANAGER_INTERNAL_SECRET=test-secret-for-integration \
     pnpm --filter @growi/vault-manager test:integ
   ```

A run is considered green when steps 2 (`git --version` ≥ 2.30), 4 (`/health` returns 200), and 5 (integration tests pass) all succeed.
