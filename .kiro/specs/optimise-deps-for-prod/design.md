# Design Document: optimise-deps-for-prod

## Overview

This feature corrects the `devDependencies` / `dependencies` classification in `apps/app/package.json` for packages that Turbopack externalises at SSR runtime. When webpack was the bundler, all imports were inlined into self-contained chunks, making `devDependencies` sufficient. Turbopack instead loads certain packages at runtime via `.next/node_modules/` symlinks; `pnpm deploy --prod` excludes `devDependencies`, breaking the production server.

**Purpose**: Restore a working production build and then minimise the `dependencies` set to only what is genuinely required at runtime.

**Users**: Release engineers and developers maintaining the production deployment pipeline.

**Impact**: Modifies `apps/app/package.json` and up to four source files; no changes to user-facing features or API contracts.

### Goals

- `pnpm deploy --prod` produces a complete, self-contained production artifact (Req 1)
- Minimise `dependencies` by reverting packages where technically safe (Req 2, 3, 4)
- Document the Turbopack externalisation rule to prevent future misclassification (Req 5)

### Non-Goals

- Changes to Turbopack configuration or build pipeline beyond `assemble-prod.sh`
- Refactoring of feature logic or component APIs unrelated to SSR behaviour
- Migration from Pages Router to App Router

---

## Requirements Traceability

| Requirement | Summary | Components | Flows |
|-------------|---------|------------|-------|
| 1.1–1.5 | Move all 23 packages to `dependencies`; verify no missing-module errors | `package.json` | Phase 1 |
| 2.1–2.4 | Investigate and optionally remove `@emoji-mart/data` server-side import | `emoji.ts` | Phase 2 |
| 3.1–3.5 | Apply `dynamic({ ssr: false })` to eligible Group 1 components | Targeted component files | Phase 3 |
| 4.1–4.5 | Resolve `react-toastify`, `socket.io-client`, `bootstrap`, phantom packages | `admin/states/socket-io.ts`, `_app.page.tsx` | Phase 4 |
| 5.1–5.5 | Validate final state; add Turbopack externalisation rule documentation | `package.json`, steering doc | Phase 5 |

---

## Architecture

### Current Architecture Analysis

The production assembly pipeline:

```
turbo run build
  └─ Turbopack build → .next/ (with .next/node_modules/ symlinks → ../../../../node_modules/.pnpm/)

assemble-prod.sh (current — no symlink rewriting):
  [1]   pnpm deploy out --prod --legacy --filter @growi/app
        └─ out/node_modules/<pkg> → .pnpm/<pkg>/...  (self-contained in pnpm v10 ✓)
  [mv]  rm -rf node_modules && mv out/node_modules node_modules
        └─ workspace-root node_modules/ is now prod-only ✓
  [ln]  rm -rf apps/app/node_modules && ln -sfn ../../node_modules apps/app/node_modules
        └─ apps/app/node_modules → ../../node_modules ✓
  [3]   rm -rf .next/cache
  [4]   rm -f next.config.ts

cp -a node_modules /tmp/release/   → workspace-root prod node_modules
cp -a apps/app/.next ...           → preserves pnpm symlinks intact
COPY --from=builder /tmp/release/ → release image
```

The `.next/node_modules/` symlinks (pointing `../../../../node_modules/.pnpm/`) resolve naturally to the workspace-root `node_modules/` — no symlink rewriting is needed. In pnpm v10, `--legacy` produces self-contained `.pnpm/` symlinks within the deploy output (step [1b] is unnecessary); placing the output at workspace root means Turbopack's original symlink targets already resolve (step [2] is unnecessary).

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph DockerBuilder
        PrunedRoot[Pruned workspace root]
        FullDepsNM[node_modules full deps]
        Build[turbo run build]
        NextOut[apps/app/.next node_modules symlinks to 4-levels-up]
        Deploy[pnpm deploy out --prod --legacy]
        ProdNM[out/node_modules prod-only self-contained]
        Replace[rm node_modules mv out/node_modules node_modules]
        Symlink[ln -sfn apps/app/node_modules]
        Clean[rm cache next.config.ts]
        Stage[Stage to tmp/release]
    end

    subgraph ReleaseImage
        WsRoot[workspace root node_modules prod-only]
        AppNext[apps/app/.next symlinks resolve naturally]
        AppNMLink[apps/app/node_modules symlink to ws root]
        Server[pnpm run server]
    end

    PrunedRoot --> FullDepsNM
    FullDepsNM --> Build
    Build --> NextOut
    Build --> Deploy
    Deploy --> ProdNM
    ProdNM --> Replace
    Replace --> Symlink
    Symlink --> Clean
    Clean --> Stage
    Stage --> WsRoot
    Stage --> AppNext
    Stage --> AppNMLink
    WsRoot --> AppNext
    AppNMLink --> WsRoot
    WsRoot --> Server
