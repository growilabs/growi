// @vitest-environment happy-dom

import type { HasObjectId, IPage, IUser } from '@growi/core';
import { render, renderHook } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import {
  SupportedAction,
  type SupportedActionType,
  SupportedTargetModel,
} from '~/interfaces/activity';
import {
  type IInAppNotification,
  InAppNotificationStatuses,
} from '~/interfaces/in-app-notification';
import { pageDuplicateInterruptedSnapshot } from '~/models/serializers/in-app-notification-snapshot/page-duplicate-interrupted';

import { usePageModelNotification } from './PageModelNotification';

const push = vi.hoisted(() => vi.fn());

vi.mock('next/router', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../FormattedDistanceDate', () => ({
  FormattedDistanceDate: () => null,
}));

const snapshot = pageDuplicateInterruptedSnapshot.stringify({
  path: '/dest/top',
  fromPath: '/src/top',
  toPath: '/dest/top',
  copiedPageCount: 3,
  sourcePageCount: 7,
});

const buildNotification = (
  action: SupportedActionType,
): IInAppNotification<IPage> & HasObjectId =>
  mock<IInAppNotification<IPage> & HasObjectId>({
    _id: 'notification1',
    targetModel: SupportedTargetModel.MODEL_PAGE,
    target: mock<IPage>({ path: '/dest/top' }),
    action,
    status: InAppNotificationStatuses.STATUS_UNOPENED,
    actionUsers: [mock<IUser>({ name: 'alice' })],
    createdAt: new Date(),
    snapshot,
  });

const renderNotification = (action: SupportedActionType) => {
  const { result } = renderHook(() =>
    usePageModelNotification(buildNotification(action)),
  );
  const utils = result.current;
  if (utils == null) throw new Error('expected page notification utils');
  const { Notification } = utils;
  const { container } = render(<Notification />);
  return { utils, text: container.textContent ?? '' };
};

describe('usePageModelNotification', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('shows the interrupted-duplicate sub message for the interrupted action', () => {
    const { text } = renderNotification(
      SupportedAction.ACTION_PAGE_DUPLICATE_INTERRUPTED,
    );

    expect(text).toContain(
      'in_app_notification.page_duplicate_interrupted.summary',
    );
    expect(text).toContain(
      'in_app_notification.page_duplicate_interrupted.advice',
    );
  });

  it('does not show the acting user for the interrupted action', () => {
    const { text } = renderNotification(
      SupportedAction.ACTION_PAGE_DUPLICATE_INTERRUPTED,
    );

    expect(text).not.toContain('@alice');
  });

  it('keeps the acting user and omits the sub message for a normal duplicate', () => {
    const { text } = renderNotification(SupportedAction.ACTION_PAGE_DUPLICATE);

    expect(text).not.toContain('page_duplicate_interrupted');
    expect(text).toContain('@alice');
  });

  it('navigates to the target page path when opened', () => {
    const { utils } = renderNotification(
      SupportedAction.ACTION_PAGE_DUPLICATE_INTERRUPTED,
    );

    utils.publishOpen?.();

    expect(push).toHaveBeenCalledWith('/dest/top');
  });
});
