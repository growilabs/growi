import {
  autocompletion,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import emojiData from '@emoji-mart/data';

const getEmojiDataArray = (): string[] => {
  const rawEmojiDataArray = emojiData.categories;

  const emojiCategoriesData = [
    'people',
    'nature',
    'foods',
    'activity',
    'places',
    'objects',
    'symbols',
    'flags',
  ];

  const fixedEmojiDataArray: string[] = [];

  emojiCategoriesData.forEach((value) => {
    const tempArray = rawEmojiDataArray.find(
      (obj: { id: string }) => obj.id === value,
    )?.emojis;

    if (tempArray == null) {
      return;
    }

    fixedEmojiDataArray.push(...tempArray);
  });

  return fixedEmojiDataArray;
};

const emojiDataArray = getEmojiDataArray();

const emojiOptions = emojiDataArray.map((tag) => ({
  label: `:${tag}:`,
  type: tag,
}));

const TWO_OR_MORE_WORD_CHARACTERS_REGEX = /:\w{2,}$/;

// EmojiAutocompletion is activated when two characters are entered into the editor.
const emojiAutocompletion = (context: CompletionContext) => {
  const nodeBefore = syntaxTree(context.state).resolveInner(context.pos, -1);
  const textBefore = context.state.sliceDoc(nodeBefore.from, context.pos);
  const emojiBefore = TWO_OR_MORE_WORD_CHARACTERS_REGEX.exec(textBefore);

  if (!emojiBefore && !context.explicit) return null;

  return {
    from: emojiBefore ? nodeBefore.from + emojiBefore.index : context.pos,
    options: emojiOptions,
    validFor: TWO_OR_MORE_WORD_CHARACTERS_REGEX,
  };
};

export const emojiAutocompletionSettings = autocompletion({
  addToOptions: [
    {
      render: (completion: Completion) => {
        const emojiName = completion.type ?? '';
        const emoji = emojiData.emojis[emojiName].skins[0].native;

        const element = document.createElement('span');
        element.innerHTML = emoji;
        return element;
      },
      position: 20,
    },
  ],
  icons: false,
  override: [emojiAutocompletion],
});
