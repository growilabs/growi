import { rc4 } from './pdf-security';

describe('rc4', () => {
  // Published RC4 test vectors (key, plaintext, ciphertext).
  it.each([
    ['Key', 'Plaintext', 'bbf316e8d940af0ad3'],
    ['Wiki', 'pedia', '1021bf0420'],
    ['Secret', 'Attack at dawn', '45a01f645fc35b383552544b9bf5'],
  ])('encrypts %s / %s to the known ciphertext', (key, plaintext, ciphertext) => {
    expect(rc4(Buffer.from(key), Buffer.from(plaintext)).toString('hex')).toBe(
      ciphertext,
    );
  });
});
