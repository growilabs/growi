/**
 * VaultNamespaceBuilder
 *
 * Executes a single VaultInstructionDoc and updates the corresponding
 * namespace ref(s) inside the shared bare repository.
 *
 * Supported ops:
 *  - upsert            — add or update a single page blob in a namespace tree
 *  - remove            — delete a single page blob from a namespace tree
 *  - bulk-upsert       — add or update N page blobs in one commit (concurrency 16)
 *  - rename-prefix     — move a subtree within the same namespace (no blob re-write)
 *  - grant-change-prefix — move a subtree between two namespaces
 *  - reset-all         — delete all namespace refs and clear state; keep object pool
 *
 * All ops are idempotent: submitting the same instruction twice produces the
 * same resulting commit OID (content-addressed git objects + deterministic
 * file paths guarantee convergence).
 */
import type { VaultInstructionDoc } from '@growi/core/dist/interfaces/vault';
/**
 * Applies a single VaultInstructionDoc to the shared bare repository.
 *
 * The function dispatches to the appropriate op handler based on
 * `instruction.op` and resolves when all git objects, refs, and
 * MongoDB state have been updated atomically within each namespace.
 *
 * Idempotency guarantee: submitting the same instruction twice converges
 * to the same commit OID because git object storage is content-addressed
 * and VaultPathMapper is a pure function.
 *
 * @param instruction - The instruction document to process.
 */
export declare function applyInstruction(
  instruction: VaultInstructionDoc,
): Promise<void>;
