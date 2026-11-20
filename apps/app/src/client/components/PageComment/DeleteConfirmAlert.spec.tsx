/**
 * Unit tests for the delete confirmation shared by the normal comment
 * (`Comment.tsx`) and the inline comment (`InlineCommentItem.tsx`)
 * (design.md: 削除確認UIの共通化).
 *
 * This is a presentational component, so its whole contract is what it
 * renders and which callback each button fires. The `testIdPrefix` behavior
 * is asserted for both real callers' prefixes, because each caller's own
 * tests (and the Playwright suite) locate these buttons by the resulting
 * `data-testid`.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./DeleteConfirmAlert.module.scss', () => ({
  default: { 'delete-confirm-alert': 'delete-confirm-alert' },
}));

import { DeleteConfirmAlert } from './DeleteConfirmAlert';

describe('DeleteConfirmAlert', () => {
  it('derives every data-testid from testIdPrefix', () => {
    const { unmount } = render(
      <DeleteConfirmAlert
        testIdPrefix="inline-comment"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId('inline-comment-delete-confirm'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('inline-comment-delete-cancel-button'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('inline-comment-delete-confirm-button'),
    ).toBeInTheDocument();

    unmount();

    render(
      <DeleteConfirmAlert
        testIdPrefix="comment"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByTestId('comment-delete-confirm')).toBeInTheDocument();
    expect(
      screen.getByTestId('comment-delete-cancel-button'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('comment-delete-confirm-button'),
    ).toBeInTheDocument();
  });

  it('renders a Bootstrap danger alert carrying an icon, the confirmation message and the button group', () => {
    render(
      <DeleteConfirmAlert
        testIdPrefix="comment"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const confirm = screen.getByTestId('comment-delete-confirm');
    expect(confirm).toHaveClass(
      'alert',
      'alert-danger',
      'd-flex',
      'align-items-center',
      'gap-2',
      'mb-0',
    );
    // The left accent is a CSS Modules rule, not the `border-start border-3`
    // utility pair: those set `border-left-color` to the neutral
    // `--bs-border-color` with `!important`, which overrode `alert-danger`'s
    // own tone and painted the accent grey.
    expect(confirm.className).toContain('delete-confirm-alert');
    expect(confirm).not.toHaveClass('border-start');

    expect(confirm).toHaveAttribute('role', 'alert');
    expect(confirm.querySelector('.material-symbols-outlined')).not.toBeNull();
    expect(confirm).toHaveTextContent('page_comment.delete_comment');

    // No modal is used for the confirmation.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onConfirm when the delete button is clicked', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DeleteConfirmAlert
        testIdPrefix="comment"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    await userEvent.click(screen.getByTestId('comment-delete-confirm-button'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when the cancel button is clicked', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DeleteConfirmAlert
        testIdPrefix="comment"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    await userEvent.click(screen.getByTestId('comment-delete-cancel-button'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
