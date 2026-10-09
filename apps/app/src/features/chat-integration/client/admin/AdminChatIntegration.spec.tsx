// Proves task 9.1's screen-level contract:
//   - the screen renders relation state (active/unpaired) from the list
//     endpoint
//   - capabilities render GENERICALLY -- a fabricated, never-seen-before
//     capability field is rendered rather than silently dropped, proving no
//     hardcoded per-platform switch exists
//   - live connection status shows for an active relation
//   - the encryption-key-unconfigured state disables pairing and shows why
//   - submitting the pairing form calls the pairing endpoint with the
//     entered fields
//   - an active relation offers a disconnect (Requirement 9.7) that asks for
//     confirmation, calls the unpair endpoint, and re-reads the relation list

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiv3Get: vi.fn(),
  apiv3Post: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: mocks.apiv3Get,
  apiv3Post: mocks.apiv3Post,
}));

vi.mock('~/client/util/toastr', () => ({
  toastError: mocks.toastError,
  toastSuccess: mocks.toastSuccess,
}));

import { AdminChatIntegration } from './AdminChatIntegration';

interface AdminRelationListItem {
  readonly relationId: string;
  readonly platform: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly label: string | null;
  readonly state: 'active' | 'unpaired';
  readonly createdAt: string;
  readonly unpairedAt: string | null;
}

const ACTIVE_RELATION: AdminRelationListItem = {
  relationId: 'relation-active',
  platform: 'slack',
  workspaceId: 'workspace-1',
  workspaceName: 'Active Workspace',
  label: null,
  state: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  unpairedAt: null,
};

const UNPAIRED_RELATION: AdminRelationListItem = {
  relationId: 'relation-unpaired',
  platform: 'discord',
  workspaceId: 'workspace-2',
  workspaceName: 'Old Workspace',
  label: 'Old label',
  state: 'unpaired',
  createdAt: '2026-01-01T00:00:00.000Z',
  unpairedAt: '2026-02-01T00:00:00.000Z',
};

const CAPABILITY_REPORT = {
  platforms: [
    {
      platform: 'slack',
      capabilities: [
        { capability: 'slashCommand', level: 'none', substitute: 'mention' },
        {
          capability: 'never-seen-before-capability',
          level: 'degraded',
          substitute: 'a made-up workaround',
        },
      ],
    },
  ],
};

const CONNECTION_STATUS = {
  platform: 'slack',
  health: 'connected',
  since: '2026-01-01T00:00:00.000Z',
};

const SETTINGS = {
  settings: {
    relationId: ACTIVE_RELATION.relationId,
    channelPermissions: [
      { commandName: 'create-page', allowedChannels: 'all' },
      { commandName: 'keep', allowedChannels: ['C0001', 'C0002'] },
    ],
  },
  version: 4,
};

interface DestinationsView {
  destinations: Array<{
    platform: string;
    channelId: string;
    channelName: string;
    pathPattern: string;
    triggerEvents: string[];
  }>;
  channels: Array<{
    platform: string;
    channelId: string;
    channelName: string;
    isPrivate: boolean;
  }>;
  channelsUnavailable: string | null;
  overlaps: Array<{ channelId: string; channelName: string }>;
  overlapsMayBeStale: boolean;
}

const DESTINATIONS: DestinationsView = {
  destinations: [
    {
      platform: 'slack',
      channelId: 'C0001',
      channelName: 'general',
      pathPattern: '/*',
      triggerEvents: ['pageCreate'],
    },
  ],
  channels: [
    {
      platform: 'slack',
      channelId: 'C0001',
      channelName: 'general',
      isPrivate: false,
    },
    {
      platform: 'slack',
      channelId: 'C0002',
      channelName: 'random',
      isPrivate: false,
    },
  ],
  channelsUnavailable: null,
  overlaps: [],
  overlapsMayBeStale: false,
};

