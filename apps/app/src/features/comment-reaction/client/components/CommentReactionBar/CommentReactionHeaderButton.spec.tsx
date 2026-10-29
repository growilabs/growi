// @vitest-environment happy-dom

import type { EmojiPickerSelection } from '@growi/editor/dist/client/components/EmojiPicker';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type {
  ReactionChip as ReactionChipType,
  ReactionKey,
} from '../../../interfaces';
import type { UseCommentReactions } from '../../hooks/use-comment-reactions';
import { CommentReactionHeaderButton } from './CommentReactionHeaderButton';

const mocks = vi.hoisted(() => ({
  useCommentReactions: vi.fn(),
  useCanReactToComments: vi.fn(),
}));

vi.mock('../../hooks/use-comment-reactions', () => ({
  useCommentReactions: mocks.useCommentReactions,
}));
vi.mock('../../hooks/use-can-react-to-comments', () => ({
  useCanReactToComments: mocks.useCanReactToComments,
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/stores-universal/use-next-themes', () => ({
  useNextThemes: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('./CommentReactionBar.module.scss', () => ({ default: {} }));
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
      </div>
    ) : null,
}));

const THUMBS_UP = 'unicode:+1' as ReactionKey;

const chip: ReactionChipType = {
  emoji: THUMBS_UP,
  count: 1,
  reactedByMe: false,
  users: [{ _id: 'u1', username: 'alice', name: 'Alice', imageUrlCached: '' }],
};

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
  mocks.useCommentReactions.mockReturnValue({ chips, isUpdating, setReaction });
  mocks.useCanReactToComments.mockReturnValue(canReact);
  return { setReaction };
};

const addButton = (): HTMLElement | null =>
  screen.queryByRole('button', { name: 'comment_reaction.add_reaction' });

const renderButton = (
  props: { isReadOnly?: boolean; className?: string } = {},
) =>
  render(
    <CommentReactionHeaderButton
      pageId="page1"
      commentId="comment1"
      isReadOnly={props.isReadOnly ?? false}
      className={props.className}
    />,
  );

describe('CommentReactionHeaderButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the add button for a comment without reactions', () => {
    setup({ chips: [] });

    renderButton();

    expect(addButton()).not.toBeNull();
  });

  it('is reachable with the keyboard', async () => {
    setup({ chips: [] });

    renderButton();
    await userEvent.tab();

    expect(document.activeElement).toBe(addButton());
  });

  it('puts the className given by its host on its outermost element', () => {
    setup({ chips: [] });

    const { container } = renderButton({ className: 'host-class' });

    expect(container.firstElementChild).toHaveClass('host-class');
  });

  it('shows nothing once the comment has a reaction, because the chip row carries the add button then', () => {
    setup({ chips: [chip] });

    const { container } = renderButton();

    expect(container.firstChild).toBeNull();
  });

  it('shows nothing when reactions are not allowed', () => {
    setup({ chips: [], canReact: false });

    const { container } = renderButton({ isReadOnly: true });

    expect(container.firstChild).toBeNull();
  });

  it.each([
    ['could not be loaded', null],
    ['are still loading', undefined],
  ])('shows nothing when the reactions %s', (_, chips) => {
    setup({ chips });

    const { container } = renderButton();

    expect(container.firstChild).toBeNull();
  });

  it('reads the reactions of the given comment and gates on the isReadOnly it was given', () => {
    setup({ chips: [] });

    renderButton({ isReadOnly: true });

    expect(mocks.useCommentReactions).toHaveBeenCalledWith('page1', 'comment1');
    expect(mocks.useCanReactToComments).toHaveBeenCalledWith(true);
  });

  it('adds the emoji chosen in the picker through the hook', async () => {
    const { setReaction } = setup({ chips: [] });

    renderButton();
    await userEvent.click(addButton() as HTMLElement);
    await userEvent.click(
      screen.getByRole('button', { name: 'pick-thumbs-up' }),
    );

    expect(setReaction).toHaveBeenCalledTimes(1);
    expect(setReaction).toHaveBeenCalledWith(THUMBS_UP, true);
  });

  it('is disabled while an update is in flight', () => {
    setup({ chips: [], isUpdating: true });

    renderButton();

    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
  });
});
