// `AdminFlow` -- carrying out what an operator typed.
//
// `AdminCommandSet` (`command/admin-command-set.ts`) reads the words and
// answers with an `AdminCommandIntent`: a value describing the operation and
// its arguments, deliberately never a call, because `command/` sits to the
// LEFT of `relation/` and `growi/` in the declared dependency order. This file
// is the other half -- the one place where those intents actually reach
// `PairingService`, `RelationKeyService` and `GrowiClient`.
//
// The decisions that live here and nowhere else:
//
//  - **Where the actor's roles come from.** `isWorkspaceAdmin` needs the
//    actor's roles, and reading them means calling the chat service -- which
//    only `platform/` may do. So the observation is a REQUIRED dependency,
//    exactly as `CommandFlow` takes `resolveInstallationId`: whoever composes
//    this flow joins `PlatformFacade.observeActorRoles` to the channel it was
//    typed in (`runtime/dependencies.ts`). It is required, not optional with a
//    default, because a default is precisely the "forgot to pass it" path task
//    4.3 closed by making `actor` a required parameter.
//  - **Where the answer is shown.** Driven off `intent.delivery`, never off
//    the operation. That is what makes 「登録コードは本人にだけ見えるメッセージ
//    で返す」 structural: `issue-pairing-code` pins the literal `'ephemeral'`
//    in its type, so a branch posting it to the channel cannot be written
//    without contradicting the type it read.
//  - **The two halves of a rotation stay apart.** `rotate-key` runs steps 1-3
//    (`rotate`); `rotate-key status` runs step 4 (`revokeOldIfAllDelivered`),
//    which design.md's AdminCommandSet table assigns to it by name. Calling
//    both from one word would revoke inside the same command that mints.
//  - **`GrowiClient.registerKey` / `.revokeKey` are handed over as they are.**
//    They are structurally `SendKeyRegistration` / `SendKeyRevocation`, which
//    is why `KeyDeliveryOutcome`'s field is named `response`; an adapter here
//    would be a second declaration of the same shape, free to drift.
import type { ChannelRef } from '@growi/chat';

import {
  type AdminCommandIntent,
  type AdminDelivery,
  parseAdminCommand,
} from '../command/index.js';
import { createRelationRepository, type DbClient } from '../db/index.js';
import type { GrowiClient } from '../growi/index.js';
import type { PlatformFacade } from '../platform/index.js';
import {
  PairingOrderLimitError,
  type PairingService,
  type RelationKeyService,
  type RotationStatus,
} from '../relation/index.js';
import type {
  AdminActorRoles,
  Invocation,
  OutboundMessage,
  Relation,
} from '../types/index.js';

/**
 * The two facade operations an operator command uses. Narrowed with `Pick`
 * for the same reason `CommandFlowPlatform` is: a reader can see from the
 * type alone that running an operator command opens no connection, lists no
 * channels and reads no history.
 */
export type AdminFlowPlatform = Pick<PlatformFacade, 'post' | 'postEphemeral'>;

/**
 * The actor's roles on the chat service, as the caller observed them, or
 * `null` when they could not be observed at all.
 *
 * A missing answer is NOT an empty one. Both end in a refusal -- which is the
 * safe direction -- but the operator has to be told which happened: "you are
 * not an admin" sends them to their workspace's settings, while "this proxy
 * could not read your roles" is a fault in the proxy's own configuration.
 */
export type ObserveActorRoles = (
  invocation: Invocation,
) => Promise<AdminActorRoles | null>;

export interface AdminFlowDeps {
  readonly db: DbClient;
  readonly platform: AdminFlowPlatform;
  readonly pairing: Pick<PairingService, 'issueCode' | 'unpair'>;
  readonly keyService: Pick<
    RelationKeyService,
    'rotate' | 'rotationStatus' | 'revokeOldIfAllDelivered'
  >;
  readonly growiClient: Pick<GrowiClient, 'registerKey' | 'revokeKey'>;
  /** See `CommandFlowDeps.resolveInstallationId`: the same gap, filled once. */
  readonly resolveInstallationId: (
    channel: ChannelRef,
  ) => Promise<string | null>;
  readonly observeActorRoles: ObserveActorRoles;
}

export interface AdminFlow {
  /**
   * Runs one operator word. Reached from `CommandFlow.startCommand`, which
   * owns the user/operator split; a word that is not an operator word never
   * arrives here, and is answered as unknown rather than silently ignored.
   */
  run(invocation: Invocation): Promise<void>;
}

// ---------------------------------------------------------------------------
// The search weight's range
// ---------------------------------------------------------------------------

