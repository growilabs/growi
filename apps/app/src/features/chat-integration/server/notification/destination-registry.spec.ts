import {
  DestinationRegistry,
  type Gen2Destination,
} from './destination-registry';

describe('DestinationRegistry', () => {
  it('dispatches to every destination in the set, including a platform value it has never seen before', async () => {
    // Requirement 12.2/12.3: the registry must not branch on `platform` --
    // this is what "宛先の集合を種類で分岐しない" means. Proving it works for
    // 'slack'/'discord' alone would not rule out an `if (platform === ...)`
    // branch inside the registry; including a made-up platform name the
    // registry could not have special-cased in advance is what actually
    // proves genericity.
    const destinations: Gen2Destination[] = [
      { relationId: 'rel-1', platform: 'slack', channelId: 'C1' },
      { relationId: 'rel-1', platform: 'discord', channelId: 'D2' },
      {
        relationId: 'rel-2',
        platform: 'some-future-platform-nobody-wrote-a-branch-for',
        channelId: 'X3',
      },
    ];
    const registry = new DestinationRegistry(destinations);

    const dispatched: Gen2Destination[] = [];
    const results = await registry.dispatchAll(async (destination) => {
      dispatched.push(destination);
    });

    expect(dispatched).toEqual(destinations);
    expect(results).toEqual(
      destinations.map((destination) => ({
        destination,
        outcome: 'dispatched',
      })),
    );
  });

  it('reports each destination result independently -- one failing dispatch does not stop or hide the others', async () => {
    const destinations: Gen2Destination[] = [
      { relationId: 'rel-1', platform: 'slack', channelId: 'ok-1' },
      { relationId: 'rel-1', platform: 'slack', channelId: 'will-fail' },
      { relationId: 'rel-1', platform: 'slack', channelId: 'ok-2' },
    ];
    const registry = new DestinationRegistry(destinations);

    const results = await registry.dispatchAll(async (destination) => {
      if (destination.channelId === 'will-fail') {
        throw new Error('boom');
      }
    });

    expect(results).toEqual([
      { destination: destinations[0], outcome: 'dispatched' },
      { destination: destinations[1], outcome: 'failed' },
      { destination: destinations[2], outcome: 'dispatched' },
    ]);
  });

  it('exposes the number of destinations it holds', () => {
    const registry = new DestinationRegistry([
      { relationId: 'rel-1', platform: 'slack', channelId: 'C1' },
      { relationId: 'rel-1', platform: 'teams', channelId: 'T1' },
    ]);

    expect(registry.size).toBe(2);
  });

  it('dispatches to nothing and returns an empty result set when given an empty set', async () => {
    const registry = new DestinationRegistry([]);
    const dispatch = vi.fn();

    const results = await registry.dispatchAll(dispatch);

    expect(dispatch).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});
