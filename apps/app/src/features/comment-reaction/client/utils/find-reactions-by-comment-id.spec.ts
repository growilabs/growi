import { mock } from 'vitest-mock-extended';

import type { ICommentListItem } from '~/features/comment/interfaces';

import type { ReactionChip, ReactionKey } from '../../interfaces';
import { findReactionsByCommentId } from './find-reactions-by-comment-id';

const chips: ReactionChip[] = [
  {
    emoji: 'unicode:+1' as ReactionKey,
    count: 1,
    reactedByMe: false,
    users: [],
  },
];

const item = (id: string, reactions: ReactionChip[] | null) =>
  Object.assign(mock<ICommentListItem>(), { id, reactions });

describe('findReactionsByCommentId', () => {
  const comments = [item('c1', chips), item('c2', null), item('c3', [])];

  it("returns the target comment's chips", () => {
    expect(findReactionsByCommentId(comments, 'c1')).toEqual(chips);
    expect(findReactionsByCommentId(comments, 'c3')).toEqual([]);
  });

  it('returns null when reactions could not be loaded or the comment is absent', () => {
    expect(findReactionsByCommentId(comments, 'c2')).toBeNull();
    expect(findReactionsByCommentId(comments, 'gone')).toBeNull();
  });

  it('reflects a new list array rather than a stale index', () => {
    const next = [item('c1', [])];
    expect(findReactionsByCommentId(comments, 'c1')).toEqual(chips);
    expect(findReactionsByCommentId(next, 'c1')).toEqual([]);
  });
});
