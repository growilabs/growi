// The actor's role/permission facts, shared by the layer that READS them
// (`platform/actor-roles.ts` -- the only layer allowed to name a Chat SDK) and
// the layer that JUDGES them (`command/admin-command-set.ts`'s
// `isWorkspaceAdmin`). `platform/` sits to the LEFT of `command/` in the
// declared dependency order, so a type both of them use can only live here.
//
// Zero imports from `chat` / `@chat-adapter/*`, like every other file in this
// directory.

/**
 * `grantedFields` holds the role names or permission flags the actor actually
 * has, in the same vocabulary `ADMIN_CHECK_TABLE`
 * (`capabilities/admin-check.ts`) declares (`is_admin`, `ADMINISTRATOR`,
 * `system_admin`, `owner`, ...). Reading and judging are kept apart so the
 * judgement stays a pure function of facts someone else observed.
 *
 * Mattermost's `team_admin` is scoped to a team, so a reader must include it
 * only when the actor holds it on the team the command was typed in --
 * `ADMIN_CHECK_TABLE` records that scoping in its `description`, and no
 * boolean answer can carry it.
 *
 * **An empty `grantedFields` is not the same as no answer.** Whoever observes
 * these facts reports "could not be read at all" as `null` instead, because
 * `AdminFlow` shows the two as different messages: 「あなたは管理者ではない」
 * sends the operator to their workspace's settings, while 「権限を読み取れま
 * せん」 is a fault in this proxy's own configuration.
 */
export interface AdminActorRoles {
  readonly grantedFields: ReadonlyArray<string>;
}
