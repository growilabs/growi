import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

// Task 1.2 scope only: proves the devcontainer's `postgres` service (added in
// .devcontainer/compose.yml by this same task) is reachable and can run a
// query, and that the `chat_sdk` schema task 1.2 must prepare for
// `@chat-adapter/state-pg` (design.md's "Chat SDK の state が使う schema も
// 同じ DB に用意する") actually exists and is selected by the connection URL
// documented for task 1.4/1.5. This is intentionally a standalone
// infra-verification check, not part of the layered app structure --
// src/runtime/config.ts (task 1.5) is "the only place allowed to read env
// vars" for the *application* code, but no such layer exists yet, and this
// file predates it.
//
// The connection strings mirror apps/chat-integration-proxy/.env.development
// (DATABASE_URL / CHAT_SDK_DATABASE_URL) and .devcontainer/compose.yml's
// `postgres` / `postgres-init` services, so this test also runs for a
// developer who has not sourced the env file into their shell.
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';

const CHAT_SDK_DATABASE_URL =
  process.env.CHAT_SDK_DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy?options=-c%20search_path%3Dchat_sdk';

describe('PostgreSQL connectivity (task 1.2)', () => {
  it('connects to the devcontainer postgres service and runs one query', async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      // Fail fast instead of hanging when `postgres` does not resolve/accept
      // connections yet (expected until the devcontainer is rebuilt with the
      // service added by this task).
      connectionTimeoutMillis: 5_000,
    });

    try {
      const result = await pool.query('SELECT 1 AS ok');
      expect(result.rows).toEqual([{ ok: 1 }]);
    } finally {
      await pool.end();
    }
  });

  it('selects the chat_sdk schema via the state-pg connection URL', async () => {
    // `@chat-adapter/state-pg` has no schema option of its own, so schema
    // separation from this app's own (default `public`-schema) tables relies
    // entirely on the `options=-c search_path=chat_sdk` query parameter that
    // `pg` forwards as a libpq startup parameter. Asserting `current_schema()`
    // here proves three things at once: `postgres-init` actually created the
    // `chat_sdk` schema, `pg` really does honor that connection-string
    // parameter, and the URL documented in .env.development for task 1.4/1.5
    // is correct -- rather than leaving that adapter-specific mechanism as an
    // unverified claim for a later task to discover is wrong.
    const pool = new Pool({
      connectionString: CHAT_SDK_DATABASE_URL,
      connectionTimeoutMillis: 5_000,
    });

    try {
      const result = await pool.query('SELECT current_schema()');
      expect(result.rows).toEqual([{ current_schema: 'chat_sdk' }]);
    } finally {
      await pool.end();
    }
  });
});
