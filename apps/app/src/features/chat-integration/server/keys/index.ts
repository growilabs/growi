// Public surface of the key handling this feature owns.
//
// `withDecryptedChatKey` is deliberately NOT re-exported here. Decryption is
// meant to happen only inside the function that signs (design.md "復号する場所
// -- 署名する関数の中だけ。他の層へは復号した値ではなく署名する関数を渡す"), so the
// signing function should be placed in this directory and import
// `./key-encryption` directly rather than going through this barrel. This is
// a convention, not an enforced boundary -- nothing in this repo's tooling
// (e.g. biome's `noRestrictedImports`) currently blocks a file elsewhere from
// importing `./key-encryption` directly. Enforcing it mechanically, if ever
// needed, would require adding such a restriction.

export type {
  ChatKeyEncryptionConfigurationStatus,
  EncryptedChatKeyEnvelope,
} from './key-encryption';
export {
  ChatKeyEncryptionConfigurationError,
  describeChatKeyEncryptionConfiguration,
  encryptChatKeyForStorage,
  isChatKeyEncryptionConfigured,
  isEncryptedChatKeyEnvelope,
} from './key-encryption';
export type { SignWithOwnKeyParams } from './key-store';
export {
  registerPeerKey,
  resolvePeerKey,
  revokeOwnKey,
  revokePeerKey,
  signWithOwnKey,
  storeOwnKey,
  storePeerKey,
} from './key-store';

// `chatKeyGenerationOf` and `ChatKeyEncryptionEnv` are also left off: the
// generation reader belongs to the key change this spec defers, and the env
// type is only named by callers that pass one in -- both live in
// `./key-encryption` until something outside this directory needs them.