```

**Key decisions**:
- Workspace-root staging (not `apps/app/` staging): Turbopack's `.next/node_modules/` symlinks point `../../../../node_modules/.pnpm/` (workspace root). Placing the deploy output at workspace root means these symlinks resolve naturally — no step [2] rewriting needed (see `research.md` — Session 3: Decision: workspace-root staging).
- Keep `--legacy` in `pnpm deploy`: In pnpm v10, `--legacy` produces self-contained `.pnpm/` symlinks within the deploy output — step [1b] rewriting is no longer needed (see `research.md` — Session 3).
- `apps/app/node_modules` as a symlink to `../../node_modules`: satisfies `migrate-mongo` script path and Node.js `require()` traversal without duplicating the `.pnpm/` store.
- `pnpm deploy --prod` (not `--dev`) is the correct scope; only runtime packages belong in the artifact.

### Technology Stack

| Layer | Choice | Role | Notes |
|-------|--------|------|-------|
| Package manifest | `apps/app/package.json` | Declares runtime vs build-time deps | 23 entries move from `devDependencies` to `dependencies` |
| Build assembly | `apps/app/bin/assemble-prod.sh` | Produces self-contained release artifact | No symlink rewriting; workspace-root staging + `apps/app/node_modules` symlink (pnpm v10) |
| Bundler | Turbopack (Next.js 16) | Externalises packages to `.next/node_modules/` | Externalisation heuristic: static module-level imports in SSR code paths |
| Package manager | pnpm v10 with `--legacy` deploy | Produces pnpm-native `node_modules` with `.pnpm/` virtual store | `inject-workspace-packages` not required with `--legacy` |

---

## System Flows

### Phased Execution Flow

```mermaid
graph TB
    P1[Phase 1: Move all 23 to dependencies]
    P1Check{Production server OK?}
    P2[Phase 2: Investigate @emoji-mart/data server import]
    P2Result{Removal viable without breaking emoji?}
    P2Revert[Move @emoji-mart/data back to devDependencies]
    P2Keep[Document as justified production dep]
    P3[Phase 3: Apply ssr:false to eligible Group 1 components]
    P4[Phase 4: Resolve ambiguous packages]
    P5[Phase 5: Final validation and documentation]

    P1 --> P1Check
    P1Check -->|No| P1
    P1Check -->|Yes| P2
    P2 --> P2Result
    P2Result -->|Yes| P2Revert
    P2Result -->|No| P2Keep
    P2Revert --> P3
    P2Keep --> P3
    P3 --> P4
    P4 --> P5
