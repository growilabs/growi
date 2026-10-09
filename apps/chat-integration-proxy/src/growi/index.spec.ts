import * as growiLayer from './index.js';

describe('growi/ public entry point', () => {
  it('exposes exactly what the layers above it need, and nothing more', () => {
    // Asserted rather than described in a comment, for the same reason
    // `relation/index.spec.ts` asserts its own list: a barrel silently grows
    // when someone adds `export *`, and this layer's contract is what every
    // later layer reads it through.
    //
    // Final as of task 6.3, the last task of this layer: the three modules
    // design.md lists under `growi/` are all built. Only value exports appear
    // here -- the types travel with them and are checked by the compiler.
    expect(Object.keys(growiLayer).sort()).toEqual([
      'createFanOutCollector',
      'createGrowiClient',
      'fuseResults',
    ]);
  });
});
