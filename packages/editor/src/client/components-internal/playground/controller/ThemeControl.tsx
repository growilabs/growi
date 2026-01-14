import type { EditorTheme } from '../../../../consts';
import { AllEditorTheme } from '../../../../consts';
import { OutlineSecondaryButtons } from './OutlineSecondaryButtons';

type ThemeControlProps = {
  setEditorTheme: (value: EditorTheme) => void;
};

export const ThemeControl = ({
  setEditorTheme,
}: ThemeControlProps): JSX.Element => {
  return (
    <div className="row mt-5">
      <h2>Themes</h2>
      <div className="col">
        <OutlineSecondaryButtons<EditorTheme>
          update={setEditorTheme}
          items={AllEditorTheme}
        />
      </div>
    </div>
  );
};
