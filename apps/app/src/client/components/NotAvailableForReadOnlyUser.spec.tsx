import { render, screen } from '@testing-library/react';
import {
  describe, it, expect, vi,
} from 'vitest';

import { NotAvailableIfReadOnlyUserNotAllowedToComment } from './NotAvailableForReadOnlyUser';

const useIsReadOnlyUser = vi.hoisted(() => vi.fn().mockReturnValue({ data: true }));
const useIsRomUserAllowedToComment = vi.hoisted(() => vi.fn().mockReturnValue({ data: true }));

vi.mock('~/stores-universal/context', () => ({
  useIsReadOnlyUser,
  useIsRomUserAllowedToComment,
}));

describe('NotAvailableForReadOnlyUser.tsx', () => {

  it('renders NotAvailable component as enable when user is read-only and comments by rom users is allowed', async() => {
    useIsReadOnlyUser.mockReturnValue({ data: true });
    useIsRomUserAllowedToComment.mockReturnValue({ data: true });

    render(
      <NotAvailableIfReadOnlyUserNotAllowedToComment>
        <div data-testid="test-child">Test Child</div>
      </NotAvailableIfReadOnlyUserNotAllowedToComment>,
    );

    // when
    const element = screen.getByTestId('test-child');
    const wrapperElement = element.parentElement;

    // then
    expect(wrapperElement).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('renders NotAvailable component as disable when user is read-only and comments by rom users is not allowed', async() => {
    useIsReadOnlyUser.mockReturnValue({ data: true });
    useIsRomUserAllowedToComment.mockReturnValue({ data: false });

    render(
      <NotAvailableIfReadOnlyUserNotAllowedToComment>
        <div data-testid="test-child">Test Child</div>
      </NotAvailableIfReadOnlyUserNotAllowedToComment>,
    );

    // when
    const element = screen.getByTestId('test-child');
    const wrapperElement = element.parentElement;

    // then
    expect(wrapperElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders NotAvailable component as enable when user is not read-only and comments by rom users is allowed', async() => {
    useIsReadOnlyUser.mockReturnValue({ data: false });
    useIsRomUserAllowedToComment.mockReturnValue({ data: true });

    render(
      <NotAvailableIfReadOnlyUserNotAllowedToComment>
        <div data-testid="test-child">Test Child</div>
      </NotAvailableIfReadOnlyUserNotAllowedToComment>,
    );

    // when
    const element = screen.getByTestId('test-child');
    const wrapperElement = element.parentElement;

    // then
    expect(wrapperElement).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('renders NotAvailable component as enable when user is not read-only and comments by rom users is not allowed', async() => {
    useIsReadOnlyUser.mockReturnValue({ data: false });
    useIsRomUserAllowedToComment.mockReturnValue({ data: false });

    render(
      <NotAvailableIfReadOnlyUserNotAllowedToComment>
        <div data-testid="test-child">Test Child</div>
      </NotAvailableIfReadOnlyUserNotAllowedToComment>,
    );

    // when
    const element = screen.getByTestId('test-child');
    const wrapperElement = element.parentElement;

    // then
    expect(wrapperElement).not.toHaveAttribute('aria-hidden', 'true');
  });

});
