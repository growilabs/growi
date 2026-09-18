# Devcontainer Environment

## Service Connectivity

This project runs inside a devcontainer defined in `.devcontainer/compose.yml`. The services below marked "always" are **always accessible by hostname** — do NOT run connectivity checks (`ping`, `nc`, `node net.connect`, etc.) before using them.

| Service | Hostname | Port | Notes |
|---------|----------|------|-------|
| MongoDB | `mongo` | `27017` | Replica set `rs0`; required for transactions and change streams. Always running. |
| Elasticsearch | `elasticsearch` | `9200` | Full-text search. Always running. |
| PostgreSQL | `postgres` | `5432` | Used only by `apps/chat-integration-proxy`. **Opt-in, not always running** — see below. |

## PostgreSQL (opt-in, `chat-integration-proxy` only)

`postgres`/`postgres-init` carry `profiles: ["chat-integration-proxy"]` in `.devcontainer/compose.yml`, so a plain `docker compose up` (what every devcontainer in this repo does on start, since `mongo`/`elasticsearch` have no profile and are needed by every app here) does **not** start them. Before working on `chat-integration-proxy` or running its `*.integ.ts` suite, start them from the **docker host** (not from inside this devcontainer — there is no `docker` CLI in here):

```bash
docker compose --profile chat-integration-proxy up -d postgres postgres-init
```

If `getent hosts postgres` still fails afterward inside the devcontainer, the running devcontainer's compose project may need `docker compose -p <project-name> ...` instead of the bare `docker compose` above — see `.devcontainer/compose.yml`'s own comment on `postgres` for the full explanation, or `Dev Containers: Rebuild Container` in VS Code as a fallback.

## MongoDB

Connection string (already in `apps/app/.env.development`):
```
mongodb://mongo:27017/growi?replicaSet=rs0
```

`mongosh` is **not** installed in the devcontainer (`app` service). To run ad-hoc queries from the devcontainer, use the bundled MongoDB driver via Node.js:

```bash
node -e "
const { MongoClient } = require('/workspace/growi-vault/node_modules/.pnpm/mongodb@6.8.0_@aws-sdk+credential-providers@3.600.0_@aws-sdk+client-sso-oidc@3.600.0__socks@2.8.3/node_modules/mongodb');
async function main() {
  const client = new MongoClient('mongodb://mongo:27017/growi?replicaSet=rs0');
  await client.connect();
  const db = client.db('growi');
  // ... your query here ...
  await client.close();
}
main().catch(console.error);
"
```

## Smoke Testing the App

The development server **can always be started** in the devcontainer for smoke and integration verification. Never claim the runtime environment is unavailable.

See `apps/app/.claude/skills/app-commands/SKILL.md` → **Smoke Testing** section for the full workflow.

## Do Not Run pnpm Commands Concurrently

Never run `pnpm install` in parallel with any `turbo run` / `pnpm run` /
`pnpm vitest` invocation — even in a different worktree. pnpm's
dependency-status check (`runDepsStatusCheck`) spawns an internal
`pnpm install`; two installs contend on the shared store lock and both fail
with `Command was killed with SIGINT`. When orchestrating parallel subagents,
serialize installs against any agent's build/test runs.
