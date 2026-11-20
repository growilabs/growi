import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { mock } from 'vitest-mock-extended';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';
import { isMailerSetupAtom } from '~/states/server-configurations';

import PasswordResetRequestForm from './PasswordResetRequestForm';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Post: vi.fn(),
}));

vi.mock('~/client/util/toastr', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

const mockApiv3Post = vi.mocked(apiv3Post);
const mockToastError = vi.mocked(toastError);
const mockToastSuccess = vi.mocked(toastSuccess);

const renderForm = () => {
  const store = createStore();
  store.set(isMailerSetupAtom, true);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return render(<PasswordResetRequestForm />, { wrapper: Wrapper });
};

const sendButton = () =>
  screen.getByRole('button', { name: 'forgot_password.send' });

const submitEmail = (email: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: email } });
  fireEvent.click(sendButton());
};

describe('PasswordResetRequestForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the neutral toast immediately and keeps the form usable while waiting for the response', () => {
    mockApiv3Post.mockReturnValue(new Promise(() => {}));
    renderForm();

    submitEmail('user@example.com');

    expect(mockToastSuccess).toHaveBeenCalledWith(
      'forgot_password.email_sent_if_account_exists',
    );
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(sendButton()).toBeEnabled();
  });

  it('shows no error toast when the request is accepted', async () => {
    mockApiv3Post.mockResolvedValue(mock());
    renderForm();

    submitEmail('user@example.com');

    await waitFor(() => expect(mockApiv3Post).toHaveBeenCalled());
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows the retry guidance when the server reports a failed request', async () => {
    mockApiv3Post.mockRejectedValue([
      {
        message: 'Failed to process the password reset request.',
        code: forgotPasswordErrorCode.PASSWORD_RESET_REQUEST_FAILED,
      },
    ]);
    renderForm();

    submitEmail('user@example.com');

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        'forgot_password.request_failed',
      ),
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it('shows other API errors as they are', async () => {
    const rateLimitError = [{ message: 'Too many requests', code: '429' }];
    mockApiv3Post.mockRejectedValue(rateLimitError);
    renderForm();

    submitEmail('user@example.com');

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(rateLimitError),
    );
  });

  it('asks for an email address without sending a request when the input is empty', () => {
    renderForm();

    fireEvent.click(sendButton());

    expect(mockToastError).toHaveBeenCalledWith(
      'forgot_password.email_is_required',
    );
    expect(mockApiv3Post).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
