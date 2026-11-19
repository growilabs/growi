import { InAppNotification } from '~/server/models/in-app-notification';

import type {
  ReviewRequestNotificationSnapshot,
  ReviewResultNotificationSnapshot,
} from '../../interfaces';

type ReviewNotificationKind =
  | ReviewRequestNotificationSnapshot['kind']
  | ReviewResultNotificationSnapshot['kind'];

const kindOf = (snapshot: string): unknown => {
  const parsed: unknown = JSON.parse(snapshot);
  return parsed != null && typeof parsed === 'object' && 'kind' in parsed
    ? parsed.kind
    : undefined;
};

// Notifications are told apart by snapshot kind, not by action (see
// research.md's notification action Decision).
export const findReviewNotifications = async (
  kind: ReviewNotificationKind,
  where: { readonly target: string; readonly user?: string },
) =>
  (await InAppNotification.find(where).sort({ _id: 1 }).lean().exec()).filter(
    (n) => kindOf(n.snapshot) === kind,
  );
