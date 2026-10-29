// @vitest-environment happy-dom

import { render, screen, within } from '@testing-library/react';

import type { ReactionUser } from '../../../interfaces';
import { ReactionUsersPopover } from './ReactionUsersPopover';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./CommentReactionBar.module.scss', () => ({ default: {} }));

const ANCHOR_ID = 'users-popover-anchor';
const anchorRef = { current: document.body };

// The anchor must already be in the DOM when the popover opens, as it is in ReactionChip.
const renderPopover = (users: readonly ReactionUser[], isOpen = true): void => {
  const anchor = document.createElement('button');
  anchor.id = ANCHOR_ID;
  document.body.appendChild(anchor);
  anchorRef.current = anchor;

  const tree = (open: boolean): JSX.Element => (
    <ReactionUsersPopover
      target={anchorRef}
      isOpen={open}
      toggle={vi.fn()}
      users={users}
    />
  );
  const { rerender } = render(tree(false));
  rerender(tree(isOpen));
};

afterEach(() => {
  document.getElementById(ANCHOR_ID)?.remove();
});

describe('ReactionUsersPopover', () => {
  it('lists users in the given order, preferring name over username and keeping id strings as is', async () => {
    renderPopover([
      { _id: 'u1', username: 'alice', name: 'Alice A.', imageUrlCached: '' },
      { _id: 'u2', username: 'bob', name: '', imageUrlCached: '' },
      '64b0000000000000000000ff',
    ]);

    const items = await screen.findAllByRole('listitem');

    expect(items.map((item) => item.textContent)).toEqual([
      'Alice A.',
      'bob',
      '64b0000000000000000000ff',
    ]);
  });

  it('is titled with the reacted-by label', async () => {
    renderPopover(['u1']);

    const list = await screen.findByRole('list');
    const popover = list.closest('.popover');
    expect(popover).not.toBeNull();
    expect(
      within(popover as HTMLElement).getByText('comment_reaction.reacted_by'),
    ).toBeTruthy();
  });

  it('renders nothing while closed', () => {
    renderPopover(['u1'], false);

    expect(screen.queryByRole('list')).toBeNull();
  });
});
