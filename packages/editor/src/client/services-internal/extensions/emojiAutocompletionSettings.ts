import {
  autocompletion,
  type Completion,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import nativeLookup from '@growi/emoji-mart-data';

/**
 * A single `addToOptions` entry as accepted by {@link autocompletion}. Derived
 * from the (non-exported) config type so the render signature stays in sync with
 * `@codemirror/autocomplete` without a type assertion.
 */
type AddToOption = NonNullable<
  NonNullable<Parameters<typeof autocompletion>[0]>['addToOptions']
>[number];

const emojiOptions: Completion[] = Object.keys(nativeLookup).map((tag) => ({
  label: `:${tag}:`,
  type: tag,
}));

const TWO_OR_MORE_WORD_CHARACTERS_REGEX = /:\w{2,}$/;

// EmojiCompletionSource is activated when two characters are entered into the editor.
export const emojiCompletionSource: CompletionSource = (context) => {
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

export const emojiRenderOption: AddToOption = {
  render: (completion) => {
    const emojiName = completion.type ?? '';
    const emoji = nativeLookup[emojiName]?.skins[0].native ?? '';

    const element = document.createElement('span');
    element.innerHTML = emoji;
    return element;
  },
  position: 20,
};

export const emojiAutocompletionSettings = autocompletion({
  addToOptions: [emojiRenderOption],
  icons: false,
  override: [emojiCompletionSource],
});
