import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Req 1.5: the built service (`node dist/main.js`, what the image starts)
// exits before listening when the token is unset or blank, and says which
// variable is missing. A started service is covered by service.integ.ts; the
// port is fixed at 8000 as in the FastAPI image, so it is not started here.

const MAIN = fileURLToPath(new URL('../dist/main.js', import.meta.url));

const startMain = (env: Readonly<Record<string, string>>) =>
  spawnSync(process.execPath, [MAIN], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });

describe('node dist/main.js', () => {
  it.each([
    ['unset', {}],
    ['blank', { ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: ' ' }],
  ])('exits non-zero without listening when the token is %s', (_, env) => {
    const started = startMain(env);

    expect(started.error).toBeUndefined();
    expect(started.status).not.toBe(0);
    expect(started.status).not.toBeNull();
    expect(started.stderr).toContain('ATTACHMENT_EXTRACTOR_SERVICE_TOKEN');
    expect(started.stderr).not.toMatch(/listening/i);
  });
});
