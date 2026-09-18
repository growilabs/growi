import { mock } from 'vitest-mock-extended';

import { createGen2NotificationDispatcher } from './destination-dispatcher';
import type { Gen2Destination } from './destination-registry';
import { DestinationRegistry } from './destination-registry';
import type { NotificationOutbox } from './notification-outbox';

describe('createGen2NotificationDispatcher', () => {
  it("enqueues one outbox row for the destination it is given, scoped to that destination's relation", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const outbox = mock<NotificationOutbox>({ enqueue });

    const dispatch = createGen2NotificationDispatcher(
      'someone created [/a](https://growi.example.com/a)',
      false,
      outbox,
    );
    const destination: Gen2Destination = {
      relationId: 'rel-1',
      platform: 'slack',
      channelId: 'C1',
    };

    await dispatch(destination);

    expect(enqueue).toHaveBeenCalledWith({
      relationId: 'rel-1',
      targets: [{ platform: 'slack', channelId: 'C1' }],
      markdown: 'someone created [/a](https://growi.example.com/a)',
      containsRestrictedPage: false,
    });
  });

  it('threads containsRestrictedPage through to the outbox row', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const outbox = mock<NotificationOutbox>({ enqueue });

    const dispatch = createGen2NotificationDispatcher(
      'someone edited [/secret](https://growi.example.com/secret)',
      true,
      outbox,
    );

    await dispatch({
      relationId: 'rel-1',
      platform: 'discord',
      channelId: 'D1',
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ containsRestrictedPage: true }),
    );
  });

  it('a relation with 2+ configured destinations produces one outbox call PER destination, proving the caller repeats per relation rather than stopping after one', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const outbox = mock<NotificationOutbox>({ enqueue });
    const destinations: Gen2Destination[] = [
      { relationId: 'rel-1', platform: 'slack', channelId: 'C1' },
      { relationId: 'rel-1', platform: 'slack', channelId: 'C2' },
      { relationId: 'rel-2', platform: 'discord', channelId: 'D1' },
    ];
    const registry = new DestinationRegistry(destinations);

    await registry.dispatchAll(
      createGen2NotificationDispatcher('body', false, outbox),
    );

    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        relationId: 'rel-1',
        targets: [{ platform: 'slack', channelId: 'C1' }],
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        relationId: 'rel-1',
        targets: [{ platform: 'slack', channelId: 'C2' }],
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        relationId: 'rel-2',
        targets: [{ platform: 'discord', channelId: 'D1' }],
      }),
    );
  });
});
