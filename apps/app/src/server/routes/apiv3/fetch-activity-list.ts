/**
 * Shared audit-log list logic used by both transports:
 *  - GET  /_api/v3/activity        (legacy, kept for API/PAT backward compat)
 *  - POST /_api/v3/activity/list   (used by the admin UI to avoid a long URL)
 *
 * Extracted from the route handler so the two routes share one implementation
 * (single source of truth — no filter/serialize drift between GET and POST).
 *
 * `resolveActivityListWhere` is pure and receives `availableActions` as input
 * (the caller owns "what actions exist"), so it is unit-testable without a
 * Crowi/DB (coding-style: executors take their work-set as input).
 */

import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import { isValid } from 'date-fns/isValid';
import { parseISO } from 'date-fns/parseISO';

import type { Prisma } from '~/generated/prisma/client';
import type { ISearchFilter } from '~/interfaces/activity';
import { prisma } from '~/utils/prisma';

import { buildActivityListWhere } from './build-activity-list-where';

/**
 * Convert a parsed search filter into a Prisma `where` object.
 *
 * The action list is intersected with `availableActions` (the actions actually
 * available under the current audit-log config). The null-vs-empty distinction
 * is preserved for buildActivityListWhere (req 2.2):
 *  - `actions` absent (undefined)        → searchableActions undefined → clause omitted → all results
 *  - `actions` present but all invalid   → searchableActions []        → in:[]          → zero results
 */
export function resolveActivityListWhere(
  availableActions: readonly string[],
  parsedSearchFilter: ISearchFilter,
): ReturnType<typeof buildActivityListWhere> {
  let searchableActions: string[] | undefined;
  if (parsedSearchFilter.actions != null) {
    searchableActions = parsedSearchFilter.actions.filter((action) =>
      availableActions.includes(action),
    );
  }

  const startDate = parseISO(parsedSearchFilter?.dates?.startDate || '');
  const endDate = parseISO(parsedSearchFilter?.dates?.endDate || '');

  return buildActivityListWhere({
    usernames: parsedSearchFilter.usernames,
    actions: searchableActions,
    startDate: isValid(startDate) ? startDate : undefined,
    endDate: isValid(endDate) ? endDate : undefined,
  });
}

/**
 * Paginate activities and remap each doc to the old Mongoose response shape
 * (req 2.3): drop `userId`, keep serialized `user`, keep _id/__v and all other
 * scalar fields.
 */
export async function paginateAndSerializeActivities(
  where: ReturnType<typeof buildActivityListWhere>,
  limit: number,
  offset: number,
): Promise<Record<string, unknown>> {
  const paginateResult = await prisma.activities.paginate({
    where,
    orderBy: { createdAt: 'desc' },
    offset,
    limit,
    include: { user: true },
  });

  // Type note: the `paginate` generic resolves via PaginateOptions<…> which
  // does not propagate `include` into the result type, so `docs` is typed as
  // the base scalar shape (no `user` property). We route through `unknown` to
  // reach the correct payload type — the runtime value is correct because
  // `include: { user: true }` was passed to `paginate`.
  type ActivityWithUser = Prisma.activitiesGetPayload<{
    include: { user: true };
  }>;
  const serializedDocs = (
    paginateResult.docs as unknown as ActivityWithUser[]
  ).map((doc) => {
    const { user, userId, ...rest } = doc;
    return {
      // The Prisma `users` type has nullable fields (e.g. name: string|null)
      // while `IUser` requires non-nullable. At runtime they map to the same
      // MongoDB document. Cast to Ref<IUser> so serializeUserSecurely resolves.
      // biome-ignore lint/suspicious/noExplicitAny: Prisma users type diverges from Ref<IUser> only in nullability; same runtime document
      user: serializeUserSecurely(user as any),
      ...rest,
    };
  });

  return {
    ...paginateResult,
    docs: serializedDocs,
  };
}
