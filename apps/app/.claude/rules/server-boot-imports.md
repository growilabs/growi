# Server Boot Imports (lazy-loading conventions)

Every module statically reachable from the server's boot entrypoints loads at
every server start and its RSS is paid by **every** deployment, whether or not
the feature is configured. Measured examples of what a single stray top-level
import costs: full aws-sdk v2 via `nodemailer-ses-transport` (+23 MiB), the
openai SDK (+25 MiB), ldapjs (+18 MiB), each `@ai-sdk/*` provider (~3–14 MiB).

## The rule (two directions)

1. **Config-gated heavy dependencies load lazily.** An SDK that is only used
   when a feature/provider is enabled (mail transports, passport strategy SDKs,
   AI provider SDKs, file-uploader backends, redis, ES clients) must be loaded
   via dynamic `import()` **inside** the function that uses it, **after** the
   enabled/config check — so a disabled feature never triggers the import and a
   misconfigured one fails fast without loading the SDK. Prefer a data-driven
   map of loaders (see `service/file-uploader/index.ts`, `service/mail/mail.ts`).
2. **Universally-paid costs are warmed up, not deferred.** A cost every real
   deployment pays anyway (e.g. the Prisma query engine) must be paid **at
   boot** (see `utils/prisma-connect.ts`): deferring it hides the memory from
   startup-based capacity planning and moves the latency onto the first user
   request. Deciding which direction applies is the design decision — document it.

## Every lazy-load change ships with a drift spec

Use the shared walker — do not write a new one:

- `~/test-utils/static-import-graph` — `traceStaticImportChains({ srcRoot, entrypoints, bannedPattern })`
  walks static imports only (dynamic `import()` is a boundary, `import type` is skipped).
- `~/test-utils/boot-entrypoints` — the single declared `BOOT_ENTRYPOINTS` list.
- Naming: `no-eager-<what>-imports.spec.ts`, co-located with the guarded module.

**Walk from two roots.** Both are required; each has caught a real regression
the other cannot see:

- *the guarded module's own entry* — required because crowi loads some services
  via dynamic `import()` (e.g. the mail service), so a boot-rooted walk never
  enters them and misses regressions inside;
- *the shared `BOOT_ENTRYPOINTS`* — required because routes statically
  registered at boot are a separate leak path (real cases: `app-settings`
  importing `createSMTPClient` at top level; `ldap-user-group-sync` reaching
  ldapjs independently of the passport service).

Include an entrypoint-existence guard test, and **mutation-check the spec
before committing** (re-add the banned import, confirm RED, revert) — see the
Guard / Drift Specs section of the `essential-test-design` skill.

## Existing guards (extend, don't duplicate)

| Spec | Banned from the static graph |
|---|---|
| `features/mastra/server/no-eager-ai-imports.spec.ts` | `@mastra/*`, `@ai-sdk/*`, `ai`, `tokenlens` (from boot) |
| `server/service/mail/no-eager-transport-imports.spec.ts` | `nodemailer`, `nodemailer-ses-transport`, `aws-sdk` |
| `server/service/no-eager-passport-strategy-imports.spec.ts` | `openid-client`, `passport-ldapauth`, `ldapjs`, `passport-saml`, `passport-github`, `passport-google-oauth20` |
| `.../llm-providers/no-eager-provider-imports.spec.ts` | `@ai-sdk/*`, `@azure/identity` (from the mastra provider graph) |

Known gap: the `openai` SDK and `@azure/identity` are still boot-loaded through
the legacy `features/openai` client-delegator (via suggest-path) and are not yet
boot-banned; that closes with the agentic suggest-path migration (#11293).
