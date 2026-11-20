/**
 * The partial-clone filters this server serves.
 *
 * A clone transfers every object in the requester's view, which for a long-lived
 * wiki is dominated by the current snapshot rather than by history (each view's
 * history is squashed to a parentless commit — requirement 6). `git
 * sparse-checkout` alone does not help: it only decides what is written into the
 * working tree, not what the server sends.
 *
 * What does shrink the transfer is a partial-clone filter, and of git's filters
 * only `sparse:oid=<blob>` applies the exclusion **on the server**: it names a
 * blob holding sparse-checkout patterns, and upload-pack leaves out the file
 * bodies those patterns exclude. The client therefore receives everything it
 * needs in one response and never asks for a single object afterwards, which is
 * what keeps the request compatible with the want guard (requirements 5.6–5.8):
 * one want, a few hundred bytes, no per-object follow-up.
 *
 * The other filters (`blob:none`, `blob:limit`, `tree:<n>`, `object:type`,
 * `combine:`) all defer objects for the client to fetch by name later, which the
 * want guard refuses — so they are refused up front instead, with a message that
 * says what to use (requirement 5.9). `sparse:path` is not a choice at all: git
 * dropped it because it let a client name any path on the server.
 *
 * A spec is only served when the server published it (requirement 5.10). Without
 * that, a client could point the filter at any object whose name it knows and
 * learn something from which paths came back.
 */

import { createHash } from 'node:crypto';

import { updateRef, writeBlob } from './vault-repo-storage.js';

// ---------------------------------------------------------------------------
// Published specs
// ---------------------------------------------------------------------------

/** A sparse-checkout pattern set the server offers as a partial-clone filter. */
export interface SparseFilterSpec {
  /** Ref name segment the spec is anchored under; also its public name. */
  readonly name: string;
  /**
   * The patterns, byte for byte as git will read them. Changing these changes
   * the object name clients pass, so they are effectively part of the public
   * interface — see the README.
   */
  readonly patterns: string;
}

/**
 * Every spec clients may name in `--filter=sparse:oid=<oid>`.
 *
 * Non-cone patterns, because an exclusion cannot be expressed in cone mode.
 * The client sets the same patterns locally with `git sparse-checkout`, so that
 * its checkout asks for nothing the server left out.
 */
export const PUBLISHED_SPARSE_FILTERS: readonly SparseFilterSpec[] = [
  { name: 'exclude-user-pages', patterns: '/*\n!/user\n' },
];

/** Ref namespace the published specs are anchored under. */
const SPARSE_FILTER_REF_PREFIX = 'refs/vault/sparse-filters';

/** Prefix of a filter that names a blob of sparse-checkout patterns. */
const SPARSE_OID_PREFIX = 'sparse:oid=';

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Ref a published spec is anchored under.
 *
 * The ref exists so the blob stays reachable: an unreferenced object is removed
 * by the maintenance gc (requirement 6.4), and the object name published in the
 * README would then stop resolving. It lives outside `refs/namespaces/`, so no
 * view advertises it.
 *
 * @param name - Spec name.
 * @returns Ref path relative to the git directory.
 */
export function sparseFilterRefPath(name: string): string {
  return `${SPARSE_FILTER_REF_PREFIX}/${name}`;
}

/**
 * Object name git gives a spec's patterns.
 *
 * Computed rather than read back from the repository, so the value a request is
 * checked against never depends on the repository being in any particular state
 * (a check that cannot resolve its allowed set would have to refuse everything).
 * `installSparseFilters` asserts that git agrees.
 *
 * @param spec - The spec whose object name is wanted.
 * @returns 40-character SHA-1 object name.
 */
export function sparseFilterOid(spec: SparseFilterSpec): string {
  const body = Buffer.from(spec.patterns, 'utf8');
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8');
  return createHash('sha1')
    .update(Buffer.concat([header, body]))
    .digest('hex');
}

/**
 * Returns the filters in a request that this server does not serve.
 *
 * @param filters - Filter specs taken from the request's want section.
 * @param specs - Specs the server publishes.
 * @returns The offending filter specs. Empty when every one may be served.
 */
export function findUnsupportedFilters(
  filters: readonly string[],
  specs: readonly SparseFilterSpec[],
): readonly string[] {
  const served = new Set(specs.map((spec) => sparseFilterOid(spec)));

  return filters.filter((filter) => {
    if (!filter.startsWith(SPARSE_OID_PREFIX)) {
      return true;
    }
    return !served.has(filter.slice(SPARSE_OID_PREFIX.length).trim());
  });
}

/**
 * Writes every published spec into the bare repository and anchors it to a ref.
 *
 * Idempotent: the blob is content-addressed and the ref write is a replace, so
 * running this at every boot costs one object write per spec.
 *
 * @param specs - Specs to publish.
 * @throws When git names a spec's patterns differently than `sparseFilterOid`
 *   does, which would leave the published object name unresolvable.
 */
export async function installSparseFilters(
  specs: readonly SparseFilterSpec[],
): Promise<void> {
  for (const spec of specs) {
    // biome-ignore lint/performance/noAwaitInLoops: a handful of specs, written once at boot; sequential keeps the failure attributable to one spec
    const oid = await writeBlob(Buffer.from(spec.patterns, 'utf8'));
    const expected = sparseFilterOid(spec);
    if (oid !== expected) {
      throw new Error(
        `Sparse filter '${spec.name}' was stored as ${oid} but is published as ${expected}`,
      );
    }
    await updateRef(sparseFilterRefPath(spec.name), oid);
  }
}
