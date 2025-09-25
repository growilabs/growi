import { useCallback } from 'react';

import { GlobalCodeMirrorEditorKey } from '../../../../consts';
import { useCodeMirrorEditorIsolated } from '../../../stores/codemirror-editor';

export const InitEditorValueRow = (): JSX.Element => {
  const { data } = useCodeMirrorEditorIsolated(GlobalCodeMirrorEditorKey.MAIN);

  const initDoc = data?.initDoc;
  const initEditorValue = useCallback(() => {
    initDoc?.('# Header\n\n- foo\n-bar\n');
  }, [initDoc]);

  return (
    <div className="row">
      <div className="col">
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => initEditorValue()}
        >
          Initialize editor value
        </button>
      </div>
    </div>
  );
};
