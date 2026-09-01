// Confirms the wire shape of a signed `NotificationRequest` before it is
// trusted anywhere downstream (Requirement 10.1). See parse-command.ts's
// header comment for why every parse* function here re-checks shape even
// though the body already passed signature verification.

import type { NotificationRequest } from '../contract/notification.js';
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
