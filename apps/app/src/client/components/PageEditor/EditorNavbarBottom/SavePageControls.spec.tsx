// Requirement 2.2 end to end on the save controls: a channel picked in the
// Gen 2 picker travels with the save as `chatIntegrationDestinations`,
// which is the field `create-page.ts` / `update-page.ts` already read.
//
// Gen 1's own `slackChannels` free-text field is asserted to still be
// carried unchanged in the same save -- the two generations coexist
// (Requirements 12.1-12.3); Gen 2 does not replace or disable Gen 1.

import { globalEventTarget } from '@growi/core/dist/utils';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SaveOptions } from '../PageEditor';

const mocks = vi.hoisted(() => ({ apiv3Get: vi.fn() }));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/client/util/apiv3-client', () => ({ apiv3Get: mocks.apiv3Get }));
vi.mock('~/states/page', () => ({
  useCurrentPageData: () => ({ _id: 'page-1', path: '/docs/page' }),
  useCurrentPageId: () => 'page-1',
  useCurrentPagePath: () => '/docs/page',
  useIsEditable: () => true,
}));
vi.mock('~/stores/editor', () => ({
  useSWRxSlackChannels: () => ({ data: undefined }),
}));
vi.mock('~/stores/page', () => ({
  useSWRxCurrentGrantData: () => ({ data: undefined, mutate: vi.fn() }),
}));
vi.mock('~/stores/user', () => ({
  useSWRxRelatedGroupsMembers: () => ({ data: undefined }),
}));
vi.mock('~/states/global', () => ({ useCurrentUser: () => undefined }));
// The desktop layout, where the notification controls sit inline next to
// the save button rather than behind a modal.
vi.mock('~/states/ui/device', () => ({
  useDeviceLargerThanMd: () => [true],
}));

import {
  isAclEnabledAtom,
  isSlackConfiguredAtom,
} from '~/states/server-configurations';

import { SavePageControls } from './SavePageControls';

const CHANNELS = [
  {
    relationId: 'relation-a',
    workspaceName: 'Workspace A',
    platform: 'slack',
    channelId: 'C0001',
    channelName: 'general',
    isPrivate: false,
  },
];

const renderControls = () => {
  const store = createStore();
  store.set(isAclEnabledAtom, false);
  store.set(isSlackConfiguredAtom, true);

  return render(
    <Provider store={store}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <SavePageControls />
      </SWRConfig>
    </Provider>,
  );
};

/** Captures the save request the controls broadcast. */
const listenForSave = () => {
  const saves: SaveOptions[] = [];
  const listener = (e: Event) => {
    saves.push((e as CustomEvent<SaveOptions>).detail);
  };
  globalEventTarget.addEventListener('saveAndReturnToView', listener);
  return {
    saves,
    stop: () =>
      globalEventTarget.removeEventListener('saveAndReturnToView', listener),
  };
};

describe('SavePageControls', () => {
  let saveListener: ReturnType<typeof listenForSave>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiv3Get.mockResolvedValue({
      data: { channels: CHANNELS, unavailableRelations: [] },
    });
    saveListener = listenForSave();
  });

  afterEach(() => {
    saveListener.stop();
  });

  it('carries the picked Gen 2 channel with the save, as chatIntegrationDestinations', async () => {
    const user = userEvent.setup();

    renderControls();

    await user.selectOptions(
      await screen.findByRole('listbox'),
      screen.getByRole('option', { name: /general/ }),
    );
    await user.click(screen.getByTestId('save-page-btn'));

    await waitFor(() => {
      expect(saveListener.saves).toHaveLength(1);
    });
    expect(saveListener.saves[0].chatIntegrationDestinations).toEqual([
      { relationId: 'relation-a', platform: 'slack', channelId: 'C0001' },
    ]);
  });

  it('still carries Gen 1 fields, and no Gen 2 destinations when none was picked', async () => {
    const user = userEvent.setup();

    renderControls();

    await screen.findByRole('listbox');
    await user.click(screen.getByTestId('save-page-btn'));

    await waitFor(() => {
      expect(saveListener.saves).toHaveLength(1);
    });
    expect(saveListener.saves[0]).toMatchObject({
      slackChannels: '',
      isSlackEnabled: false,
      chatIntegrationDestinations: [],
    });
  });
});