// Route apiv3Get by URL, matching the exact endpoints AdminChatIntegration
// calls -- this is the observable contract (which endpoints get hit), not
// an implementation spy on internal function names.
const stubApi = ({
  encryptionConfigured = true,
  relations = [ACTIVE_RELATION],
  destinations = DESTINATIONS,
}: {
  encryptionConfigured?: boolean;
  relations?: AdminRelationListItem[];
  destinations?: DestinationsView;
} = {}) => {
  mocks.apiv3Get.mockImplementation((url: string) => {
    if (url === '/chat-integration/admin/encryption-status') {
      return Promise.resolve({
        data: encryptionConfigured
          ? { configured: true }
          : { configured: false, reason: 'unset' },
      });
    }
    if (url === '/chat-integration/admin/relations') {
      return Promise.resolve({ data: { relations } });
    }
    if (url.endsWith('/capabilities')) {
      return Promise.resolve({ data: CAPABILITY_REPORT });
    }
    if (url.endsWith('/connection-status')) {
      return Promise.resolve({ data: CONNECTION_STATUS });
    }
    if (url.endsWith('/settings')) {
      return Promise.resolve({ data: SETTINGS });
    }
    if (url.endsWith('/notification-destinations')) {
      return Promise.resolve({ data: destinations });
    }
    return Promise.reject(new Error(`unexpected URL: ${url}`));
  });
};

// Fresh SWR cache per render -- otherwise a later test's fetch resolves
// instantly from a previous test's cached data instead of calling
// `apiv3Get` again (same reasoning as this feature's other client specs).
const renderScreen = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AdminChatIntegration />
    </SWRConfig>,
  );

