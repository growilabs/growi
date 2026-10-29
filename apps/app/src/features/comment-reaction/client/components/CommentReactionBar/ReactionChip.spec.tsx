// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type {
  ReactionChip as ReactionChipType,
  ReactionKey,
} from '../../../interfaces';
import { ReactionChip } from './ReactionChip';

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

const countButton = (): HTMLElement =>
  screen.getByRole('button', { name: 'comment_reaction.reacted_count:2' });

describe('ReactionChip', () => {
  it('shows the glyph and the number of reacting users', () => {
    render(<ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />);

    expect(screen.getByText(THUMBS_UP_GLYPH)).toBeTruthy();
    expect(countButton().textContent).toContain('2');
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

    expect(screen.getByText(':no-such-emoji:')).toBeTruthy();
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

    expect(screen.getByText(':garbage:')).toBeTruthy();
    expect(screen.getByText(THUMBS_UP_GLYPH)).toBeTruthy();
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

  describe('emoji part', () => {
    it('is pressed for my reaction and not pressed otherwise', () => {
      const { rerender } = render(
        <ReactionChip
          chip={makeChip({ reactedByMe: true })}
          canReact
          onToggle={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('button', { pressed: true }).textContent,
      ).toContain(THUMBS_UP_GLYPH);

      rerender(
        <ReactionChip
          chip={makeChip({ reactedByMe: false })}
          canReact
          onToggle={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('button', { pressed: false }).textContent,
      ).toContain(THUMBS_UP_GLYPH);
    });

    it('requests adding when pressed on a chip I have not reacted to', async () => {
      const onToggle = vi.fn();
      render(<ReactionChip chip={makeChip()} canReact onToggle={onToggle} />);

      await userEvent.click(screen.getByRole('button', { pressed: false }));

      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onToggle).toHaveBeenCalledWith(THUMBS_UP, true);
    });

    it('requests removing when pressed on my own chip', async () => {
      const onToggle = vi.fn();
      render(
        <ReactionChip
          chip={makeChip({ reactedByMe: true })}
          canReact
          onToggle={onToggle}
        />,
      );

      await userEvent.click(screen.getByRole('button', { pressed: true }));

      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onToggle).toHaveBeenCalledWith(THUMBS_UP, false);
    });

    it('cannot be pressed when the user cannot react', async () => {
      const onToggle = vi.fn();
      render(
        <ReactionChip chip={makeChip()} canReact={false} onToggle={onToggle} />,
      );

      expect(screen.queryByRole('button', { pressed: false })).toBeNull();
      expect(screen.getAllByRole('button')).toHaveLength(1);

      await userEvent.click(screen.getByText(THUMBS_UP_GLYPH));
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('cannot be pressed while an update is in flight', async () => {
      const onToggle = vi.fn();
      render(
        <ReactionChip
          chip={makeChip()}
          canReact
          isUpdating
          onToggle={onToggle}
        />,
      );

      await userEvent.click(screen.getByRole('button', { pressed: false }));

      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  describe('count part', () => {
    it('opens the users list without requesting an update', async () => {
      const onToggle = vi.fn();
      render(<ReactionChip chip={makeChip()} canReact onToggle={onToggle} />);
      expect(screen.queryByText('Alice A.')).toBeNull();

      await userEvent.click(countButton());

      expect(await screen.findByText('Alice A.')).toBeTruthy();
      expect(screen.getByText('bob')).toBeTruthy();
      expect(screen.getByText('64b0000000000000000000ff')).toBeTruthy();
      expect(countButton().getAttribute('aria-expanded')).toBe('true');
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('closes the users list when pressed again', async () => {
      render(<ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />);

      await userEvent.click(countButton());
      await screen.findByText('Alice A.');
      await userEvent.click(countButton());

      await waitFor(() =>
        expect(countButton().getAttribute('aria-expanded')).toBe('false'),
      );
    });

    it('closes the users list when pressing outside of it', async () => {
      render(<ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />);

      await userEvent.click(countButton());
      await screen.findByText('Alice A.');
      await userEvent.click(document.body);

      await waitFor(() =>
        expect(countButton().getAttribute('aria-expanded')).toBe('false'),
      );
    });

    it('opens the users list even when the user cannot react', async () => {
      const onToggle = vi.fn();
      render(
        <ReactionChip chip={makeChip()} canReact={false} onToggle={onToggle} />,
      );

      await userEvent.click(countButton());

      expect(await screen.findByText('Alice A.')).toBeTruthy();
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('stays pressable while an update is in flight', async () => {
      render(
        <ReactionChip
          chip={makeChip()}
          canReact
          isUpdating
          onToggle={vi.fn()}
        />,
      );

      await userEvent.click(countButton());

      expect(await screen.findByText('Alice A.')).toBeTruthy();
    });
  });

  it('gives each chip its own popover target so repeated chips do not collide', async () => {
    render(
      <>
        <ReactionChip chip={makeChip()} canReact onToggle={vi.fn()} />
        <ReactionChip
          chip={makeChip({
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

    await userEvent.click(
      screen.getByRole('button', { name: 'comment_reaction.reacted_count:1' }),
    );

    expect(await screen.findByText('Carol')).toBeTruthy();
    expect(screen.queryByText('Alice A.')).toBeNull();
  });
});
