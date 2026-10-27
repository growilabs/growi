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
} from '../../interfaces';
import {
  type AutoApplyPageFacts,
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
import {
  createMaintenanceActions,
  type MaintenanceActions,
} from './maintenance-actions';
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
import {
  type ChangeProposalSettings,
  readChangeProposalSettings,
} from './settings';

const logger = loggerFactory(
  'growi:features:change-proposal:services:change-proposal-service',
);

const BASED_ON_RELATIONS: readonly string[] = ['follow-up', 'rework'];

export type ChangeProposalService = RequesterActions &
  RevertAction &
  MaintenanceActions &
  ProposalQuery & {
    createProposal(
      input: CreateProposalRequest,
    ): Promise<ServiceResult<CreateProposalResult>>;
  };

export type ChangeProposalServiceDeps = {
  readonly applier?: ProposalApplier;
  readonly now?: () => Date;
  readonly maintenanceBatchSize?: number;
  readonly appliedListScan?: AppliedListScan;
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
  { ok: true; basedOn: BasedOn } | { ok: false; error: ServiceError }
> => {
  if (!isUsableBasedOnShape(basedOn)) {
    return fail({ code: 'based-on-unavailable' });
  }
  const base = await prisma.changeproposals.findProposal(basedOn.proposalId);
  const checked = validateBasedOn(basedOn, base, requesterId);
  return checked.ok ? checked : fail(checked.rejection);
};

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

  const requesterId = requester._id.toString();
  const dailyMax = settings.maxProposalsPerUserPerDay;
  if (
    dailyMax != null &&
    (await prisma.changeproposals.countCreatedSince(
      requesterId,
      startOfServerDay(now),
    )) >= dailyMax
  ) {
    return fail({ code: 'daily-limit-reached', max: dailyMax });
  }

  const targets = await checkCreateTargets(shaped.value.operations, requester);
  if (!targets.ok) {
    return targets;
  }

  if (input.basedOn == null) {
    return {
      ok: true,
      requester,
      normalized: shaped.value,
      pageFacts: targets.pageFacts,
    };
  }
  const based = await checkBasedOn(input.basedOn, requesterId);
  if (!based.ok) {
    return based;
  }
  return {
    ok: true,
    requester,
    normalized: shaped.value,
    pageFacts: targets.pageFacts,
    basedOn: based.basedOn,
  };
};

export const createChangeProposalService = (
  crowi: Crowi,
  deps: ChangeProposalServiceDeps = {},
): ChangeProposalService => {
  const applier = deps.applier ?? createProposalApplier(crowi);
  const now = deps.now ?? (() => new Date());

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
    ...createRequesterActions({ applier, now }),
    ...createRevertAction({ applier, now, pageService: crowi.pageService }),
    ...createProposalQuery({
      appliedListScan: deps.appliedListScan,
      pageService: crowi.pageService,
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
      const { requester, normalized, pageFacts, basedOn } = checked;

      const proposal = await prisma.changeproposals.createProposal({
        requester: requester._id.toString(),
        entry: normalized.entry,
        modelLabel: normalized.modelLabel,
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

      recordProposalActivity(crowi, {
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
      return { ok: true, value: { proposalId: proposal._id, apply } };
    },
  };
};
