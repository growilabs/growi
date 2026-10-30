// The Gen 1 half of Requirement 12.4's comparison: which channels does the
// existing (Gen 1) Slack notification setting post to?
//
// Gen 1 stores that as ONE FREE-TEXT FIELD per setting row --
// `GlobalNotificationSetting`'s SLACK discriminator has `slackChannels: String`,
// a comma-separated list of channel NAMES with no identifier anywhere in the
// row. That is the whole reason Requirement 12.4's check is name-based (see
// `channel-name-overlap.ts`).
//
// Gen 1 is read here and NOWHERE ELSE in this feature, and only read --
// this spec does not change how Gen 1 stores or manages its settings
// ("Gen 1 には手を入れない").

import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:features:chat-integration:admin:gen1-slack-channel-names',
);

/**
 * The little of a Gen 1 notification setting row this needs. Structural on
 * purpose: a MAIL row has no `slackChannels` at all, so "is this a chat
 * destination" is decided by the field being present rather than by reading
 * the discriminator key, and no Gen 1 type has to be imported to say so.
 */
export interface Gen1NotificationSettingRow {
  readonly isEnabled?: boolean;
  readonly slackChannels?: unknown;
}

/** What `GlobalNotificationSetting.findAll()` provides, and nothing more. */
export interface Gen1NotificationSettingSource {
  findAll(): Promise<readonly Gen1NotificationSettingRow[]>;
}

/**
 * Every channel name Gen 1 posts to, deduplicated, in the order first seen.
 *
 * A row explicitly turned off is skipped -- it posts nothing, so there is
 * no double posting to warn about. Anything else is included, including a
 * row whose `isEnabled` is missing: for a warning, being told about a
 * channel that turns out to be idle costs an operator far less than not
 * being told about one that is live.
 */
export const collectGen1SlackChannelNames = (
  rows: readonly Gen1NotificationSettingRow[],
): string[] => {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (row.isEnabled === false || typeof row.slackChannels !== 'string') {
      continue;
    }
    for (const raw of row.slackChannels.split(',')) {
      const name = raw.trim();
      if (name.length === 0 || seen.has(name)) {
        continue;
      }
      seen.add(name);
      names.push(name);
    }
  }

  return names;
};

/**
 * Reads the Gen 1 side through whatever source the caller hands over
 * (`crowi.models.GlobalNotificationSetting` in production).
 *
 * An absent source means Gen 1's crowi-dependent models were never
 * registered on this instance, and the honest answer is then "Gen 1 has no
 * destinations to collide with" -- there is no Gen 1 notification running
 * either. A read that FAILS is deliberately not swallowed: the caller reads
 * the Gen 2 destinations from the same database in the same request, so a
 * failure here is not a "no overlap" answer, and reporting one would put a
 * reassuring, wrong "no warning" in front of the administrator.
 */
export const readGen1SlackChannelNames = async (
  source: Gen1NotificationSettingSource | undefined,
): Promise<string[]> => {
  if (source == null) {
    logger.debug(
      "Gen 1's GlobalNotificationSetting model is not registered; treating Gen 1 as having no notification destinations.",
    );
    return [];
  }
  return collectGen1SlackChannelNames(await source.findAll());
};
