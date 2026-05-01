import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMentionCompletionSource,
  type UserSuggestion,
} from './mentionAutocompletionSettings';

const mockUser = (username: string, name = ''): UserSuggestion => ({
  username,
  name,
});

const createContext = (
  doc: string,
  pos?: number,
  explicit = false,
): CompletionContext => {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos ?? doc.length, explicit);
};

describe('createMentionCompletionSource', () => {
  let mockFetchUsers: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetchUsers = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const invoke = (doc: string) => {
    const source = createMentionCompletionSource(mockFetchUsers);
    const promise = source(createContext(doc));
    vi.runAllTimers();
    return promise;
  };

  describe('trigger detection', () => {
    it('triggers on @a (@ followed by one character)', async () => {
      mockFetchUsers.mockResolvedValue([mockUser('alice', 'Alice')]);
      const result = await invoke('@a');
      expect(result).not.toBeNull();
      expect(mockFetchUsers).toHaveBeenCalledWith('a');
    });

    it('triggers on @abc and passes query without @', async () => {
      mockFetchUsers.mockResolvedValue([mockUser('abc', 'Abc')]);
      const result = await invoke('hello @abc');
      expect(result).not.toBeNull();
      expect(mockFetchUsers).toHaveBeenCalledWith('abc');
    });

    it('does not trigger on bare word without @', async () => {
      const result = await invoke('alice');
      expect(result).toBeNull();
      expect(mockFetchUsers).not.toHaveBeenCalled();
    });

    it('does not trigger on @ alone (no character after @)', async () => {
      const result = await invoke('@');
      expect(result).toBeNull();
      expect(mockFetchUsers).not.toHaveBeenCalled();
    });

    it('does not trigger on email-style text (word character before @)', async () => {
      const result = await invoke('user@example.com');
      expect(result).toBeNull();
      expect(mockFetchUsers).not.toHaveBeenCalled();
    });
  });

  describe('result shape', () => {
    it('sets from to the position of the @ symbol', async () => {
      mockFetchUsers.mockResolvedValue([mockUser('alice')]);
      const result = await invoke('hello @ali');
      expect(result?.from).toBe(6);
    });

    it('uses @username as label for each option', async () => {
      mockFetchUsers.mockResolvedValue([
        mockUser('alice', 'Alice'),
        mockUser('bob', 'Bob'),
      ]);
      const result = await invoke('@a');
      expect(result?.options.map((o) => o.label)).toEqual(['@alice', '@bob']);
    });

    it('includes user name as detail when present', async () => {
      mockFetchUsers.mockResolvedValue([mockUser('alice', 'Alice Smith')]);
      const result = await invoke('@a');
      expect(result?.options[0].detail).toBe('Alice Smith');
    });
  });

  describe('maxMatches limit', () => {
    it('limits results to 10 when fetchUsers returns more', async () => {
      const users = Array.from({ length: 15 }, (_, i) =>
        mockUser(`user${i}`, `User ${i}`),
      );
      mockFetchUsers.mockResolvedValue(users);
      const result = await invoke('@user');
      expect(result?.options).toHaveLength(10);
    });

    it('returns all results when fetchUsers returns fewer than 10', async () => {
      mockFetchUsers.mockResolvedValue([
        mockUser('alice'),
        mockUser('bob'),
        mockUser('carol'),
      ]);
      const result = await invoke('@a');
      expect(result?.options).toHaveLength(3);
    });
  });

  describe('error handling', () => {
    it('returns null when fetchUsers throws', async () => {
      mockFetchUsers.mockRejectedValue(new Error('network error'));
      const result = await invoke('@a');
      expect(result).toBeNull();
    });

    it('returns null when fetchUsers returns empty array', async () => {
      mockFetchUsers.mockResolvedValue([]);
      const result = await invoke('@a');
      expect(result).toBeNull();
    });
  });
});
