// `AdminCommandSet` -- design.md's Components and Interfaces row for this
// file: 「運用者の入り口（**文字列の解釈と結果の組み立てだけ**）」.
//
// The five things an operator can type (design.md's AdminCommandSet table):
// `register`, `unregister`, `weight <growi> <値>`, `rotate-key`, and
// `rotate-key status`.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. design.md: 「この部品は文字列の
// 解釈と結果の組み立てだけを持つ。4 つの操作の中身はすべて右側の層にある
// （`register`/`unregister` は `relation/`、`rotate-key` は `relation/` と
// `growi/`）ので、ここから直に呼ぶと宣言した依存の向き（`command → relation
// → growi`）を逆走する。実際の呼び出しは `orchestration/` が行い、この部品は
// 呼ぶべき操作と引数を値として返す」. So `parseAdminCommand` returns a plain
// data description of the operation to run -- never a callable, never a
// partially applied service call -- and this file imports nothing from
// `relation/`, `growi/`, or `orchestration/`.
//
// Everything an intent needs that only the surrounding context knows (which
// installation, which relation, which channel) is deliberately absent: the
// operator types `rotate-key` at a workspace, and `RelationKeyService.rotate`
// takes an `installationId` design.md says is resolved from the workspace the
// command was typed in. Resolving that is orchestration's step, not a value
// this parser can invent.
import type { PlatformName } from '@growi/chat';

import { ADMIN_CHECK_TABLE } from '../capabilities/index.js';
import type { AdminActorRoles, Invocation } from '../types/index.js';

/**
 * The words an operator can type. `rotate-key status` is not a sixth word --
 * it is the word `rotate-key` followed by the literal argument `status`, which
 * is how it arrives from `CommandInvocation.normalize` (`commandName` is the
 * first token, `argsText` is the rest).
 */
export const ADMIN_COMMAND_WORDS = [
  'register',
  'unregister',
  'weight',
  'rotate-key',
] as const;

export type AdminCommandWord = (typeof ADMIN_COMMAND_WORDS)[number];

const isAdminCommandWord = (word: string): word is AdminCommandWord =>
  (ADMIN_COMMAND_WORDS as ReadonlyArray<string>).includes(word);

/**
 * Re-exported so this file's own vocabulary stays complete for its readers:
 * `isWorkspaceAdmin` below takes one, and `command/index.ts` publishes it.
 * It is DECLARED in `types/` because `platform/actor-roles.ts` -- which reads
 * these facts off the chat service -- sits to the left of this layer.
 */
export type { AdminActorRoles };

/**
 * Where an intent's answer may be shown. `'ephemeral'` means only the person
 * who typed the command may see it.
 */
export type AdminDelivery = 'ephemeral' | 'channel';

/**
 * The operation orchestration should carry out, plus its arguments -- a value,
 * not a call (see the file header).
 *
 * Every variant carries `delivery`, including the four where it is
 * `'channel'`, so that reading it is part of acting on any intent rather than
 * a special case someone has to remember for `register` alone. design.md:
 * 「登録コードは本人にだけ見えるメッセージで返す。チャンネルに平文で出さない」.
 * `issue-pairing-code` pins the literal `'ephemeral'` in its type, so an
 * orchestration branch that posted it to the channel could not be written
 * without contradicting the type it read.
 */
export type AdminCommandIntent =
  | {
      /** design.md 9.1: issue a pairing code that expires after a while. */
      readonly operation: 'issue-pairing-code';
      readonly delivery: 'ephemeral';
    }
  | {
      /** design.md 9.7: undo the pairing this channel's workspace holds. */
      readonly operation: 'unregister';
      readonly delivery: AdminDelivery;
    }
  | {
      /** design.md 3.8: this workspace's per-GROWI search weight. */
      readonly operation: 'set-search-weight';
      /**
       * The GROWI token exactly as typed. Deliberately NOT called
       * `growiUri`: whether it names a `growi_uri` or a `growi_label` is
       * answered by reading the `relation` rows, which is `relation/`'s
       * work. Deciding it here would settle that question in the layer with
       * the least information about it.
       */
      readonly growiRef: string;
      readonly weight: number;
      readonly delivery: AdminDelivery;
    }
  | {
      /** design.md 10.5, steps 1-3: mint if needed, then (re)deliver. */
      readonly operation: 'rotate-key';
      readonly delivery: AdminDelivery;
    }
  | {
      /** design.md 10.5, step 4: revoke the old key iff all peers have it. */
      readonly operation: 'rotate-key-status';
      readonly delivery: AdminDelivery;
    };

/**
 * What reading one `Invocation` produced.
 *
 * `'not-admin-command'` is an ordinary outcome, not a fault: most of what
 * users type is a `CommandSet` command, and this parser is asked first.
 */
export type AdminCommandOutcome =
  | { readonly kind: 'not-admin-command' }
  | {
      readonly kind: 'denied';
      readonly word: AdminCommandWord;
      /** The roles that would have allowed it, for the message shown back. */
      readonly requiredAnyOf: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'invalid';
      readonly word: AdminCommandWord;
      readonly detail: string;
    }
  | { readonly kind: 'intent'; readonly intent: AdminCommandIntent };

