// @vitest-environment happy-dom

import { useSyncExternalStore } from 'react';
import type { EmojiPickerSelection } from '@growi/editor/dist/client/components/EmojiPicker';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ReactionChip, ReactionKey } from '../../../interfaces';
import { CommentReactionBar } from './CommentReactionBar';
import { CommentReactionHeaderButton } from './CommentReactionHeaderButton';

const THUMBS_UP = 'unicode:+1' as ReactionKey;

const chip: ReactionChip = {
  emoji: THUMBS_UP,
  count: 1,
  reactedByMe: true,
  users: [{ _id: 'u1', username: 'alice', name: 'Alice', imageUrlCached: '' }],
};

// A stand-in for the comment list cache that both components read from.
const mocks = vi.hoisted(() => {
  let chips: readonly unknown[] = [];
  const listeners = new Set<() => void>();
  return {
    getChips: () => chips,
    setChips: (next: readonly unknown[]) => {
      chips = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setReaction: vi.fn(),
  };
});

vi.mock('../../hooks/use-comment-reactions', () => ({
  useCommentReactions: () => ({
    chips: useSyncExternalStore(
      mocks.subscribe,
      mocks.getChips,
    ) as readonly ReactionChip[],
    isUpdating: false,
    setReaction: mocks.setReaction,
  }),
}));
vi.mock('../../hooks/use-can-react-to-comments', () => ({
  useCanReactToComments: () => true,
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

const addButton = (): HTMLElement =>
  screen.getByRole('button', { name: 'comment_reaction.add_reaction' });

const renderComment = () =>
  render(
    <>
      <CommentReactionHeaderButton
        pageId="page1"
        commentId="comment1"
        isReadOnly={false}
      />
      <input aria-label="elsewhere" />
      <CommentReactionBar
        pageId="page1"
        commentId="comment1"
        isReadOnly={false}
      />
    </>,
  );

const nextFrame = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

const pickFirstReactionWithKeyboard = async (): Promise<void> => {
  await userEvent.tab();
  expect(document.activeElement).toBe(addButton());
  await userEvent.keyboard('{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'pick-thumbs-up' }));
};

describe('focus after the first reaction of a comment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setChips([]);
  });

  it('moves to the add button at the end of the chip row once the header button has gone', async () => {
    mocks.setReaction.mockImplementation(() => {
      mocks.setChips([chip]);
      return Promise.resolve();
    });
    renderComment();

    await pickFirstReactionWithKeyboard();

    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: /add_reaction/ }),
      ).toHaveLength(1);
      expect(document.activeElement).toBe(addButton());
    });
  });

  it('lands in the copy of the comment the add was made from when the same comment is shown twice', async () => {
    mocks.setReaction.mockImplementation(() => {
      mocks.setChips([chip]);
      return Promise.resolve();
    });
    render(
      <>
        <div data-testid="thread-copy">
          <CommentReactionBar
            pageId="page1"
            commentId="comment1"
            isReadOnly={false}
          />
        </div>
        <div data-testid="popover-copy">
          <CommentReactionHeaderButton
            pageId="page1"
            commentId="comment1"
            isReadOnly={false}
          />
          <CommentReactionBar
            pageId="page1"
            commentId="comment1"
            isReadOnly={false}
          />
        </div>
      </>,
    );

    // The thread copy has no header button of its own here; the add starts in the popover copy.
    await pickFirstReactionWithKeyboard();

    await waitFor(() => {
      expect(
        within(screen.getByTestId('popover-copy')).getByRole('button', {
          name: 'comment_reaction.add_reaction',
        }),
      ).toBe(document.activeElement);
    });
  });

  it('leaves the focus where the user moved it while the request was in flight', async () => {
    let finish: () => void = () => {};
    mocks.setReaction.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            mocks.setChips([chip]);
            resolve();
          };
        }),
    );
    renderComment();

    await pickFirstReactionWithKeyboard();
    const elsewhere = screen.getByRole('textbox', { name: 'elsewhere' });
    await userEvent.click(elsewhere);
    act(() => {
      finish();
    });

    expect(screen.queryByText('👍')).not.toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('keeps the header button, with focus unchanged, when the request fails', async () => {
    mocks.setReaction.mockResolvedValue(undefined);
    renderComment();

    await pickFirstReactionWithKeyboard();

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(
      screen.getAllByRole('button', { name: 'comment_reaction.add_reaction' }),
    ).toHaveLength(1);
    expect(screen.queryByText('👍')).toBeNull();
  });
});
