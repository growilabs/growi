import type { HttpBindings } from '@hono/node-server';
import type { Context } from 'hono';

// The Node request and response behind each Hono context: the upload is read
// from c.env.incoming, not from the web Request (research.md 16.1 1).
export type AppEnv = { Bindings: HttpBindings };
export type AppContext = Context<AppEnv>;
