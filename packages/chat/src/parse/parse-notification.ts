// Confirms the wire shape of a signed `NotificationRequest` before it is
// trusted anywhere downstream (Requirement 10.1). See parse-command.ts's
// header comment for why every parse* function here re-checks shape even
// though the body already passed signature verification.

import type {
  NotificationRequest,
  NotificationResult,
} from '../contract/notification.js';
import { OP_NAMES } from '../endpoints/op-names.js';
import { PLATFORM_NAMES } from './common-fields.js';
import { arr, isRecord, oneOf, str } from './shape.js';

const RELATION_ID_MAX = 128;
const REQUEST_ID_MAX = 128;
const CHANNEL_ID_MAX = 200;
/** A fan-out to a large but bounded number of channels in one request. */
const TARGETS_MAX = 500;
/** A notification body -- generous for a rendered markdown message. */
const MARKDOWN_MAX = 50_000;

type ParseError = { readonly error: 'malformed' };

type NotificationTarget = NotificationRequest['targets'][number];

const parseTarget = (v: unknown): NotificationTarget | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const platform = oneOf(v.platform, PLATFORM_NAMES);
  const channelId = str(v.channelId, CHANNEL_ID_MAX);

  if (platform === undefined || channelId === undefined) {
    return undefined;
  }

  return { platform, channelId };
};

export const parseNotificationRequest = (
  raw: unknown,
): NotificationRequest | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const relationId = str(raw.relationId, RELATION_ID_MAX);
  const op = oneOf(raw.op, [OP_NAMES.notification]);
  const requestId = str(raw.requestId, REQUEST_ID_MAX);
  const targets = arr(raw.targets, TARGETS_MAX, parseTarget);
  const markdown = str(raw.markdown, MARKDOWN_MAX);
  const containsRestrictedPage = raw.containsRestrictedPage;

  if (
    relationId === undefined ||
    op === undefined ||
    requestId === undefined ||
    targets === undefined ||
    markdown === undefined ||
    typeof containsRestrictedPage !== 'boolean'
  ) {
    return { error: 'malformed' };
  }

  return {
    relationId,
    op,
    requestId,
    targets,
    markdown,
    containsRestrictedPage,
  };
};

// ---------------------------------------------------------------------------
// parseNotificationResult (task 6.4)
//
// `NotificationResult` is proxy -> GROWI and carries no envelope
// (`relationId`/`op`) at all -- it is the per-target outcome list GROWI
// writes straight back into its outbox row (design.md's callout box on the
// "受け取るものは要求も応答も" rule), so there is nothing to check besides
// `outcomes` itself.

type NotificationOutcome = NotificationResult['outcomes'][number];

const OUTCOME_STATUS_VALUES = [
  'posted',
  'bot-not-in-channel',
  'channel-not-in-installation',
  'inventory-not-ready',
  'platform-error',
  'timeout',
] as const;

const REMEDY_MAX = 500;
const DETAIL_MAX = 2000;
/** One outcome per `NotificationRequest.targets` entry; same cap as that array. */
const OUTCOMES_MAX = TARGETS_MAX;

const parseOutcome = (v: unknown): NotificationOutcome | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const platform = oneOf(v.platform, PLATFORM_NAMES);
  const channelId = str(v.channelId, CHANNEL_ID_MAX);
  const status = oneOf(v.status, OUTCOME_STATUS_VALUES);

  if (
    platform === undefined ||
    channelId === undefined ||
    status === undefined
  ) {
    return undefined;
  }

  let remedy: string | undefined;
  if (v.remedy !== undefined) {
    remedy = str(v.remedy, REMEDY_MAX);
    if (remedy === undefined) {
      return undefined;
    }
  }

  let detail: string | undefined;
  if (v.detail !== undefined) {
    detail = str(v.detail, DETAIL_MAX);
    if (detail === undefined) {
      return undefined;
    }
  }

  return { platform, channelId, status, remedy, detail };
};

export const parseNotificationResult = (
  raw: unknown,
): NotificationResult | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const outcomes = arr(raw.outcomes, OUTCOMES_MAX, parseOutcome);
  if (outcomes === undefined) {
    return { error: 'malformed' };
  }

  return { outcomes };
};
