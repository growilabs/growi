// Which GROWI (or GROWIs) an invocation runs against (Requirements 6.4,
// 8.1-8.4, 8.6, 11.3). design.md, 「GrowiSelector の判断」:
//
//   - 対象が 1 つに定まる操作で、許可している GROWI が複数 → 利用者に選ばせる
//   - 許可している GROWI が 1 つだけ → 選択を求めずそれに対して実行する
//   - 全 GROWI を対象とする操作 → 選択を求めず、許可している全 GROWI へ配る
//   - どの GROWI も紐づいていない、または許可していない → 実行せず理由を示す
//
// **Whether a channel may run a command is NOT decided here.** `@growi/chat`'s
// `judge` owns that rule, and both sides of the integration have to reach the
// same verdict from the same inputs -- GROWI's admin screen writes the
// settings, this proxy enforces them. design.md says this component's
// `excluded` reasons are 「`filterBroadcastTargets` が返す `PermissionVerdict`
// の理由をそのまま持つ」, so `judge`'s two-sided default (a command with no
// stored row is denied when it writes, allowed when it does not) arrives here
// intact rather than being re-derived, which would be a second authorization
// rule free to drift from the first.
//
// This file only decides WHICH GROWIs; `search_weight` -- how their answers
// are then merged -- belongs to `SearchFusion`, not here.

import type { ChannelRef, CommandName, RelationSettings } from '@growi/chat';
import { judge } from '@growi/chat';

import {
  createChannelPermissionRepository,
  createRelationRepository,
  type DbClient,
  type PermittedChannels,
} from '../db/index.js';
import type { Relation } from '../types/index.js';
import { growiBasePathOf } from './growi-uri-resolver.js';

/** One GROWI that was left out, with the reason the user needs to be told (Req 11.3). */
export interface ExcludedGrowi {
  readonly relationId: string;
  readonly growiLabel: string;
  /** `PermissionVerdict`'s own reasons, carried through unchanged. */
  readonly reason: 'not-permitted-in-channel' | 'no-settings';
}

/**
 * `silent` is deliberately NOT a variant of `explain`. A posted URL that
 * belongs to no linked GROWI must produce no message at all (Requirement
 * 6.4) -- every chat message containing any link would otherwise draw a
 * complaint from the bot. Every other dead end owes the user a reason
 * (Requirement 8.6), so folding the two together would force one caller or
 * the other into the wrong behaviour.
 */
export type SelectionOutcome =
  | {
      readonly kind: 'execute';
      readonly targets: ReadonlyArray<Relation>;
      readonly excluded: ReadonlyArray<ExcludedGrowi>;
    }
  | {
      readonly kind: 'choose';
      readonly options: ReadonlyArray<Relation>;
      readonly excluded: ReadonlyArray<ExcludedGrowi>;
    }
  | {
      readonly kind: 'explain';
      readonly reason: 'not-linked' | 'not-permitted';
      readonly excluded: ReadonlyArray<ExcludedGrowi>;
    }
  | { readonly kind: 'silent' };

/**
 * Keyed by `CommandTrait.targeting`, so a caller composes this straight out of
 * the `CommandSet` declaration instead of branching on a command name.
 *
 * `all-paired-no-filter` carries NO `commandName` and NO channel. That is the
 * point: `link` is not judged against `channel_permission` at all (design.md:
 * 「`link` はチャンネル権限の判定に掛けない」... 「後から `channel_permission`
 * に `link` の行を作らないこと」), and `CommandTrait.permissionCheckName` is
 * `null` for it. Making the name absent from this variant rather than
 * nullable means the `link` path cannot reach a permission read even by
 * mistake -- the compiler refuses, instead of a runtime guard that a later
 * edit could drop.
 */
export type SelectionRequest =
  | {
      readonly targeting: 'exactly-one' | 'all-permitted';
      readonly installationId: string;
      readonly channel: ChannelRef;
      readonly commandName: CommandName;
    }
  | {
      readonly targeting: 'url-match';
      readonly installationId: string;
      readonly channel: ChannelRef;
      readonly commandName: CommandName;
      /** The text posted in the channel. Not required to be a URL at all. */
      readonly url: string;
    }
  | {
      readonly targeting: 'all-paired-no-filter';
      readonly installationId: string;
    };

export interface GrowiSelectorDeps {
  readonly db: DbClient;
}

