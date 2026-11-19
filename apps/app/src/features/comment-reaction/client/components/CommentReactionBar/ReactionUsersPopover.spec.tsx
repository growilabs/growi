// @vitest-environment happy-dom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ReactionUser } from '../../../interfaces';
import { ReactionUsersPopover } from './ReactionUsersPopover';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./CommentReactionBar.module.scss', () => ({ default: {} }));

// The anchor must already be in the DOM when the popover mounts, as the chip is in ReactionChip.
const anchors: HTMLElement[] = [];

const renderPopover = (users: readonly ReactionUser[]): HTMLElement => {
  const anchor = document.createElement('button');
  anchors.push(anchor);
  anchor.textContent = 'anchor';
  document.body.appendChild(anchor);
  render(<ReactionUsersPopover target={{ current: anchor }} users={users} />);
  return anchor;
};

afterEach(() => {
  for (const anchor of anchors.splice(0)) {
    anchor.remove();
  }
});

describe('ReactionUsersPopover', () => {
  it('lists users in the given order, preferring name over username and keeping id strings as is', async () => {
    const anchor = renderPopover([
      { _id: 'u1', username: 'alice', name: 'Alice A.', imageUrlCached: '' },
      { _id: 'u2', username: 'bob', name: '', imageUrlCached: '' },
      '64b0000000000000000000ff',
    ]);

    await userEvent.hover(anchor);
    const items = await screen.findAllByRole('listitem');

    expect(items.map((item) => item.textContent)).toEqual([
      'Alice A.',
      'bob',
      '64b0000000000000000000ff',
    ]);
  });

  it('is titled with the reacted-by label', async () => {
    const anchor = renderPopover(['u1']);

    await userEvent.hover(anchor);
    const list = await screen.findByRole('list');
    const popover = list.closest('.popover');

    expect(popover).not.toBeNull();
    expect(
      within(popover as HTMLElement).getByText('comment_reaction.reacted_by'),
    ).toBeInTheDocument();
  });

  it('shows nothing until its target is hovered or focused', () => {
    renderPopover(['u1']);

    expect(screen.queryByRole('list')).toBeNull();
  });
});
