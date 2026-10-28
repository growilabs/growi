// Requirement 2.2 on the page-save screen: the person saving a page picks
// the notification channel FROM A LIST, by identifier, and never types a
// channel name. Gen 1's own free-text field
// (`client/components/SlackNotification.tsx`) keeps working next to this;
// nothing here replaces it.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IApiv3ChatIntegrationDestinationInput } from '~/interfaces/apiv3/page';

const mocks = vi.hoisted(() => ({ apiv3Get: vi.fn() }));

vi.mock('~/client/util/apiv3-client', () => ({ apiv3Get: mocks.apiv3Get }));
// Interpolation values are appended to the key so a test can see them.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options == null ? key : `${key} ${JSON.stringify(options)}`,
  }),
}));

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

const manyChannels = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    relationId: 'relation-a',
    workspaceName: 'Workspace A',
    platform: 'slack',
    channelId: `C${i}`,
    channelName: `channel-${i}`,
    isPrivate: false,
  }));

// A fresh SWR cache per render, so each test's own stubbed response is the
// one that gets fetched (same reasoning as MyChatAccountLinks.spec.tsx).
const renderSelect = (
  props: Partial<{
    destinations: readonly IApiv3ChatIntegrationDestinationInput[];
    onChange: (
      destinations: readonly IApiv3ChatIntegrationDestinationInput[],
    ) => void;
    openInModal: boolean;
  }> = {},
) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ChatIntegrationDestinationSelect
        destinations={props.destinations ?? []}
        onChange={props.onChange ?? vi.fn()}
        openInModal={props.openInModal}
      />
    </SWRConfig>,
  );

const findToggle = () =>
  screen.findByRole('button', {
    name: /chat_integration.destination_select.aria_label/,
  });

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  const toggle = await findToggle();
  await user.click(toggle);
  return toggle;
};

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
    const user = userEvent.setup();

    const { baseElement } = renderSelect();
    await openMenu(user);

    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
    expect(
      baseElement.querySelectorAll(
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
    await openMenu(user);

    // Both workspaces have a channel named `general`; picking the one under
    // Workspace B must produce Workspace B's relation, which is the only
    // thing telling them apart.
    const workspaceB = screen.getByRole('group', { name: /Workspace B/ });
    await user.click(within(workspaceB).getByRole('checkbox'));

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

  it('removes a channel from the output when its checkbox is cleared', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: { channels: CHANNELS, unavailableRelations: [] },
    });
    const onChange = vi.fn();
    const user = userEvent.setup();

    renderSelect({
      destinations: [
        { relationId: 'relation-a', platform: 'slack', channelId: 'C0001' },
        { relationId: 'relation-b', platform: 'slack', channelId: 'C0001' },
      ],
      onChange,
    });
    await openMenu(user);

    const workspaceA = screen.getByRole('group', { name: /Workspace A/ });
    await user.click(within(workspaceA).getByRole('checkbox'));

    expect(onChange).toHaveBeenLastCalledWith([
      { relationId: 'relation-b', platform: 'slack', channelId: 'C0001' },
    ]);
  });

  it('shows how many channels are selected without opening the menu', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: { channels: CHANNELS, unavailableRelations: [] },
    });

    renderSelect({
      destinations: [
        { relationId: 'relation-a', platform: 'slack', channelId: 'C0001' },
        { relationId: 'relation-b', platform: 'slack', channelId: 'C0001' },
      ],
    });

    const toggle = await findToggle();
    expect(toggle).toHaveTextContent('"selectedCount":2');
  });

  it('keeps the menu open after a channel is checked, so several can be picked in a row', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: { channels: CHANNELS, unavailableRelations: [] },
    });
    const user = userEvent.setup();

    renderSelect();
    const toggle = await openMenu(user);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const workspaceA = screen.getByRole('group', { name: /Workspace A/ });
    await user.click(within(workspaceA).getByRole('checkbox'));

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not change the size of the controls however many channels there are', async () => {
    mocks.apiv3Get.mockResolvedValueOnce({
      data: { channels: manyChannels(1), unavailableRelations: [] },
    });
    const one = renderSelect();
    await findToggle();
    const elementsWithOne = one.container.querySelectorAll('*').length;
    one.unmount();

    mocks.apiv3Get.mockResolvedValueOnce({
      data: { channels: manyChannels(50), unavailableRelations: [] },
    });
    const fifty = renderSelect();
    await findToggle();

    expect(fifty.container.querySelectorAll('*').length).toBe(elementsWithOne);
  });

  it('opens upward by default and downward inside a modal', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: { channels: CHANNELS, unavailableRelations: [] },
    });

    const inline = renderSelect();
    await findToggle();
    expect(inline.container.querySelector('.dropup')).not.toBeNull();
    inline.unmount();

    const modal = renderSelect({ openInModal: true });
    await findToggle();
    expect(modal.container.querySelector('.dropup')).toBeNull();
    expect(modal.container.querySelector('.dropdown')).not.toBeNull();
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
    const user = userEvent.setup();

    renderSelect();
    await openMenu(user);

    expect(await screen.findByText(/Workspace B/)).toBeInTheDocument();
    expect(screen.getByText(/unreachable/)).toBeInTheDocument();
  });

  it('moves focus into the menu when it opens, so the boxes are reachable and toggleable from the keyboard', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: { channels: CHANNELS, unavailableRelations: [] },
    });
    const onChange = vi.fn();
    const user = userEvent.setup();

    renderSelect({ onChange });
    const toggle = await findToggle();
    toggle.focus();
    await user.keyboard('{Enter}');

    const firstBox = within(
      screen.getByRole('group', { name: /Workspace A/ }),
    ).getByRole('checkbox');
    expect(firstBox).toHaveFocus();

    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith([
      { relationId: 'relation-a', platform: 'slack', channelId: 'C0001' },
    ]);
  });

  it('closes on Escape and returns focus to the toggle', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: { channels: CHANNELS, unavailableRelations: [] },
    });
    const user = userEvent.setup();

    renderSelect();
    const toggle = await openMenu(user);
    await user.keyboard('{Escape}');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('includes the selected count and a partial-failure notice in the accessible name of the toggle', async () => {
    mocks.apiv3Get.mockResolvedValue({
      data: {
        channels: CHANNELS,
        unavailableRelations: [
          { relationId: 'relation-c', workspaceName: 'C', reason: 'x' },
        ],
      },
    });

    renderSelect({
      destinations: [
        { relationId: 'relation-a', platform: 'slack', channelId: 'C0001' },
      ],
    });

    const toggle = await findToggle();
    expect(toggle).toHaveAccessibleName(/"selectedCount":1/);
    expect(toggle).toHaveAccessibleName(/partial_warning_title/);
  });
});
