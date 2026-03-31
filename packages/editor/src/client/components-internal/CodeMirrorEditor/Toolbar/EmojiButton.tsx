import {
  type ComponentType,
  type CSSProperties,
  type JSX,
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, UncontrolledTooltip } from 'reactstrap';

import { useResolvedTheme } from '../../../../states/ui/resolved-theme';
import { useCodeMirrorEditorIsolated } from '../../../stores/codemirror-editor';

type PickerProps = {
  onEmojiSelect: (emoji: { shortcodes: string }) => void;
  theme: string | undefined;
  data: unknown;
};

type Props = {
  editorKey: string;
};

export const EmojiButton = (props: Props): JSX.Element => {
  const { editorKey } = props;

  const id = useId();
  const { t } = useTranslation('commons');

  const [isOpen, setIsOpen] = useState(false);
  const [Picker, setPicker] = useState<ComponentType<PickerProps> | null>(null);
  const [emojiData, setEmojiData] = useState<unknown>(null);

  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey);
  const resolvedTheme = useResolvedTheme();
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  useEffect(() => {
    if (!isOpen || Picker != null) return;
    Promise.all([import('@emoji-mart/react'), import('@emoji-mart/data')]).then(
      ([pickerMod, dataMod]) => {
        setPicker(() => pickerMod.default as ComponentType<PickerProps>);
        setEmojiData(dataMod.default);
      },
    );
  }, [isOpen, Picker]);

  const selectEmoji = useCallback(
    (emoji: { shortcodes: string }): void => {
      if (!isOpen) {
        return;
      }

      codeMirrorEditor?.insertText(emoji.shortcodes);

      toggle();
    },
    [isOpen, toggle, codeMirrorEditor],
  );

  const setStyle = useCallback((): CSSProperties => {
    const view = codeMirrorEditor?.view;
    const cursorIndex = view?.state.selection.main.head;

    if (view == null || cursorIndex == null || !isOpen) {
      return {};
    }

    const offset = 20;
    const emojiPickerHeight = 420;
    const cursorRect = view.coordsAtPos(cursorIndex);
    const editorRect = view.dom.getBoundingClientRect();

    if (cursorRect == null) {
      return {};
    }

    // Emoji Picker bottom position exceed editor's bottom position
    if (cursorRect.bottom + emojiPickerHeight > editorRect.bottom) {
      return {
        top: editorRect.bottom - emojiPickerHeight,
        left: cursorRect.left + offset,
        position: 'fixed',
      };
    }
    return {
      top: cursorRect.top + offset,
      left: cursorRect.left + offset,
      position: 'fixed',
    };
  }, [isOpen, codeMirrorEditor]);

  return (
    <>
      <button
        id={id}
        type="button"
        className="btn btn-toolbar-button"
        onClick={toggle}
      >
        <span className="material-symbols-outlined fs-5">emoji_emotions</span>
      </button>
      <UncontrolledTooltip placement="top" target={CSS.escape(id)}>
        {t('toolbar.emoji')}
      </UncontrolledTooltip>
      {isOpen && Picker != null && emojiData != null && (
        <div className="mb-2 d-none d-md-block">
          <Modal
            isOpen={isOpen}
            toggle={toggle}
            backdropClassName="emoji-picker-modal"
            fade={false}
          >
            <span style={setStyle()}>
              <Picker
                onEmojiSelect={selectEmoji}
                theme={resolvedTheme}
                data={emojiData}
                // TODO: https://redmine.weseek.co.jp/issues/133681
                // i18n={}
              />
            </span>
          </Modal>
        </div>
      )}
    </>
  );
};
