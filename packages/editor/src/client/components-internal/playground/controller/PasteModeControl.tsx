import type { PasteMode } from '../../../../consts/index.js';
import { AllPasteMode } from '../../../../consts/index.js';
import { OutlineSecondaryButtons } from './OutlineSecondaryButtons.js';

type PasteModeControlProps = {
  setEditorPaste: (value: PasteMode) => void;
};

export const PasteModeControl = ({
  setEditorPaste,
}: PasteModeControlProps): JSX.Element => {
  return (
    <div className="row mt-5">
      <h2>Paste mode</h2>
      <div className="col">
        <OutlineSecondaryButtons<PasteMode>
          update={setEditorPaste}
          items={AllPasteMode}
        />
      </div>
    </div>
  );
};
