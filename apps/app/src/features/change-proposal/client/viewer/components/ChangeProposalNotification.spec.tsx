// @vitest-environment happy-dom
import type { HasObjectId, IUser } from '@growi/core';
import { render, renderHook, screen } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import type { ModelNotificationUtils } from '~/client/components/InAppNotification/ModelNotification';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import {
  type IInAppNotification,
  InAppNotificationStatuses,
} from '~/interfaces/in-app-notification';

import { useChangeProposalModelNotification } from './ChangeProposalNotification';

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

const actionUser = mock<IUser>({ name: 'alice' });

type Overrides = Partial<IInAppNotification & HasObjectId>;

const buildNotification = (
  overrides: Overrides,
): IInAppNotification & HasObjectId => ({
  _id: '65a1b2c3d4e5f60718293a00',
  user: mock<IUser>(),
  targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
  target: { _id: OTHER_ID },
  action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
  status: InAppNotificationStatuses.STATUS_UNOPENED,
  actionUsers: [actionUser],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  snapshot: '',
  ...overrides,
});

const coalescedSnapshot = (kind: 'apply' | 'revert', paths: string[]) =>
  JSON.stringify({
    proposalId: PROPOSAL_ID,
    entry: 'mcp',
    kind,
    requester: { id: OTHER_ID, username: 'alice' },
    pages: paths.map((path, i) => ({
      id: `65a1b2c3d4e5f60718293b0${i}`,
      path,
    })),
  });

const revertRequestSnapshot = (message: string) =>
  JSON.stringify({
    proposalId: PROPOSAL_ID,
    kind: 'revert-request',
    sender: { id: OTHER_ID, username: 'bob' },
    message,
  });

const resolveUtils = (notification: IInAppNotification & HasObjectId) =>
  renderHook(() => useChangeProposalModelNotification(notification)).result
    .current;

const renderNotification = (utils: ModelNotificationUtils | null) => {
  if (utils == null) {
    throw new Error('expected notification utils');
  }
  const { Notification } = utils;
  return render(<Notification />);
};

describe('useChangeProposalModelNotification', () => {
  it('shows the apply text, up to 3 paths and the link to the proposal', () => {
    const utils = resolveUtils(
      buildNotification({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
        snapshot: coalescedSnapshot('apply', ['/a', '/b']),
      }),
    );

    expect(utils?.clickLink).toBe(`/me/change-proposals/${PROPOSAL_ID}`);
    const { container } = renderNotification(utils);
    expect(container.textContent).toContain(
      'commons:in_app_notification.change_proposal.applied',
    );
    expect(container.textContent).toContain('@alice');
    expect(screen.getByText('/a')).toBeTruthy();
    expect(screen.getByText('/b')).toBeTruthy();
    expect(container.textContent).not.toContain('other_pages');
  });

  it('shows the revert text, the first 3 paths and the other-pages note', () => {
    const utils = resolveUtils(
      buildNotification({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
        snapshot: coalescedSnapshot('revert', ['/a', '/b', '/c', '/d', '/e']),
      }),
    );

    const { container } = renderNotification(utils);
    expect(container.textContent).toContain(
      'commons:in_app_notification.change_proposal.reverted',
    );
    expect(screen.getByText('/c')).toBeTruthy();
    expect(screen.queryByText('/d')).toBeNull();
    expect(container.textContent).toContain(
      'commons:in_app_notification.change_proposal.other_pages',
    );
    expect(container.textContent).not.toMatch(/\b5\b/);
  });

  it('shows exactly 3 paths without the other-pages note', () => {
    const utils = resolveUtils(
      buildNotification({
        snapshot: coalescedSnapshot('apply', ['/a', '/b', '/c']),
      }),
    );
    const { container } = renderNotification(utils);
    expect(screen.getByText('/c')).toBeTruthy();
    expect(container.textContent).not.toContain('other_pages');
  });

  it('links the original requester revert notification to the original proposal', () => {
    const utils = resolveUtils(
      buildNotification({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
        // the target is the revert proposal; the snapshot points at the original
        target: { _id: OTHER_ID },
        snapshot: coalescedSnapshot('revert', ['/a']),
      }),
    );
    expect(utils?.clickLink).toBe(`/me/change-proposals/${PROPOSAL_ID}`);
  });

  it('shows the revert-request text and the sender message', () => {
    const utils = resolveUtils(
      buildNotification({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
        actionUsers: [mock<IUser>({ name: 'bob' })],
        snapshot: revertRequestSnapshot('please revert this'),
      }),
    );

    expect(utils?.clickLink).toBe(`/me/change-proposals/${PROPOSAL_ID}`);
    const { container } = renderNotification(utils);
    expect(container.textContent).toContain(
      'commons:in_app_notification.change_proposal.revert_requested',
    );
    expect(screen.getByText('please revert this')).toBeTruthy();
  });

  it('renders the message as plain text, not as HTML', () => {
    const utils = resolveUtils(
      buildNotification({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
        snapshot: revertRequestSnapshot('<img src=x onerror=alert(1)>'),
      }),
    );
    const { container } = renderNotification(utils);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('truncates a long message with an ellipsis', () => {
    const utils = resolveUtils(
      buildNotification({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
        snapshot: revertRequestSnapshot('x'.repeat(300)),
      }),
    );
    const { container } = renderNotification(utils);
    expect(container.textContent).toContain(`${'x'.repeat(100)}…`);
    expect(container.textContent).not.toContain('x'.repeat(101));
  });

  it('returns null when the snapshot cannot be read', () => {
    expect(
      resolveUtils(buildNotification({ snapshot: 'not json' })),
    ).toBeNull();
    expect(
      resolveUtils(
        buildNotification({
          snapshot: JSON.stringify({ proposalId: 'nope', kind: 'apply' }),
        }),
      ),
    ).toBeNull();
  });

  it('returns null for other target models', () => {
    expect(
      resolveUtils(
        buildNotification({
          targetModel: SupportedTargetModel.MODEL_PAGE,
          snapshot: coalescedSnapshot('apply', ['/a']),
        }),
      ),
    ).toBeNull();
  });
});
