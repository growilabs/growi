/**
 * VaultBlobHasher
 *
 * Computes the git blob OID (SHA-1) for arbitrary content using isomorphic-git.
 * Because git object addressing is content-based, the same content always
 * produces the same OID — the fundamental invariant that makes no-op writes
 * safe in VaultRepoStorage.
 *
 * This module exposes a single pure function; no state or I/O is required.
 */

import git from 'isomorphic-git';

/**
 * Computes the 40-character hexadecimal SHA-1 OID that git would assign to
 * the given content when stored as a blob object.
 *
 * The calculation follows git's canonical blob format:
 *   `blob <byte-length>\0<content>`
 * This matches what `git hash-object` produces on the command line.
 *
 * @param content - Raw bytes or UTF-8 string to hash.
 * @returns A 40-character lowercase hexadecimal SHA-1 string.
 */
export async function hashBlob(content: Buffer | string): Promise<string> {
  // isomorphic-git's hashBlob accepts Uint8Array or string and returns
  // { oid, type, object, format } — we only need the OID.
  const result = await git.hashBlob({
    object: content instanceof Buffer ? content : content,
  });
  return result.oid;
}
