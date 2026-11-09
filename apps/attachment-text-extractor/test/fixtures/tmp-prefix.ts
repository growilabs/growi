/**
 * The one prefix every test's temporary directory under os.tmpdir() starts
 * with, so a test that checks the shared temporary directory for leftovers
 * (runner/child-isolation.integ.ts) can tell other test files' directories
 * from what a killed child left behind.
 */
export const SPEC_TMP_PREFIX = 'ate-spec-';