/**
 * Whether the actor may run admin commands on this service, decided from the
 * declared table rather than from a `if (platform === ...)` chain (design.md:
 * 「調べ方はサービスごとに違うので、能力表の隣にデータとして持つ...
 * `if (platform === ...)` と書かない」). Adding a service therefore means
 * adding a row to `ADMIN_CHECK_TABLE`, and nothing here.
 *
 * Why it is a gate at all: without it anyone in the workspace could pair their
 * own GROWI, and Requirement 9's whole point -- that a third party cannot
 * register one -- would not hold.
 */
export const isWorkspaceAdmin = (
  platform: PlatformName,
  actor: AdminActorRoles,
): boolean =>
  ADMIN_CHECK_TABLE[platform].fields.some((field) =>
    actor.grantedFields.includes(field),
  );

/** The whitespace-separated tokens of an argument string, empties dropped. */
const tokensOf = (argsText: string): ReadonlyArray<string> =>
  argsText.split(/\s+/).filter((token) => token.length > 0);

/**
 * A finite number, or `null`.
 *
 * Hand-written rather than `Number(token)` because that answers `0` for an
 * empty string and `NaN` for `'2abc'` only after accepting `'2 '`, and
 * `parseFloat('2abc')` answers `2` -- both would silently set a weight the
 * operator never typed. `Number.isFinite` additionally rejects `'Infinity'`,
 * which `Number` accepts.
 */
const finiteNumberOf = (token: string): number | null => {
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
};

/**
 * The rotation's two words. `rotate-key` alone starts or resumes it;
 * `rotate-key status` is design.md's separate 4th step (revoke the old key
 * once every peer has the new one). Anything else is rejected rather than
 * treated as bare `rotate-key`: a typo must not mint and distribute keys.
 */
const ROTATE_KEY_STATUS_WORD = 'status';

const parseArguments = (
  word: AdminCommandWord,
  argsText: string,
): AdminCommandIntent | { readonly detail: string } => {
  const tokens = tokensOf(argsText);

  switch (word) {
    // Both take no argument in design.md's table. Extra words are rejected
    // rather than ignored, for the same reason `rotate-key stauts` is: a
    // mistyped line should not carry out the operation the operator did not
    // finish typing -- and `unregister` is the destructive one of the five.
    case 'register':
    case 'unregister':
      if (tokens.length > 0) return { detail: `usage: ${word}` };
      return word === 'register'
        ? { operation: 'issue-pairing-code', delivery: 'ephemeral' }
        : { operation: 'unregister', delivery: 'channel' };

    case 'weight': {
      const [growiRef, weightToken, ...rest] = tokens;
      if (growiRef == null || weightToken == null || rest.length > 0) {
        return { detail: 'usage: weight <growi> <value>' };
      }
      const weight = finiteNumberOf(weightToken);
      // No range is checked here: design.md declares none, and whichever
      // layer writes `relation.search_weight` is where one would belong.
      if (weight == null) {
        return { detail: `weight must be a number, not '${weightToken}'` };
      }
      return {
        operation: 'set-search-weight',
        growiRef,
        weight,
        delivery: 'channel',
      };
    }

    case 'rotate-key': {
      if (tokens.length === 0) {
        return { operation: 'rotate-key', delivery: 'channel' };
      }
      if (tokens.length === 1 && tokens[0] === ROTATE_KEY_STATUS_WORD) {
        return { operation: 'rotate-key-status', delivery: 'channel' };
      }
      return {
        detail: `usage: rotate-key, or rotate-key ${ROTATE_KEY_STATUS_WORD}`,
      };
    }
  }
};

/**
 * Reads one normalized `Invocation` as an admin command.
 *
 * The three steps are ordered on purpose:
 *
 * 1. Is this word an admin command at all? If not, say so and let
 *    `CommandSet` have it -- an unknown word is not an authorization event.
 * 2. Is the actor a workspace admin? Checked BEFORE the arguments, so the
 *    wording of an argument error can never tell a non-admin which GROWI
 *    identifiers or subcommands this workspace knows.
 * 3. Do the arguments make sense?
 *
 * Requiring `actor` as a parameter is what makes the admin gate impossible to
 * skip: there is no way to obtain an intent without having supplied the
 * actor's roles. It does not, and cannot, force the caller to have observed
 * those roles honestly -- that is orchestration's obligation.
 */
export const parseAdminCommand = (
  invocation: Invocation,
  actor: AdminActorRoles,
): AdminCommandOutcome => {
  const word = invocation.commandName.trim();
  if (!isAdminCommandWord(word)) return { kind: 'not-admin-command' };

  if (!isWorkspaceAdmin(invocation.platform, actor)) {
    return {
      kind: 'denied',
      word,
      requiredAnyOf: ADMIN_CHECK_TABLE[invocation.platform].fields,
    };
  }

  const parsed = parseArguments(word, invocation.argsText);
  return 'detail' in parsed
    ? { kind: 'invalid', word, detail: parsed.detail }
    : { kind: 'intent', intent: parsed };
};
