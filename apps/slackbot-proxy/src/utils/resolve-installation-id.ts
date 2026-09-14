/**
 * Resolve the single id to use when saving or looking up an Installation row.
 *
 * A Slack Enterprise Grid workspace-level install carries both a teamId and
 * an enterpriseId at once. Always prefer teamId when present so every call
 * site agrees on the same key regardless of where it runs — mixing
 * priorities between save and lookup sites previously made installations
 * unfindable after being saved.
 */
export const resolveInstallationId = (ids: {
  teamId?: string | null;
  enterpriseId?: string | null;
}): string | undefined => {
  return ids.teamId ?? ids.enterpriseId ?? undefined;
};
