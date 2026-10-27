import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

/**
 * Integration tests for `pagetagrelations.findPageIdsWithAllTags`.
 *
 * Runs against the real database shared per worker by the `app-integration`
 * Vitest project. Fixtures use a name prefix unique to this file and are
 * removed by name/id so that they never disturb the `tags` /
 * `pagetagrelations` rows other `.integ.ts` files in the same worker own.
 */

const TAG_PREFIX = 'lsx-findPageIdsWithAllTags-';
const TAG_A = `${TAG_PREFIX}a`;
const TAG_B = `${TAG_PREFIX}b`;
const TAG_UNUSED = `${TAG_PREFIX}unused`;
const TAG_ABSENT = `${TAG_PREFIX}absent`;

const FIXTURE_TAG_NAMES = [TAG_A, TAG_B, TAG_UNUSED];

const newPageId = (): string => new mongoose.Types.ObjectId().toString();

const createdPageIds: string[] = [];

const registerPageId = (): string => {
  const pageId = newPageId();
  createdPageIds.push(pageId);
  return pageId;
};

const cleanUp = async (): Promise<void> => {
  await prisma.pagetagrelations.deleteMany({
    where: { relatedPageId: { in: createdPageIds } },
  });
  await prisma.tags.deleteMany({
    where: { name: { in: FIXTURE_TAG_NAMES } },
  });
};

/**
 * Creates the fixture tags and returns their ids by name.
 */
const createTags = async (names: string[]): Promise<Record<string, string>> => {
  await prisma.tags.createMany({ data: names.map((name) => ({ name })) });
  const tags = await prisma.tags.findMany({ where: { name: { in: names } } });
  return Object.fromEntries(tags.map((tag) => [tag.name, tag.id]));
};

const tagPage = async (pageId: string, tagIds: string[]): Promise<void> => {
  await prisma.pagetagrelations.createMany({
    data: tagIds.map((relatedTagId) => ({
      relatedPageId: pageId,
      relatedTagId,
    })),
  });
};

describe('pagetagrelations.findPageIdsWithAllTags', () => {
  beforeEach(async () => {
    createdPageIds.length = 0;
    await cleanUp();
  });

  afterEach(async () => {
    await cleanUp();
  });

  it('returns only the pages that have the single specified tag', async () => {
    // arrange
    const tagIdByName = await createTags([TAG_A, TAG_UNUSED]);
    const taggedPageId = registerPageId();
    const untaggedPageId = registerPageId();
    const otherTaggedPageId = registerPageId();
    await tagPage(taggedPageId, [tagIdByName[TAG_A]]);
    await tagPage(otherTaggedPageId, [tagIdByName[TAG_UNUSED]]);

    // act
    const pageIds = await prisma.pagetagrelations.findPageIdsWithAllTags([
      TAG_A,
    ]);

    // assert
    expect(pageIds).toEqual([taggedPageId]);
    expect(pageIds).not.toContain(untaggedPageId);
    expect(pageIds).not.toContain(otherTaggedPageId);
  });

  it('returns only the pages that have every specified tag (AND)', async () => {
    // arrange
    const tagIdByName = await createTags([TAG_A, TAG_B]);
    const bothTagsPageId = registerPageId();
    const onlyAPageId = registerPageId();
    const onlyBPageId = registerPageId();
    await tagPage(bothTagsPageId, [tagIdByName[TAG_A], tagIdByName[TAG_B]]);
    await tagPage(onlyAPageId, [tagIdByName[TAG_A]]);
    await tagPage(onlyBPageId, [tagIdByName[TAG_B]]);

    // act
    const pageIds = await prisma.pagetagrelations.findPageIdsWithAllTags([
      TAG_A,
      TAG_B,
    ]);

    // assert
    expect(pageIds).toEqual([bothTagsPageId]);
  });

  it('returns an empty array when both tags exist but no single page has both', async () => {
    // arrange
    const tagIdByName = await createTags([TAG_A, TAG_B]);
    const onlyAPageId = registerPageId();
    const onlyBPageId = registerPageId();
    await tagPage(onlyAPageId, [tagIdByName[TAG_A]]);
    await tagPage(onlyBPageId, [tagIdByName[TAG_B]]);

    // act
    const pageIds = await prisma.pagetagrelations.findPageIdsWithAllTags([
      TAG_A,
      TAG_B,
    ]);

    // assert
    expect(pageIds).toEqual([]);
  });

  it('returns an empty array when one of the specified tag names does not exist', async () => {
    // arrange
    const tagIdByName = await createTags([TAG_A]);
    const taggedPageId = registerPageId();
    await tagPage(taggedPageId, [tagIdByName[TAG_A]]);

    // act
    const pageIds = await prisma.pagetagrelations.findPageIdsWithAllTags([
      TAG_A,
      TAG_ABSENT,
    ]);

    // assert
    expect(pageIds).toEqual([]);
  });
});