```

Each phase gate requires: production server starts without errors + `GET /` returns HTTP 200 with expected content (body contains `内部仕様や仕様策定中の議論の内容をメモしていく Wiki です。`) + zero `ERR_MODULE_NOT_FOUND` in server log. **Do NOT use `/login` as the smoke test URL** — it returns HTTP 200 even when SSR is broken because the login page does not render editor components.

---

## Components and Interfaces

### Summary Table

| Component | Domain | Intent | Req Coverage | Contracts |
|-----------|--------|--------|--------------|-----------|
| `package.json` | Build Config | Dependency manifest | 1.1, 2.3, 2.4, 3.4, 3.5, 4.1–4.4, 5.3 | State |
| `emoji.ts` (remark plugin) | Server Renderer | Emoji shortcode → native emoji lookup | 2.1, 2.2, 2.3 | Service |
| Admin socket atom | Client State | Socket.IO connection for admin panel | 4.2 | State |
| Group 1 component wrappers | UI | `dynamic({ ssr: false })` wrapping for eligible components | 3.1–3.5 | — |

---

### Build Config

#### `apps/app/package.json`

| Field | Detail |
|-------|--------|
| Intent | Central manifest governing which packages are included in `pnpm deploy --prod` output |
| Requirements | 1.1, 2.3, 2.4, 3.4, 3.5, 4.1–4.4, 5.3 |

**Responsibilities & Constraints**
- Determines the complete set of packages in the production artifact.
- Any package appearing in `.next/node_modules/` after a production build must be in `dependencies`, not `devDependencies`.
- Changes propagate to all consumers of the monorepo lock file; `pnpm install --frozen-lockfile` must remain valid.

**Final classification** (all packages in `dependencies`; 3 successfully reverted to `devDependencies`):

| Package | Final classification | Rationale |
|---------|---------------------|-----------|
| `@codemirror/state` + 18 others (`codemirror`, `codemirror-emacs/vim/vscode-keymap`, `@lezer/highlight`, `@marp-team/*`, `@emoji-mart/react`, `reveal.js`, `pako`, `cm6-theme-basic-light`, `y-codemirror.next`) | `dependencies` | Found in `.next/node_modules/` via transitive imports; not in initial 23 — discovered during implementation |
| `@handsontable/react` | `dependencies` | Still externalised despite `useEffect` dynamic import; `ssr: false` does not prevent Turbopack externalisation |
| `@headless-tree/core`, `@headless-tree/react` | `dependencies` | Used in PageTree hooks (SSR'd) |
| `@tanstack/react-virtual` | `dependencies` | Used in ItemsTree (layout-critical, SSR'd) |
| `bootstrap` | `dependencies` | Still externalised despite `useEffect`-guarded `import()`; transitive imports cause externalisation |
| `diff2html` | `dependencies` | Still externalised despite `ssr: false` on RevisionDiff; static import analysis reaches it |
| `downshift` | `dependencies` | Used in SearchModal (SSR'd) |
| `fastest-levenshtein` | `dependencies` | Used in openai client service (SSR'd) |
| `i18next-http-backend`, `i18next-localstorage-backend`, `react-dropzone` | `dependencies` | Still in `.next/node_modules/` via transitive imports despite no direct `src/` imports |
| `pretty-bytes` | `dependencies` | Used in RichAttachment (SSR'd) |
| `react-copy-to-clipboard` | `dependencies` | Used in multiple inline components (SSR'd) |
| `react-dnd`, `react-dnd-html5-backend` | `dependencies` | Still externalised despite DnD provider wrapped with `ssr: false` |
| `react-hook-form` | `dependencies` | Used in forms across app (SSR'd) |
| `react-input-autosize` | `dependencies` | Used in form inputs (SSR'd) |
| `react-toastify` | `dependencies` | Static `{ toast }` import in `toastr.ts`; async refactor would change API surface |
| `simplebar-react` | `dependencies` | Used in Sidebar, AiAssistant (layout-critical, SSR'd) |
| **`@emoji-mart/data`** | **`devDependencies`** | Replaced with bundled `emoji-native-lookup.json`; no runtime package needed |
| **`fslightbox-react`** | **`devDependencies`** | `import()` inside `useEffect`; broken symlink in `.next/node_modules/` is harmless (SSR never accesses it) |
| **`socket.io-client`** | **`devDependencies`** | `await import()` inside `useEffect` in `admin/states/socket-io.ts`; no static SSR import path |

**Contracts**: State [x]

**Implementation Notes**
- Integration: Edit `apps/app/package.json` directly; run `pnpm install --frozen-lockfile` to verify lock file integrity after changes.
- Validation: After each phase, run `assemble-prod.sh` locally and start `pnpm run server`; confirm no `ERR_MODULE_NOT_FOUND` in logs and HTTP 200 on `/login`.
- Risks: Moving packages from `devDependencies` to `dependencies` may increase Docker image size; acceptable trade-off for Phase 1.

---

### Server Renderer

#### `apps/app/src/services/renderer/remark-plugins/emoji.ts`

| Field | Detail |
|-------|--------|
| Intent | Resolve `:emoji-name:` shortcodes to native emoji characters during Markdown SSR |
| Requirements | 2.1, 2.2, 2.3 |

**Responsibilities & Constraints**
- Processes Markdown AST server-side via `findAndReplace`.
- Uses `@emoji-mart/data/sets/15/native.json` only to look up `emojiData.emojis[name]?.skins[0].native`.
- Must produce identical output before and after any refactor (Req 2.2).

**Dependencies**
- External: `@emoji-mart/data` — static emoji data (P1, Phase 2 investigation target)

**Contracts**: Service [x]

**Phase 2 investigation**: Determine whether `@emoji-mart/data` can be replaced with a repo-bundled static lookup file. The required data structure is:

```typescript
interface EmojiNativeLookup {
  emojis: Record<string, { skins: [{ native: string }] }>;
}
```

If a static extraction script (run at package update time) can produce this file, `@emoji-mart/data` can revert to `devDependencies`. If not, document as justified production dependency per Req 2.4.

**Implementation Notes**
- Integration: Any replacement file must be a static JSON import; no runtime fetch.
- Validation: Render a Markdown document containing known emoji shortcodes (`:+1:`, `:tada:`, etc.) and verify the native characters appear in the output.
- Risks: Static extraction requires a maintenance step when `@emoji-mart/data` is upgraded.

---

### Client State

#### `apps/app/src/features/admin/states/socket-io.ts`

| Field | Detail |
|-------|--------|
| Intent | Jotai atom managing Socket.IO connection for the admin panel |
| Requirements | 4.2 |

**Responsibilities & Constraints**
- Provides an `io` Socket.IO client instance to admin panel components.
- The static `import io from 'socket.io-client'` at module level causes Turbopack to externalise `socket.io-client` for SSR.

**Dependencies**
- External: `socket.io-client` — WebSocket client (P1 if static; P2 after dynamic import refactor)

**Contracts**: State [x]

**Phase 4 refactor target**: Replace static import with dynamic import to match the pattern in `states/socket-io/global-socket.ts`:

```typescript
// Before (causes SSR externalisation)
import io from 'socket.io-client';

// After (browser-only, matches global-socket.ts pattern)
const io = (await import('socket.io-client')).default;
```

**Implementation Notes**
- Integration: The atom must be an async atom or use `atomWithLazy` to defer the import.
- Validation: Verify admin socket connects in browser; verify `socket.io-client` no longer appears in `.next/node_modules/` after a production build.
- Risks: Admin socket consumers must handle the async initialisation; if synchronous access is required at page load, the refactor may not be feasible.

---

### UI — `dynamic({ ssr: false })` Wrapper Points

These are not new components; they are targeted wrapping of existing imports using Next.js `dynamic`.

**Phase 3 evaluation criteria**:
1. Component renders interactive content only (no meaningful text for SEO)
2. Initial HTML without the component does not cause visible layout shift
3. No hydration mismatch after applying `ssr: false`

| Component | Package | `ssr: false` Feasibility | Notes |
|-----------|---------|-------------------------|-------|
| `LightBox.tsx` | `fslightbox-react` | High — renders only after user interaction | No SSR content |
| `RevisionDiff.tsx` | `diff2html` | High — interactive diff viewer, no SEO content | Loaded on user action |
| `PageTree.tsx` drag-drop | `react-dnd`, `react-dnd-html5-backend` | Medium — DnD provider wraps tree; tree content is SSR'd | Wrap DnD provider only, not content |
| `HandsontableModal.tsx` | `@handsontable/react` | High — modal, not in initial HTML | Verify existing dynamic import pattern |
| `SearchModal.tsx` | `downshift` | Low — search input in sidebar, part of hydration | Risk of layout shift |
| openai fuzzy matching | `fastest-levenshtein` | Medium — algorithm utility; depends on call site | May be callable lazily |

**Contracts**: None (pure wrapping changes, no new interfaces)

**Implementation Notes**
- Apply `dynamic` wrapping to the specific consuming component file, not to the package entry point.
- Validation per component: (a) build with package removed from `dependencies`, (b) confirm it disappears from `.next/node_modules/`, (c) run Production Server Startup Procedure and assert `GET /` returns HTTP 200 with expected content, (d) confirm no hydration warnings in browser console.
- Risks: Wrapping components that render visible content may cause flash of missing content (FOMC); test on slow connections.

---

## Testing Strategy

### Production Server Startup Procedure

以下の手順でプロダクションサーバーを起動する。devcontainer 環境での検証を想定している。

**Step 1 — クリーンビルド**（ワークスペースルートから実行）

```bash
turbo run build --filter @growi/app
```

**Step 2 — プロダクション用アセンブル**（ワークスペースルートから実行）

```bash
bash apps/app/bin/assemble-prod.sh
```

> **注意**:
> - `assemble-prod.sh` は `apps/app/next.config.ts` を削除する。**`next.config.ts` はサーバーテスト完了後（Step 6）に復元すること。** サーバー起動前に復元すると、Next.js が起動時に TypeScript インストールを試みて pnpm install が走り、`apps/app/node_modules` symlink が上書きされ HTTP 500 となる。
> - `assemble-prod.sh` は `rm -rf node_modules && mv out/node_modules node_modules` を実行するため、ワークスペースルートの `node_modules/` が prod-only に置き換わる。**`mv node_modules node_modules.bak` は不要**（新アプローチではワークスペースルートが自動的に prod-only になる）。テスト後は `pnpm install` で開発環境を復元すること。
> - `apps/app/node_modules` は `../../node_modules` へのシンボリックリンクになる。Docker release image でもこの構造が再現される。

**Step 3 — プロダクションサーバー起動**（`apps/app/` から実行）

```bash
cd apps/app && pnpm run server > /tmp/server.log 2>&1 &
```

起動完了を待つ:

```bash
timeout 60 bash -c 'until grep -q "Express server is listening" /tmp/server.log; do sleep 2; done'
```

> **注意**: `preserver` スクリプトが `pnpm run migrate` を実行するため、起動に数十秒かかる。**Do NOT use mongosh/mongo** for DB connectivity checks — check server logs instead.

**Step 4 — 検証**

```bash
# HTTP ステータスとコンテンツ確認
HTTP_CODE=$(curl -s -o /tmp/response.html -w "%{http_code}" http://localhost:3000/)
echo "HTTP: $HTTP_CODE"  # → 200 であること
grep -c "内部仕様や仕様策定中の議論の内容をメモしていく Wiki です。" /tmp/response.html  # → 1 以上であること

# ERR_MODULE_NOT_FOUND がないことを確認
grep -c "ERR_MODULE_NOT_FOUND" /tmp/server.log  # → 0 であること
```

> **検証 URL は `/` を使うこと。`/login` は不可。** `/login` は SSR が壊れていても HTTP 200 を返すため正常動作の確認にならない。`/` はエディタ関連コンポーネントを SSR するため、パッケージが欠損すると HTTP 500 になる。

**Step 5 — サーバー停止**

```bash
kill $(lsof -ti:3000)
```

**Step 6 — 開発環境の復元**（検証後）

```bash
# next.config.ts を復元
git show HEAD:apps/app/next.config.ts > apps/app/next.config.ts
```

---

### Server Rendering Verification

プロダクションサーバー起動後、以下のコマンドで SSR の正常動作を確認する。

**検証コマンド（Production Server Startup Procedure の Step 5 参照）**

```bash
# URL は / を使うこと（/login は不可）
HTTP_CODE=$(curl -s -o /tmp/response.html -w "%{http_code}" http://localhost:3000/)
echo "HTTP: $HTTP_CODE"  # → 200
grep -c "内部仕様や仕様策定中の議論の内容をメモしていく Wiki です。" /tmp/response.html  # → 1 以上
grep -c "ERR_MODULE_NOT_FOUND" /tmp/server.log  # → 0
```

**破損シンボリックリンクの確認**

`assemble-prod.sh` 実行後、`.next/node_modules/` および `apps/app/node_modules/` 内のシンボリックリンクがすべて解決可能であることを確認する。

```bash
# .next/node_modules/ の確認
cd apps/app && find .next/node_modules -maxdepth 2 -type l | while read link; do
  linkdir=$(dirname "$link"); target=$(readlink "$link")
  resolved=$(cd "$linkdir" 2>/dev/null && realpath -m "$target" 2>/dev/null || echo "UNRESOLVABLE")
  [ "$resolved" = "UNRESOLVABLE" ] || [ ! -e "$resolved" ] && echo "BROKEN: $link"
done

# apps/app/node_modules/ の確認（ワークスペースルートの node_modules をリネーム後に実行）
find apps/app/node_modules -maxdepth 2 -type l | while read link; do
  linkdir=$(dirname "$link"); target=$(readlink "$link")
  resolved=$(cd "$linkdir" 2>/dev/null && realpath -m "$target" 2>/dev/null || echo "UNRESOLVABLE")
  [ "$resolved" = "UNRESOLVABLE" ] || [ ! -e "$resolved" ] && echo "BROKEN: $link"
done
```

> **注意**: `@growi/*` パッケージは `../../../../packages/` を指すシンボリックリンクだが、`packages/` はワークスペースルート直下に存在するため問題ない。

**devDependencies 逆入り確認**

```bash
# devDependencies に列挙されているパッケージが .next/node_modules/ に現れないことを確認
# （あれば Classification regression）
```

**devcontainer における再現性について**

`assemble-prod.sh` は `rm -rf node_modules && mv out/node_modules node_modules` を実行するため、ワークスペースルートの `node_modules/` が prod-only の deploy 出力に置き換わる。**`mv node_modules node_modules.bak` は不要**（以前のアプローチでは必要だったが、現アプローチでは `assemble-prod.sh` がワークスペースルートを自動的に prod-only にする）。テスト完了後は `pnpm install` で開発環境を復元すること。

---

### Phase 1 — Smoke Test (Req 1.3, 1.4, 1.5)

- 上記「Production Server Startup Procedure」に従いサーバーを起動し、stdout に `ERR_MODULE_NOT_FOUND` が出力されないことを確認する。
- **HTTP GET `/`** (not `/login`): assert HTTP 200, body contains `内部仕様や仕様策定中の議論の内容をメモしていく Wiki です。`, zero `ERR_MODULE_NOT_FOUND` in server log.
- Run `launch-prod` CI job: assert job passes against MongoDB 6.0 and 8.0.

### Phase 2 — Emoji Rendering (Req 2.2)

- Unit test: render Markdown string containing `:+1:`, `:tada:`, `:rocket:` through the remark plugin; assert native emoji characters in output.
- If static file replacement applied: run same test against replacement; assert identical output.

### Phase 3 — Hydration Integrity (Req 3.3)

- Per-package smoke test: for each package moved to devDependencies, run Production Server Startup Procedure and assert `GET /` HTTP 200 with expected content.
- Per-component browser test: load page containing the wrapped component; assert no React hydration warnings in browser console.
- Visual regression: screenshot comparison of affected pages before and after `ssr: false` wrapping.

### Phase 4 — Admin Socket and Bootstrap (Req 4.2, 4.3)

- Per-package smoke test: for each package moved to devDependencies, run Production Server Startup Procedure and assert `GET /` HTTP 200 with expected content.
- Admin socket: open admin panel in browser; assert Socket.IO connection established (WebSocket upgrade in browser DevTools Network tab).
- Bootstrap: assert Bootstrap dropdown/modal JavaScript functions correctly in browser after confirming `import()` placement.

### Phase 5 — Final Coverage Check (Req 5.1, 5.3)

- After deploy, assert that every symlink in `apps/app/.next/node_modules/` AND `apps/app/node_modules/` resolves to an existing file (zero broken symlinks; `apps/app/node_modules` is a symlink to `../../node_modules` which is the prod-only workspace-root `node_modules/`).
- Assert no package listed in `devDependencies` appears in `apps/app/.next/node_modules/` after a production build.
- Run Production Server Startup Procedure and assert `GET /` HTTP 200 with expected content.

---

