import React from 'react';

import {
  render, screen, fireEvent, waitFor,
} from '@testing-library/react';
import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

import { apiv3Post } from '~/client/util/apiv3-client';
import type { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';

import { LoginForm } from './LoginForm';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('~/client/util/t-with-opt', () => ({
  useTWithOpt: () => (key: string) => key,
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Post: vi.fn(),
}));

vi.mock('./ExternalAuthButton', () => ({
  ExternalAuthButton: ({ authType }: { authType: string }) => (
    <button type="button" data-testid={`external-auth-${authType}`}>
      External Auth {authType}
    </button>
  ),
}));

vi.mock('../CompleteUserRegistration', () => ({
  CompleteUserRegistration: () => <div>Complete Registration</div>,
}));

const defaultProps = {
  isEmailAuthenticationEnabled: false,
  registrationMode: 'Open' as const,
  registrationWhitelist: [],
  isPasswordResetEnabled: true,
  isLocalStrategySetup: true,
  isLdapStrategySetup: false,
  isLdapSetupFailed: false,
  minPasswordLength: 8,
  isMailerSetup: true,
};

const mockApiv3Post = vi.mocked(apiv3Post);

describe('LoginForm - Error Display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when password login is enabled', () => {
    it('should display login form', () => {
      const props = {
        ...defaultProps,
        isLocalStrategySetup: true,
      };

      render(<LoginForm {...props} />);

      expect(screen.getByTestId('login-form')).toBeInTheDocument();
    });

    it('should display external account login errors', () => {
      const externalAccountLoginError = {
        message: 'jwks must be a JSON Web Key Set formatted object',
        name: 'ExternalAccountLoginError',
      };

      const props = {
        ...defaultProps,
        isLocalStrategySetup: true,
        externalAccountLoginError,
      };

      render(<LoginForm {...props} />);

      expect(screen.getByText('jwks must be a JSON Web Key Set formatted object')).toBeInTheDocument();
    });
  });

  describe('when password login is disabled', () => {
    it('should still display external account login errors', () => {
      const externalAccountLoginError = {
        message: 'jwks must be a JSON Web Key Set formatted object',
        name: 'ExternalAccountLoginError',
      };

      const props = {
        ...defaultProps,
        isLocalStrategySetup: false,
        isLdapStrategySetup: false,
        enabledExternalAuthType: ['oidc'] satisfies IExternalAuthProviderType[],
        externalAccountLoginError,
      };

      render(<LoginForm {...props} />);

      expect(screen.getByText('jwks must be a JSON Web Key Set formatted object')).toBeInTheDocument();
    });

    it('should not render local/LDAP form but should still show errors', () => {
      const externalAccountLoginError = {
        message: 'OIDC authentication failed',
        name: 'ExternalAccountLoginError',
      };

      const props = {
        ...defaultProps,
        isLocalStrategySetup: false,
        isLdapStrategySetup: false,
        enabledExternalAuthType: ['oidc'] satisfies IExternalAuthProviderType[],
        externalAccountLoginError,
      };

      render(<LoginForm {...props} />);

      expect(screen.queryByTestId('tiUsernameForLogin')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tiPasswordForLogin')).not.toBeInTheDocument();
      expect(screen.getByText('OIDC authentication failed')).toBeInTheDocument();
    });
  });

  describe('error display priority and login error handling', () => {
    it('should show external errors when no login errors exist', () => {
      const externalAccountLoginError = {
        message: 'External error message',
        name: 'ExternalAccountLoginError',
      };

      const props = {
        ...defaultProps,
        isLocalStrategySetup: true,
        externalAccountLoginError,
      };

      render(<LoginForm {...props} />);

      expect(screen.getByText('External error message')).toBeInTheDocument();
    });

    it('should prioritize login errors over external account login errors after failed login', async() => {
      const externalAccountLoginError = {
        message: 'External error message',
        name: 'ExternalAccountLoginError',
      };

      // Mock API call to return error
      mockApiv3Post.mockRejectedValueOnce([
        {
          message: 'Invalid username or password',
          code: 'LOGIN_FAILED',
          args: {},
        },
      ]);

      const props = {
        ...defaultProps,
        isLocalStrategySetup: true,
        externalAccountLoginError,
      };

      render(<LoginForm {...props} />);

      // Initially, external error should be visible
      expect(screen.getByText('External error message')).toBeInTheDocument();

      // Fill in login form and submit
      const usernameInput = screen.getByTestId('tiUsernameForLogin');
      const passwordInput = screen.getByTestId('tiPasswordForLogin');
      const submitButton = screen.getByTestId('btnSubmitForLogin');

      fireEvent.change(usernameInput, { target: { value: 'testuser' } });
      fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });
      fireEvent.click(submitButton);

      // Wait for login error to appear and external error to be replaced
      await waitFor(() => {
        expect(screen.getByText('Invalid username or password')).toBeInTheDocument();
      });

      // External error should no longer be visible when login error exists
      expect(screen.queryByText('External error message')).not.toBeInTheDocument();
    });

    it('should display dangerouslySetInnerHTML errors for PROVIDER_DUPLICATED_USERNAME_EXCEPTION', async() => {
      // Mock API call to return PROVIDER_DUPLICATED_USERNAME_EXCEPTION error
      mockApiv3Post.mockRejectedValueOnce([
        {
          message: 'This username is already taken by <a href="/login">another provider</a>',
          code: 'provider-duplicated-username-exception',
          args: {},
        },
      ]);

      const props = {
        ...defaultProps,
        isLocalStrategySetup: true,
      };

      render(<LoginForm {...props} />);

      // Fill in login form and submit
      const usernameInput = screen.getByTestId('tiUsernameForLogin');
      const passwordInput = screen.getByTestId('tiPasswordForLogin');
      const submitButton = screen.getByTestId('btnSubmitForLogin');

      fireEvent.change(usernameInput, { target: { value: 'testuser' } });
      fireEvent.change(passwordInput, { target: { value: 'password' } });
      fireEvent.click(submitButton);

      // Wait for the dangerouslySetInnerHTML error to appear
      await waitFor(() => {
        // Check that the error with HTML content is rendered
        expect(screen.getByText(/This username is already taken by/)).toBeInTheDocument();
      });
    });

    it('should handle multiple login errors correctly', async() => {
      // Mock API call to return multiple errors
      mockApiv3Post.mockRejectedValueOnce([
        {
          message: 'Username is required',
          code: 'VALIDATION_ERROR',
          args: {},
        },
        {
          message: 'Password is too short',
          code: 'VALIDATION_ERROR',
          args: {},
        },
      ]);

      const props = {
        ...defaultProps,
        isLocalStrategySetup: true,
      };

      render(<LoginForm {...props} />);

      // Submit form without filling inputs
      const submitButton = screen.getByTestId('btnSubmitForLogin');
      fireEvent.click(submitButton);

      // Wait for multiple errors to appear
      await waitFor(() => {
        expect(screen.getByText('Username is required')).toBeInTheDocument();
        expect(screen.getByText('Password is too short')).toBeInTheDocument();
      });
    });
  });

  describe('error display when both login methods are disabled', () => {
    it('should still display external errors when no login methods are available', () => {
      const externalAccountLoginError = {
        message: 'Authentication service unavailable',
        name: 'ExternalAccountLoginError',
      };

      const props = {
        ...defaultProps,
        isLocalStrategySetup: false,
        isLdapStrategySetup: false,
        enabledExternalAuthType: undefined,
        externalAccountLoginError,
      };

      render(<LoginForm {...props} />);

      expect(screen.getByText('Authentication service unavailable')).toBeInTheDocument();
    });
  });
});