export interface GrowiSelector {
  select(request: SelectionRequest): Promise<SelectionOutcome>;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * A stable order for everything this module hands back. `findMany` gives no
 * order of its own, so without this the buttons offered for one and the same
 * choice could come back in a different order on the next call, and a user
 * comparing two identical prompts would see them disagree. Label first
 * because that is what the user reads; `relationId` only breaks ties between
 * two GROWIs labelled the same.
 */
const inDisplayOrder = (
  relations: ReadonlyArray<Relation>,
): ReadonlyArray<Relation> =>
  [...relations].sort(
    (a, b) =>
      a.growiLabel.localeCompare(b.growiLabel) ||
      a.relationId.localeCompare(b.relationId),
  );

// ---------------------------------------------------------------------------
// Matching a posted URL against a GROWI's own URI
// ---------------------------------------------------------------------------

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/**
 * The linked GROWI a posted URL sits under, or `null`.
 *
 * `URL.origin` is the comparison for the host half, which drops a default
 * port written out on either side (`https://host:443/` and `https://host/`
 * share an origin) without this file having to know the default port per
 * scheme.
 *
 * The base always ends in `/`, so a match can only land on a whole path
 * segment: `/growix/Page` does not sit under `/growi/`, though a base written
 * without the trailing `/` would say it does -- and that would quietly
 * attribute one team's page to another team's GROWI.
 *
 * The posted path is given a trailing `/` of its own so that the GROWI's root
 * pasted bare (`https://example.com/growi`) still matches its base
 * (`/growi/`). Without it the one URL most likely to be shared -- the GROWI's
 * front door -- would be the one URL not recognised.
 *
 * When several GROWIs share a host, the LONGEST base wins: a GROWI at
 * `/team/` is the more specific answer for `/team/Sandbox` than one at `/`,
 * which would otherwise swallow every page on the host.
 */
const matchByUrl = (
  relations: ReadonlyArray<Relation>,
  postedUrl: string,
): Relation | null => {
  const posted = parseUrl(postedUrl);
  if (posted == null) {
    return null;
  }

  const targetPath = `${posted.pathname.replace(/\/+$/, '')}/`;

  const candidates = relations.flatMap((relation) => {
    const uri = parseUrl(relation.growiUri);
    if (uri == null || uri.origin !== posted.origin) {
      return [];
    }
    const base = growiBasePathOf(uri);
    return targetPath.startsWith(base) ? [{ relation, base }] : [];
  });

  return (
    candidates.reduce<{ relation: Relation; base: string } | null>(
      (best, candidate) =>
        best == null || candidate.base.length > best.base.length
          ? candidate
          : best,
      null,
    )?.relation ?? null
  );
};

// ---------------------------------------------------------------------------
// The selector
// ---------------------------------------------------------------------------

/**
 * The one relation's worth of settings `judge` needs, rebuilt from this
 * proxy's own `channel_permission` row. Faithful because `judge` reads only
 * the row for `commandName`, and it documents "no settings at all" and "no
 * row for this command" as the same input.
 */
const settingsFor = (
  relationId: string,
  commandName: CommandName,
  channels: PermittedChannels | null,
): RelationSettings | null =>
  channels == null
    ? null
    : {
        relationId,
        channelPermissions: [{ commandName, allowedChannels: channels }],
      };

interface Judged {
  readonly relation: Relation;
  readonly permitted: boolean;
  readonly excluded: ExcludedGrowi | null;
}

export const createGrowiSelector = (deps: GrowiSelectorDeps): GrowiSelector => {
  const relations = createRelationRepository(deps.db);
  const permissions = createChannelPermissionRepository(deps.db);

  const judgeEach = async (
    candidates: ReadonlyArray<Relation>,
    commandName: CommandName,
    channel: ChannelRef,
  ): Promise<ReadonlyArray<Judged>> =>
    Promise.all(
      candidates.map(async (relation) => {
        const channels = await permissions.find(
          relation.relationId,
          commandName,
        );
        const verdict = judge(
          settingsFor(relation.relationId, commandName, channels),
          commandName,
          channel,
        );
        return {
          relation,
          permitted: verdict.allowed,
          excluded: verdict.allowed
            ? null
            : {
                relationId: relation.relationId,
                growiLabel: relation.growiLabel,
                reason: verdict.reason,
              },
        };
      }),
    );

  return {
    select: async (request: SelectionRequest): Promise<SelectionOutcome> => {
      const linked = inDisplayOrder(
        await relations.listByInstallation(request.installationId),
      );

      // `link`: every paired GROWI, with no permission filter at all, and the
      // choice is offered even when there is only one -- the user is picking
      // which identity to tie, not which GROWI an operation lands on, so
      // there is nothing here for 8.3's "don't ask when there's only one" to
      // apply to.
      if (request.targeting === 'all-paired-no-filter') {
        return linked.length === 0
          ? { kind: 'explain', reason: 'not-linked', excluded: [] }
          : { kind: 'choose', options: linked, excluded: [] };
      }

      if (request.targeting === 'url-match') {
        // Requirement 6.4: a link to somewhere that is not a linked GROWI is
        // an ordinary message, and gets no answer of any kind. Both "nothing
        // is linked" and "this text is not even a URL" are that same case.
        const matched = matchByUrl(linked, request.url);
        if (matched == null) {
          return { kind: 'silent' };
        }
        // Past the match it is no longer an unrelated link: the user pointed
        // at a GROWI this workspace knows, so being barred from it in this
        // channel is worth saying (Requirement 11.3).
        const [judged] = await judgeEach(
          [matched],
          request.commandName,
          request.channel,
        );
        return judged.permitted
          ? { kind: 'execute', targets: [matched], excluded: [] }
          : {
              kind: 'explain',
              reason: 'not-permitted',
              // Non-null by construction: `permitted` is false exactly when
              // `judge` returned a reason.
              excluded: judged.excluded == null ? [] : [judged.excluded],
            };
      }

      if (linked.length === 0) {
        // Requirement 8.6. Distinct from `not-permitted` because the way out
        // is different: pair a GROWI, rather than ask an admin to permit this
        // channel.
        return { kind: 'explain', reason: 'not-linked', excluded: [] };
      }

      const judged = await judgeEach(
        linked,
        request.commandName,
        request.channel,
      );
      const targets = judged
        .filter((entry) => entry.permitted)
        .map((entry) => entry.relation);
      const excluded = judged.flatMap((entry) =>
        entry.excluded == null ? [] : [entry.excluded],
      );

      if (targets.length === 0) {
        return { kind: 'explain', reason: 'not-permitted', excluded };
      }

      // 8.4: fan out to every permitted GROWI without asking. 8.2 / 8.3: ask
      // only when the answer is genuinely ambiguous, i.e. more than one
      // permitted GROWI is left.
      return request.targeting === 'all-permitted' || targets.length === 1
        ? { kind: 'execute', targets, excluded }
        : { kind: 'choose', options: targets, excluded };
    },
  };
};
