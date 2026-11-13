// CLI: `export-openapi.ts --output <path>` writes the OpenAPI document the
// service serves at GET /openapi.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadSettings } from '../src/config/load-settings';
import { createApp, generateOpenApiDocument } from '../src/http';
import type { ConversionRunner } from '../src/runner';

const { values } = parseArgs({
  options: { output: { type: 'string' } },
});
if (values.output === undefined || values.output === '') {
  process.stderr.write('usage: export-openapi.ts --output <path>\n');
  process.exit(2);
}

// The document comes from the route definitions alone: no request is served,
// so the token is a placeholder and the runner is never called.
const notServing = (): never => {
  throw new Error('export-openapi serves no request');
};
const runner: ConversionRunner = { run: notServing, readiness: notServing };
const app = createApp({
  settings: loadSettings({
    ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: 'export-openapi',
  }),
  runner,
});

const document = await generateOpenApiDocument(app);
mkdirSync(path.dirname(path.resolve(values.output)), { recursive: true });
writeFileSync(values.output, `${JSON.stringify(document, null, 2)}\n`);
