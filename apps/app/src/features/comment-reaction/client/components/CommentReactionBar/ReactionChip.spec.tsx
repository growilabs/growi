// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type {
  ReactionChip as ReactionChipType,
  ReactionKey,
} from '../../../interfaces';
import { ReactionChip } from './ReactionChip';

const mocks = vi.hoisted(() => ({ useCanHover: vi.fn() }));

vi.mock('../../hooks/use-can-hover', () => ({
  useCanHover: mocks.useCanHover,
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count == null ? key : `${key}:${options.count}`,
  }),
}));
vi.mock('./CommentReactionBar.module.scss', () => ({ default: {} }));

const THUMBS_UP = 'unicode:+1' as ReactionKey;
const THUMBS_UP_GLYPH = '👍';

const makeChip = (
  overrides: Partial<ReactionChipType> = {},
): ReactionChipType => ({
  emoji: THUMBS_UP,
  count: 2,
  reactedByMe: false,
  users: [
    { _id: 'u1', username: 'alice', name: 'Alice A.', imageUrlCached: '' },
    { _id: 'u2', username: 'bob', name: '', imageUrlCached: '' },
    '64b0000000000000000000ff',
  ],
  ...overrides,
});

const chipButton = (name = '+1'): HTMLElement =>
  screen.getByRole('button', { name });

// Longer than the popover's show delay, so a list that was going to open has opened.
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 100));

beforeEach(() => {
  mocks.useCanHover.mockReturnValue(true);
});

describe('ReactionChip', () => {
  it('is one button showing the glyph and the number of reacting users', () => {
    render(<ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(chipButton()).toHaveTextContent(THUMBS_UP_GLYPH);
    expect(chipButton()).toHaveTextContent('2');
  });

  it('is described by the number and the names of the reacting users, so a screen reader announces who reacted on focus', () => {
    render(<ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />);

    expect(chipButton()).toHaveAccessibleDescription(
      'comment_reaction.reacted_count:2: Alice A., bob, 64b0000000000000000000ff',
    );
  });

  it('is described by the number only on a device that cannot hover', () => {
    mocks.useCanHover.mockReturnValue(false);
    render(<ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />);

    expect(chipButton()).toHaveAccessibleDescription(
      'comment_reaction.reacted_count:2',
    );
  });

  it('shows the shortcode text when the glyph cannot be resolved', () => {
    const unknown = 'unicode:no-such-emoji' as ReactionKey;
    render(
      <ReactionChip
        chip={makeChip({ emoji: unknown })}
        canReact
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText(':no-such-emoji:')).toBeInTheDocument();
  });

  it('still renders when the key is malformed, showing it as text, without affecting other chips', () => {
    const malformed = 'garbage' as ReactionKey;
    render(
      <>
        <ReactionChip
          chip={makeChip({ emoji: malformed })}
          canReact
          onToggle={vi.fn()}
        />
        <ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />
      </>,
    );

    expect(screen.getByText(':garbage:')).toBeInTheDocument();
    expect(screen.getByText(THUMBS_UP_GLYPH)).toBeInTheDocument();
  });

  it('labels chips that differ only by skin tone distinguishably', () => {
    const toned = 'unicode:+1::skin-tone-3' as ReactionKey;
    render(
      <>
        <ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />
        <ReactionChip
          chip={makeChip({ emoji: toned })}
          canReact
          onToggle={vi.fn()}
        />
      </>,
    );

    const labels = screen
      .getAllByRole('button', { pressed: false })
      .map((button) => button.getAttribute('aria-label'));
    expect(new Set(labels).size).toBe(2);
  });

  describe('pressing', () => {
    it('shows my reaction as pressed and others as not pressed', () => {
      const { rerender } = render(
        <ReactionChip
          chip={makeChip({ reactedByMe: true })}
          canReact
          onToggle={vi.fn()}
        />,
      );
      expect(chipButton()).toHaveAttribute('aria-pressed', 'true');

      rerender(
        <ReactionChip
          chip={makeChip({ reactedByMe: false })}
          canReact
          onToggle={vi.fn()}
        />,
      );
      expect(chipButton()).toHaveAttribute('aria-pressed', 'false');
    });

    it('requests adding on a chip I have not reacted to', async () => {
      const onToggle = vi.fn();
      render(<ReactionChip chip={makeChip()} canReact onToggle={onToggle} />);

      await userEvent.click(chipButton());

      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onToggle).toHaveBeenCalledWith(THUMBS_UP, true);
    });

    it('requests removing on my own chip', async () => {
      const onToggle = vi.fn();
      render(
        <ReactionChip
          chip={makeChip({ reactedByMe: true })}
          canReact
          onToggle={onToggle}
        />,
      );

      await userEvent.click(chipButton());

      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onToggle).toHaveBeenCalledWith(THUMBS_UP, false);
    });

    it.each([
      ['the user cannot react', { canReact: false, isUpdating: false }],
      ['an update is in flight', { canReact: true, isUpdating: true }],
    ])('requests nothing and is marked unavailable when %s', async (_, props) => {
      const onToggle = vi.fn();
      render(<ReactionChip chip={makeChip()} {...props} onToggle={onToggle} />);

      expect(chipButton()).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(chipButton());

      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  describe('who reacted', () => {
    it('lists the users while the chip is hovered, without requesting an update', async () => {
      const onToggle = vi.fn();
      render(<ReactionChip chip={makeChip()} canReact onToggle={onToggle} />);
      expect(screen.queryByText('Alice A.')).toBeNull();

      await userEvent.hover(chipButton());

      expect(await screen.findByText('Alice A.')).toBeInTheDocument();
      expect(screen.getByText('bob')).toBeInTheDocument();
      expect(screen.getByText('64b0000000000000000000ff')).toBeInTheDocument();

      await userEvent.unhover(chipButton());

      await waitFor(() => expect(screen.queryByText('Alice A.')).toBeNull());
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('lists the users when the chip gets keyboard focus', async () => {
      const onToggle = vi.fn();
      render(<ReactionChip chip={makeChip()} canReact onToggle={onToggle} />);

      await userEvent.tab();

      expect(chipButton()).toHaveFocus();
      expect(await screen.findByText('Alice A.')).toBeInTheDocument();
      expect(onToggle).not.toHaveBeenCalled();
    });

    it.each([
      ['the user cannot react', { canReact: false, isUpdating: false }],
      ['an update is in flight', { canReact: true, isUpdating: true }],
    ])('still lists the users on hover when %s', async (_, props) => {
      render(<ReactionChip chip={makeChip()} {...props} onToggle={vi.fn()} />);

      await userEvent.hover(chipButton());

      expect(await screen.findByText('Alice A.')).toBeInTheDocument();
    });

    it('never lists the users on a device that cannot hover', async () => {
      mocks.useCanHover.mockReturnValue(false);
      render(<ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />);

      await userEvent.hover(chipButton());
      await userEvent.tab();
      await settle();

      expect(screen.queryByText('Alice A.')).toBeNull();
    });

    it('lists only the hovered chip users when several chips are shown', async () => {
      render(
        <>
          <ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />
          <ReactionChip
            chip={makeChip({
              emoji: 'unicode:heart' as ReactionKey,
              users: [
                {
                  _id: 'u9',
                  username: 'carol',
                  name: 'Carol',
                  imageUrlCached: '',
                },
              ],
              count: 1,
            })}
            canReact
            onToggle={vi.fn()}
          />
        </>,
      );

      await userEvent.hover(chipButton('heart'));

      expect(await screen.findByText('Carol')).toBeInTheDocument();
      expect(screen.queryByText('Alice A.')).toBeNull();
    });
  });
});
