import type {
  OperationStatus,
  OperationType,
  ProposalEntry,
  ProposalStatus,
} from '../../../interfaces';
import type { RevertProgressEntry } from '../domain';

export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export type StatusAppearance = {
  readonly tone: StatusTone;
  // A Material Symbols ligature name; the word next to it carries the meaning.
  readonly icon: string;
};

export const PROPOSAL_STATUS_APPEARANCE = {
  pending: { tone: 'info', icon: 'schedule' },
  applied: { tone: 'success', icon: 'check_circle' },
  'partially-applied': { tone: 'info', icon: 'incomplete_circle' },
  reverted: { tone: 'neutral', icon: 'undo' },
  'partially-reverted': { tone: 'neutral', icon: 'undo' },
  'not-applied': { tone: 'neutral', icon: 'do_not_disturb_on' },
  discarded: { tone: 'neutral', icon: 'cancel' },
  expired: { tone: 'neutral', icon: 'timer_off' },
  withdrawn: { tone: 'neutral', icon: 'cancel' },
} as const satisfies Record<ProposalStatus, StatusAppearance>;

// 'stale' stays neutral: it is a skip, not an error to act on (requirement 11.5).
export const OPERATION_STATUS_APPEARANCE = {
  pending: { tone: 'info', icon: 'schedule' },
  applied: { tone: 'success', icon: 'check_circle' },
  failed: { tone: 'danger', icon: 'error' },
  stale: { tone: 'neutral', icon: 'skip_next' },
  skipped: { tone: 'neutral', icon: 'skip_next' },
  reverted: { tone: 'neutral', icon: 'undo' },
  'revert-refused': { tone: 'warning', icon: 'block' },
} as const satisfies Record<OperationStatus, StatusAppearance>;

export const REVERT_PROGRESS_APPEARANCE = {
  'in-progress': { tone: 'info', icon: 'progress_activity' },
  reverted: { tone: 'success', icon: 'check_circle' },
  'revert-refused': { tone: 'warning', icon: 'block' },
  skipped: { tone: 'neutral', icon: 'skip_next' },
  'not-targeted': { tone: 'neutral', icon: 'remove' },
} as const satisfies Record<RevertProgressEntry['state'], StatusAppearance>;

export const OPERATION_TYPE_ICONS = {
  edit: 'edit_note',
  create: 'note_add',
  move: 'drive_file_move',
  'delete-completely': 'delete_forever',
} as const satisfies Record<OperationType, string>;

export const ENTRY_ICONS = {
  'ai-chat': 'smart_toy',
  vault: 'folder_open',
  mcp: 'hub',
  revert: 'undo',
} as const satisfies Record<ProposalEntry, string>;
