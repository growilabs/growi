// Log every module loaded by this process (ESM and CJS) to MODULE_LOG_FILE.
// Usage: node --import /path/to/module-log.mjs <entry>
//   or:  node -r ... (CJS entry works too; --import runs first regardless)
import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const out = process.env.MODULE_LOG_FILE;
if (out) {
  registerHooks({
    load(url, context, nextLoad) {
      try {
        appendFileSync(out, `${url}\n`);
      } catch {
        /* ignore logging failures */
      }
      return nextLoad(url, context);
    },
  });
}
