import type { IUserHasId } from '@growi/core';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import {
  type ApplyResult,
  type BasedOn,
  type ChangeProposalDocument,
  MAX_TOTAL_BODY_BYTES,
  type ReviewerRef,
} from '../../interfaces';
import {
  type AutoApplyPageFacts,
  activeReviewers,
  selectAutoApplyTargets,
  validateBasedOn,
  validateProposalInput,
} from '../domain';
import type {
  CreateProposalRequest,
  CreateProposalResult,
  ServiceError,
  ServiceResult,
} from './change-proposal-service-types';
import { checkCreateTargets } from './check-create-targets';
import { checkGivenReviewers, inheritReviewers } from './create-reviewers';
import {
  createMaintenanceActions,
  type MaintenanceActions,
} from './maintenance-actions';
import type { WriteOriginalMark } from './mark-original-operation';
import {
  type NormalizedCreateInput,
  normalizeCreateInput,
} from './normalize-create-input';
import { isRequesterAllowed } from './pre-write-checks';
import { recordProposalActivity } from './proposal-activity';
import {
  createProposalApplier,
  type ProposalApplier,
} from './proposal-applier';
import type { AppliedListScan } from './proposal-list-query';
import { createProposalQuery, type ProposalQuery } from './proposal-query';
import {
  createRequesterActions,
  type RequesterActions,
} from './requester-actions';
import { createRevertAction, type RevertAction } from './revert-action';
import { createReviewNotifier, type ReviewNotifier } from './review-notifier';
import {
  createReviewerActions,
  type ReviewerActions,
} from './reviewer-actions';
import {
  type ChangeProposalSettings,
  readChangeProposalSettings,
} from './settings';

const logger = loggerFactory(
  'growi:features:change-proposal:services:change-proposal-service',
);

const BASED_ON_RELATIONS: readonly string[] = ['follow-up', 'rework'];

export type ChangeProposalService = RequesterActions &
  ReviewerActions &
  RevertAction &
  MaintenanceActions &
  ProposalQuery & {
    createProposal(
      input: CreateProposalRequest,
    ): Promise<ServiceResult<CreateProposalResult>>;
  };

export type ChangeProposalServiceDeps = {
  readonly applier?: ProposalApplier;
  readonly reviewNotifier?: ReviewNotifier;
  readonly now?: () => Date;
  readonly maintenanceBatchSize?: number;
  readonly appliedListScan?: AppliedListScan;
  readonly markRetryWait?: () => Promise<void>;
  readonly writeOriginalMark?: WriteOriginalMark;
};

const fail = (error: ServiceError): { ok: false; error: ServiceError } => ({
  ok: false,
  error,
});

const startOfServerDay = (now: Date): Date => {
  const since = new Date(now);
  since.setHours(0, 0, 0, 0);
  return since;
};

const isUsableBasedOnShape = (basedOn: BasedOn): boolean =>
  typeof basedOn.proposalId === 'string' &&
  BASED_ON_RELATIONS.includes(basedOn.relation) &&
  Array.isArray(basedOn.operationKeys) &&
  basedOn.operationKeys.every((key) => typeof key === 'string');

const checkBasedOn = async (
  basedOn: BasedOn,
  requesterId: string,
): Promise<
  | { ok: true; basedOn: BasedOn; baseReviewers: readonly ReviewerRef[] }
  | { ok: false; error: ServiceError }
> => {
  if (!isUsableBasedOnShape(basedOn)) {
    return fail({ code: 'based-on-unavailable' });
  }
  const base = await prisma.changeproposals.findProposal(basedOn.proposalId);
  const checked = validateBasedOn(basedOn, base, requesterId);
  return checked.ok
    ? { ...checked, baseReviewers: base?.reviewers ?? [] }
    : fail(checked.rejection);
};

