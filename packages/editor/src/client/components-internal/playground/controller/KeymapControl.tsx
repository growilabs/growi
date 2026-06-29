import type { KeyMapMode } from '../../../../consts/index.js';
import { AllKeyMap } from '../../../../consts/index.js';
import { OutlineSecondaryButtons } from './OutlineSecondaryButtons.js';

type KeymapControlProps = {
  setEditorKeymap: (value: KeyMapMode) => void;
};

export const KeymapControl = ({
  setEditorKeymap,
}: KeymapControlProps): JSX.Element => {
  return (
    <div className="row mt-5">
      <h2>Keymaps</h2>
      <div className="col">
        <OutlineSecondaryButtons<KeyMapMode>
          update={setEditorKeymap}
          items={AllKeyMap}
        />
      </div>
    </div>
  );
};
