// @vitest-environment happy-dom

import type { EmojiPickerSelection } from '@growi/editor/dist/client/components/EmojiPicker';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MAX_REACTION_KINDS_PER_COMMENT } from '../../../interfaces';
import { AddReactionButton } from './AddReactionButton';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/stores-universal/use-next-themes', () => ({
  useNextThemes: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('./CommentReactionBar.module.scss', () => ({ default: {} }));

type MockPickerProps = {
  isOpen: boolean;
  onSelect: (selection: EmojiPickerSelection) => void;
  onClose: () => void;
};

// Stands in for the lazily loaded emoji-mart picker; the real one is covered in @growi/editor.
vi.mock('@growi/editor/dist/client/components/EmojiPicker', () => ({
  EmojiPicker: ({ isOpen, onSelect, onClose }: MockPickerProps) =>
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
        <button
          type="button"
          onClick={() => onSelect({ kind: 'native', id: 'no-such-emoji' })}
        >
          pick-unknown
        </button>
        <button type="button" onClick={onClose}>
          close-picker
        </button>
      </div>
    ) : null,
}));

const addButton = (): HTMLElement =>
  screen.getByRole('button', { name: 'comment_reaction.add_reaction' });

describe('AddReactionButton', () => {
  it('renders nothing when the user cannot react', () => {
    const { container } = render(
      <AddReactionButton canReact={false} chipCount={0} onAdd={vi.fn()} />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is enabled and keeps the picker closed until pressed', () => {
    render(<AddReactionButton canReact chipCount={0} onAdd={vi.fn()} />);

    expect((addButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows an icon, hidden from assistive tech, while keeping the accessible name', () => {
    render(<AddReactionButton canReact chipCount={0} onAdd={vi.fn()} />);

    const icon = addButton().querySelector('.material-symbols-outlined');
    expect(icon?.textContent).toBe('add_reaction');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens the picker when pressed', async () => {
    render(<AddReactionButton canReact chipCount={0} onAdd={vi.fn()} />);

    await userEvent.click(addButton());

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('stays enabled just below the kind limit', () => {
    render(
      <AddReactionButton
        canReact
        chipCount={MAX_REACTION_KINDS_PER_COMMENT - 1}
        onAdd={vi.fn()}
      />,
    );

    expect((addButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('is disabled at the kind limit and does not open the picker', async () => {
    render(
      <AddReactionButton
        canReact
        chipCount={MAX_REACTION_KINDS_PER_COMMENT}
        onAdd={vi.fn()}
      />,
    );

    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(addButton());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains the reached limit in a tooltip', async () => {
    render(
      <AddReactionButton
        canReact
        chipCount={MAX_REACTION_KINDS_PER_COMMENT}
        onAdd={vi.fn()}
      />,
    );

    await userEvent.hover(addButton().parentElement as HTMLElement);

    expect(
      await screen.findByText('comment_reaction.kind_limit_reached'),
    ).toBeTruthy();
  });

  it('labels the button in a tooltip on hover below the limit, without the limit reason', async () => {
    render(<AddReactionButton canReact chipCount={1} onAdd={vi.fn()} />);

    await userEvent.hover(addButton().parentElement as HTMLElement);

    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'comment_reaction.add_reaction',
    );
    expect(
      screen.queryByText('comment_reaction.kind_limit_reached'),
    ).toBeNull();
  });

  it('labels the button in a tooltip when it receives keyboard focus', async () => {
    render(<AddReactionButton canReact chipCount={1} onAdd={vi.fn()} />);

    await userEvent.tab();

    expect(document.activeElement).toBe(addButton());
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'comment_reaction.add_reaction',
    );
  });

  it('shows only the limit reason, not the add label, at the limit', async () => {
    render(
      <AddReactionButton
        canReact
        chipCount={MAX_REACTION_KINDS_PER_COMMENT}
        onAdd={vi.fn()}
      />,
    );

    await userEvent.hover(addButton().parentElement as HTMLElement);

    expect(
      await screen.findByText('comment_reaction.kind_limit_reached'),
    ).toBeTruthy();
    expect(screen.getByRole('tooltip').textContent).toBe(
      'comment_reaction.kind_limit_reached',
    );
  });

  it('renders the tooltip without a fade transition, like the other tooltips in the app', async () => {
    render(<AddReactionButton canReact chipCount={1} onAdd={vi.fn()} />);

    await userEvent.hover(addButton().parentElement as HTMLElement);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.closest('.fade')).toBeNull();
  });

  it('is disabled while a write is in flight', () => {
    render(
      <AddReactionButton canReact chipCount={0} isUpdating onAdd={vi.fn()} />,
    );

    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('requests adding the selected emoji as a reaction key and closes the picker', async () => {
    const onAdd = vi.fn();
    render(<AddReactionButton canReact chipCount={0} onAdd={onAdd} />);

    await userEvent.click(addButton());
    await userEvent.click(screen.getByText('pick-thumbs-up'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('unicode:+1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('passes the skin tone through to the key', async () => {
    const onAdd = vi.fn();
    render(<AddReactionButton canReact chipCount={0} onAdd={onAdd} />);

    await userEvent.click(addButton());
    await userEvent.click(screen.getByText('pick-thumbs-up-tone-3'));

    expect(onAdd).toHaveBeenCalledWith('unicode:+1::skin-tone-3');
  });

  it('requests nothing when the picker is closed without a selection', async () => {
    const onAdd = vi.fn();
    render(<AddReactionButton canReact chipCount={0} onAdd={onAdd} />);

    await userEvent.click(addButton());
    await userEvent.click(screen.getByText('close-picker'));

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('requests nothing for a selection that is not a valid reaction key', async () => {
    const onAdd = vi.fn();
    render(<AddReactionButton canReact chipCount={0} onAdd={onAdd} />);

    await userEvent.click(addButton());
    await userEvent.click(screen.getByText('pick-unknown'));

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
