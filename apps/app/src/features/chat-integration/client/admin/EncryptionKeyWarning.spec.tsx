// Proves what the warning says for each way the encryption key can be
// unusable, and that it stays out of the way otherwise.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EncryptionKeyWarning } from './EncryptionKeyWarning';

describe('EncryptionKeyWarning', () => {
  it('says chat integration is not available when the key is unset, naming the variable and how to generate a key', () => {
    render(
      <EncryptionKeyWarning status={{ configured: false, reason: 'unset' }} />,
    );

    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent(/chat integration is not available/i);
    expect(warning).toHaveTextContent(
      /CHAT_INTEGRATION_KEY_ENCRYPTION_KEY is not set/,
    );
    expect(warning).toHaveTextContent(/openssl rand -base64 32/);
  });

  it('tells a malformed key apart from an unset one', () => {
    render(
      <EncryptionKeyWarning
        status={{ configured: false, reason: 'invalid-key' }}
      />,
    );

    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent(/is set, but it is not a valid key/);
    expect(warning).not.toHaveTextContent(/is not set/);
  });

  it('names the generation variable when only the generation is invalid', () => {
    render(
      <EncryptionKeyWarning
        status={{ configured: false, reason: 'invalid-generation' }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      /CHAT_INTEGRATION_KEY_ENCRYPTION_KEY_GENERATION/,
    );
  });

  it('treats an unusable key without a stated reason like an unset one', () => {
    render(<EncryptionKeyWarning status={{ configured: false }} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /CHAT_INTEGRATION_KEY_ENCRYPTION_KEY is not set/,
    );
  });

  it('shows nothing while the key is usable', () => {
    render(<EncryptionKeyWarning status={{ configured: true }} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows nothing before the status has loaded, so a configured screen never flashes it', () => {
    render(<EncryptionKeyWarning status={undefined} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