// Reviewers given at creation win over the base's; a follow-up or rework without them inherits.
const checkBasedOnAndReviewers = async (
  basedOn: BasedOn | undefined,
  givenReviewers: readonly ReviewerRef[] | undefined,
  requesterId: string,
  now: Date,
): Promise<
  | { ok: true; basedOn?: BasedOn; reviewers: readonly ReviewerRef[] }
  | { ok: false; error: ServiceError }
> => {
  if (basedOn == null) {
    return { ok: true, reviewers: givenReviewers ?? [] };
  }
  const based = await checkBasedOn(basedOn, requesterId);
  if (!based.ok) {
    return based;
  }
  return {
    ok: true,
    basedOn: based.basedOn,
    reviewers:
      givenReviewers ?? inheritReviewers(based.baseReviewers, requesterId, now),
  };
};

const checkCreateInput = (
  input: CreateProposalRequest,
  settings: ChangeProposalSettings,
):
  | { ok: true; normalized: NormalizedCreateInput }
  | { ok: false; error: ServiceError } => {
  const shaped = normalizeCreateInput(input);
  if (!shaped.ok) {
    return fail({ code: 'input-rejected', rejection: shaped.rejection });
  }
  const validated = validateProposalInput(shaped.value.operations, {
    maxOperations: settings.maxOperationsPerProposal,
    maxTotalBodyBytes: MAX_TOTAL_BODY_BYTES,
    enabledOperationTypes: settings.enabledOperationTypes,
  });
  if (!validated.ok) {
    return fail({ code: 'input-rejected', rejection: validated.rejection });
  }
  return { ok: true, normalized: shaped.value };
};

const checkDailyLimit = async (
  requesterId: string,
  dailyMax: number | null,
  now: Date,
): Promise<{ ok: false; error: ServiceError } | null> =>
  dailyMax != null &&
  (await prisma.changeproposals.countCreatedSince(
    requesterId,
    startOfServerDay(now),
  )) >= dailyMax
    ? fail({ code: 'daily-limit-reached', max: dailyMax })
    : null;

// Everything the requester could be refused for; nothing is written. The feature switch is checked before the input shape because a disabled feature needs no further reads.
const checkCreateRequest = async (
  input: CreateProposalRequest,
  settings: ChangeProposalSettings,
  now: Date,
): Promise<
  | {
      ok: true;
      requester: IUserHasId;
      normalized: NormalizedCreateInput;
      pageFacts: ReadonlyMap<string, AutoApplyPageFacts>;
      basedOn?: BasedOn;
      reviewers: readonly ReviewerRef[];
    }
  | { ok: false; error: ServiceError }
> => {
  const { requester } = input;
  if (!isRequesterAllowed(requester)) {
    return fail({ code: 'user-not-allowed' });
  }
  if (!settings.isEnabled) {
    return fail({ code: 'feature-disabled' });
  }
  const shaped = checkCreateInput(input, settings);
  if (!shaped.ok) {
    return shaped;
  }
  const { normalized } = shaped;

  const requesterId = requester._id.toString();
  const given = await checkGivenReviewers(
    normalized.reviewers,
    requesterId,
    settings.isReviewersEnabled,
    now,
  );
  if (!given.ok) {
    return given;
  }

  const overLimit = await checkDailyLimit(
    requesterId,
    settings.maxProposalsPerUserPerDay,
    now,
  );
  if (overLimit != null) {
    return overLimit;
  }

  const targets = await checkCreateTargets(normalized.operations, requester);
  if (!targets.ok) {
    return targets;
  }

  const based = await checkBasedOnAndReviewers(
    input.basedOn,
    given.reviewers,
    requesterId,
    now,
  );
  if (!based.ok) {
    return based;
  }
  return { ...based, requester, normalized, pageFacts: targets.pageFacts };
};

