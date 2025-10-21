import type { KeyMapMode } from '../../../../consts';
import { AllKeyMap } from '../../../../consts';
import { OutlineSecondaryButtons } from './OutlineSecondaryButtons';

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
