// @vitest-environment happy-dom
import type { HasObjectId, IUser } from '@growi/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import {
  type IInAppNotification,
  InAppNotificationStatuses,
} from '~/interfaces/in-app-notification';

import InAppNotificationElm from './InAppNotificationElm';

const { apiv3PostMock, mutateCountMock, routerPushMock } = vi.hoisted(() => ({
  apiv3PostMock: vi.fn(),
  mutateCountMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Post: apiv3PostMock,
}));

vi.mock('~/stores/in-app-notification', () => ({
  useSWRxInAppNotificationStatus: () => ({ mutate: mutateCountMock }),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) =>
      options?.ns != null ? `${options.ns}:${key}` : key,
  }),
}));

vi.mock('~/client/components/FormattedDistanceDate', () => ({
  FormattedDistanceDate: () => null,
}));

const PROPOSAL_ID = '65a1b2c3d4e5f60718293a4b';
const OTHER_ID = '65a1b2c3d4e5f60718293a4c';
const NOTIFICATION_ID = '65a1b2c3d4e5f60718293a00';

const buildNotification = (
  overrides: Partial<IInAppNotification & HasObjectId>,
): IInAppNotification & HasObjectId => ({
  _id: NOTIFICATION_ID,
  user: mock<IUser>(),
  targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
  target: { _id: OTHER_ID },
  action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
  status: InAppNotificationStatuses.STATUS_UNOPENED,
  actionUsers: [],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  snapshot: '',
  ...overrides,
});

const coalescedSnapshot = (kind: 'apply' | 'revert') =>
  JSON.stringify({
    proposalId: PROPOSAL_ID,
    entry: 'mcp',
    kind,
    requester: { id: OTHER_ID, username: 'alice' },
    pages: [{ id: '65a1b2c3d4e5f60718293b00', path: '/changed-page' }],
  });

const revertRequestSnapshot = JSON.stringify({
  proposalId: PROPOSAL_ID,
  kind: 'revert-request',
  sender: { id: OTHER_ID, username: 'bob' },
  message: 'please revert this',
});

const proposalHref = `/me/change-proposals/${PROPOSAL_ID}`;

describe('InAppNotificationElm with Change Proposal notifications', () => {
  beforeEach(() => {
    apiv3PostMock.mockReset();
    apiv3PostMock.mockResolvedValue({});
    mutateCountMock.mockReset();
    routerPushMock.mockReset();
  });

  it.each([
    {
      name: 'apply',
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      snapshot: coalescedSnapshot('apply'),
      text: 'commons:in_app_notification.change_proposal.applied',
      detail: '/changed-page',
    },
    {
      name: 'revert',
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
      snapshot: coalescedSnapshot('revert'),
      text: 'commons:in_app_notification.change_proposal.reverted',
      detail: '/changed-page',
    },
    {
      name: 'revert-request',
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
      snapshot: revertRequestSnapshot,
      text: 'commons:in_app_notification.change_proposal.revert_requested',
      detail: 'please revert this',
    },
  ])('renders the $name notification, links to the proposal and marks it as read on click', ({
    action,
    snapshot,
    text,
    detail,
  }) => {
    const onOpened = vi.fn();
    const { container } = render(
      <InAppNotificationElm
        notification={buildNotification({ action, snapshot })}
        onUnopenedNotificationOpend={onOpened}
      />,
    );

    expect(container.textContent).toContain(text);
    expect(screen.getByText(detail)).toBeTruthy();
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe(proposalHref);

    if (link == null) {
      throw new Error('expected a link');
    }
    fireEvent.click(link);
    expect(apiv3PostMock).toHaveBeenCalledWith('/in-app-notification/open', {
      id: NOTIFICATION_ID,
    });
  });

  it('recounts unread notifications after marking one as read', async () => {
    const onOpened = vi.fn();
    const { container } = render(
      <InAppNotificationElm
        notification={buildNotification({
          snapshot: coalescedSnapshot('apply'),
        })}
        onUnopenedNotificationOpend={onOpened}
      />,
    );
    const link = container.querySelector('a');
    if (link == null) {
      throw new Error('expected a link');
    }
    fireEvent.click(link);

    await vi.waitFor(() => expect(mutateCountMock).toHaveBeenCalledTimes(1));
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it('does not call the open API again for an already opened notification', () => {
    const { container } = render(
      <InAppNotificationElm
        notification={buildNotification({
          status: InAppNotificationStatuses.STATUS_OPENED,
          snapshot: coalescedSnapshot('apply'),
        })}
      />,
    );
    const link = container.querySelector('a');
    if (link == null) {
      throw new Error('expected a link');
    }
    fireEvent.click(link);
    expect(apiv3PostMock).not.toHaveBeenCalled();
  });

  it('renders nothing for a Change Proposal notification with an unreadable snapshot', () => {
    const { container } = render(
      <InAppNotificationElm
        notification={buildNotification({ snapshot: '' })}
      />,
    );
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('InAppNotificationElm with existing kinds', () => {
  it('still renders a user registration notification without a link', () => {
    const user = mock<IUser>({ username: 'newcomer' });
    const { container } = render(
      <InAppNotificationElm
        notification={buildNotification({
          targetModel: SupportedTargetModel.MODEL_USER,
          action: SupportedAction.ACTION_USER_REGISTRATION_APPROVAL_REQUEST,
          target: user,
          snapshot: '',
        })}
      />,
    );
    expect(container.textContent).toContain('newcomer');
    expect(container.querySelector('a')?.getAttribute('href')).toBeNull();
  });

  it('still renders a page notification and navigates to the page on click', async () => {
    const pageId = '65a1b2c3d4e5f60718293c00';
    const { container } = render(
      <InAppNotificationElm
        notification={buildNotification({
          targetModel: SupportedTargetModel.MODEL_PAGE,
          action: SupportedAction.ACTION_PAGE_LIKE,
          target: { _id: pageId, path: '/liked-page' },
          snapshot: JSON.stringify({ path: '/liked-page' }),
        })}
      />,
    );
    expect(container.textContent).toContain('liked');
    const link = container.querySelector('a');
    if (link == null) {
      throw new Error('expected a link');
    }
    fireEvent.click(link);
    await vi.waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith('/liked-page'),
    );
  });
});
