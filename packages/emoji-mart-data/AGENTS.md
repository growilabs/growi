# @growi/emoji-mart-data

A build-time extraction package that produces a minimal emoji native lookup JSON
from `@emoji-mart/data`. The generated artifact is consumed by two places in the
monorepo:

| Consumer | Usage |
|---|---|
| `apps/app` — `emoji.ts` (remark plugin) | Converts `:shortcode:` → native emoji during server-side Markdown rendering |
| `packages/editor` — `emojiAutocompletionSettings.ts` | Populates CodeMirror autocomplete suggestions with native emoji previews |

---

## Why this package was created

### The problem: Turbopack externalisation

After migrating from webpack to Turbopack, packages that are statically imported
in SSR-reachable code are **externalised** — Turbopack creates runtime symlinks
under `.next/node_modules/` instead of inlining them. Any externalised package
must be listed under `dependencies` (not `devDependencies`) in `apps/app/package.json`,
otherwise `pnpm deploy --prod` produces a broken production artifact.

`@emoji-mart/data` (~4 MB JSON) was statically imported in `apps/app/emoji.ts` and
in `packages/editor/emojiAutocompletionSettings.ts`. Both import paths were
transitively reachable from SSR, so Turbopack externalised the package and it
had to live in `apps/app` `dependencies`.

### The fix: break the static import chain

The consumers only need a `name → native-emoji` mapping, a tiny subset of the
full `@emoji-mart/data` payload. By extracting that mapping at build time into a
plain JSON file and publishing it as `@growi/emoji-mart-data`, the static imports
of `@emoji-mart/data` are eliminated:

- **`emoji.ts`** and **`emojiAutocompletionSettings.ts`** now import
  `@growi/emoji-mart-data` (a JSON, bundled inline by Turbopack — never externalised).
- **`EmojiButton.tsx`** still needs the full `@emoji-mart/data` for the
  `<Picker>` component, but loads it via `import()` inside a `useEffect` (the
  only pattern confirmed to prevent Turbopack externalisation).

Result: `@emoji-mart/data` and `@emoji-mart/react` are removed from
`apps/app` `dependencies` entirely and remain only in `packages/editor`
`devDependencies`.

---

## Why one output file is sufficient

During design we initially expected to need **two** output files:

- A *full* lookup for `apps/app` (all emoji, any order)
- A *category-ordered* lookup for `packages/editor` autocomplete (8 categories,
  UX-friendly order)

Investigation of `@emoji-mart/data/sets/15/native.json` showed that the dataset
has **exactly 8 categories** and all 1870 emojis fall into them:

```
people   529   nature  152   foods    133   activity  85
places   218   objects 261   symbols  223   flags     269
total: 1870  =  Object.keys(emojis).length
```

The `component` category (skin-tone modifier entries that could inflate the
count) does not exist as a standalone category — skin tones are embedded inside
each emoji's `skins[]` array and are not addressable by `:shortcode:`.

Therefore one category-ordered file satisfies both consumers:

- `apps/app/emoji.ts` does key lookups (`lookup[name]`) — order is irrelevant.
- `packages/editor/emojiAutocompletionSettings.ts` uses `Object.keys(lookup)` —
  category order means common emojis surface first in autocomplete.

---

## Maintenance

Whenever `@emoji-mart/data` is upgraded, regenerate the lookup:

```bash
turbo run build --filter @growi/emoji-mart-data
```

Or directly from this package directory:

```bash
node bin/extract.ts
```

Commit the updated `pnpm-lock.yaml` and re-verify with:

```bash
turbo run build --filter @growi/app
```
