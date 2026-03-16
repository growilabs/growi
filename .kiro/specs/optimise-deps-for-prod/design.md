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

### Existing Architecture Analysis

The production assembly pipeline is:

```
turbo run build
  └─ Turbopack build → .next/ (with .next/node_modules/ symlinks → ../../../../node_modules/.pnpm/)

assemble-prod.sh
  ├─ pnpm deploy out --prod --legacy   → out/node_modules/ (pnpm-native: .pnpm/ + symlinks)
  ├─ rm + mv out/node_modules → apps/app/node_modules/
  ├─ rm -rf .next/cache
  ├─ next.config.ts removal
  └─ symlink rewrite: ../../../../ → ../../ in .next/node_modules/

cp -a to /tmp/release/           → preserves pnpm symlinks intact
COPY --from=builder /tmp/release/ → release image
```

The symlink rewrite step is essential: `.next/node_modules/` symlinks point to the workspace-root `.pnpm/` (4 levels up), which does not exist in the release image. After rewriting to 2 levels up, they resolve to `apps/app/node_modules/.pnpm/` (included in the deploy output), preserving pnpm's sibling-resolution for transitive dependencies.

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph BuildEnv
        TurboBuild[turbo run build]
        NextModules[.next/node_modules symlinks]
        AssembleScript[assemble-prod.sh]
        DeployOut[pnpm deploy out]
        AppNodeModules[apps/app/node_modules .pnpm + symlinks]
        RewriteStep[symlink rewrite step]
    end

    subgraph ReleaseImage
        ReleaseDist[release artifact]
        ProdServer[pnpm run server]
    end

    TurboBuild --> NextModules
    AssembleScript --> DeployOut
    DeployOut --> AppNodeModules
    AssembleScript --> RewriteStep
    RewriteStep --> NextModules
    AppNodeModules --> ReleaseDist
    NextModules --> ReleaseDist
    ReleaseDist --> ProdServer
