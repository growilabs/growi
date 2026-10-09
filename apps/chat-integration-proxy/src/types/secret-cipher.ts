// `SecretCipher` is the pair of functions the storage layer uses to write and
// read the two encrypted columns (`installation.credentials`,
// `own_key.private_key_pem`; design.md's Data Models section).
//
// It lives in `types/` rather than next to its only implementation
// (`runtime/config.ts`) for the same reason `Relation` does: `db/` is the
// layer that consumes it, and design.md's declared dependency order
// (`types -> capabilities -> db -> platform -> command -> relation -> growi
// -> orchestration -> routes`) puts `runtime/` outside the chain -- "`runtime/`
// は最も外側。上のどこからも import されない". A `db/repositories/**` file that
// imported `runtime/config.ts` to name this type would be a layer violation
// (`src/architecture.spec.ts` catches it), and re-declaring the same interface
// inside `db/` would give the app two declarations that can drift apart.
//
// The interface is only the *shape*. The key itself still never leaves
// `runtime/config.ts`'s closure -- what travels to other layers is a value of
// this type, i.e. functions, never the key or a decrypted value.

export interface SecretCipher {
  readonly encrypt: (plaintext: string) => string;
  readonly decrypt: (ciphertext: string) => string;
}
