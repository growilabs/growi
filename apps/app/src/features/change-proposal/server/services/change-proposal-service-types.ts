import type { IUserHasId } from '@growi/core';

import type {
  ApplyResult,
  ApplyTrigger,
  BasedOn,
  CreatableEntry,
  CreatableOperationInput,
} from '../../interfaces';
import type { CreateInputRejection } from './normalize-create-input';

export type ServiceError =
  // missing, not requester, or nothing the caller may see — one shape
  | { readonly code: 'not-found' }
  | { readonly code: 'not-open' }
  | {
      readonly code: 'input-rejected';
      readonly rejection: CreateInputRejection;
    }
  | { readonly code: 'feature-disabled' }
  | { readonly code: 'daily-limit-reached'; readonly max: number }
  | { readonly code: 'target-unavailable'; readonly index: number }
  | { readonly code: 'base-revision-mismatch'; readonly index: number }
  | { readonly code: 'user-not-allowed' }
  // missing base, other requester's, or a revert proposal — one shape
  | { readonly code: 'based-on-unavailable' }
  | {
      readonly code: 'based-on-operation-not-eligible';
      readonly operationKey?: string;
    };

export type ServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ServiceError };

export type CreateProposalRequest = {
  // null stands for a guest
  readonly requester: IUserHasId | null;
  readonly entry: CreatableEntry;
  readonly modelLabel?: string;
  readonly operations: readonly CreatableOperationInput[];
  readonly request?: RequestParameters;
  // request: the caller route's activity is settled as CHANGE_PROPOSAL_CREATE
  readonly trigger?: ApplyTrigger;
  readonly basedOn?: BasedOn;
  readonly perPageNotifications?: boolean;
};

export type CreateProposalResult = {
  readonly proposalId: string;
  // null when nothing was due for auto-apply
  readonly apply: ApplyResult | null;
};

export type RequestParameters = {
  readonly ip?: string;
  readonly endpoint?: string;
};

// Operation keys; a chosen key also approves the other pending operations on its page.
export type ApprovalTargets = readonly string[] | 'all';
