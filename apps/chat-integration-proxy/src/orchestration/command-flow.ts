// `CommandFlow` -- what happens between a user typing a command and reading
// an answer (design.md's `orchestration/command-flow.ts`: 「権限の判定 →
// GROWI の選択 → 引数の収集 → 送信 → 投稿」).
//
// This is the first file that composes the layers below it, so it holds the
// decisions none of them could hold on their own:
//
//  - **The permission judgement comes first, before the user is asked for
//    anything.** `GrowiSelector.select()` is both the permission gate and the
//    candidate list (it runs `@growi/chat`'s `judge`, the same rule GROWI's
//    admin screen writes), so one call answers 「実行してよいか」 and 「どの
//    GROWI か」 together. Only the *question* 「どの GROWI に対して?」 is
//    deferred until the values are in -- see `dispatch` below.
//  - **An account link is announced through exactly one function.**
//    `accountLinkNotice` is reached both by a write GROWI refused
//    (`CommandResponse` の `account-link-required`, Requirement 7.6) and by a
//    user typing `link` (`AccountLinkStartResponse` の `link-issued`).
//    design.md: 「どちらも投稿の経路は 1 本にする」. Both go to the requester
//    alone: the link is one-time and short-lived, so it must not sit in a
//    channel.
//  - **`keep` never reaches GROWI when the range holds nothing** (Requirement
//    5.5). `fetchHistory` answering with no messages ends the command here.
//  - **Nothing branches on a command name literal.** Which fields to collect,
//    what to send and how the target is decided all come from
//    `COMMAND_TRAITS` / `LINK_TRAIT`; the one place a name is read is where
//    the request body's own shape differs (`buildSingleRequest`), which is
//    the discriminant of `CommandRequest` itself.
//
// **Operator words are not executed here, but the split is decided here.**
// `startCommand` receives them (see `event-sink.ts`'s `KNOWN_COMMAND_WORDS`)
// and hands them to `AdminFlow`, which is where the operator commands actually
// reach `relation/` and `growi/`. Keeping the routing in this one entrance is
// what makes it impossible for a word to be answered twice, or by neither.
import type {
  CommandName,
  CommandRequest,
  CommandResponse,
  SearchResultItem,
} from '@growi/chat';
import { COMMAND_NAMES, OP_NAMES } from '@growi/chat';

import { toProtocolChannelRef } from '../capabilities/index.js';
import {
  ADMIN_COMMAND_WORDS,
  type ArgumentCollector,
  COMMAND_TRAITS,
  type CommandTrait,
  type GrowiChoiceOption,
  LINK_COMMAND_WORD,
  LINK_TRAIT,
  type PrivateReplier,
  type PrivateReplyOrigin,
  privateReplyOriginOf,
  SEARCH_DEFAULT_LIMIT,
} from '../command/index.js';
import {
  type FanOutCollector,
  type FanOutOutcome,
  fuseResults,
  type GrowiClient,
} from '../growi/index.js';
import type { PlatformFacade } from '../platform/index.js';
import type {
  ExcludedGrowi,
  GrowiSelector,
  SelectionOutcome,
} from '../relation/index.js';
import type {
  HistoryMessage,
  Invocation,
  OutboundMessage,
  PlatformEvent,
  Relation,
  SdkChannelRef,
} from '../types/index.js';
import type { AdminFlow } from './admin-flow.js';
import type { CommandFlow, LinkPostedEvent } from './event-sink.js';
import { parseTimeRange, TIME_RANGE_USAGE } from './time-range.js';

/**
 * The facade operations a user command uses. Narrowed with `Pick` for the
 * same reason `ArgumentCollectorPlatform` is: a reader can see from the type
 * alone that running a command opens no connection and lists no channels,
 * and that a reply meant for one person can only go out through
 * `privateReplier`.
 */
export type CommandFlowPlatform = Pick<
  PlatformFacade,
  'post' | 'replace' | 'attachPreview' | 'fetchHistory'
>;

