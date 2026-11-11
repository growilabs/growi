import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatViolation,
  traceStaticImportChains,
} from '~/test-utils/static-import-graph';

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

// The entry spec (change-proposal-ai-agent) imports this barrel, so it must stay
// loadable without the AI stack (same banned set as features/mastra's boot guard).
const HEAVY_PACKAGE =
  /^(@mastra\/|@ai-sdk\/|ai$|tokenlens|openai(\/|$)|@azure\/identity(\/|$))/;
const SERVER_BARREL = 'features/change-proposal/server/index.ts';

describe('change-proposal server barrel import boundary', () => {
  it('has no static import chain to the AI SDK packages', () => {
    const violations = traceStaticImportChains({
      srcRoot: SRC_ROOT,
      entrypoints: [SERVER_BARREL],
      bannedPattern: HEAVY_PACKAGE,
    });

    expect(violations.map(formatViolation)).toEqual([]);
  });

  it('still finds the barrel it traces from', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, SERVER_BARREL))).toBe(true);
  });
});
