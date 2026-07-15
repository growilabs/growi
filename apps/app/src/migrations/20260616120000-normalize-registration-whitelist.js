import mongoose from 'mongoose';

import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import {
  isValidWhitelistEntry,
  normalizeWhitelistEntries,
} from '~/utils/email-whitelist';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:normalize-registration-whitelist');

const KEY = 'security:registrationWhitelist';

module.exports = {
  async up() {
    logger.info('Apply migration: Normalize registration whitelist entries');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const config = await Config.findOne({ key: KEY });
    if (config == null || config.value == null) {
      logger.info(
        'No registration whitelist config found - migration not needed',
      );
      return;
    }

    let entries;
    try {
      entries = JSON.parse(config.value);
    } catch (err) {
      logger.warn(
        'Failed to parse registration whitelist value - skipping',
        err,
      );
      return;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      logger.info('Registration whitelist is empty - migration not needed');
      return;
    }

    const normalized = normalizeWhitelistEntries(entries);

    // Surface entries that remain invalid even after normalization (e.g. legacy
    // free-form values or regex patterns the old lax validator accepted). These
    // are left untouched - deleting them would discard admin intent - but the
    // new save validator will reject the whole list with a 400 once an admin
    // edits the security settings. Warn here so operators can fix them at
    // migration time instead of discovering it later on save.
    const invalidEntries = normalized.filter(
      (entry) => !isValidWhitelistEntry(entry),
    );
    if (invalidEntries.length > 0) {
      logger.warn(
        'The following registration whitelist entries are invalid and were left unchanged. ' +
          'They will block saving security settings until corrected in Admin > Security: ' +
          JSON.stringify(invalidEntries),
      );
    }

    const isChanged = JSON.stringify(normalized) !== JSON.stringify(entries);
    if (!isChanged) {
      logger.info(
        'No legacy whitelist entries to normalize - migration not needed',
      );
      return;
    }

    await Config.updateOne({ key: KEY }, { value: JSON.stringify(normalized) });

    logger.info('Migration has successfully applied');
  },

  async down() {
    logger.info('Rollback migration: Normalize registration whitelist entries');
    // No rollback action - normalization is a non-destructive, idempotent correction
    logger.info('No rollback action needed');
  },
};
