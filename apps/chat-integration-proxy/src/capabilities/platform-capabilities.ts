// The single declared place for what each of the 4 chat services can do
// ("プラットフォーム能力表" -- design.md's "唯一の宣言箇所"). No other file
// in this app may branch on `platform === 'slack'` etc. for a capability
// question; it reads this table instead.
//
// Two other axes live in this same file because design.md places them
// "next to" the capability table, but they are declared as SEPARATE data
// structures from `CAPABILITY_TABLE` -- design.md is explicit that mixing
// them in would be wrong, since their "true" means the opposite of a
// capability's "true":
// - `CONNECTION_UNIT_TABLE`: how many persistent connections a service
//   needs and what its distributed-lock key looks like. This has nothing to
//   do with what the service can *do*.
// - `REQUIRES_INBOUND_REACHABILITY`: whether this proxy must accept an
//   inbound connection from the service. `true` here means "needs an open
//   inbound hole", the opposite polarity of `supports()` returning `true`
//   ("this platform is capable") -- folding it into `CAPABILITY_TABLE` would
//   silently invert that meaning for whoever reads it next to a capability
//   row.
import type {
  CapabilityLevel,
  CapabilityReport,
  PlatformName,
} from '@growi/chat';

/**
 * Every capability row design.md's プラットフォーム能力表 declares.
 * `CAPABILITY_TABLE` below has one entry per member of this union --
 * completeness across the 4 services for each of these is what
 * `platform-capabilities.spec.ts` checks without hardcoding a count.
 */
export type CapabilityName =
  | 'ephemeralMessage'
  | 'slashCommand'
  | 'mention'
  | 'modal'
  | 'interactiveActions'
  | 'card'
  | 'linkPreview'
  | 'fetchMessages'
  | 'plainReply';

type CapabilityRow = Readonly<Record<PlatformName, CapabilityLevel>>;

/**
 * design.md's プラットフォーム能力表, transcribed verbatim: ○ -> `full`,
 * △ -> `degraded`, × -> `none`, 要確認 -> `unverified`. See the Revalidation
 * Triggers section for when `plainReply`'s `unverified` rows are expected
 * to change.
 */
export const CAPABILITY_TABLE: Readonly<Record<CapabilityName, CapabilityRow>> =
  {
    ephemeralMessage: {
      slack: 'full',
      discord: 'full',
      teams: 'full',
      mattermost: 'full',
    },
    // `full` would be a lie here: `command/invocation.ts` normalizes a
    // slash-command event's raw `command` field (which every adapter sends
    // WITH its leading `/`, confirmed against `@chat-adapter/slack`'s and
    // `@chat-adapter/discord`'s actual payload construction) with only a
    // `.trim()`, so the result never matches any registered command name (none
    // of which carries a `/`) -- no slash command actually invokes anything on
    // any service today. Requirement 1.3 requires this table to tell the
    // operator only what is actually usable, so both rows read `none` until a
    // future task teaches `invocation.ts` to normalize the `/`-prefixed form.
    slashCommand: {
      slack: 'none',
      discord: 'none',
      teams: 'none',
      mattermost: 'none',
    },
    mention: {
      slack: 'full',
      discord: 'full',
      teams: 'full',
      mattermost: 'full',
    },
    modal: {
      slack: 'full',
      discord: 'none',
      teams: 'full',
      mattermost: 'none',
    },
    interactiveActions: {
      slack: 'full',
      discord: 'full',
      teams: 'full',
      mattermost: 'none',
    },
    card: {
      slack: 'full',
      discord: 'full',
      teams: 'full',
      mattermost: 'degraded',
    },
    linkPreview: {
      slack: 'full',
      discord: 'none',
      teams: 'none',
      mattermost: 'none',
    },
    fetchMessages: {
      slack: 'full',
      discord: 'full',
      teams: 'full',
      mattermost: 'full',
    },
    plainReply: {
      slack: 'unverified',
      discord: 'unverified',
      teams: 'unverified',
      mattermost: 'unverified',
    },
  };

/**
 * design.md's 「無いときの代わり」 column -- what to do instead when a service
 * cannot do this. **One text per capability, not per service**, because that
 * is how design.md declares it: the fallback for a missing `modal` is the same
 * fallback whichever service is missing it.
 *
 * Written in English while design.md's column is in Japanese: the report goes
 * out over the wire to a GROWI whose administrator's language this proxy never
 * learns (`OpOnlyRequest` carries no locale), so translating it is the reading
 * side's business, not this table's. Each entry carries design.md's own
 * wording in a trailing comment so a reviewer can check the transcription
 * against the source column.
 *
 * A capability whose column reads `—` is absent here: there is nothing
 * documented to fall back to, and inventing a sentence for it would be this
 * file claiming a design decision design.md did not make.
 */
export const CAPABILITY_SUBSTITUTE: Readonly<
  Partial<Record<CapabilityName, string>>
