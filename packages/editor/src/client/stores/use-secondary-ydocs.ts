import { useEffect } from 'react';
import useSWRImmutable from 'swr/immutable';
import * as Y from 'yjs';

type Configuration = {
  pageId?: string;
  useSecondary?: boolean;
};

type StoredYDocs = {
  primaryDoc: Y.Doc;
  secondaryDoc: Y.Doc | undefined;
};

type YDocsState = StoredYDocs & {
  activeDoc: Y.Doc;
};

export const useSecondaryYdocs = (
  isEnabled: boolean,
  configuration?: Configuration,
): YDocsState | null => {
  const { pageId, useSecondary = false } = configuration ?? {};
  const cacheKey = `swr-ydocs:${pageId}`;

  const { data: docs, mutate } = useSWRImmutable<StoredYDocs>(
    isEnabled && pageId ? cacheKey : null,
    () => {
      const primaryDoc = new Y.Doc();
      return { primaryDoc, secondaryDoc: undefined };
    },
  );

  useEffect(() => {
    if (docs == null) return;

    // create secondaryDoc if needed
    if (useSecondary && docs.secondaryDoc == null) {
      const secondaryDoc = new Y.Doc();
      mutate({ ...docs, secondaryDoc }, false);

      // apply primaryDoc state to secondaryDoc
      Y.applyUpdate(secondaryDoc, Y.encodeStateAsUpdate(docs.primaryDoc));
    }
    // destroy secondaryDoc
    else if (!useSecondary && docs.secondaryDoc != null) {
      docs.secondaryDoc.destroy();
      mutate({ ...docs, secondaryDoc: undefined }, false);
    }

    // cleanup
    return () => {
      if (!isEnabled) {
        docs.primaryDoc.destroy();
        docs.secondaryDoc?.destroy();
      }
    };
  }, [docs, isEnabled, useSecondary, mutate]);

  if (
    docs?.primaryDoc == null ||
    (useSecondary && docs?.secondaryDoc == null)
  ) {
    return null;
  }

  return {
    activeDoc: docs.secondaryDoc ?? docs.primaryDoc,
    primaryDoc: docs.primaryDoc,
    secondaryDoc: docs.secondaryDoc,
  };
};
