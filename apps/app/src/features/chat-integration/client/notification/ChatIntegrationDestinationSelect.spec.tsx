// Requirement 2.2 on the page-save screen: the person saving a page picks
// the notification channel FROM A LIST, by identifier, and never types a
// channel name. Gen 1's own free-text field
// (`client/components/SlackNotification.tsx`) keeps working next to this;
// nothing here replaces it.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IApiv3ChatIntegrationDestinationInput } from '~/interfaces/apiv3/page';

const mocks = vi.hoisted(() => ({ apiv3Get: vi.fn() }));

vi.mock('~/client/util/apiv3-client', () => ({ apiv3Get: mocks.apiv3Get }));

import { ChatIntegrationDestinationSelect } from './ChatIntegrationDestinationSelect';

const CHANNELS = [
  {
    relationId: 'relation-a',
    workspaceName: 'Workspace A',
    platform: 'slack',
    channelId: 'C0001',
    channelName: 'general',
    isPrivate: false,
  },
  {
    relationId: 'relation-b',
    workspaceName: 'Workspace B',
    platform: 'slack',
    channelId: 'C0001',
    channelName: 'general',
    isPrivate: false,
  },
];

// A fresh SWR cache per render, so each test's own stubbed response is the
// one that gets fetched (same reasoning as MyChatAccountLinks.spec.tsx).
const renderSelect = (
  props: Partial<{
    destinations: readonly IApiv3ChatIntegrationDestinationInput[];
    onChange: (
      destinations: readonly IApiv3ChatIntegrationDestinationInput[],
    ) => void;
  }> = {},
) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ChatIntegrationDestinationSelect
        destinations={props.destinations ?? []}
        onChange={props.onChange ?? vi.fn()}
      />
    </SWRConfig>,
  );

describe('ChatIntegrationDestinationSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers no free-text channel field anywhere -- a channel can only be picked from the list', async () => {
    // A typed channel name is exactly what Gen 2 does not accept: names
    // drift, and the save carries identifiers. If a text box appeared here,
    // someone would type into it and the destination would silently not be
    // the one they meant.
    mocks.apiv3Get.mockResolvedValue({
      data: { channels: CHANNELS, unavailableRelations: [] },
    });

    const { container } = renderSelect();

    await screen.findByRole('listbox');
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
    expect(
      container.querySelectorAll(
        'input[type="text"], input:not([type]), textarea',
      ),
    ).toHaveLength(0);
  });

  it('reports the picked channel as a relation, platform and identifier -- never a name', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: { channels: CHANNELS, unavailableRelations: [] },
    });
    const onChange = vi.fn();
    const user = userEvent.setup();

    renderSelect({ onChange });

    const listbox = await screen.findByRole('listbox');
    // Both workspaces have a channel named `general`; picking the second
    // one must produce Workspace B's relation, which is the only thing
    // telling them apart.
    await user.selectOptions(
      listbox,
      screen.getByRole('option', { name: /Workspace B/ }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([
        { relationId: 'relation-b', platform: 'slack', channelId: 'C0001' },
      ]);
    });
    const [picked] = onChange.mock.calls.at(-1) as [
      Array<Record<string, unknown>>,
    ];
    expect(picked[0]).not.toHaveProperty('channelName');
  });

  it('renders nothing when no chat workspace is paired', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: { channels: [], unavailableRelations: [] },
    });

    const { container } = renderSelect();

    await waitFor(() => {
      expect(mocks.apiv3Get).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('says which workspace is missing from the list when its channels could not be fetched', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: {
        channels: [CHANNELS[0]],
        unavailableRelations: [
          {
            relationId: 'relation-b',
            workspaceName: 'Workspace B',
            reason: 'unreachable',
          },
        ],
      },
    });

    renderSelect();

    expect(await screen.findByText(/Workspace B/)).toBeInTheDocument();
  });
});
