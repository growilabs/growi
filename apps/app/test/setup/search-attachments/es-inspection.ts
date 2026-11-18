/**
 * Reads Elasticsearch state over plain HTTP, independently of the client the
 * code under test uses, so integration tests assert what is really stored.
 */

export const elasticsearchOrigin = (): string => {
  // ELASTICSEARCH_URI is mapped from VITE_ELASTICSEARCH_URI by test/setup/elasticsearch.ts
  const uri = process.env.ELASTICSEARCH_URI;
  if (uri == null) throw new Error('ELASTICSEARCH_URI is not set');
  return new URL(uri).origin;
};

/** Names made unique per run: the tokenizer splits on letter/digit boundaries. */
export const uniqueRunToken = (): string =>
  `${process.env.VITEST_WORKER_ID ?? '1'}${Date.now()}${Math.floor(Math.random() * 1e6)}`.replace(
    /[0-9]/g,
    (d) => 'abcdefghij'[Number(d)],
  );

export const indexExists = async (name: string): Promise<boolean> =>
  (await fetch(`${elasticsearchOrigin()}/${name}`, { method: 'HEAD' })).ok;

/** The concrete indices the alias points to; empty when the alias is missing. */
export const aliasTargets = async (alias: string): Promise<string[]> => {
  const res = await fetch(`${elasticsearchOrigin()}/_alias/${alias}`);
  if (res.status === 404) return [];
  return Object.keys((await res.json()) as Record<string, unknown>).sort();
};

export const refreshIndex = async (index: string): Promise<void> => {
  const res = await fetch(`${elasticsearchOrigin()}/${index}/_refresh`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`refresh of ${index} failed: ${res.status}`);
  }
};

export type StoredDoc = { _id: string; _source: Record<string, unknown> };

/** The docs of one attachment in `index` (an alias or a concrete index), after a refresh. */
export const docsOfAttachment = async (
  index: string,
  attachmentId: string,
): Promise<StoredDoc[]> => {
  await refreshIndex(index);
  const res = await fetch(`${elasticsearchOrigin()}/${index}/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: 100,
      query: { term: { attachmentId } },
    }),
  });
  if (!res.ok) {
    throw new Error(`search of ${index} failed: ${res.status}`);
  }
  const json = (await res.json()) as { hits: { hits: StoredDoc[] } };
  return [...json.hits.hits].sort((a, b) => a._id.localeCompare(b._id));
};

export const countDocs = async (index: string): Promise<number> => {
  await refreshIndex(index);
  const res = await fetch(`${elasticsearchOrigin()}/${index}/_count`);
  return ((await res.json()) as { count: number }).count;
};

export const setWriteBlock = async (
  index: string,
  blocked: boolean,
): Promise<void> => {
  const res = await fetch(`${elasticsearchOrigin()}/${index}/_settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'index.blocks.write': blocked }),
  });
  if (!res.ok) {
    throw new Error(`setting the write block on ${index} failed`);
  }
};

export const deleteIndices = async (
  names: readonly string[],
): Promise<void> => {
  await Promise.all(
    names.map((name) =>
      fetch(`${elasticsearchOrigin()}/${name}?ignore_unavailable=true`, {
        method: 'DELETE',
      }),
    ),
  );
};
