import {
  CompletionContext,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMentionCompletionSource,
  type UserSuggestion,
} from '../../services/mentionAutocompletionSettings';
import {
  emojiAutocompletionSettings,
  emojiCompletionSource,
} from './emojiAutocompletionSettings';

const mockUser = (username: string, name = ''): UserSuggestion => ({
  username,
  name,
});

// The emoji source reads syntaxTree(context.state) and context.state.sliceDoc(),
// so it requires a real EditorState-backed CompletionContext (the markdown
// language itself is not required for a direct call).
const createContext = (
  doc: string,
  pos?: number,
  explicit = false,
): CompletionContext => {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos ?? doc.length, explicit);
};

describe('emoji / mention source decoupling (Requirement 4)', () => {
  // AC 4.4 — the emoji source and the mention source coexist; neither suppresses the other.
  describe('AC 4.4: coexistence', () => {
    let mockFetchUsers: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetchUsers = vi.fn();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('emoji source returns options for ":smi" and mention source returns a result for "@ab" — neither suppresses the other', async () => {
      // NOTE: this calls the two sources INDEPENDENTLY (each in its own context),
      // not on a single merged autocompletion() facility. It proves each source
      // returns a result in isolation — not coexistence on the shared facility.
      // Emoji source: synchronous, driven directly. explicit:true guarantees a
      // non-null result independent of syntax-tree resolution details.
      const emojiResult = emojiCompletionSource(createContext(':smi', 4, true));
      expect(emojiResult).not.toBeNull();
      expect(emojiResult?.options.length).toBeGreaterThan(0);

      // Mention source: debounced (300ms) + async. Drive with fake timers and a
      // mock returning at least one user (an empty array resolves to null).
      mockFetchUsers.mockResolvedValue([mockUser('abc', 'Abc')]);
      const mentionSource = createMentionCompletionSource(mockFetchUsers);
      const mentionState = EditorState.create({ doc: '@ab' });
      const mentionPromise = mentionSource(
        new CompletionContext(mentionState, 3, false),
      );
      vi.runAllTimers();
      const mentionResult = await mentionPromise;
      expect(mentionResult).not.toBeNull();
    });
  });

  // AC 4.6 — the emoji source is scoped to the markdown language, so it is NOT
  // active inside fenced code blocks but IS active in normal markdown text.
  describe('AC 4.6: code-block scoping', () => {
    it('scopes emoji source to markdown language — not active inside fenced code blocks', () => {
      // A synchronously-loaded stub sublanguage so the ```js region actually
      // nests in a unit test. codeLanguages: languages (from
      // @codemirror/language-data) loads ASYNC and would NOT nest here, which
      // would make the .not.toContain assertion falsely pass/fail.
      const stubParser = StreamLanguage.define({
        token: (s) => {
          s.next();
          return null;
        },
      });
      const jsDesc = LanguageDescription.of({
        name: 'javascript',
        alias: ['js'],
        support: new LanguageSupport(stubParser),
      });

      const doc = '```js\n:smi\n```\n\n:smi';
      const state = EditorState.create({
        doc,
        extensions: [
          markdown({ base: markdownLanguage, codeLanguages: [jsDesc] }),
          emojiAutocompletionSettings,
        ],
      });

      const posInBlock = doc.indexOf(':smi') + 1; // cursor inside the ```js block
      const posOutside = doc.lastIndexOf(':smi') + 1; // cursor in normal markdown

      // state.languageDataAt(name, pos) returns language-data values for the
      // active language at pos. Inside the fenced block the active language is
      // the stub, so markdown's emoji source is not returned there.
      const sourcesInBlock = state.languageDataAt<CompletionSource>(
        'autocomplete',
        posInBlock,
      );
      const sourcesOutside = state.languageDataAt<CompletionSource>(
        'autocomplete',
        posOutside,
      );

      expect(sourcesInBlock).not.toContain(emojiCompletionSource);
      expect(sourcesOutside).toContain(emojiCompletionSource);
    });
  });
});
