import {
  autocompletion,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import nativeLookup from '@growi/emoji-mart-data';

const emojiOptions: Completion[] = Object.keys(nativeLookup).map((tag) => ({
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

export const emojiAutocompletionSettings = [
  autocompletion({
    addToOptions: [
      {
        render: (completion: Completion) => {
          const emojiName = completion.type ?? '';
          const emoji = nativeLookup[emojiName]?.skins[0].native ?? '';

          const element = document.createElement('span');
          element.innerHTML = emoji;
          return element;
        },
        position: 20,
      },
    ],
    icons: false,
  }),
  markdownLanguage.data.of({ autocomplete: emojiAutocompletion }),
];