export const createChangeProposalService = (
  crowi: Crowi,
  deps: ChangeProposalServiceDeps = {},
): ChangeProposalService => {
  const applier = deps.applier ?? createProposalApplier(crowi);
  const reviewNotifier = deps.reviewNotifier ?? createReviewNotifier(crowi);
  const now = deps.now ?? (() => new Date());

  // With a reviewer other than the requester, auto-apply writes nothing, so the saved proposal is current (tasks.md 3.3).
  const notifyReviewers = async (
    proposal: ChangeProposalDocument,
    activityId: string,
  ): Promise<void> => {
    const candidates = activeReviewers(proposal.reviewers);
    if (candidates.length === 0) {
      return;
    }
    await reviewNotifier.notifyReviewRequest({
      proposal,
      candidates,
      actorId: proposal.requester,
      activityId,
    });
  };

  const approveAndApply = async (
    proposal: ChangeProposalDocument,
    settings: ChangeProposalSettings,
    pageFacts: ReadonlyMap<string, AutoApplyPageFacts>,
    request: CreateProposalRequest['request'],
  ): Promise<ApplyResult | null> => {
    const targetIndices = new Set(
      selectAutoApplyTargets(
        settings.autoApplyPolicy,
        proposal.operations,
        pageFacts,
        proposal.requester,
        proposal.basedOn?.relation ?? null,
        proposal.reviewers,
      ),
    );
    const keys = proposal.operations
      .filter((op) => targetIndices.has(op.index))
      .map((op) => op.key);
    if (keys.length === 0) {
      return null;
    }

    try {
      const approved = await prisma.changeproposals.markApproved(
        proposal._id,
        proposal.requester,
        keys,
        now(),
      );
      if (!approved.ok) {
        return null;
      }
    } catch (err) {
      // Nothing was approved: the proposal simply waits for the requester.
      logger.error(
        { err, proposalId: proposal._id },
        'Approving the auto-apply targets of a new change proposal failed',
      );
      return null;
    }

    try {
      // One activity id settles one action, so the apply always mints its own.
      return await applier.apply(proposal._id, { kind: 'background' }, request);
    } catch (err) {
      // The approvals are saved, so the maintenance cron resumes the apply.
      logger.error(
        { err, proposalId: proposal._id },
        'Auto-apply right after creating a change proposal failed',
      );
      return { type: 'in-progress' };
    }
  };

  return {
    ...createRequesterActions(),
    ...createReviewerActions({ crowi, applier, reviewNotifier, now }),
    ...createRevertAction({
      applier,
      now,
      deletePermission: crowi,
      markRetryWait: deps.markRetryWait,
      writeOriginalMark: deps.writeOriginalMark,
    }),
    ...createProposalQuery({
      appliedListScan: deps.appliedListScan,
      deletePermission: crowi,
    }),
    ...createMaintenanceActions({
      applier,
      now,
      batchSize: deps.maintenanceBatchSize,
    }),
    async createProposal(input) {
      const settings = readChangeProposalSettings();
      const createdAt = now();
      const checked = await checkCreateRequest(input, settings, createdAt);
      if (!checked.ok) {
        return checked;
      }
      const { requester, normalized, pageFacts, basedOn, reviewers } = checked;

      const proposal = await prisma.changeproposals.createProposal({
        requester: requester._id.toString(),
        entry: normalized.entry,
        modelLabel: normalized.modelLabel,
        purpose: normalized.purpose,
        reviewers,
        basedOn,
        perPageNotifications:
          typeof input.perPageNotifications === 'boolean'
            ? input.perPageNotifications
            : true,
        expiresAt:
          settings.pendingExpirationSeconds == null
            ? undefined
            : new Date(
                createdAt.getTime() + settings.pendingExpirationSeconds * 1000,
              ),
        operations: normalized.operations,
      });

      const { activityId } = recordProposalActivity(crowi, {
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_CREATE,
        proposalId: proposal._id,
        operator: requester,
        trigger: input.trigger ?? { kind: 'background' },
        request: input.request,
      });

      const apply = await approveAndApply(
        proposal,
        settings,
        pageFacts,
        input.request,
      );
      await notifyReviewers(proposal, activityId);
      return { ok: true, value: { proposalId: proposal._id, apply } };
    },
  };
};