describe('AdminChatIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders each relation with its workspace name, platform, and lifecycle state', async () => {
    stubApi({ relations: [ACTIVE_RELATION, UNPAIRED_RELATION] });

    renderScreen();

    expect(await screen.findByText('Active Workspace')).toBeInTheDocument();
    expect(await screen.findByText('Old label')).toBeInTheDocument();
    const rows = await screen.findAllByTestId(
      'grw-chat-integration-relation-row',
    );
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('active')).toBeInTheDocument();
    expect(within(rows[1]).getByText('unpaired')).toBeInTheDocument();
  });

  it('renders CapabilityReport generically, including a fabricated field no known platform sends', async () => {
    stubApi({ relations: [ACTIVE_RELATION] });

    renderScreen();

    // Both a known-shaped capability AND the fabricated one must render --
    // if the component had a hardcoded per-platform switch instead of a
    // generic loop, the fabricated one would be silently dropped.
    expect(await screen.findByText('slashCommand')).toBeInTheDocument();
    expect(
      await screen.findByText('never-seen-before-capability'),
    ).toBeInTheDocument();
    expect(screen.getByText('a made-up workaround')).toBeInTheDocument();

    // A KNOWN capability's own level/substitute must also come through
    // verbatim -- not just its name. Without this, a hardcoded override
    // for a specific known capability name (e.g. "always show slashCommand
    // as unsupported") could silently replace what the proxy actually
    // reported, while the fabricated-field assertions above would still
    // pass untouched (they only prove unknown fields aren't dropped).
    const rows = await screen.findAllByTestId(
      'grw-chat-integration-capability-row',
    );
    const slashCommandRow = rows.find((row) =>
      within(row).queryByText('slashCommand'),
    );
    expect(slashCommandRow).toBeDefined();
    expect(
      within(slashCommandRow as HTMLElement).getByText('none'),
    ).toBeInTheDocument();
    expect(
      within(slashCommandRow as HTMLElement).getByText('mention'),
    ).toBeInTheDocument();
  });

  it('does not fetch capabilities/connection-status for an unpaired relation', async () => {
    stubApi({ relations: [UNPAIRED_RELATION] });

    renderScreen();

    expect(await screen.findByText('Old label')).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.apiv3Get).toHaveBeenCalledWith(
        '/chat-integration/admin/relations',
      );
    });
    expect(mocks.apiv3Get).not.toHaveBeenCalledWith(
      expect.stringContaining('capabilities'),
    );
    expect(mocks.apiv3Get).not.toHaveBeenCalledWith(
      expect.stringContaining('connection-status'),
    );
  });

  it("shows the active relation's live connection health", async () => {
    stubApi({ relations: [ACTIVE_RELATION] });

    renderScreen();

    expect(
      await screen.findByTestId('grw-chat-integration-connection-health'),
    ).toHaveTextContent('connected');
  });

  describe('channel permissions (task 9.2)', () => {
    const scopeSelectFor = (commandName: string) =>
      screen.getByLabelText(commandName, { selector: 'select' });

    it("shows each command's saved permission, including 'all' and an explicit channel list", async () => {
      stubApi({ relations: [ACTIVE_RELATION] });

      renderScreen();

      expect(
        await screen.findByTestId('grw-chat-integration-permissions-form'),
      ).toBeInTheDocument();
      // 'all' is not an empty channel list -- if the screen could not tell
      // the two apart, an administrator would silently narrow a command that
      // was allowed everywhere.
      expect(scopeSelectFor('create-page')).toHaveValue('all');
      expect(scopeSelectFor('keep')).toHaveValue('listed');
      expect(screen.getByLabelText(/channel ids for keep/i)).toHaveValue(
        'C0001, C0002',
      );
      // A command with no stored row must stay "not configured" rather than
      // being shown (and later saved) as an explicit rule.
      expect(scopeSelectFor('search')).toHaveValue('unset');
    });

    it('saves the whole set, keeping unchanged commands and omitting the unconfigured ones', async () => {
      stubApi({ relations: [ACTIVE_RELATION] });
      mocks.apiv3Post.mockResolvedValue({
        data: { status: 'saved', version: 5, push: { ok: true } },
      });
      const user = userEvent.setup();

      renderScreen();

      await screen.findByTestId('grw-chat-integration-permissions-form');
      await user.selectOptions(scopeSelectFor('search'), 'listed');
      await user.type(
        screen.getByLabelText(/channel ids for search/i),
        'C0009 C0010',
      );
      await user.click(
        screen.getByRole('button', { name: /save channel permissions/i }),
      );

      await waitFor(() => {
        expect(mocks.apiv3Post).toHaveBeenCalledWith(
          `/chat-integration/admin/relations/${ACTIVE_RELATION.relationId}/settings`,
          {
            channelPermissions: [
              { commandName: 'search', allowedChannels: ['C0009', 'C0010'] },
              { commandName: 'create-page', allowedChannels: 'all' },
              { commandName: 'keep', allowedChannels: ['C0001', 'C0002'] },
            ],
          },
        );
      });
      expect(mocks.toastSuccess).toHaveBeenCalled();
    });

    it('reports a save whose push failed as saved, and says the proxy will fetch it', async () => {
      stubApi({ relations: [ACTIVE_RELATION] });
      mocks.apiv3Post.mockResolvedValue({
        data: {
          status: 'saved',
          version: 5,
          push: { ok: false, reason: 'unreachable' },
        },
      });
      const user = userEvent.setup();

      renderScreen();

      await screen.findByTestId('grw-chat-integration-permissions-form');
      await user.click(
        screen.getByRole('button', { name: /save channel permissions/i }),
      );

      await waitFor(() => {
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
          expect.stringMatching(/proxy will fetch/i),
        );
      });
      expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it('does not offer a permission editor for an unpaired relation', async () => {
      stubApi({ relations: [UNPAIRED_RELATION] });

      renderScreen();

      expect(await screen.findByText('Old label')).toBeInTheDocument();
      expect(
        screen.queryByTestId('grw-chat-integration-permissions-form'),
      ).not.toBeInTheDocument();
    });
  });

  describe('notification destinations (task 9.3)', () => {
    it('warns the administrator when a channel is a destination on both generations', async () => {
      stubApi({
        destinations: {
          ...DESTINATIONS,
          overlaps: [{ channelId: 'C0001', channelName: 'general' }],
        },
      });

      renderScreen();

      const warning = await screen.findByTestId(
        'grw-chat-integration-destination-overlap-warning',
      );
      // The channel has to be named: "some channel overlaps" leaves the
      // administrator with nothing to act on.
      expect(warning).toHaveTextContent('general');
    });

    it('shows no overlap warning when no channel is configured twice', async () => {
      stubApi();

      renderScreen();

      expect(
        await screen.findByTestId('grw-chat-integration-destination-form'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(
          'grw-chat-integration-destination-overlap-warning',
        ),
      ).not.toBeInTheDocument();
    });

    it('offers the fetched channels to pick from and saves the picked channel by IDENTIFIER', async () => {
      stubApi();
      mocks.apiv3Post.mockResolvedValue({
        data: { status: 'saved', destination: {} },
      });
      const user = userEvent.setup();

      renderScreen();

      await screen.findByTestId('grw-chat-integration-destination-form');
      // The administrator reads names but the option's value is the id --
      // picking by name is not offered anywhere on this form.
      await user.selectOptions(
        screen.getByLabelText('Channel', { selector: 'select' }),
        screen.getByRole('option', { name: /random/ }),
      );
      await user.clear(screen.getByLabelText('Page path'));
      await user.type(screen.getByLabelText('Page path'), '/docs/*');
      await user.click(screen.getByLabelText('pageEdit'));
      await user.click(
        screen.getByRole('button', { name: /add destination/i }),
      );

      await waitFor(() => {
        expect(mocks.apiv3Post).toHaveBeenCalledWith(
          `/chat-integration/admin/relations/${ACTIVE_RELATION.relationId}/notification-destinations`,
          {
            channelId: 'C0002',
            pathPattern: '/docs/*',
            triggerEvents: ['pageEdit'],
          },
        );
      });
      // No channel name may be sent: the name is the server's to resolve
      // from the channel list, and an administrator never types one.
      const [, body] = mocks.apiv3Post.mock.calls.at(-1) as [
        string,
        Record<string, unknown>,
      ];
      expect(body).not.toHaveProperty('channelName');
    });

    it('tells the administrator the overlap check may be stale when the channel list could not be fetched', async () => {
      // The dangerous reading of this state is "no warning shown, so
      // nothing overlaps". Nothing was actually checked against current
      // names, and the screen has to say so.
      stubApi({
        destinations: {
          ...DESTINATIONS,
          channels: [],
          channelsUnavailable: 'unreachable',
          overlaps: [],
          overlapsMayBeStale: true,
        },
      });

      renderScreen();

      const caution = await screen.findByTestId(
        'grw-chat-integration-destination-overlap-stale',
      );
      expect(caution).toHaveTextContent(/may be stale/i);
    });

    it('says nothing about staleness when the channel list was fetched', async () => {
      stubApi();

      renderScreen();

      expect(
        await screen.findByTestId('grw-chat-integration-destination-form'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('grw-chat-integration-destination-overlap-stale'),
      ).not.toBeInTheDocument();
    });

    it('cannot add a destination when the channel list could not be fetched', async () => {
      stubApi({
        destinations: {
          ...DESTINATIONS,
          channels: [],
          channelsUnavailable: 'unreachable',
          overlapsMayBeStale: true,
        },
      });

      renderScreen();

      // What is already configured still shows...
      expect(
        await screen.findByTestId('grw-chat-integration-destination-row'),
      ).toHaveTextContent('general');
      // ...but there is no way to pick a channel that was never confirmed.
      expect(
        screen.queryByTestId('grw-chat-integration-destination-form'),
      ).not.toBeInTheDocument();
    });
  });

  describe('disconnecting a workspace (Requirement 9.7)', () => {
    it('asks for confirmation first, and posts nothing until it is given', async () => {
      // Disconnecting deletes this relation's keys, channel permissions and
      // notification destinations, so a single stray click must not do it.
      stubApi({ relations: [ACTIVE_RELATION] });
      const user = userEvent.setup();

      renderScreen();

      await user.click(
        await screen.findByRole('button', { name: /disconnect/i }),
      );
      expect(mocks.apiv3Post).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mocks.apiv3Post).not.toHaveBeenCalled();
    });

    it('unpairs the relation through the admin endpoint once confirmed, then reloads the list', async () => {
      stubApi({ relations: [ACTIVE_RELATION] });
      mocks.apiv3Post.mockResolvedValue({ data: { status: 'unpaired' } });
      const user = userEvent.setup();

      renderScreen();

      await user.click(
        await screen.findByRole('button', { name: /disconnect/i }),
      );
      await user.click(
        screen.getByRole('button', { name: /yes, disconnect/i }),
      );

      await waitFor(() => {
        expect(mocks.apiv3Post).toHaveBeenCalledWith(
          `/chat-integration/admin/relations/${ACTIVE_RELATION.relationId}/unpair`,
          {},
        );
      });
      expect(mocks.toastSuccess).toHaveBeenCalled();
      // The list has to be re-read: the row's state is what the screen shows
      // the operator, and it has just changed on the server.
      await waitFor(() => {
        const listCalls = mocks.apiv3Get.mock.calls.filter(
          ([url]) => url === '/chat-integration/admin/relations',
        );
        expect(listCalls.length).toBeGreaterThan(1);
      });
    });

    it('reports a failed disconnect as an error rather than a success', async () => {
      stubApi({ relations: [ACTIVE_RELATION] });
      mocks.apiv3Post.mockRejectedValue(new Error('relation not found'));
      const user = userEvent.setup();

      renderScreen();

      await user.click(
        await screen.findByRole('button', { name: /disconnect/i }),
      );
      await user.click(
        screen.getByRole('button', { name: /yes, disconnect/i }),
      );

      await waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalled();
      });
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
    });

    it('does not offer a disconnect for a relation that is already unpaired', async () => {
      stubApi({ relations: [UNPAIRED_RELATION] });

      renderScreen();

      expect(await screen.findByText('Old label')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /disconnect/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('shows the encryption-key-unconfigured warning and disables the pairing form', async () => {
    stubApi({ encryptionConfigured: false, relations: [] });

    renderScreen();

    expect(
      await screen.findByText(/encryption key is not configured/i),
    ).toBeInTheDocument();
    const submitButton = await screen.findByRole('button', { name: /pair/i });
    expect(submitButton).toBeDisabled();
    expect(screen.getByLabelText(/registration code/i)).toBeDisabled();
  });

  it('submits the pairing form with the entered fields when the key is configured', async () => {
    stubApi({ encryptionConfigured: true, relations: [] });
    mocks.apiv3Post.mockResolvedValue({
      data: { status: 'paired', relationId: 'relation-new' },
    });
    const user = userEvent.setup();

    renderScreen();

    await user.type(
      await screen.findByLabelText(/registration code/i),
      'the-code',
    );
    await user.type(
      screen.getByLabelText(/proxy url/i),
      'https://proxy.example.test',
    );
    await user.type(
      screen.getByLabelText(/this growi's url/i),
      'https://growi.example.test',
    );
    await user.type(
      screen.getByLabelText(/label to show the chat service/i),
      'My GROWI',
    );
    await user.click(screen.getByRole('button', { name: /pair/i }));

    await waitFor(() => {
      expect(mocks.apiv3Post).toHaveBeenCalledWith(
        '/chat-integration/admin/pairing',
        {
          registrationCode: 'the-code',
          proxyUri: 'https://proxy.example.test',
          growiUri: 'https://growi.example.test',
          growiLabel: 'My GROWI',
        },
      );
    });
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it('shows an error toast (not a success) for a non-"paired" outcome', async () => {
    stubApi({ encryptionConfigured: true, relations: [] });
    mocks.apiv3Post.mockResolvedValue({
      data: { status: 'code-expired' },
    });
    const user = userEvent.setup();

    renderScreen();

    await user.type(
      await screen.findByLabelText(/registration code/i),
      'the-code',
    );
    await user.type(
      screen.getByLabelText(/proxy url/i),
      'https://proxy.example.test',
    );
    await user.type(
      screen.getByLabelText(/this growi's url/i),
      'https://growi.example.test',
    );
    await user.type(
      screen.getByLabelText(/label to show the chat service/i),
      'My GROWI',
    );
    await user.click(screen.getByRole('button', { name: /pair/i }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalled();
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
