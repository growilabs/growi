import type {
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';

export interface UserSuggestion {
  username: string;
  name: string;
}

export type FetchUsersFn = (query: string) => Promise<UserSuggestion[]>;

const MENTION_TRIGGER_REGEX = /(?<!\w)@[\w.-]+$/;

const MAX_MATCHES = 10;

const buildResult = (
  from: number,
  users: UserSuggestion[],
): CompletionResult => ({
  from,
  options: users.slice(0, MAX_MATCHES).map((user) => ({
    label: `@${user.username}`,
    detail: user.name || undefined,
  })),
});

export const createMentionCompletionSource = (fetchUsers: FetchUsersFn) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingResolve: ((result: CompletionResult | null) => void) | null = null;

  return (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(MENTION_TRIGGER_REGEX);
    if (!match) return Promise.resolve(null);

    const query = match.text.slice(1);

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      pendingResolve?.(null);
      pendingResolve = null;
    }

    return new Promise<CompletionResult | null>((resolve) => {
      pendingResolve = resolve;
      timer = setTimeout(async () => {
        timer = null;
        pendingResolve = null;

        if (context.aborted) {
          resolve(null);
          return;
        }

        let users: UserSuggestion[];
        try {
          users = await fetchUsers(query);
        } catch {
          resolve(null);
          return;
        }

        if (context.aborted || users.length === 0) {
          resolve(null);
          return;
        }

        resolve(buildResult(match.from, users));
      }, 300);
    });
  };
};

export const createMentionCompletionExtension = (
  fetchUsers: FetchUsersFn,
): Extension => {
  return markdownLanguage.data.of({
    autocomplete: createMentionCompletionSource(fetchUsers),
  });
};
