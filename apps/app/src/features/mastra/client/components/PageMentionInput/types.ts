import type { IUser, Ref } from '@growi/core';

/**
 * Display value object for a page-path search candidate.
 * Mapped from `IPageWithSearchMeta` (`data._id` / `data.path` / `data.creator`).
 */
export interface PagePathCandidate {
  readonly pageId: string;
  readonly path: string;
  /** Page creator, populated by the /search endpoint; rendered as an avatar. */
  readonly creator?: Ref<IUser> | null;
}

/**
 * Value object for a committed mention.
 * The source of truth for both the decoration and the submitted text is the
 * path string held in the editor doc.
 */
export interface MentionData {
  readonly path: string; // used for submission, display and navigation
  readonly pageId?: string; // optional (navigation can be derived from path)
}

/**
 * Transient state of the active `@` mention session.
 * Not persisted.
 */
export interface MentionSessionState {
  readonly active: boolean;
  readonly from: number; // position of "@"
  readonly to: number; // end of the query (= caret)
  readonly query: string; // search string right after "@" (may be empty)
}

/**
 * Bidirectional bridge between CodeMirror (imperative) and the React candidate
 * UI (declarative). Single entry point for search, highlight and commit.
 */
export interface MentionController {
  // --- state (subscribed by the candidate list) ---
  readonly isOpen: boolean;
  readonly query: string;
  readonly highlightedIndex: number;
  readonly candidates: readonly PagePathCandidate[];
  readonly isLoading: boolean;
  // --- operations (called by the keymap / candidate row click) ---
  moveUp(): void;
  moveDown(): void;
  /** Set the highlighted index directly (e.g. mouse hover from the candidate list). */
  setHighlightedIndex(index: number): void;
  commit(index?: number): void; // defaults to highlightedIndex
  close(): void;
}

/**
 * Props for the `PageMentionInput` React adapter.
 */
export interface PageMentionInputProps {
  value: string; // flattened path string (for submission / empty check)
  onChange: (value: string) => void; // returns the flatten result on each doc change
  placeholder?: string;
}
