import {
  type ComponentType,
  type JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Modal } from 'reactstrap';

type EmojiMartSelection = { id: string; skin?: number };

type PickerProps = {
  onEmojiSelect: (emoji: EmojiMartSelection) => void;
  theme: string | undefined;
  data: unknown;
  skinTonePosition: 'preview' | 'search' | 'none';
};

/** Discriminated by `kind` so that other emoji sources can be added as further members. */
export type EmojiPickerSelection = {
  kind: 'native';
  id: string;
  skin?: number;
};

export type EmojiPickerProps = {
  isOpen: boolean;
  onSelect: (selection: EmojiPickerSelection) => void;
  onClose: () => void;
  theme?: 'light' | 'dark' | 'auto';
};

export const EmojiPicker = (props: EmojiPickerProps): JSX.Element | null => {
  const { isOpen, onSelect, onClose, theme } = props;

  const [Picker, setPicker] = useState<ComponentType<PickerProps> | null>(null);
  const [emojiData, setEmojiData] = useState<unknown>(null);

  // Keeps the load effect independent of the parent's callback identity.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || Picker != null) return;

    let cancelled = false;
    Promise.all([import('@emoji-mart/react'), import('@emoji-mart/data')])
      .then(([pickerMod, dataMod]) => {
        if (cancelled) return;
        setPicker(() => pickerMod.default as ComponentType<PickerProps>);
        setEmojiData(dataMod.default);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // biome-ignore lint/suspicious/noConsole: the editor package has no logger
        console.error('Failed to load the emoji picker:', error);
        // Lets the parent reset its open state so that the next open retries the load.
        onCloseRef.current();
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, Picker]);

  const handleEmojiSelect = useCallback(
    (emoji: EmojiMartSelection): void => {
      onSelect({ kind: 'native', id: emoji.id, skin: emoji.skin });
    },
    [onSelect],
  );

  if (!isOpen || Picker == null || emojiData == null) {
    return null;
  }

  return (
    <Modal
      isOpen
      toggle={onClose}
      centered
      fade={false}
      backdropClassName="emoji-picker-modal"
      contentClassName="border-0 bg-transparent shadow-none align-items-center"
    >
      <Picker
        onEmojiSelect={handleEmojiSelect}
        theme={theme}
        data={emojiData}
        skinTonePosition="search"
      />
    </Modal>
  );
};
