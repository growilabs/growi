// @vitest-environment happy-dom

import type { EmojiPickerSelection } from '@growi/editor/dist/client/components/EmojiPicker';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type {
  ReactionChip as ReactionChipType,
  ReactionKey,
} from '../../../interfaces';
import type { UseCommentReactions } from '../../hooks/use-comment-reactions';
import { CommentReactionBar } from './CommentReactionBar';

const mocks = vi.hoisted(() => ({
  useCommentReactions: vi.fn(),
  useCanReactToComments: vi.fn(),
}));

// A device that can hover, so a chip lists who reacted on hover.
vi.mock('../../hooks/use-can-hover', () => ({ useCanHover: () => true }));

vi.mock('../../hooks/use-comment-reactions', () => ({
  useCommentReactions: mocks.useCommentReactions,
}));
vi.mock('../../hooks/use-can-react-to-comments', () => ({
  useCanReactToComments: mocks.useCanReactToComments,
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count == null ? key : `${key}:${options.count}`,
  }),
}));
vi.mock('~/stores-universal/use-next-themes', () => ({
  useNextThemes: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('./CommentReactionBar.module.scss', () => ({
  default: { 'reaction-bar': 'reaction-bar' },
}));
// Stands in for the lazily loaded emoji-mart picker; the real one is covered in @growi/editor.
vi.mock('@growi/editor/dist/client/components/EmojiPicker', () => ({
  EmojiPicker: ({
    isOpen,
    onSelect,
  }: {
    isOpen: boolean;
    onSelect: (selection: EmojiPickerSelection) => void;
  }) =>
    isOpen ? (
      <div role="dialog">
        <button
          type="button"
          onClick={() => onSelect({ kind: 'native', id: '+1' })}
        >
          pick-thumbs-up
        </button>
        <button
          type="button"
          onClick={() => onSelect({ kind: 'native', id: '+1', skin: 3 })}
        >
          pick-thumbs-up-tone-3
        </button>
      </div>
    ) : null,
}));

const THUMBS_UP = 'unicode:+1' as ReactionKey;
const HEART = 'unicode:heart' as ReactionKey;

const makeChip = (
  overrides: Partial<ReactionChipType> = {},
): ReactionChipType => ({
  emoji: THUMBS_UP,
  count: 2,
  reactedByMe: false,
  users: [
    { _id: 'u1', username: 'alice', name: 'Alice A.', imageUrlCached: '' },
    { _id: 'u2', username: 'bob', name: '', imageUrlCached: '' },
  ],
  ...overrides,
});

const setup = ({
  chips,
  canReact = true,
  isUpdating = false,
  setReaction = vi.fn().mockResolvedValue(undefined),
}: {
  chips: UseCommentReactions['chips'];
  canReact?: boolean;
  isUpdating?: boolean;
  setReaction?: UseCommentReactions['setReaction'];
}) => {
  mocks.useCommentReactions.mockReturnValue({
    chips,
    isUpdating,
    setReaction,
  });
  mocks.useCanReactToComments.mockReturnValue(canReact);
  return { setReaction };
};

const addButton = (): HTMLElement | null =>
  screen.queryByRole('button', { name: 'comment_reaction.add_reaction' });

describe('CommentReactionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows each chip with its glyph and number of reacting users, followed by the add button', () => {
    setup({
      chips: [makeChip(), makeChip({ emoji: HEART, count: 1 })],
    });

    render(
      <CommentReactionBar
        pageId="page1"
        commentId="comment1"
        isReadOnly={false}
      />,
    );

    const thumbsUp = screen.getByRole('button', { name: '+1' });
    const heart = screen.getByRole('button', { name: 'heart' });
    expect(thumbsUp).toHaveTextContent('👍2');
    expect(thumbsUp).toHaveAccessibleDescription(
      'comment_reaction.reacted_count:2',
    );
    expect(heart).toHaveTextContent('❤️1');
    expect(heart).toHaveAccessibleDescription(
      'comment_reaction.reacted_count:1',
    );
    expect(addButton()).not.toBeNull();
  });

  it('takes no space when the comment has no reactions, leaving the add button to the header', () => {
    setup({ chips: [] });

    const { container } = render(
      <CommentReactionBar
        pageId="page1"
        commentId="comment1"
        isReadOnly={false}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(addButton()).toBeNull();
  });

  it('reads the chips of the given comment and gates on the isReadOnly it was given', () => {
    setup({ chips: [makeChip()] });

    render(
      <CommentReactionBar pageId="page1" commentId="comment1" isReadOnly />,
    );

    expect(mocks.useCommentReactions).toHaveBeenCalledWith('page1', 'comment1');
    expect(mocks.useCanReactToComments).toHaveBeenCalledWith(true);
  });

  it('toggles the reaction of the pressed chip through the hook', async () => {
    const { setReaction } = setup({
      chips: [makeChip({ reactedByMe: true })],
    });

    render(
      <CommentReactionBar
        pageId="page1"
        commentId="comment1"
        isReadOnly={false}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '+1' }));

    expect(setReaction).toHaveBeenCalledWith(THUMBS_UP, false);
  });

  it.each([
    ['pick-thumbs-up', 'unicode:+1'],
    ['pick-thumbs-up-tone-3', 'unicode:+1::skin-tone-3'],
  ])('adds the emoji chosen in the picker through the hook (%s)', async (pickerButton, expectedKey) => {
    const { setReaction } = setup({ chips: [makeChip({ emoji: HEART })] });

    render(
      <CommentReactionBar
        pageId="page1"
        commentId="comment1"
        isReadOnly={false}
      />,
    );
    await userEvent.click(addButton() as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: pickerButton }));

    expect(setReaction).toHaveBeenCalledTimes(1);
    expect(setReaction).toHaveBeenCalledWith(expectedKey, true);
  });

  it('keeps the chips but has no add button when reactions are not allowed, and hovering a chip still lists the users', async () => {
    const { setReaction } = setup({ chips: [makeChip()], canReact: false });

    render(
      <CommentReactionBar pageId="page1" commentId="comment1" isReadOnly />,
    );

    const chip = screen.getByRole('button', { name: '+1' });
    expect(chip).toHaveTextContent('👍');
    expect(addButton()).toBeNull();

    await userEvent.hover(chip);

    await waitFor(() => expect(screen.getByText('Alice A.')).toBeTruthy());
    expect(screen.getByText('bob')).toBeTruthy();

    await userEvent.click(chip);
    expect(setReaction).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no chips and reactions are not allowed', () => {
    setup({ chips: [], canReact: false });

    const { container } = render(
      <CommentReactionBar pageId="page1" commentId="comment1" isReadOnly />,
    );

    expect(container.firstChild).toBeNull();
  });

  it.each([
    ['could not be loaded', null],
    ['are still loading', undefined],
  ])('renders nothing even for a user who can react when the reactions %s', (_, chips) => {
    setup({ chips });

    const { container } = render(
      <CommentReactionBar
        pageId="page1"
        commentId="comment1"
        isReadOnly={false}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('blocks the chip toggle and disables the add button while an update is in flight', async () => {
    const { setReaction } = setup({ chips: [makeChip()], isUpdating: true });

    render(
      <CommentReactionBar
        pageId="page1"
        commentId="comment1"
        isReadOnly={false}
      />,
    );

    const chip = screen.getByRole('button', { name: '+1' });
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(chip);
    expect(setReaction).not.toHaveBeenCalled();
    expect(addButton()).toBeDisabled();
  });

  it('removes a chip once an unreact drops it from the chips', () => {
    setup({ chips: [makeChip(), makeChip({ emoji: HEART, count: 1 })] });
    const { rerender } = render(
      <CommentReactionBar
        pageId="page1"
        commentId="comment1"
        isReadOnly={false}
      />,
    );
    expect(screen.getByText('❤️')).toBeTruthy();

    setup({ chips: [makeChip()] });
    rerender(
      <CommentReactionBar
        pageId="page1"
        commentId="comment1"
        isReadOnly={false}
      />,
    );

    expect(screen.queryByText('❤️')).toBeNull();
    expect(screen.getByText('👍')).toBeTruthy();
  });
});