```

**Key decisions**:
- Symlink rewrite (not `cp -rL`) preserves pnpm's sibling resolution for transitive deps (see `research.md` — Decision: Symlink Rewrite over cp -rL).
- `pnpm deploy --prod` (not `--dev`) is the correct scope; only runtime packages belong in the artifact.

### Technology Stack

| Layer | Choice | Role | Notes |
|-------|--------|------|-------|
| Package manifest | `apps/app/package.json` | Declares runtime vs build-time deps | 23 entries move from `devDependencies` to `dependencies` |
| Build assembly | `apps/app/bin/assemble-prod.sh` | Produces self-contained release artifact | Already contains symlink rewrite; no changes needed in Phase 1 |
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

Each phase gate requires: production server starts without errors + login page returns HTTP 200.

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

**Phase 1 changes — move all 23 to `dependencies`**:

| Package | Current | Target | Rationale |
|---------|---------|--------|-----------|
| `@codemirror/state` | devDep | dep | Used in editor components (SSR'd) |
| `@emoji-mart/data` | devDep | dep | Static import in remark plugin (server-side) |
| `@handsontable/react` | devDep | dep | Used in HandsontableModal (SSR'd unless wrapped) |
| `@headless-tree/core` | devDep | dep | Used in PageTree hooks (SSR'd) |
| `@headless-tree/react` | devDep | dep | Used in ItemsTree (SSR'd) |
| `@tanstack/react-virtual` | devDep | dep | Used in ItemsTree (layout-critical, SSR'd) |
| `bootstrap` | devDep | dep | Dynamic JS import in `_app.page.tsx` (Phase 4 to verify) |
| `diff2html` | devDep | dep | Used in RevisionDiff (SSR'd) |
| `downshift` | devDep | dep | Used in SearchModal (SSR'd) |
| `fastest-levenshtein` | devDep | dep | Used in openai client service (SSR'd) |
| `fslightbox-react` | devDep | dep | Used in LightBox (SSR'd) |
| `i18next-http-backend` | devDep | dep | Present in `.next/node_modules/`; source unknown (Phase 4 to verify) |
| `i18next-localstorage-backend` | devDep | dep | Present in `.next/node_modules/`; source unknown (Phase 4 to verify) |
| `pretty-bytes` | devDep | dep | Used in RichAttachment (SSR'd) |
| `react-copy-to-clipboard` | devDep | dep | Used in multiple inline components (SSR'd) |
| `react-dnd` | devDep | dep | Used in PageTree drag-drop (SSR'd) |
| `react-dnd-html5-backend` | devDep | dep | Used in PageTree drag-drop (SSR'd) |
| `react-dropzone` | devDep | dep | Present in `.next/node_modules/`; source unknown (Phase 4 to verify) |
| `react-hook-form` | devDep | dep | Used in forms across app (SSR'd) |
| `react-input-autosize` | devDep | dep | Used in form inputs (SSR'd) |
| `react-toastify` | devDep | dep | Static import in `toastr.ts` (SSR'd) |
| `simplebar-react` | devDep | dep | Used in Sidebar, AiAssistant (layout-critical, SSR'd) |
| `socket.io-client` | devDep | dep | Static import in admin socket atom (Phase 4 refactor) |

**Phase 2–4 revert candidates** (move back to `devDependencies` if conditions met):

| Package | Condition for revert | Phase |
|---------|----------------------|-------|
| `@emoji-mart/data` | Server-side import removed or replaced with static file | 2 |
| `fslightbox-react` | Wrapped with `dynamic({ ssr: false })`; no longer in `.next/node_modules/` | 3 |
| `diff2html` | Wrapped with `dynamic({ ssr: false })`; no longer in `.next/node_modules/` | 3 |
| `react-dnd` | DnD-specific components wrapped with `dynamic({ ssr: false })` | 3 |
| `react-dnd-html5-backend` | Same as `react-dnd` | 3 |
| `@handsontable/react` | Confirmed `dynamic({ ssr: false })` in HandsontableModal | 3 |
| `socket.io-client` | Admin socket refactored to dynamic import | 4 |
| `bootstrap` | Confirmed `import()` is browser-only (inside `useEffect`) | 4 |
| `i18next-http-backend` | Confirmed absent from `.next/node_modules/` post-Phase-1 | 4 |
| `i18next-localstorage-backend` | Confirmed absent from `.next/node_modules/` post-Phase-1 | 4 |
| `react-dropzone` | Confirmed absent from `.next/node_modules/` post-Phase-1 | 4 |

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
- Validation per component: (a) build with package removed from `dependencies`, (b) confirm it disappears from `.next/node_modules/`, (c) confirm no hydration warnings in browser console.
- Risks: Wrapping components that render visible content may cause flash of missing content (FOMC); test on slow connections.

---

## Testing Strategy

### Production Server Startup Procedure

以下の手順でプロダクションサーバーを起動する。devcontainer 環境での検証を想定している。

**Step 1 — クリーンビルド**

```bash
cd /workspace/growi/apps/app
pnpm run build
```

**Step 2 — プロダクション用アセンブル**

```bash
bash bin/assemble-prod.sh
```

> **注意**: `assemble-prod.sh` は `apps/app/next.config.ts` を削除する。次回の開発ビルドを実行する前に必ず復元すること。

**Step 3 — プロダクションサーバー起動**

`.env.production.local` が存在しない場合は作成する:

```
MONGO_URI=mongodb://mongo/growi-dev-wiki
```

サーバーを起動する:

```bash
cd /workspace/growi/apps/app
pnpm run server
```

**Step 4 — 開発環境の復元**（検証後）

```bash
# next.config.ts を復元
git show HEAD:apps/app/next.config.ts > apps/app/next.config.ts

