// Proves the pairing entry point: a button opens the pairing form in a
// modal, a successful pairing closes it and tells the screen to re-read its
// list, and a failed one leaves the modal open with what was typed.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiv3Post: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Post: mocks.apiv3Post,
}));

vi.mock('~/client/util/toastr', () => ({
  toastError: mocks.toastError,
  toastSuccess: mocks.toastSuccess,
}));

import { PairingSection } from './PairingSection';

type User = ReturnType<typeof userEvent.setup>;

const renderSection = ({
  encryptionConfigured = true,
}: {
  encryptionConfigured?: boolean;
} = {}) => {
  const onPaired = vi.fn();
  render(
    <PairingSection
      encryptionConfigured={encryptionConfigured}
      onPaired={onPaired}
    />,
  );
  return { onPaired };
};

const fillPairingForm = async (user: User): Promise<void> => {
  await user.type(
    await screen.findByLabelText(/registration code/i),
    'the-code',
  );
  await user.type(
    screen.getByLabelText(/proxy url/i),
    'https://proxy.example.test',
  );
  await user.type(
    screen.getByLabelText(/this growi's url/i),
    'https://growi.example.test',
  );
  await user.type(
    screen.getByLabelText(/label to show the chat service/i),
    'My GROWI',
  );
};

describe('PairingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the pairing form out of the page until the add-connection button is pressed', async () => {
    const user = userEvent.setup();
    renderSection();

    expect(
      screen.queryByLabelText(/registration code/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add connection/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/registration code/i)).toBeInTheDocument();
  });

  it('disables the add-connection button while the encryption key is unusable', () => {
    renderSection({ encryptionConfigured: false });

    expect(
      screen.getByRole('button', { name: /add connection/i }),
    ).toBeDisabled();
    expect(
      screen.queryByLabelText(/registration code/i),
    ).not.toBeInTheDocument();
  });

  it('submits the entered fields, closes the modal and reports the pairing when paired', async () => {
    mocks.apiv3Post.mockResolvedValue({
      data: { status: 'paired', relationId: 'relation-new' },
    });
    const user = userEvent.setup();
    const { onPaired } = renderSection();

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await fillPairingForm(user);
    await user.click(screen.getByRole('button', { name: /^pair$/i }));

    await waitFor(() => {
      expect(mocks.apiv3Post).toHaveBeenCalledWith(
        '/chat-integration/admin/pairing',
        {
          registrationCode: 'the-code',
          proxyUri: 'https://proxy.example.test',
          growiUri: 'https://growi.example.test',
          growiLabel: 'My GROWI',
        },
      );
    });
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(onPaired).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows an error toast (not a success) and keeps the modal open for a non-"paired" outcome', async () => {
    mocks.apiv3Post.mockResolvedValue({ data: { status: 'code-expired' } });
    const user = userEvent.setup();
    const { onPaired } = renderSection();

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await fillPairingForm(user);
    await user.click(screen.getByRole('button', { name: /^pair$/i }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalled();
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(onPaired).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/registration code/i)).toHaveValue('the-code');
  });

  it('closes the modal without calling the pairing endpoint when cancelled', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await user.click(await screen.findByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mocks.apiv3Post).not.toHaveBeenCalled();
  });
});
