import { describe, expect, it } from 'vitest';

import * as relationLayer from './index.js';

describe('relation/ public entry point', () => {
  it('exposes exactly what orchestration needs from this layer, and nothing more', () => {
    // Asserted rather than described in a comment, for the same reason
    // `command/index.spec.ts` and `platform/index.spec.ts` assert their own
    // lists: a barrel silently grows when someone adds `export *`, and this
    // layer's contract is what every later layer reads it through.
    //
    // Declared final by task 5.5, the last task of this layer. `relation/` has
    // no facade module of its own (design.md's File Structure Plan gives it
    // five modules and a barrel, unlike `platform/index.ts`'s
    // `createPlatformFacade`), so this list IS the layer's surface.
    //
    // Both `createUnpairService` and `PairingService.unpair` are published on
    // purpose: design.md declares `unpair` on `PairingService` (line 986) AND
    // lists `unpair-service.ts` as a module of its own (line 330). The service
    // is the one place the deletion is composed; `PairingService.unpair`
    // delegates to it so that a caller already holding the pairing surface
    // does not have to construct a second one.
    expect(Object.keys(relationLayer).sort()).toEqual(
      [
        'GrowiRequestTimeoutError',
        'MAX_LIVE_PAIRING_ORDERS',
        'MAX_SUBMISSION_ATTEMPTS',
        'PairingOrderLimitError',
        'REGISTRATION_CODE_TTL_MS',
        'createGrowiSelector',
        'createGrowiUriResolver',
        'createPairingService',
        'createRelationKeyService',
        'createUnpairService',
      ].sort(),
    );
  });
});