/**
 * `AdminCommandSet` checks only that the typed weight is a finite number and
 * leaves the range to whoever writes `relation.search_weight` -- which is
 * here (task 4.3's hand-off).
 *
 * The bounds are this file's own judgement, design.md declaring none:
 *
 *  - **Not zero, and not negative.** `fuseResults` scores an item as
 *    `weight / (k + rank)`, so a weight of zero drops the GROWI out of every
 *    result while it still counts as a permitted target -- a silently
 *    incomplete search, which Requirement 11.3 exists to prevent. Excluding a
 *    GROWI is what channel permissions are for.
 *  - **A ceiling.** One GROWI at an enormous weight pushes every other
 *    GROWI's results below the cut, which looks exactly like the others
 *    having failed to answer.
 *  - **A whole number.** `search_weight` is an integer column, so a fraction
 *    would be stored as something other than what was typed.
 */
export const MIN_SEARCH_WEIGHT = 1;
export const MAX_SEARCH_WEIGHT = 1000;

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

const markdown = (text: string): OutboundMessage => ({
  kind: 'markdown',
  markdown: text,
});

const labelsOf = (relations: ReadonlyArray<Relation>): string =>
  relations.map((relation) => relation.growiLabel).join('、');

const rotationLine = (
  label: string,
  delivered: boolean,
  detail: string | null,
): string =>
  delivered
    ? `- ${label}: 新しい鍵を受け取りました`
    : `- ${label}: まだ受け取っていません${detail == null ? '' : `（${detail}）`}`;

