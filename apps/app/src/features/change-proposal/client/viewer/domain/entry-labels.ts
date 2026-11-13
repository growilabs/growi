import type { ProposalEntry } from '../../../interfaces';

export const ENTRY_LABEL_KEYS = {
  'ai-chat': 'change_proposal_viewer.entry.ai_chat',
  vault: 'change_proposal_viewer.entry.vault',
  mcp: 'change_proposal_viewer.entry.mcp',
  revert: 'change_proposal_viewer.entry.revert',
} as const satisfies Record<ProposalEntry, string>;
