import type { JSX } from 'react';

import type { EncryptionStatus } from './types';

const ENCRYPTION_KEY_ENV_NAME = 'CHAT_INTEGRATION_KEY_ENCRYPTION_KEY';
const ENCRYPTION_KEY_GENERATION_ENV_NAME =
  'CHAT_INTEGRATION_KEY_ENCRYPTION_KEY_GENERATION';

const describeEncryptionProblem = (
  reason: EncryptionStatus['reason'],
): JSX.Element => {
  switch (reason) {
    case 'invalid-key':
      return (
        <>
          <code>{ENCRYPTION_KEY_ENV_NAME}</code> is set, but it is not a valid
          key. It must be 32 random bytes, base64-encoded. Generate one with{' '}
          <code>openssl rand -base64 32</code>.
        </>
      );
    case 'invalid-generation':
      return (
        <>
          <code>{ENCRYPTION_KEY_GENERATION_ENV_NAME}</code> is set, but it is
          not a whole number of 1 or more.
        </>
      );
    default:
      return (
        <>
          <code>{ENCRYPTION_KEY_ENV_NAME}</code> is not set. Set it to 32 random
          bytes, base64-encoded. Generate one with{' '}
          <code>openssl rand -base64 32</code>.
        </>
      );
  }
};

/**
 * Shown at the top of the screen while the encryption key this feature needs
 * is missing or malformed. The key protects the private keys GROWI signs
 * with, so without it a new connection cannot be added and a stored private
 * key cannot be decrypted either. Nothing is shown until the status has
 * loaded, so a configured screen never flashes the warning.
 */
export const EncryptionKeyWarning = ({
  status,
}: {
  status: EncryptionStatus | undefined;
}): JSX.Element | null => {
  if (status == null || status.configured) {
    return null;
  }

  return (
    <div
      className="alert alert-danger mb-4"
      role="alert"
      data-testid="grw-chat-integration-encryption-warning"
    >
      <h3 className="alert-heading h5">Chat integration is not available</h3>
      <p className="mb-2">
        GROWI encrypts the private keys it signs chat integration requests with.
        Until the encryption key is configured, no connection can be added, and
        the private keys of connections added earlier cannot be used either.
      </p>
      <p className="mb-2">{describeEncryptionProblem(status.reason)}</p>
      <p className="mb-0">Restart GROWI after changing the environment.</p>
    </div>
  );
};
