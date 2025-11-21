import type { ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';
import {
  describe, it, expect, vi,
} from 'vitest';

import { isRomUserAllowedToCommentAtom } from '~/states/server-configurations';

import { NotAvailableIfReadOnlyUserNotAllowedToComment } from './NotAvailableForReadOnlyUser';

const useIsReadOnlyUser = vi.hoisted(() => vi.fn().mockReturnValue(true));

vi.mock('~/states/context', () => ({
  useIsReadOnlyUser,
}));

vi.mock('react-disable', () => ({
  Disable: ({ children, disabled }: { children: ReactNode; disabled: boolean }) => (
    <div aria-hidden={disabled ? 'true' : undefined}>
      {children}
    </div>
  ),
}));

const HydrateAtoms = ({ children, initialValues }: { children: ReactNode; initialValues: Array<[typeof isRomUserAllowedToCommentAtom, boolean]> }) => {
  useHydrateAtoms(initialValues);
  return <>{children}</>;
};

describe('NotAvailableForReadOnlyUser.tsx', () => {

  it('renders NotAvailable component as enable when user is read-only and comments by rom users is allowed', async() => {
    useIsReadOnlyUser.mockReturnValue(true);

    render(
      <Provider>
        <HydrateAtoms initialValues={[[isRomUserAllowedToCommentAtom, true]]}>
          <NotAvailableIfReadOnlyUserNotAllowedToComment>
            <div data-testid="test-child">Test Child</div>
          </NotAvailableIfReadOnlyUserNotAllowedToComment>
        </HydrateAtoms>
      </Provider>,
    );

    // when
    const element = screen.getByTestId('test-child');
    const wrapperElement = element.parentElement;

    // then
    expect(wrapperElement).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('renders NotAvailable component as disable when user is read-only and comments by rom users is not allowed', async() => {
    useIsReadOnlyUser.mockReturnValue(true);

    render(
      <Provider>
        <HydrateAtoms initialValues={[[isRomUserAllowedToCommentAtom, false]]}>
          <NotAvailableIfReadOnlyUserNotAllowedToComment>
            <div data-testid="test-child">Test Child</div>
          </NotAvailableIfReadOnlyUserNotAllowedToComment>
        </HydrateAtoms>
      </Provider>,
    );

    // when
    const element = screen.getByTestId('test-child');
    const wrapperElement = element.parentElement;

    // then
    expect(wrapperElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders NotAvailable component as enable when user is not read-only and comments by rom users is allowed', async() => {
    useIsReadOnlyUser.mockReturnValue(false);

    render(
      <Provider>
        <HydrateAtoms initialValues={[[isRomUserAllowedToCommentAtom, true]]}>
          <NotAvailableIfReadOnlyUserNotAllowedToComment>
            <div data-testid="test-child">Test Child</div>
          </NotAvailableIfReadOnlyUserNotAllowedToComment>
        </HydrateAtoms>
      </Provider>,
    );

    // when
    const element = screen.getByTestId('test-child');
    const wrapperElement = element.parentElement;

    // then
    expect(wrapperElement).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('renders NotAvailable component as enable when user is not read-only and comments by rom users is not allowed', async() => {
    useIsReadOnlyUser.mockReturnValue(false);

    render(
      <Provider>
        <HydrateAtoms initialValues={[[isRomUserAllowedToCommentAtom, false]]}>
          <NotAvailableIfReadOnlyUserNotAllowedToComment>
            <div data-testid="test-child">Test Child</div>
          </NotAvailableIfReadOnlyUserNotAllowedToComment>
        </HydrateAtoms>
      </Provider>,
    );

    // when
    const element = screen.getByTestId('test-child');
    const wrapperElement = element.parentElement;

    // then
    expect(wrapperElement).not.toHaveAttribute('aria-hidden', 'true');
  });

});
