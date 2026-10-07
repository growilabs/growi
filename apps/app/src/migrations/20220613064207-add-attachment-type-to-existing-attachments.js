import { AttachmentType } from '~/server/interfaces/attachment';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory(
  'growi:migrate:add-attachment-type-to-existing-attachments',
);

export async function up() {
  logger.info('Apply migration');

  // Add attachmentType for wiki page
  // Filter pages where "attachmentType" doesn't exist and "page" is not null
  await prisma.$runCommandRaw({
    update: 'attachments',
    updates: [
      // Wiki page attachments: "page" is set, "attachmentType" doesn't exist
      {
        q: { page: { $ne: null }, attachmentType: { $exists: false } },
        u: { $set: { attachmentType: AttachmentType.WIKI_PAGE } },
        multi: true,
      },
      // Profile image attachments: "page" is null, "attachmentType" doesn't exist
      {
        q: { page: { $eq: null }, attachmentType: { $exists: false } },
        u: { $set: { attachmentType: AttachmentType.PROFILE_IMAGE } },
        multi: true,
      },
    ],
  });

  logger.info('Migration has successfully applied');
}

export async function down() {
  // No rollback
}
