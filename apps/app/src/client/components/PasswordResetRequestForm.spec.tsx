import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { mock } from 'vitest-mock-extended';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';
import { apiV3ErrorCode } from '~/interfaces/errors/v3-error';
import { isMailerSetupAtom } from '~/states/server-configurations';

import PasswordResetRequestForm, {
  IMMEDIATE_REJECTION_WAIT_MS,
} from './PasswordResetRequestForm';

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

const NEUTRAL_TOAST = 'forgot_password.email_sent_if_account_exists';

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

/** A request whose outcome the test decides later. */
const deferredRequest = () => {
  let reject: (reason: unknown) => void = () => {};
  let resolve: (value: unknown) => void = () => {};
  mockApiv3Post.mockReturnValue(
    new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    }),
  );
  return { resolve: () => resolve(mock()), reject: (e: unknown) => reject(e) };
};

const immediateRejections = [
  {
    status: 405,
    code: forgotPasswordErrorCode.PASSWORD_RESET_IS_UNAVAILABLE,
    messageKey: 'forgot_password.password_reset_disabled',
  },
  {
    status: 400,
    code: apiV3ErrorCode.VALIDATION_FAILED,
    messageKey: 'forgot_password.invalid_input_format',
  },
];

describe('PasswordResetRequestForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(
    immediateRejections,
  )('shows only the $status error toast when the server rejects the request at once', async ({
    code,
    messageKey,
  }) => {
    mockApiv3Post.mockRejectedValue([{ message: 'rejected', code }]);
    renderForm();

    submitEmail('user@example.com');
    await advance(IMMEDIATE_REJECTION_WAIT_MS);

    expect(mockToastError).toHaveBeenCalledWith(messageKey);
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  // e.g. a plain 429 from the rate limiter or a 502 page from a proxy
  it('shows only the retry guidance when the request fails at once without an error code', async () => {
    mockApiv3Post.mockRejectedValue([]);
    renderForm();

    submitEmail('user@example.com');
    await advance(IMMEDIATE_REJECTION_WAIT_MS);

    expect(mockToastError).toHaveBeenCalledWith(
      'forgot_password.request_failed',
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('shows the neutral toast once the immediate rejection window has passed, keeping the form usable', async () => {
    deferredRequest();
    renderForm();

    submitEmail('user@example.com');
    await advance(IMMEDIATE_REJECTION_WAIT_MS - 1);
    expect(mockToastSuccess).not.toHaveBeenCalled();

    await advance(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(NEUTRAL_TOAST);
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(sendButton()).toBeEnabled();
  });

  it('shows no error toast when the request is accepted', async () => {
    const request = deferredRequest();
    renderForm();

    submitEmail('user@example.com');
    await advance(IMMEDIATE_REJECTION_WAIT_MS);
    request.resolve();
    await advance(0);

    expect(mockToastSuccess).toHaveBeenCalledWith(NEUTRAL_TOAST);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows the retry guidance after the neutral toast when the server reports a failed request', async () => {
    const request = deferredRequest();
    renderForm();

    submitEmail('user@example.com');
    await advance(IMMEDIATE_REJECTION_WAIT_MS);
    request.reject([
      {
        message: 'Failed to process the password reset request.',
        code: forgotPasswordErrorCode.PASSWORD_RESET_REQUEST_FAILED,
      },
    ]);
    await advance(0);

    expect(mockToastSuccess).toHaveBeenCalledWith(NEUTRAL_TOAST);
    expect(mockToastError).toHaveBeenCalledWith(
      'forgot_password.request_failed',
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['without an error code', []],
    ['with an unknown error code', [{ message: 'other', code: 'unknown' }]],
  ])('shows the retry guidance after the neutral toast when the request fails later %s', async (_label, error) => {
    const request = deferredRequest();
    renderForm();

    submitEmail('user@example.com');
    await advance(IMMEDIATE_REJECTION_WAIT_MS);
    request.reject(error);
    await advance(0);

    expect(mockToastSuccess).toHaveBeenCalledWith(NEUTRAL_TOAST);
    expect(mockToastError).toHaveBeenCalledWith(
      'forgot_password.request_failed',
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);
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
