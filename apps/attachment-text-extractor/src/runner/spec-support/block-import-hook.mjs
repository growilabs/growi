// Loaded into a child with `--import <this file's URL>?blocked=<package>`: makes
// that package impossible to import, the way a missing or broken install would.
// Only the main thread is affected (registerHooks is per thread), which is
// where the conversion components are loaded.
import { registerHooks } from 'node:module';

const blocked = new URL(import.meta.url).searchParams.get('blocked');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      blocked != null &&
      (specifier === blocked || specifier.startsWith(`${blocked}/`))
    ) {
      throw new Error(`blocked by the test: ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
});
