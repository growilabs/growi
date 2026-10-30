// The single declared place for what the user can type (design.md's
// CommandSet table: "この表がそのまま `command/command-set.ts` の中身になる。
// ここに無いものは打てない。`if (name === 'search')` のような分岐を各層に
// 書かず、この宣言を読んで動く"). No other file in this app may branch on a
// command name literal; every later layer (`argument-collector.ts`,
// `orchestration/*`) reads this table instead.
//
// This is a RICHER, PROXY-SIDE SUPERSET of `@growi/chat`'s own
// `COMMAND_TRAITS` (packages/chat/src/commands/command-names.ts). That file
// already owns the shared vocabulary (`CommandName` / `COMMAND_NAMES`) and a
// 2-field trait (`writes` / `targeting`) needed by both sides of the
// integration. This file adds what only the proxy needs to build a
// `CommandRequest`/prompt a modal: the fields to collect (`FieldSpec[]`),
// the permission-check name, and (for `search`) the server-decided `limit`.
// `CommandName` itself is imported, never redeclared.

import type { CommandName } from '@growi/chat';
import { COMMAND_NAMES } from '@growi/chat';

import type { FieldSpec } from '../types/index.js';

/**
 * How a command's target GROWI(s) are decided. Only the STRATEGY is
 * declared here -- the resolution algorithm itself (reading
 * `channel_permission` / `search_weight`) belongs to `GrowiSelector`
 * (`relation/growi-selection.ts`, a later task).
 *
 * `'all-paired-no-filter'` exists only for `link`: every other targeting
 * value implicitly assumes "among the GROWIs this channel is *permitted* to
 * use", but `link` is not a channel-permission decision at all (design.md:
 * 「`GrowiSelector` の判断は『許可している GROWI』を前提に書かれているが、
 * `link` にはその絞りが無い」) -- it lets the user choose from every GROWI
 * their account is *paired* with, regardless of channel permission.
 */
export type CommandTargeting =
  | 'all-permitted'
  | 'exactly-one'
  | 'url-match'
  | 'all-paired-no-filter';

/**
 * What kind of contract a command sends. `command-set.ts` only names the
 * shape, it does not build the object -- constructing the actual
 * `CommandRequest` / `AccountLinkStartRequest` is orchestration's job
 * (a later task).
 */
export type CommandRequestKind = 'command-request' | 'account-link-start';

/**
 * One command's full declaration: what it collects, what contract it
 * sends, how its target is decided, and the name checked against
 * `channel_permission`.
 *
 * A permission-check name of `null` means "not checked" -- reserved for
 * `link` alone, and deliberately not a string, so it can never be mistaken
 * for (or accidentally reused as) a real command name in a
 * `channel_permission` row. design.md: 「後から `channel_permission` に
 * `link` の行を作らないこと -- 判定に掛けない決定と食い違う」.
 */
export interface CommandTrait {
  readonly fields: ReadonlyArray<FieldSpec>;
  readonly sends: CommandRequestKind;
  readonly targeting: CommandTargeting;
  readonly permissionCheckName: string | null;
}

/**
 * `search`'s result count is a proxy-side decision, never asked of the
 * user (design.md: 「`limit` は proxy が決める（既定 10）-- 利用者には
 * 聞かない」). Declared as a named constant, not inlined, so
 * `orchestration/` and this file's own test both read the same value.
 */
export const SEARCH_DEFAULT_LIMIT = 10;

/**
 * The 5-command shared vocabulary's proxy-side traits, keyed by the SAME
 * `CommandName` union `@growi/chat` declares. `Record<CommandName,
 * CommandTrait>` makes a missing entry a compile error, not a runtime gap
 * -- the same mechanism `@growi/chat`'s own `COMMAND_TRAITS` already uses
 * (design.md: 「宣言に無い言葉が打てず、性質を書いていないコマンドを
 * 作れない」).
 *
 * `title` is deliberately absent from every `fields` list below --
 * `CommandRequest`'s `create-page` and `keep` variants do not carry a
 * title field, so collecting one would only be discarded. GROWI derives
 * the page title itself, from the body's first heading or the path's tail
 * segment. Adding a title field requires extending the protocol contract
 * first, out of scope here.
 */
export const COMMAND_TRAITS: Readonly<Record<CommandName, CommandTrait>> = {
  [COMMAND_NAMES.search]: {
    fields: [
      {
        name: 'keyword',
        label: 'Keyword',
        required: true,
        kind: 'text',
      },
    ],
    sends: 'command-request',
    targeting: 'all-permitted',
    permissionCheckName: COMMAND_NAMES.search,
  },
  [COMMAND_NAMES.createPage]: {
    fields: [
      {
        name: 'path',
        label: 'Path',
        required: true,
        kind: 'path',
      },
      {
        name: 'body',
        label: 'Body',
        required: true,
        kind: 'multiline',
      },
    ],
    sends: 'command-request',
    targeting: 'exactly-one',
    permissionCheckName: COMMAND_NAMES.createPage,
  },
  [COMMAND_NAMES.keep]: {
    fields: [
      {
        name: 'range',
        label: 'Time range',
        required: true,
        kind: 'time-range',
      },
      {
        name: 'path',
        label: 'Path',
        required: true,
        kind: 'path',
      },
    ],
    sends: 'command-request',
    targeting: 'exactly-one',
    permissionCheckName: COMMAND_NAMES.keep,
  },
  [COMMAND_NAMES.help]: {
    fields: [],
    sends: 'command-request',
    targeting: 'all-permitted',
    permissionCheckName: COMMAND_NAMES.help,
  },
  [COMMAND_NAMES.linkPreview]: {
    fields: [],
    sends: 'command-request',
    targeting: 'url-match',
    permissionCheckName: COMMAND_NAMES.linkPreview,
  },
};

/**
 * `link` is a genuinely separate, typeable command word that stays OUTSIDE
 * `@growi/chat`'s `CommandName` union (design.md: 「紐付けの開始は
 * `CommandRequest` ではなく `AccountLinkStartRequest` という別の契約なので、
 * `COMMAND_NAMES` には足さない。共有する契約を広げずに済み...」). It is
 * declared here, separately from `COMMAND_TRAITS`, precisely so it cannot
 * be reached through `CommandName`-keyed lookups (`COMMAND_TRAITS[name]`,
 * `isWriteCommand`, `targetingOf` from `@growi/chat`) meant only for the
 * shared protocol vocabulary.
 *
 * Not channel-permission-checked (`permissionCheckName: null`) -- linking
 * an account is not a write to GROWI, it is the user tying their own
 * identity to a GROWI account, so it is exempt from `channel_permission`
 * by design, not by omission. Its target is "every GROWI this user's
 * account is paired with", with no permission filter at all.
 */
export const LINK_COMMAND_WORD = 'link';

export const LINK_TRAIT: CommandTrait = {
  fields: [],
  sends: 'account-link-start',
  targeting: 'all-paired-no-filter',
  permissionCheckName: null,
};