# node_modules を復元
cd /workspace/growi
pnpm install
```

---

### Server Rendering Verification

プロダクションサーバー起動後、以下のコマンドで SSR の正常動作を確認する。

**基本確認（HTTP 200 チェック）**

```bash
curl -o /dev/null -s -w "%{http_code}\n" http://localhost:3000/login
# → 200 が返れば OK
```

**モジュール解決エラーのチェック**

サーバーのログに `ERR_MODULE_NOT_FOUND` が出ていないことを確認する。バックグラウンド起動した場合:

```bash
grep -c "ERR_MODULE_NOT_FOUND" /tmp/growi-prod.log
# → 0 が返れば OK
```

**破損シンボリックリンクの確認**

`assemble-prod.sh` 実行後、`.next/node_modules/` 内にシンボリックリンクが存在するが、そのすべてが致命的なエラーを引き起こすわけではない。以下の 2 種類に分類される。

| カテゴリ | 説明 | サーバーへの影響 |
|---------|------|----------------|
| **既存の破損リンク** | 元々 devDependencies だったパッケージのリンク（変更前から存在） | なし（サーバーが実際に `require()` しないため） |
| **新規の破損リンク** | 今回の変更で devDependencies に移動したパッケージのリンク | `dynamic({ ssr: false })` で正しくラップされていれば無害 |

Turbopack は SSR 静的解析時に `dynamic({ ssr: false })` 境界の内側のパッケージについても `.next/node_modules/` エントリを作成する。破損シンボリックリンクが存在すること自体は問題ではなく、サーバーが実際にそのパッケージを `require()` するかどうかが判断基準となる。

**devcontainer における再現性の注意事項**

devcontainer では `pnpm deploy --prod` 後もワークスペースルートの `node_modules/` が残存するため、`.next/` を経由しないモジュール解決パス（例: `../../node_modules/foo`）では誤って green と判定される可能性がある。ただし `.next/node_modules/` 内のシンボリックリンクは直接ファイルシステムパスによる解決であり、Docker 本番環境と同じ挙動を示す。そのため Turbopack の外部化（externalisation）検証においては devcontainer テストで十分な精度が得られる。

---

### Phase 1 — Smoke Test (Req 1.3, 1.4, 1.5)

- 上記「Production Server Startup Procedure」に従いサーバーを起動し、stdout に `ERR_MODULE_NOT_FOUND` が出力されないことを確認する。
- HTTP GET `/login`: assert 200 response and absence of SSR error log lines.
- Run `launch-prod` CI job: assert job passes against MongoDB 6.0 and 8.0.

### Phase 2 — Emoji Rendering (Req 2.2)

- Unit test: render Markdown string containing `:+1:`, `:tada:`, `:rocket:` through the remark plugin; assert native emoji characters in output.
- If static file replacement applied: run same test against replacement; assert identical output.

### Phase 3 — Hydration Integrity (Req 3.3)

- Per-component browser test: load page containing the wrapped component; assert no React hydration warnings in browser console.
- Visual regression: screenshot comparison of affected pages before and after `ssr: false` wrapping.

### Phase 4 — Admin Socket and Bootstrap (Req 4.2, 4.3)

- Admin socket: open admin panel in browser; assert Socket.IO connection established (WebSocket upgrade in browser DevTools Network tab).
- Bootstrap: assert Bootstrap dropdown/modal JavaScript functions correctly in browser after confirming `import()` placement.

### Phase 5 — Final Coverage Check (Req 5.1, 5.3)

- Automated check (add to `assemble-prod.sh` or CI): after deploy, assert that every symlink in `apps/app/.next/node_modules/` resolves to an existing file in `apps/app/node_modules/.pnpm/`.
- Assert no package listed in `devDependencies` appears in `apps/app/.next/node_modules/` after a production build.

---

## Migration Strategy

The five phases are executed sequentially. Each phase is independently deployable and verifiable.

```mermaid
graph LR
    P1[Phase 1\nBaseline fix\nall 23 to deps]
    P2[Phase 2\n@emoji-mart/data\nserver import]
    P3[Phase 3\nssr:false\nGroup 1 candidates]
    P4[Phase 4\nAmbiguous\npackages]
    P5[Phase 5\nValidation\ndocumentation]

    P1 --> P2
    P2 --> P3
    P3 --> P4
    P4 --> P5
```

**Rollback**: Each phase modifies only `package.json` and/or one source file. Rolling back is a targeted revert of those changes; the production build pipeline (`assemble-prod.sh`, Dockerfile) is unchanged throughout.

**Phase 1 rollback trigger**: Production server fails to start or CI `launch-prod` fails → revert `package.json` changes.

**Phase 3/4 rollback trigger**: Hydration error or functional regression detected → revert the specific `dynamic()` wrapping or import refactor; package remains in `dependencies`.
