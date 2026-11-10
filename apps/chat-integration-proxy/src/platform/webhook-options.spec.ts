// Task 3.8: what a webhook call is given besides the request.
//
// Small surface, but the one thing it decides is invisible until a user tries
// it: without `onOpenModal` the Chat SDK refuses to open a Teams modal and
// only writes a warning, so a service whose `modal` capability is `full` would
// never show one.
import { describe, expect, it } from 'vitest';

import { webhookOptionsFor } from './webhook-options.js';

describe('webhookOptionsFor', () => {
  it('gives Teams a way to open a modal inside the response', () => {
    // Teams has no `Adapter.openModal`; the webhook response is the only place
    // a dialog can be handed back.
    expect(webhookOptionsFor('teams')?.onOpenModal).toBeTypeOf('function');
  });

  it('never defers the work past the response', () => {
    // Deferring is what closes a Teams dialog before it can open.
    expect(webhookOptionsFor('teams')?.waitUntil).toBeUndefined();
  });

  it.each([
    'slack',
    'discord',
    'mattermost',
  ] as const)('leaves %s on the SDK defaults', (platform) => {
    // These three open a modal through the platform's own API, so overriding
    // that here would replace a working mechanism with a fallback.
    expect(webhookOptionsFor(platform)).toBeUndefined();
  });

  it('reports a modal it cannot deliver as not opened', async () => {
    // The caller reads `false` from `PlatformFacade.openModal` and asks its
    // questions in the channel instead. A fabricated view id would claim a
    // modal the user never saw.
    const options = webhookOptionsFor('teams');

    await expect(
      options?.onOpenModal?.(
        {
          type: 'modal',
          callbackId: 'growi-modal',
          title: 'Keep',
          children: [],
        },
        'context-1',
      ),
    ).resolves.toBeUndefined();
  });
});
