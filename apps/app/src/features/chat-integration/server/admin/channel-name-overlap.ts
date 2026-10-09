// Requirement 12.4: warn an administrator, AT CONFIGURATION TIME, when the
// same channel is a destination for both Gen 1 and Gen 2 -- otherwise one
// page event is posted to that channel twice, once by each generation, and
// nobody notices until the channel is noisy.
//
// The match is by channel NAME, and that is a deliberate approximation, not
// an oversight (design.md "要件 12.4 -- 宛先が重なるときの注意喚起"): Gen 1's
// `SlackAppIntegration` holds no workspace identifier, so "are Gen 1 and
// Gen 2 talking to the same workspace" cannot be decided by identifier at
// all, and Gen 1's own destinations (`GlobalNotificationSetting`'s
// `slackChannels`) are stored as names with no identifier alongside them.
// Two different workspaces with a same-named channel therefore produce a
// false warning. That is the side to err on for a configuration-time
// warning, and design.md says so explicitly -- do NOT "fix" this by trying
// to match more precisely.
//
// Normalisation follows the same bias. An operator types Gen 1's channel
// list by hand, so `#general`, ` general`, and `General` all mean the
// channel Gen 2 stored as `general`; comparing raw strings would miss every
// one of those and produce a silent non-warning, which is the failure mode
// that actually costs something here.

/** The one Gen 2 destination shape this comparison needs. */
export interface ComparableDestination {
  readonly platform: string;
  readonly channelId: string;
  readonly channelName: string;
}

export interface ChannelNameOverlap {
  readonly channelId: string;
  readonly channelName: string;
}

/**
 * Gen 1's global notification settings can only ever post to Slack
 * (`GlobalNotificationSlackSetting` is the only chat-bound discriminator it
 * has), so a Gen 2 destination on any other service cannot collide with one
 * however its name reads. This is a fact about the Gen 1 side of the
 * comparison, not per-platform behaviour of Gen 2 -- nothing else in this
 * feature branches on a platform name.
 */
const GEN1_PLATFORM = 'slack';

// Trimmed on BOTH sides of stripping the hash: a chat service renders a
// channel as `# general` in places an operator copies from, so the space
// that stripping leaves behind has to go too -- otherwise ` general` never
// matches the `general` Gen 2 stored, and the warning stays silent.
const normalizeChannelName = (name: string): string =>
  name.trim().replace(/^#+/, '').trim().toLowerCase();

/**
 * Which of `destinations` names a channel that Gen 1 also posts to.
 *
 * Takes both sides as arguments rather than reading either store itself, so
 * the rule can be exercised without a database and each caller stays in
 * charge of what it compares (`.claude/rules/coding-style.md`, "Executors
 * Take Their Work-Set as Input").
 */
export const findChannelNameOverlaps = (
  destinations: readonly ComparableDestination[],
  gen1ChannelNames: readonly string[],
): ChannelNameOverlap[] => {
  const gen1Names = new Set(
    gen1ChannelNames
      .map(normalizeChannelName)
      .filter((name) => name.length > 0),
  );
  if (gen1Names.size === 0) {
    return [];
  }

  return destinations
    .filter(
      (destination) =>
        destination.platform === GEN1_PLATFORM &&
        gen1Names.has(normalizeChannelName(destination.channelName)),
    )
    .map(({ channelId, channelName }) => ({ channelId, channelName }));
};
