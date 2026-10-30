import * as orchestrationLayer from './index.js';

describe('orchestration/ public entry point', () => {
  it('exposes exactly what the layer above it needs, and nothing more', () => {
    // Asserted rather than described in a comment, for the same reason
    // `growi/index.spec.ts` asserts its own list: a barrel silently grows when
    // someone adds `export *`, and this layer's contract is what `routes/`
    // reads it through.
    //
    // Only value exports appear here -- the types travel with them and are
    // checked by the compiler.
    expect(Object.keys(orchestrationLayer).sort()).toEqual([
      'createAdminFlow',
      'createCommandFlow',
      'createEventSink',
      'createInboundFlow',
    ]);
  });
});
