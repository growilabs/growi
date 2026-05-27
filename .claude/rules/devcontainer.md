# Devcontainer Environment

## Service Connectivity

This project runs inside a devcontainer defined in `.devcontainer/compose.yml`. The Docker Compose services are **always accessible by hostname** — do NOT run connectivity checks (`ping`, `nc`, `node net.connect`, etc.) before using them.

| Service | Hostname | Port | Notes |
|---------|----------|------|-------|
| MongoDB | `mongo` | `27017` | Replica set `rs0`; required for transactions and change streams |
| Elasticsearch | `elasticsearch` | `9200` | Full-text search |

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
