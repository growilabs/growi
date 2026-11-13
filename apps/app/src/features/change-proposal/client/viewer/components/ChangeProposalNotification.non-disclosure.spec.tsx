// @vitest-environment happy-dom
import type { HasObjectId, IUser } from '@growi/core';
import { render, renderHook } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import {
  type IInAppNotification,
  InAppNotificationStatuses,
} from '~/interfaces/in-app-notification';

import { useChangeProposalModelNotification } from './ChangeProposalNotification';

// Interpolation values other than the namespace are rendered, so a count
// passed to t() shows up in the text.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const { ns, ...values } = options ?? {};
      const prefix = typeof ns === 'string' ? `${ns}:` : '';
      const suffix =
        Object.keys(values).length > 0 ? JSON.stringify(values) : '';
      return `${prefix}${key}${suffix}`;
    },
  }),
}));

vi.mock('~/client/components/FormattedDistanceDate', () => ({
  FormattedDistanceDate: () => null,
}));

const PROPOSAL_ID = '65a1b2c3d4e5f60718293a4b';
const PATH_MARK = '<path>';
const KINDS: readonly ('apply' | 'revert')[] = ['apply', 'revert'];

// Digit-free paths, so that any digit in the display can only come from the viewer.
const pathOf = (n: number): string =>
  `/team/${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`;

const buildNotification = (
  kind: 'apply' | 'revert',
  pageCount: number,
): IInAppNotification & HasObjectId => ({
  _id: '65a1b2c3d4e5f60718293a00',
  user: mock<IUser>(),
  targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
  target: { _id: PROPOSAL_ID },
  action:
    kind === 'apply'
      ? SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY
      : SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
  status: InAppNotificationStatuses.STATUS_UNOPENED,
  actionUsers: [mock<IUser>({ name: 'alice' })],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  snapshot: JSON.stringify({
    proposalId: PROPOSAL_ID,
    entry: 'mcp',
    kind,
    requester: { id: PROPOSAL_ID, username: 'alice' },
    pages: Array.from({ length: pageCount }, (_, n) => ({
      id: PROPOSAL_ID,
      path: pathOf(n),
    })),
  }),
});

const renderedTextOf = (
  notification: IInAppNotification & HasObjectId,
): string => {
  const utils = renderHook(() =>
    useChangeProposalModelNotification(notification),
  ).result.current;
  if (utils == null) {
    throw new Error('expected notification utils');
  }
  const { Notification } = utils;
  const { container, unmount } = render(<Notification />);
  const text = container.textContent ?? '';
  unmount();
  return text;
};

describe('useChangeProposalModelNotification does not disclose how many pages changed', () => {
  it.each(
    KINDS,
  )('renders the %s notification identically for 4, 7 and 12 pages, with no digit', (kind) => {
    const texts = [4, 7, 12].map((count) =>
      renderedTextOf(buildNotification(kind, count)),
    );

    expect(texts[0]).not.toMatch(/\d/);
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe(texts[0]);
  });

  it.each(
    KINDS,
  )('renders the %s notification alike for 1, 2 and 3 pages apart from the listed paths', (kind) => {
    const shapes = [1, 2, 3].map((count) => {
      const text = renderedTextOf(buildNotification(kind, count));
      expect(text).not.toMatch(/\d/);
      const marked = Array.from({ length: count }, (_, n) => pathOf(n)).reduce(
        (acc, path) => acc.replaceAll(path, PATH_MARK),
        text,
      );
      const segments = marked.split(PATH_MARK);
      return {
        head: segments[0],
        tail: segments[segments.length - 1],
        between: [...new Set(segments.slice(1, -1))],
      };
    });

    expect(shapes[1].head).toBe(shapes[0].head);
    expect(shapes[2].head).toBe(shapes[0].head);
    expect(shapes[1].tail).toBe(shapes[0].tail);
    expect(shapes[2].tail).toBe(shapes[0].tail);
    expect(shapes[2].between).toEqual(shapes[1].between);
  });
});
