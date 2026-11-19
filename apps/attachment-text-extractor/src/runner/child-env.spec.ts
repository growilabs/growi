import { buildChildEnv } from './child-env';

// Req 3.8 and research.md 15.4 (6) / 19.1: the child's environment is an
// explicit object, never derived from the parent's process.env, so the service
// token, NODE_OPTIONS, PATH and anything else the HTTP process holds cannot
// reach it. Exact equality is the check: this test process has a PATH and more,
// and none of it may appear. process-limits.integ.ts reads what a real child
// received when its parent held the token.
describe('buildChildEnv', () => {
  it('holds only the single-thread and malloc-arena settings', () => {
    expect(Object.keys(process.env).length).toBeGreaterThan(0);

    expect(buildChildEnv()).toEqual({
      RAYON_NUM_THREADS: '1',
      MALLOC_ARENA_MAX: '2',
    });
  });
});