const statusLine = (status: RotationStatus): string => {
  if (status.problem != null) {
    return `- ${status.growiLabel}: 鍵の状態を読み取れません（${status.problem}）。運用者が調べる必要があります`;
  }
  if (status.newKeyId == null) {
    return `- ${status.growiLabel}: 入れ替えは行われていません`;
  }
  return rotationLine(status.growiLabel, status.deliveredToPeer, null);
};

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export const createAdminFlow = (deps: AdminFlowDeps): AdminFlow => {
  const {
    platform,
    pairing,
    keyService,
    growiClient,
    resolveInstallationId,
    observeActorRoles,
  } = deps;
  const relations = createRelationRepository(deps.db);

  /**
   * Shows one answer where the intent says it belongs.
   *
   * Everything that is not an intent's own answer -- a refusal, a mistyped
   * line, a missing installation -- goes to the person who typed it and
   * nowhere else: those say nothing the channel needs, and the refusals name
   * roles.
   */
  const say = async (
    invocation: Invocation,
    text: string,
    delivery: AdminDelivery = 'ephemeral',
  ): Promise<void> => {
    if (delivery === 'channel') {
      await platform.post(invocation.channel, markdown(text));
      return;
    }
    await platform.postEphemeral(
      invocation.channel,
      invocation.actor,
      markdown(text),
    );
  };

  const issuePairingCode = async (
    invocation: Invocation,
    installationId: string,
  ): Promise<string> => {
    try {
      const { code, expiresAt } = await pairing.issueCode(
        installationId,
        invocation.actor,
      );
      return `登録コード: \`${code}\`\nGROWI の管理画面のチャット連携の設定に貼り付けてください。${expiresAt.toISOString()} まで有効です。`;
    } catch (error) {
      if (error instanceof PairingOrderLimitError) {
        // The limit itself is the answer; the message must not carry a code,
        // and there is none to carry.
        return '発行済みの登録コードが上限に達しています。すでに発行したコードを使うか、失効するまで待ってください。';
      }
      throw error;
    }
  };

  const unregister = async (installationId: string): Promise<string> => {
    const paired = await relations.listByInstallation(installationId);
    if (paired.length === 0) {
      return 'この workspace には GROWI が紐づいていません。';
    }
    if (paired.length > 1) {
      // `unregister` carries no GROWI to act on, so with several paired there
      // is nothing that says which one. Of the five operator commands this is
      // the destructive one, so it refuses rather than picks.
      return `この workspace には複数の GROWI が紐づいています（${labelsOf(paired)}）。解除する GROWI を指定できないため、何もしていません。GROWI の管理画面から解除してください。`;
    }
    await pairing.unpair(paired[0].relationId);
    return `GROWI「${paired[0].growiLabel}」の紐付けを解除しました。`;
  };

  const setSearchWeight = async (
    installationId: string,
    growiRef: string,
    weight: number,
  ): Promise<string> => {
    if (
      !Number.isInteger(weight) ||
      weight < MIN_SEARCH_WEIGHT ||
      weight > MAX_SEARCH_WEIGHT
    ) {
      return `検索の重みは ${MIN_SEARCH_WEIGHT} 以上 ${MAX_SEARCH_WEIGHT} 以下の整数で指定してください。`;
    }

    const paired = await relations.listByInstallation(installationId);
    // Either name works: `AdminCommandSet` deliberately does not decide
    // whether `growiRef` names a label or a URI, because answering that means
    // reading the `relation` rows -- which is what happens here.
    const matched = paired.filter(
      (relation) =>
        relation.growiLabel === growiRef || relation.growiUri === growiRef,
    );
    if (matched.length === 0) {
      return `GROWI「${growiRef}」はこの workspace に紐づいていません。${paired.length === 0 ? '' : `紐づいているのは ${labelsOf(paired)} です。`}`;
    }
    if (matched.length > 1) {
      return `GROWI「${growiRef}」は複数の紐付けに一致します。GROWI の URI で指定してください。`;
    }

    await relations.updateSearchWeight(matched[0].relationId, weight);
    return `GROWI「${matched[0].growiLabel}」の検索の重みを ${weight} にしました。`;
  };

  const rotateKey = async (installationId: string): Promise<string> => {
    // `registerKey` is handed over as it is -- see the file header.
    const results = await keyService.rotate(
      installationId,
      growiClient.registerKey,
    );
    if (results.length === 0) {
      return 'この workspace には GROWI が紐づいていないため、入れ替える鍵がありません。';
    }

    const paired = await relations.listByInstallation(installationId);
    const labelOf = (relationId: string): string =>
      paired.find((relation) => relation.relationId === relationId)
        ?.growiLabel ?? relationId;

    const lines = results.map((result) =>
      rotationLine(
        labelOf(result.relationId),
        result.delivery.ok,
        result.delivery.ok ? null : result.delivery.reason,
      ),
    );
    return [
      '鍵の入れ替えを進めました。古い鍵はまだ有効です。',
      ...lines,
      '相手側を直したあとに `rotate-key` をもう一度打つと、届いていない GROWI にだけ配り直します。全て受け取ったら `rotate-key status` で古い鍵を失効させてください。',
    ].join('\n');
  };

  const rotateKeyStatus = async (installationId: string): Promise<string> => {
    // Read BEFORE step 4 runs: revoking finishes the rotation, so a listing
    // taken afterwards would describe the state this command just created
    // rather than the one it was asked about.
    const statuses = await keyService.rotationStatus(installationId);
    const revoked = await keyService.revokeOldIfAllDelivered(
      installationId,
      growiClient.revokeKey,
    );

    if (statuses.length === 0) {
      return 'この workspace には GROWI が紐づいていないため、入れ替え中の鍵がありません。';
    }
    const head = revoked
      ? '全ての GROWI が新しい鍵を受け取ったので、古い鍵を失効させました。'
      : '古い鍵はまだ失効させていません。';
    return [head, ...statuses.map(statusLine)].join('\n');
  };

  const carryOut = (
    invocation: Invocation,
    intent: AdminCommandIntent,
    installationId: string,
  ): Promise<string> => {
    switch (intent.operation) {
      case 'issue-pairing-code':
        return issuePairingCode(invocation, installationId);
      case 'unregister':
        return unregister(installationId);
      case 'set-search-weight':
        return setSearchWeight(installationId, intent.growiRef, intent.weight);
      case 'rotate-key':
        return rotateKey(installationId);
      case 'rotate-key-status':
        return rotateKeyStatus(installationId);
    }
  };

  return {
    run: async (invocation) => {
      const roles = await observeActorRoles(invocation);
      if (roles == null) {
        await say(
          invocation,
          'この操作を実行してよいかを判定できませんでした（チャットサービスから権限を読み取れません）。proxy の運用者に連絡してください。',
        );
        return;
      }

      const outcome = parseAdminCommand(invocation, roles);
      if (outcome.kind === 'not-admin-command') {
        // Unreachable through `CommandFlow`, which only routes operator words
        // here. Left as a silent return rather than an answer: if another
        // caller appears, the word belongs to `CommandSet`, and answering here
        // would mean the user is told twice.
        return;
      }
      if (outcome.kind === 'denied') {
        await say(
          invocation,
          `\`${outcome.word}\` を実行できるのは workspace の管理者だけです（${outcome.requiredAnyOf.join(' または ')}）。`,
        );
        return;
      }
      if (outcome.kind === 'invalid') {
        await say(invocation, outcome.detail);
        return;
      }

      const installationId = await resolveInstallationId(invocation.channel);
      if (installationId == null) {
        await say(
          invocation,
          'このチャンネルを受け持つ workspace の登録が見つかりませんでした。proxy の運用者に連絡してください。',
        );
        return;
      }

      await say(
        invocation,
        await carryOut(invocation, outcome.intent, installationId),
        outcome.intent.delivery,
      );
    },
  };
};
