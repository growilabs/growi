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

## Excluding `/user` pages with git sparse-checkout

To clone a vault while excluding all personal pages stored under `user/`, use git sparse-checkout:

```bash
git clone --no-checkout <url> my-growi-vault
cd my-growi-vault
git sparse-checkout init --cone
git sparse-checkout set '/*' '!/user'
git checkout HEAD
```

> **Important**: sparse-checkout only controls which files are materialized in your **working tree**. It does not affect the objects transferred from the server — the full history is still fetched. To limit server-side object delivery, a partial-clone filter (e.g. `--filter=blob:none`) is needed in addition to sparse-checkout.

---

## MVP Scope Limitations

The following items are **not supported** in the current MVP:

- **`git push` (write-back)** — the vault is read-only; changes made to Markdown files in the vault are not written back to GROWI.
- **Attachments** — binary files attached to pages are not exported.
- **Per-page metadata** — comments, likes, bookmarks, tags, and similar social/annotation metadata are not exported.
- **Revision history before feature activation** — only revisions created after the vault feature is enabled are captured; pre-existing history is not back-filled.
- **Drafts and unpublished pages** — only published pages are exported to the vault.

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
