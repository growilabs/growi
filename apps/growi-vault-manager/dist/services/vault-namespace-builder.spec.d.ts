/**
 * Unit tests for VaultNamespaceBuilder.applyInstruction
 *
 * All git I/O (VaultRepoStorage), DB access (RevisionModel,
 * VaultNamespaceStateModel, VaultUserViewModel), and pure-function
 * services (VaultPathMapper, VaultBlobHasher) are vi.mock'd so that
 * tests run without a real git bare repository or MongoDB instance.
 */
export {};
