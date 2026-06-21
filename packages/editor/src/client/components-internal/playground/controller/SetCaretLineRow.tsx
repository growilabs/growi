import { useForm } from 'react-hook-form';

import { GlobalCodeMirrorEditorKey } from '../../../../consts';
import { useCodeMirrorEditorIsolated } from '../../../stores/codemirror-editor';

type SetCaretLineRowFormData = {
  lineNumber: number | string;
};

export const SetCaretLineRow = (): JSX.Element => {
  const { data } = useCodeMirrorEditorIsolated(GlobalCodeMirrorEditorKey.MAIN);
  const { register, handleSubmit } = useForm<SetCaretLineRowFormData>({
    defaultValues: {
      lineNumber: 1,
    },
  });

  const setCaretLine = data?.setCaretLine;
  const onSubmit = handleSubmit((submitData) => {
    const lineNumber = Number(submitData.lineNumber) || 1;
    setCaretLine?.(lineNumber);
  });

  return (
    <form className="row mt-3" onSubmit={onSubmit}>
      <div className="col">
        <div className="input-group">
          <input
            {...register('lineNumber')}
            type="number"
            className="form-control"
            placeholder="Input line number"
            aria-label="line number"
            aria-describedby="button-set-cursor"
          />
          <button
            type="submit"
            className="btn btn-outline-secondary"
            id="button-set-cursor"
          >
            Set the cursor
          </button>
        </div>
      </div>
    </form>
  );
};