> = {
  // mention で起動する（決定 4）
  slashCommand: 'Invoke the command by mentioning the bot instead.',
  // コマンド行の引数 + 聞き返し（決定 5）
  modal: 'Take the arguments on the command line and ask follow-up questions.',
  // 番号つきの一覧を出して返信で選ばせる
  interactiveActions:
    'Post a numbered list and let the user pick by replying with a number.',
  // markdown で投稿する
  card: 'Post the same content as plain markdown.',
  // 要件 6.5 に従い「使えない」と示す
  linkPreview:
    'Tell the user that link previews are unavailable on this service.',
  // 呼びかけ付きの返信にする
  plainReply: 'Reply with the user mentioned in the message.',
};

/** The raw level, for a caller that needs to tell `degraded` apart from `none`. */
export function levelOf(
  capability: CapabilityName,
  platform: PlatformName,
): CapabilityLevel {
  return CAPABILITY_TABLE[capability][platform];
}

/**
 * `CapabilityLevel` (imported from `@growi/chat`) has 4 values: `full` is
 * the only one this function treats as usable. `degraded` (e.g.
 * Mattermost's `card`, which falls back to a plain markdown post) and
 * `unverified` (e.g. `plainReply` on every service -- not yet confirmed
 * against the real API) both mean "do not rely on this by default"; a
 * caller that specifically wants to detect "supported but degraded" (to
 * choose the documented fallback) reads `levelOf()` instead.
 *
 * The default/primary check. Returns `true` only when the level is `full`
 * -- `degraded` and `unverified` are both "do not rely on this", per
 * design.md: "`supports()` が `true` を返すのは `full` のときだけ".
 */
export function supports(
  capability: CapabilityName,
  platform: PlatformName,
): boolean {
  return levelOf(capability, platform) === 'full';
}

/**
 * How many persistent connections a service needs, and the distributed-lock
 * key `ConnectionManager` should use for it (design.md's 接続の単位 table).
 * Separate from `CAPABILITY_TABLE` -- see this file's header comment.
 */
export type ConnectionUnit =
  | { readonly kind: 'per-app'; readonly lockKey: string }
  | { readonly kind: 'per-installation'; readonly lockKeyPrefix: string }
  | { readonly kind: 'none' };

export const CONNECTION_UNIT_TABLE: Readonly<
  Record<PlatformName, ConnectionUnit>
> = {
  slack: { kind: 'per-app', lockKey: 'app:slack' },
  discord: { kind: 'per-app', lockKey: 'app:discord' },
  teams: { kind: 'none' },
  mattermost: { kind: 'per-installation', lockKeyPrefix: 'installation:' },
};

/**
 * Whether this proxy must accept an inbound connection from the service
 * (design.md's 制約 row). Only Teams is `true` -- Bot Framework POSTs to
 * this proxy rather than the proxy connecting out. Separate from
 * `CAPABILITY_TABLE` -- see this file's header comment for why `true` here
 * is not "more capable".
 */
export const REQUIRES_INBOUND_REACHABILITY: Readonly<
  Record<PlatformName, boolean>
> = {
  slack: false,
  discord: false,
  teams: true,
  mattermost: false,
};

/**
 * The services this table covers, from a table that has one entry per
 * `PlatformName` rather than from a hand-written list. Both tables in this
 * file are `Record<PlatformName, ...>`, so either would do; the connection
 * unit table is used because it is keyed by service at the top level, while
 * `CAPABILITY_TABLE` is keyed by capability and would need an arbitrary row
 * picked out of it. `Object.keys` always widens to `string[]`, so this narrows
 * back -- the same step `platform/index.ts` takes over `ADAPTER_FACTORIES`.
 */
const PLATFORM_NAMES = Object.keys(
  CONNECTION_UNIT_TABLE,
) as ReadonlyArray<PlatformName>;

/**
 * The whole capability table in the shape it leaves this proxy
 * (`CapabilityReport`, `@growi/chat`; Requirement 1.3).
 *
 * **Proxy-wide, and deliberately takes no relation.** The table is static and
 * identical for every workspace, so design.md's 「返す範囲」 column has nothing
 * to say here -- a signature is not what decides the answer, and a parameter
 * would suggest otherwise.
 *
 * Two shapes differ from the table itself. The wire type carries one row per
 * (service, capability) pair while `CAPABILITY_TABLE` is one row per
 * capability, and it carries a substitute per pair while design.md declares
 * one per capability. A `full` level reads `null`: a capability that works has
 * nothing to fall back to, and repeating the fallback text there would read as
 * "do this instead" for a service that needs no instead.
 */
export const buildCapabilityReport = (): CapabilityReport => ({
  platforms: PLATFORM_NAMES.map((platform) => ({
    platform,
    capabilities: (
      Object.keys(CAPABILITY_TABLE) as ReadonlyArray<CapabilityName>
    ).map((capability) => {
      const level = CAPABILITY_TABLE[capability][platform];
      return {
        capability,
        level,
        substitute:
          level === 'full' ? null : (CAPABILITY_SUBSTITUTE[capability] ?? null),
      };
    }),
  })),
});
