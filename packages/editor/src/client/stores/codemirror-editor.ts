import { useMemo, useRef } from 'react';
import { useSWRStatic } from '@growi/core/dist/swr';
import { deepEquals } from '@growi/core/dist/utils';
import type {
  ReactCodeMirrorProps,
  UseCodeMirror,
} from '@uiw/react-codemirror';
import type { SWRResponse } from 'swr';
import deepmerge from 'ts-deepmerge';

import { type UseCodeMirrorEditor, useCodeMirrorEditor } from '../services';

const { isDeepEquals } = deepEquals;

const isValid = (u: UseCodeMirrorEditor) => {
  return u.state != null && u.view != null;
};

export const useCodeMirrorEditorIsolated = (
  key: string | null,
  container?: HTMLDivElement | null,
  props?: ReactCodeMirrorProps,
): SWRResponse<UseCodeMirrorEditor> => {
  const ref = useRef<UseCodeMirrorEditor | null>(null);
  const currentData = ref.current;

  const swrKey = key != null ? `codeMirrorEditor_${key}` : null;
  const mergedProps = useMemo<UseCodeMirror>(
    () => deepmerge({ container }, props ?? {}),
    [container, props],
  );

  const newData = useCodeMirrorEditor(mergedProps);

  const shouldUpdate =
    swrKey != null &&
    container != null &&
    (currentData == null ||
      (isValid(newData) && !isDeepEquals(currentData, newData)));

  if (shouldUpdate) {
    ref.current = newData;
  }

  return useSWRStatic(swrKey, shouldUpdate ? newData : undefined);
};
