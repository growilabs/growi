import fs from 'node:fs';
import path from 'node:path';

/**
 * Guard spec (see the `essential-test-design` skill's "Guard / Drift Specs"
 * section): proves the chat-integration feature's server entry point
 * (`features/chat-integration/server/index.ts`) is statically reachable
 * from this file, which is one of `BOOT_ENTRYPOINTS`
 * (`~/test-utils/boot-entrypoints`) and therefore loads on every GROWI
 * process start.
 *
 * This matters because GROWI creates a Mongoose model's indexes the moment
 * the model file is `import`-ed (no `autoIndex: false` anywhere in this
 * codebase). This spec's feature will add a composite unique index
 * (`chat_account_links`) that enforces a correctness invariant, so the
 * index must exist before the feature is first used, not only after — which
 * requires its owning model to be reachable from a boot entrypoint rather
 * than a lazily-loaded request path. See design.md "新しい model が
 * いつ読み込まれるか".
 *
 * No model exists yet (added by a later task); this spec only proves the
 * entry point itself — the path every later model import will travel
 * through — is wired in.
 */
describe('chat-integration feature entry point reachability', () => {
  const apiv3IndexPath = path.join(__dirname, 'index.js');

  it('exists at the boot entrypoint this spec inspects', () => {
    // Guards against the spec silently passing vacuously if this file is
    // ever renamed or moved without updating the assertions below.
    expect(fs.existsSync(apiv3IndexPath)).toBe(true);
  });

  it('statically imports the chat-integration feature entry point', () => {
    const source = fs.readFileSync(apiv3IndexPath, 'utf8');
    expect(source).toMatch(
      /from\s+['"]~\/features\/chat-integration\/server['"]/,
    );
  });

  it('mounts the chat-integration router on the boot-time apiv3 router', () => {
    const source = fs.readFileSync(apiv3IndexPath, 'utf8');
    expect(source).toMatch(/router\.use\(\s*['"]\/chat-integration['"]/);
  });
});