export interface CommandFlowDeps {
  readonly platform: CommandFlowPlatform;
  readonly selector: GrowiSelector;
  /**
   * Narrowed to the two ways a command STARTS waiting for something.
   * Resuming is `EventSink`'s edge, not this flow's -- the flow is called
   * back with what the resumption produced.
   */
  readonly collector: Pick<ArgumentCollector, 'start' | 'startGrowiChoice'>;
  readonly growiClient: Pick<GrowiClient, 'sendCommand' | 'startAccountLink'>;
  readonly fanOutCollector: FanOutCollector;
  /**
   * Which installation a channel belongs to.
   *
   * Injected because nothing on a `PlatformEvent` carries it: an event names
   * the platform and the channel, while `GrowiSelector` is addressed by
   * `installationId`, and no repository offers that lookup today
   * (`InstallationProvider.resolve` is keyed by workspace id, which an event
   * does not carry either). Passing it in keeps that gap in one visible
   * place, to be filled by whoever composes this flow (task 9.x), instead of
   * being guessed at here.
   */
  readonly resolveInstallationId: (
    channel: SdkChannelRef,
  ) => Promise<string | null>;
  /**
   * Where an operator word goes. Injected rather than built here so this flow
   * keeps one job -- deciding which of the two vocabularies a word belongs to
   * -- and so the admin flow's own dependencies (`PairingService`,
   * `RelationKeyService`, `GrowiClient`) do not become this flow's.
   */
  readonly adminFlow: AdminFlow;
  readonly privateReplier: PrivateReplier;
  /** Requirement 10.4 keys duplicate-execution detection on this. */
  readonly newRequestId?: () => string;
  readonly searchLimit?: number;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

const markdown = (text: string): OutboundMessage => ({
  kind: 'markdown',
  markdown: text,
});

/**
 * The ONE rendering of "you need to link your account with this GROWI".
 *
 * `growiLabel` is always named, not only where several GROWIs are linked: a
 * link is granted by one GROWI alone (Requirement 7.2), and a user who cannot
 * tell which one asked will tie the wrong account. Naming it unconditionally
 * also means the wording does not depend on a count this function would
 * otherwise have to be told.
 */
const accountLinkNotice = (
  growiLabel: string,
  linkUrl: string,
): OutboundMessage =>
  markdown(
    `GROWI「${growiLabel}」との紐付けが必要です。次のリンクを開き、その GROWI にログインした状態で紐付けを承認してください（1 回だけ使えます。短時間で失効します）: ${linkUrl}`,
  );

/**
 * How a GROWI may answer a command asked of every GROWI without giving what
 * was asked: by asking the user to link their account first (a GROWI that lets
 * no guest read answers an unlinked searcher this way, Requirement 7.6), or by
 * refusing with a reason. Each needs its own handling, so neither is folded
 * into "did not answer".
 */
type DeclinedAnswer =
  | {
      readonly kind: 'account-link-required';
      readonly growiLabel: string;
      readonly linkUrl: string;
    }
  | { readonly kind: 'refused'; readonly message: string };

/** One GROWI's answer to a command asked of every GROWI. */
type FanOutAnswer<T> =
  | { readonly kind: 'answered'; readonly value: T }
  | DeclinedAnswer;

interface DeclinedEntry {
  readonly relationId: string;
  readonly growiLabel: string;
  readonly answer: DeclinedAnswer;
}

/** `null` when the response is not a way of declining. */
const declinedAnswerOf = (response: CommandResponse): DeclinedAnswer | null => {
  switch (response.kind) {
    case 'account-link-required':
      return {
        kind: 'account-link-required',
        growiLabel: response.growiLabel,
        linkUrl: response.linkUrl,
      };
    case 'error':
      return { kind: 'refused', message: response.message };
    default:
      return null;
  }
};

const splitAnswers = <T>(
  responded: FanOutOutcome<FanOutAnswer<T>>['responded'],
): {
  readonly answered: FanOutOutcome<T>['responded'];
  readonly declined: ReadonlyArray<DeclinedEntry>;
} => ({
  answered: responded.flatMap(({ relationId, growiLabel, value }) =>
    value.kind === 'answered'
      ? [{ relationId, growiLabel, value: value.value }]
      : [],
  ),
  declined: responded.flatMap(({ relationId, growiLabel, value }) =>
    value.kind === 'answered'
      ? []
      : [{ relationId, growiLabel, answer: value }],
  ),
});

const declinedNote = (declined: ReadonlyArray<DeclinedEntry>): string | null =>
  declined.length === 0
    ? null
    : `結果に含まれていない GROWI: ${declined
        .map(({ growiLabel, answer }) => {
          switch (answer.kind) {
            case 'account-link-required':
              return `${growiLabel}（アカウントの紐付けが必要です。手順はあなたにだけ送りました）`;
            case 'refused':
              return `${growiLabel}（${answer.message}）`;
            default:
              return answer satisfies never;
          }
        })
        .join('、')}`;

const notRespondedNote = (
  notResponded: FanOutOutcome<unknown>['notResponded'],
): string | null =>
  notResponded.length === 0
    ? null
    : `応答がありませんでした: ${notResponded
        .map(
          (entry) =>
            `${entry.growiLabel}（${entry.reason === 'timeout' ? '時間切れ' : 'エラー'}）`,
        )
        .join('、')}`;

/**
 * Requirement 11.3 / design.md 「検索が黙って不完全になる」: a GROWI left out
 * by channel permission is named, with the two reasons kept apart because they
 * ask the reader to do different things.
 */
const excludedNote = (
  excluded: ReadonlyArray<ExcludedGrowi>,
): string | null => {
  const barred = excluded.filter(
    (entry) => entry.reason === 'not-permitted-in-channel',
  );
  const unconfigured = excluded.filter(
    (entry) => entry.reason === 'no-settings',
  );
  const notes = [
    barred.length === 0
      ? null
      : `このチャンネルでは許可されていないため対象外: ${barred.map((entry) => entry.growiLabel).join('、')}`,
    unconfigured.length === 0
      ? null
      : `権限が設定されていないため対象外: ${unconfigured.map((entry) => entry.growiLabel).join('、')}`,
  ].filter((note) => note != null);
  return notes.length === 0 ? null : notes.join('\n');
};

const footerOf = (
  outcome: FanOutOutcome<unknown>,
  declined: ReadonlyArray<DeclinedEntry>,
): string | undefined =>
  [
    declinedNote(declined),
    notRespondedNote(outcome.notResponded),
    excludedNote(outcome.excluded),
  ]
    .filter((note) => note != null)
    .join('\n') || undefined;

const explanation = (
  commandName: string,
  outcome: Extract<SelectionOutcome, { kind: 'explain' }>,
): OutboundMessage => {
  const head =
    outcome.reason === 'not-linked'
      ? 'このチャンネルから使える GROWI がまだ紐づいていません。運用者に GROWI の紐付けを依頼してください。'
      : `このチャンネルでは \`${commandName}\` を実行できません。GROWI の管理者に、このチャンネルからの実行を許可してもらってください。`;
  const note = excludedNote(outcome.excluded);
  return markdown(note == null ? head : `${head}\n${note}`);
};

const searchRowMarkdown = (item: SearchResultItem): string =>
  `[${item.title}](${item.url}) — ${item.path}`;

const helpRowMarkdown = (entry: {
  name: CommandName;
  usage: string;
  description: string;
}): string => `\`${entry.usage}\` — ${entry.description}`;

const previewMarkdown = (
  response: Extract<CommandResponse, { kind: 'link-preview' }>,
  growiLabel: string,
): OutboundMessage =>
  markdown(
    response.restricted
      ? // Requirement 6.3: nothing but the path for a page not everyone can read.
        `${growiLabel}: ${response.path}`
      : [
          `${growiLabel}: ${response.path}`,
          response.excerpt,
          [
            response.updatedAt == null ? null : `更新: ${response.updatedAt}`,
            response.commentCount == null
              ? null
              : `コメント: ${response.commentCount}`,
          ]
            .filter((part) => part != null)
            .join(' / ') || null,
        ]
          .filter((line) => line != null && line !== '')
          .join('\n'),
  );

// ---------------------------------------------------------------------------
// Reading the command's own declaration
// ---------------------------------------------------------------------------

/**
 * Narrowed with a guard rather than an assertion: `Invocation.commandName` is
 * whatever the user typed, and `COMMAND_TRAITS` / `SelectionRequest` are both
 * keyed by the declared vocabulary.
 */
const isCommandName = (word: string): word is CommandName =>
  Object.hasOwn(COMMAND_TRAITS, word);

/**
 * The declaration a typed word runs on, or `null` when there is none to run.
 *
 * `link-preview` is deliberately among the `null`s. It has a `COMMAND_TRAITS`
 * entry because it is part of the shared vocabulary, but its real entrance is
 * a posted URL (`previewLinks`); typed on its own it names no page, so it is
 * answered as an unknown word rather than given a path through here.
 */
const traitOf = (word: string): CommandTrait | null => {
  if (word === LINK_COMMAND_WORD) return LINK_TRAIT;
  if (!isCommandName(word) || word === COMMAND_NAMES.linkPreview) return null;
  return COMMAND_TRAITS[word];
};

/**
 * The operator vocabulary as a plain string set. `ADMIN_COMMAND_WORDS` is a
 * tuple of literals, so asking it about an arbitrary typed word needs a
 * widened view of it -- built here rather than asserted at the call site.
 */
const ADMIN_WORDS: ReadonlySet<string> = new Set<string>(ADMIN_COMMAND_WORDS);

const asChoiceOptions = (
  relations: ReadonlyArray<Relation>,
): ReadonlyArray<GrowiChoiceOption> =>
  relations.map((relation) => ({
    relationId: relation.relationId,
    growiLabel: relation.growiLabel,
  }));

const toKeepMessages = (messages: ReadonlyArray<HistoryMessage>) =>
  messages.map((message) => ({
    postedAt: message.postedAt,
    author: message.author,
    markdown: message.text,
  }));

/** Who a fan-out command is sent to, and who was left out of it. */
interface FanOutTargets {
  readonly targets: ReadonlyArray<Relation>;
  readonly excluded: ReadonlyArray<ExcludedGrowi>;
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export const createCommandFlow = (deps: CommandFlowDeps): CommandFlow => {
  const {
    platform,
    selector,
    collector,
    growiClient,
    fanOutCollector,
    resolveInstallationId,
    adminFlow,
    privateReplier,
    newRequestId = () => crypto.randomUUID(),
    searchLimit = SEARCH_DEFAULT_LIMIT,
  } = deps;

  const tell = async (
    origin: PrivateReplyOrigin,
    message: OutboundMessage,
  ): Promise<void> => {
    await privateReplier.reply(origin, message);
  };

  const announceAccountLinks = async (
    origin: PrivateReplyOrigin,
    declined: ReadonlyArray<DeclinedEntry>,
  ): Promise<void> => {
    await Promise.all(
      declined.map(({ answer }) =>
        answer.kind === 'account-link-required'
          ? tell(origin, accountLinkNotice(answer.growiLabel, answer.linkUrl))
          : undefined,
      ),
    );
  };

  const envelopeFor = (invocation: Invocation, relation: Relation) => ({
    op: OP_NAMES.command,
    relationId: relation.relationId,
    requestId: newRequestId(),
    actor: invocation.actor,
    channel: toProtocolChannelRef(invocation.channel),
  });

  /**
   * The permission judgement AND the candidate list, in one call. Answering
   * `null` means the flow cannot go on and the user has already been told
   * why (or, for a posted URL, deliberately told nothing).
   */
  const selectFor = async (
    invocation: Invocation,
    trait: CommandTrait,
  ): Promise<{
    readonly outcome: SelectionOutcome;
    readonly installationId: string;
  } | null> => {
    const installationId = await resolveInstallationId(invocation.channel);
    if (installationId == null) {
      await tell(
        privateReplyOriginOf(invocation, null),
        markdown(
          'このチャットの workspace がまだ登録されていません。運用者に設定を依頼してください。',
        ),
      );
      return null;
    }

    if (trait.targeting === 'all-paired-no-filter') {
      return {
        installationId,
        outcome: await selector.select({
          targeting: 'all-paired-no-filter',
          installationId,
        }),
      };
    }
    if (!isCommandName(invocation.commandName)) return null;
    return {
      installationId,
      outcome: await selector.select({
        // `url-match` never arrives here: `traitOf` refuses `link-preview`.
        targeting:
          trait.targeting === 'exactly-one' ? 'exactly-one' : 'all-permitted',
        installationId,
        channel: invocation.channel,
        commandName: invocation.commandName,
      }),
    };
  };

  /**
   * Which GROWIs may run `commandName` in this channel, asked of the one
   * component that owns the rule.
   *
   * `all-permitted` here is a permission QUERY, not the command's own
   * targeting: it is the request shape that answers "every GROWI this channel
   * may run this on" without collapsing to a choice. Reproducing `judge`'s
   * defaults locally instead would put a second authorization rule in the
   * codebase, free to drift from the first.
   */
  const permittedFor = async (
    installationId: string,
    channel: SdkChannelRef,
    commandName: CommandName,
  ): Promise<ReadonlySet<string>> => {
    const outcome = await selector.select({
      targeting: 'all-permitted',
      installationId,
      channel,
      commandName,
    });
    return new Set(
      outcome.kind === 'execute'
        ? outcome.targets.map((target) => target.relationId)
        : [],
    );
  };

  // -- posting -------------------------------------------------------------

  /**
   * design.md's 「いったん投稿して差し替える」: a `MessageRef` does not exist
   * before the first post, and the chat services allow ~3 seconds, so the
   * placeholder goes out first and the answer replaces it.
   *
   * When the placeholder could not be posted at all, the answer is sent to
   * the person who asked instead, as the one route left when the bot cannot
   * write in the channel.
   */
  const deliver = async (
    invocation: Invocation,
    origin: PrivateReplyOrigin,
    placeholder: Awaited<ReturnType<CommandFlowPlatform['post']>>,
    message: OutboundMessage,
  ): Promise<void> => {
    if (!placeholder.ok) {
      await tell(origin, message);
      return;
    }
    await platform.replace(
      { channel: invocation.channel, messageId: placeholder.messageId },
      message,
    );
  };

  // -- one GROWI -----------------------------------------------------------

  /**
   * The body of a command that runs against a single GROWI, or `null` when
   * the command ends here (Requirement 5.5's empty range, an unreadable
   * channel, a range that cannot be read whole) -- in which case the user has
   * already been told.
   */
  const buildSingleRequest = async (
    invocation: Invocation,
    origin: PrivateReplyOrigin,
    relation: Relation,
    values: Readonly<Record<string, string>>,
  ): Promise<CommandRequest | null> => {
    if (invocation.commandName === COMMAND_NAMES.createPage) {
      return {
        ...envelopeFor(invocation, relation),
        kind: COMMAND_NAMES.createPage,
        path: values.path ?? '',
        body: values.body ?? '',
      };
    }
    if (invocation.commandName !== COMMAND_NAMES.keep) return null;

    const range = parseTimeRange(values.range ?? '');
    if (range == null) {
      await tell(origin, markdown(TIME_RANGE_USAGE));
      return null;
    }

    const history = await platform.fetchHistory(invocation.channel, range);
    if (!history.ok) {
      // Requirement 5.4 / 5.6: the reason AND what to do about it, both of
      // which `HistoryOutcome` already carries.
      await tell(origin, markdown(history.remedy));
      return null;
    }
    if (history.messages.length === 0) {
      // Requirement 5.5: no page, and GROWI is not called at all.
      await tell(
        origin,
        markdown(
          '指定された範囲に発言が 1 件もありませんでした。ページは作成していません。',
        ),
      );
      return null;
    }

    return {
      ...envelopeFor(invocation, relation),
      kind: COMMAND_NAMES.keep,
      path: values.path ?? '',
      messages: toKeepMessages(history.messages),
    };
  };

  const showResponse = async (
    invocation: Invocation,
    origin: PrivateReplyOrigin,
    relation: Relation,
    response: CommandResponse,
  ): Promise<void> => {
    switch (response.kind) {
      case 'created':
        // The channel sees this: a new page is the outcome of a conversation
        // happening there, not a private answer.
        await platform.post(
          invocation.channel,
          markdown(
            `GROWI「${relation.growiLabel}」にページを作成しました: ${response.pageUrl}`,
          ),
        );
        return;
      case 'account-link-required':
        // Requirement 7.6, through the same one function `link` uses.
        await tell(
          origin,
          accountLinkNotice(response.growiLabel, response.linkUrl),
        );
        return;
      case 'error':
        await tell(
          origin,
          markdown(
            `GROWI「${relation.growiLabel}」で実行できませんでした: ${response.message}`,
          ),
        );
        return;
      default:
        // `search` / `help` are answered through the fan-out and
        // `link-preview` through `previewLinks`; arriving here means GROWI
        // answered a different question than the one asked.
        await tell(
          origin,
          markdown(
            `GROWI「${relation.growiLabel}」から想定外の応答が返りました。`,
          ),
        );
    }
  };

  const runSingle = async (
    invocation: Invocation,
    origin: PrivateReplyOrigin,
    relation: Relation,
    values: Readonly<Record<string, string>>,
  ): Promise<void> => {
    const request = await buildSingleRequest(
      invocation,
      origin,
      relation,
      values,
    );
    if (request == null) return;

    const sent = await growiClient.sendCommand(relation.growiUri, request);
    if (!sent.ok) {
      await tell(
        origin,
        markdown(`GROWI「${relation.growiLabel}」に届きませんでした。`),
      );
      return;
    }
    await showResponse(invocation, origin, relation, sent.response);
  };

  const runAccountLink = async (
    invocation: Invocation,
    origin: PrivateReplyOrigin,
    relation: Relation,
  ): Promise<void> => {
    const started = await growiClient.startAccountLink(relation.growiUri, {
      op: OP_NAMES.accountLinkStart,
      relationId: relation.relationId,
      actor: invocation.actor,
    });
    if (!started.ok) {
      await tell(
        origin,
        markdown(`GROWI「${relation.growiLabel}」に届きませんでした。`),
      );
      return;
    }

    const response = started.response;
    if (response.status === 'link-issued') {
      await tell(
        origin,
        accountLinkNotice(relation.growiLabel, response.linkUrl),
      );
      return;
    }
    await tell(
      origin,
      markdown(
        response.status === 'already-linked'
          ? `GROWI「${relation.growiLabel}」には既に ${response.growiUserName} として紐付いています。`
          : // Requirement 7.4.
            `GROWI「${relation.growiLabel}」では、このチャットアカウントが既に別の GROWI ユーザーに紐付いています。GROWI 側で紐付けを解除してから、もう一度お試しください。`,
      ),
    );
  };

  // -- every permitted GROWI ----------------------------------------------

  const runSearch = async (
    invocation: Invocation,
    origin: PrivateReplyOrigin,
    { targets, excluded }: FanOutTargets,
    keyword: string,
  ): Promise<void> => {
    const placeholder = await platform.post(
      invocation.channel,
      markdown(`「${keyword}」を検索しています…`),
    );

    const outcome = await fanOutCollector.fanOut<
      FanOutAnswer<ReadonlyArray<SearchResultItem>>
    >({
      targets,
      excluded,
      build: (relation) => ({
        ...envelopeFor(invocation, relation),
        kind: COMMAND_NAMES.search,
        keyword,
        // design.md: 「`limit` は proxy が決める（既定 10）」.
        limit: searchLimit,
      }),
      extract: (response) => {
        const declined = declinedAnswerOf(response);
        if (declined != null) return declined;
        if (response.kind !== COMMAND_NAMES.search) {
          throw new Error(`not a search answer: ${response.kind}`);
        }
        return { kind: 'answered', value: response.items };
      },
    });
    const { answered, declined } = splitAnswers(outcome.responded);
    await announceAccountLinks(origin, declined);

    const fused = fuseResults(
      answered.map((entry) => ({
        relationId: entry.relationId,
        growiLabel: entry.growiLabel,
        // Requirement 3.8: the operator's own weight for that GROWI.
        weight:
          targets.find((target) => target.relationId === entry.relationId)
            ?.searchWeight ?? 1,
        items: entry.value,
      })),
      { limit: searchLimit },
    );

    const footer = footerOf(outcome, declined);
    await deliver(
      invocation,
      origin,
      placeholder,
      fused.length === 0
        ? // Requirement 3.5: say that nothing came back, and who was silent.
          markdown(
            [`「${keyword}」の結果は得られませんでした。`, footer]
              .filter((line) => line != null)
              .join('\n'),
          )
        : {
            kind: 'list',
            title: `「${keyword}」の検索結果`,
            // Requirement 3.3: every row says which GROWI it came from.
            rows: fused.map((result) => ({
              markdown: searchRowMarkdown(result.item),
              sourceLabel: result.growiLabel,
            })),
            ...(footer == null ? {} : { footer }),
          },
    );
  };

  const runHelp = async (
    invocation: Invocation,
    origin: PrivateReplyOrigin,
    installationId: string,
    { targets, excluded }: FanOutTargets,
  ): Promise<void> => {
    const placeholder = await platform.post(
      invocation.channel,
      markdown('使えるコマンドを調べています…'),
    );

    const outcome = await fanOutCollector.fanOut<
      FanOutAnswer<Extract<CommandResponse, { kind: 'help' }>['commands']>
    >({
      targets,
      excluded,
      build: (relation) => ({
        ...envelopeFor(invocation, relation),
        kind: COMMAND_NAMES.help,
      }),
      extract: (response) => {
        const declined = declinedAnswerOf(response);
        if (declined != null) return declined;
        if (response.kind !== COMMAND_NAMES.help) {
          throw new Error(`not a help answer: ${response.kind}`);
        }
        return { kind: 'answered', value: response.commands };
      },
    });
    const { answered, declined } = splitAnswers(outcome.responded);
    await announceAccountLinks(origin, declined);

    // Requirement 14.4: a command this channel may not run is left out. The
    // judgement is asked of `GrowiSelector`, once per command name the GROWIs
    // actually named -- not per (GROWI x command), and not re-derived here.
    const named = [
      ...new Set(
        answered.flatMap((entry) => entry.value.map((command) => command.name)),
      ),
    ];
    const permitted = new Map(
      await Promise.all(
        named.map(
          async (name) =>
            [
              name,
              await permittedFor(installationId, invocation.channel, name),
            ] as const,
        ),
      ),
    );

    // Requirement 14.3: one row per (GROWI, command), each labelled with the
    // GROWI it describes -- what a GROWI offers differs by version.
    const rows = answered.flatMap((entry) =>
      entry.value
        .filter((command) => permitted.get(command.name)?.has(entry.relationId))
        .map((command) => ({
          markdown: helpRowMarkdown(command),
          sourceLabel: entry.growiLabel,
        })),
    );

    const footer = footerOf(outcome, declined);
    await deliver(
      invocation,
      origin,
      placeholder,
      rows.length === 0
        ? markdown(
            ['このチャンネルで使えるコマンドはありませんでした。', footer]
              .filter((line) => line != null)
              .join('\n'),
          )
        : {
            kind: 'list',
            title: 'このチャンネルで使えるコマンド',
            rows,
            ...(footer == null ? {} : { footer }),
          },
    );
  };

  // -- putting the steps in order -----------------------------------------

  const runOn = async (work: {
    readonly invocation: Invocation;
    readonly trait: CommandTrait;
    /** Carried from the selection, not resolved again -- see `selectFor`. */
    readonly installationId: string;
    readonly targets: ReadonlyArray<Relation>;
    readonly excluded: ReadonlyArray<ExcludedGrowi>;
    readonly values: Readonly<Record<string, string>>;
  }): Promise<void> => {
    const { invocation, trait, installationId, targets, excluded, values } =
      work;
    const [first] = targets;
    if (first == null) return;
    const origin = privateReplyOriginOf(invocation, installationId);

    if (trait.sends === 'account-link-start') {
      await runAccountLink(invocation, origin, first);
      return;
    }
    if (trait.targeting === 'exactly-one') {
      await runSingle(invocation, origin, first, values);
      return;
    }
    if (invocation.commandName === COMMAND_NAMES.search) {
      await runSearch(
        invocation,
        origin,
        { targets, excluded },
        values.keyword ?? '',
      );
      return;
    }
    if (invocation.commandName === COMMAND_NAMES.help) {
      await runHelp(invocation, origin, installationId, { targets, excluded });
    }
  };

  /**
   * The last two steps, once the values are in.
   *
   * The 「どの GROWI に対して?」 question is asked HERE rather than before the
   * values, so a user who is going to be asked for a path and a body is asked
   * for everything in one stretch, and the answer to the choice can carry the
   * values with it (`ArgumentCollector.startGrowiChoice`) instead of needing
   * a second stored row. The permission judgement is unaffected: it already
   * ran, in `selectFor`, before anything was asked of the user.
   */
  const dispatch = async (
    invocation: Invocation,
    trait: CommandTrait,
    selected: { outcome: SelectionOutcome; installationId: string },
    values: Readonly<Record<string, string>>,
  ): Promise<void> => {
    const { outcome, installationId } = selected;
    if (outcome.kind === 'silent') return;
    if (outcome.kind === 'explain') {
      await tell(
        privateReplyOriginOf(invocation, installationId),
        explanation(invocation.commandName, outcome),
      );
      return;
    }
    if (outcome.kind === 'choose') {
      // Requirement 8.2. An `unavailable` answer needs nothing more from
      // here: the replier has already told the user and the operator.
      await collector.startGrowiChoice(
        invocation,
        values,
        asChoiceOptions(outcome.options),
      );
      return;
    }
    await runOn({
      invocation,
      trait,
      installationId,
      targets: outcome.targets,
      excluded: outcome.excluded,
      values,
    });
  };

  const startFrom = async (
    invocation: Invocation,
    trait: CommandTrait,
    values: Readonly<Record<string, string>>,
  ): Promise<void> => {
    const selected = await selectFor(invocation, trait);
    if (selected == null) return;
    await dispatch(invocation, trait, selected, values);
  };

  return {
    startCommand: async (invocation) => {
      const word = invocation.commandName;
      // The operator vocabulary is carried out by its own flow. Answering it
      // here as well would tell the operator twice.
      if (ADMIN_WORDS.has(word)) {
        await adminFlow.run(invocation);
        return;
      }

      const trait = traitOf(word);
      if (trait == null) {
        // The platform's own UI already told the user they were addressing
        // this bot, so an unrecognised word owes them an answer.
        await tell(
          privateReplyOriginOf(invocation, null),
          markdown(
            `\`${word}\` というコマンドはありません。\`help\` で、このチャンネルで使えるコマンドを確認できます。`,
          ),
        );
        return;
      }

      // Step 1 and 2: may this channel run it, and against which GROWIs.
      const selected = await selectFor(invocation, trait);
      if (selected == null) return;
      const { outcome, installationId } = selected;
      if (outcome.kind === 'silent') return;
      if (outcome.kind === 'explain') {
        // Nothing is asked of the user for a command that cannot run.
        await tell(
          privateReplyOriginOf(invocation, installationId),
          explanation(word, outcome),
        );
        return;
      }

      // Step 3: the values. Already-complete command lines finish here with
      // no round trip at all. `pending` waits for the answer; on
      // `unavailable` the replier has already told the user and the operator.
      const started = await collector.start(invocation, trait.fields);
      if (started.status !== 'collected') return;

      // Steps 4 and 5, with the selection this call already made -- asking
      // for it again would double the permission reads and leave a window
      // where the two answers disagree.
      await dispatch(invocation, trait, selected, started.values);
    },

    runCollected: async (invocation, values) => {
      const trait = traitOf(invocation.commandName);
      if (trait == null) return;
      // Judged again, not remembered: the answer arrives as a separate event,
      // possibly minutes later and on another process, and Requirement 11.4
      // says the settings in force at execution time are the ones applied.
      await startFrom(invocation, trait, values);
    },

    runChosenGrowi: async (invocation, values, relationId) => {
      const trait = traitOf(invocation.commandName);
      if (trait == null) return;
      const selected = await selectFor(invocation, trait);
      if (selected == null) return;
      const { outcome, installationId } = selected;
      const origin = privateReplyOriginOf(invocation, installationId);
      if (outcome.kind === 'silent') return;
      if (outcome.kind === 'explain') {
        await tell(origin, explanation(invocation.commandName, outcome));
        return;
      }

      // The pressed GROWI is looked for in the list as it stands NOW. The
      // offered list was permission-filtered when it was shown, and this is
      // what keeps that true at the moment the command actually runs.
      const candidates =
        outcome.kind === 'choose' ? outcome.options : outcome.targets;
      const chosen = candidates.find(
        (candidate) => candidate.relationId === relationId,
      );
      if (chosen == null) {
        await tell(
          origin,
          markdown(
            '選ばれた GROWI は、このチャンネルからは実行できなくなりました。もう一度コマンドを打ち直してください。',
          ),
        );
        return;
      }
      await runOn({
        invocation,
        trait,
        installationId,
        targets: [chosen],
        excluded: outcome.excluded,
        values,
      });
    },

    previewLinks: async (event: LinkPostedEvent) => {
      const installationId = await resolveInstallationId(event.channel);
      if (installationId == null) return;

      // The same link pasted twice earns one summary, not two (Requirement
      // 6.1 attaches *a* summary to the message).
      for (const url of new Set(event.urls)) {
        // biome-ignore lint/performance/noAwaitInLoops: one message's links are handled one at a time on purpose -- each one is a signed request to a GROWI, and a message carrying many links would otherwise fire them all at once; the previews also read in the order the links were written.
        const outcome = await selector.select({
          targeting: 'url-match',
          installationId,
          channel: event.channel,
          commandName: COMMAND_NAMES.linkPreview,
          url,
        });
        // Requirement 6.4: a link that belongs to no linked GROWI draws no
        // message of any kind.
        if (outcome.kind === 'silent') continue;
        if (outcome.kind === 'explain') {
          await tell(
            {
              channel: event.channel,
              actor: event.actor,
              sourceMessageId: event.messageRef.messageId,
              requestSummary: 'リンクの展開',
              installationId,
            },
            explanation(COMMAND_NAMES.linkPreview, outcome),
          );
          continue;
        }
        // `url-match` never answers `choose`: a URL matches one GROWI.
        if (outcome.kind === 'choose') continue;

        const [relation] = outcome.targets;
        if (relation == null) continue;
        const sent = await growiClient.sendCommand(relation.growiUri, {
          op: OP_NAMES.command,
          relationId: relation.relationId,
          requestId: newRequestId(),
          actor: event.actor,
          channel: toProtocolChannelRef(event.channel),
          kind: COMMAND_NAMES.linkPreview,
          pageUrl: url,
        });
        if (!sent.ok || sent.response.kind !== COMMAND_NAMES.linkPreview) {
          // A link nobody asked about: failing quietly is better than
          // complaining in the channel about every message carrying a URL.
          continue;
        }
        await platform.attachPreview(
          event.messageRef,
          previewMarkdown(sent.response, relation.growiLabel),
        );
      }
    },

    reportExpired: async (event: PlatformEvent) => {
      // An event carries no invocation, so the summary names what expired.
      await tell(
        {
          channel: event.channel,
          actor: event.actor,
          sourceMessageId: event.kind === 'mention' ? event.messageId : null,
          requestSummary: '入力の続き',
          installationId: null,
        },
        markdown(
          '入力の有効期限が切れました。お手数ですが、もう一度コマンドを打ち直してください。',
        ),
      );
    },
  };
};
