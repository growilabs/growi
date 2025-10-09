/* eslint-disable max-len */
const mongoose = require('mongoose');

const { getInstance } = require('../setup-crowi');

describe('V5 page migration', () => {
  let crowi;
  let Page;
  let User;
  let UserGroup;
  let UserGroupRelation;

  let testUser1;
  let rootUser;

  let rootPage;

  const rootUserGroupId = new mongoose.Types.ObjectId();
  const testUser1GroupId = new mongoose.Types.ObjectId();
  const groupIdIsolate = new mongoose.Types.ObjectId();
  const groupIdA = new mongoose.Types.ObjectId();
  const groupIdB = new mongoose.Types.ObjectId();
  const groupIdC = new mongoose.Types.ObjectId();

  const pageId1 = new mongoose.Types.ObjectId();
  const pageId2 = new mongoose.Types.ObjectId();
  const pageId3 = new mongoose.Types.ObjectId();
  const pageId4 = new mongoose.Types.ObjectId();
  const pageId5 = new mongoose.Types.ObjectId();
  const pageId6 = new mongoose.Types.ObjectId();
  const pageId7 = new mongoose.Types.ObjectId();
  const pageId8 = new mongoose.Types.ObjectId();
  const pageId9 = new mongoose.Types.ObjectId();
  const pageId10 = new mongoose.Types.ObjectId();
  const pageId11 = new mongoose.Types.ObjectId();

  const onlyPublic = (filter) => ({ grant: Page.GRANT_PUBLIC, ...filter });
  const ownedByTestUser1 = (filter) => ({
    grant: Page.GRANT_OWNER,
    grantedUsers: [testUser1._id],
    ...filter,
  });
  const root = (filter) => ({ grantedUsers: [rootUser._id], ...filter });
  const rootUserGroup = (filter) => ({
    grantedGroups: {
      $elemMatch: {
        item: rootUserGroupId,
      },
    },
    ...filter,
  });
  const testUser1Group = (filter) => ({
    grantedGroups: {
      $elemMatch: {
        item: testUser1GroupId,
      },
    },
    ...filter,
  });

  const normalized = { parent: { $ne: null } };
  const notNormalized = { parent: null };
  const empty = { isEmpty: true };

  beforeAll(async () => {
    jest.restoreAllMocks();

    crowi = await getInstance();
    Page = mongoose.model('Page');
    User = mongoose.model('User');
    UserGroup = mongoose.model('UserGroup');
    UserGroupRelation = mongoose.model('UserGroupRelation');

    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    await User.insertMany([
      { name: 'rootUser', username: 'rootUser', email: 'rootUser@example.com' },
      {
        name: 'testUser1',
        username: 'testUser1',
        email: 'testUser1@example.com',
      },
    ]);
    rootUser = await User.findOne({ username: 'rootUser' });
    testUser1 = await User.findOne({ username: 'testUser1' });
    rootPage = await Page.findOne({ path: '/' });

    await UserGroup.insertMany([
      {
        _id: rootUserGroupId,
        name: 'rootUserGroup',
      },
      {
        _id: testUser1GroupId,
        name: 'testUser1Group',
      },
      {
        _id: groupIdIsolate,
        name: 'groupIsolate',
      },
      {
        _id: groupIdA,
        name: 'groupA',
      },
      {
        _id: groupIdB,
        name: 'groupB',
        parent: groupIdA,
      },
      {
        _id: groupIdC,
        name: 'groupC',
        parent: groupIdB,
      },
    ]);

    await UserGroupRelation.insertMany([
      {
        relatedGroup: rootUserGroupId,
        relatedUser: rootUser._id,
      },
      {
        relatedGroup: testUser1GroupId,
        relatedUser: testUser1._id,
      },
      {
        relatedGroup: groupIdIsolate,
        relatedUser: testUser1._id,
      },
      {
        relatedGroup: groupIdA,
        relatedUser: testUser1._id,
      },
      {
        relatedGroup: groupIdB,
        relatedUser: testUser1._id,
      },
      {
        relatedGroup: groupIdC,
        relatedUser: testUser1._id,
      },
    ]);

    await Page.insertMany([
      {
        path: '/private1',
        grant: Page.GRANT_OWNER,
        creator: testUser1,
        lastUpdateUser: testUser1,
        grantedUsers: [testUser1._id],
      },
      {
        path: '/dummyParent/private1',
        grant: Page.GRANT_OWNER,
        creator: testUser1,
        lastUpdateUser: testUser1,
        grantedUsers: [testUser1._id],
      },
      {
        path: '/dummyParent/private1/private2',
        grant: Page.GRANT_OWNER,
        creator: testUser1,
        lastUpdateUser: testUser1,
        grantedUsers: [testUser1._id],
      },
      {
        path: '/dummyParent/private1/private3',
        grant: Page.GRANT_OWNER,
        creator: testUser1,
        lastUpdateUser: testUser1,
        grantedUsers: [testUser1._id],
      },
      {
        _id: pageId1,
        path: '/normalize_1',
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      },
      {
        _id: pageId2,
        path: '/normalize_1/normalize_2',
        parent: pageId1,
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [{ item: groupIdB, type: 'UserGroup' }],
        grantedUsers: [testUser1._id],
      },
      {
        _id: pageId3,
        path: '/normalize_1',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [{ item: groupIdA, type: 'UserGroup' }],
        grantedUsers: [testUser1._id],
      },
      {
        _id: pageId4,
        path: '/normalize_4',
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      },
      {
        _id: pageId5,
        path: '/normalize_4/normalize_5',
        parent: pageId4,
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [{ item: groupIdA, type: 'UserGroup' }],
        grantedUsers: [testUser1._id],
      },
      {
        _id: pageId6,
        path: '/normalize_4',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [{ item: groupIdIsolate, type: 'UserGroup' }],
        grantedUsers: [testUser1._id],
      },
      {
        path: '/normalize_7/normalize_8_gA',
        grant: Page.GRANT_USER_GROUP,
        creator: testUser1,
        grantedGroups: [{ item: groupIdA, type: 'UserGroup' }],
        grantedUsers: [testUser1._id],
      },
      {
        path: '/normalize_7/normalize_8_gA/normalize_9_gB',
        grant: Page.GRANT_USER_GROUP,
        creator: testUser1,
        grantedGroups: [{ item: groupIdB, type: 'UserGroup' }],
        grantedUsers: [testUser1._id],
      },
      {
        path: '/normalize_7/normalize_8_gC',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [{ item: groupIdC, type: 'UserGroup' }],
        grantedUsers: [testUser1._id],
      },
      {
        _id: pageId7,
        path: '/normalize_10',
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
        parent: rootPage._id,
        descendantCount: 3,
      },
      {
        _id: pageId8,
        path: '/normalize_10/normalize_11_gA',
        isEmpty: true,
        parent: pageId7,
        descendantCount: 1,
      },
      {
        _id: pageId9, // not v5
        path: '/normalize_10/normalize_11_gA',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [{ item: groupIdA, type: 'UserGroup' }],
      },
      {
        _id: pageId10,
        path: '/normalize_10/normalize_11_gA/normalize_11_gB',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [{ item: groupIdB, type: 'UserGroup' }],
        parent: pageId8,
        descendantCount: 0,
      },
      {
        _id: pageId11,
        path: '/normalize_10/normalize_12_gC',
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [{ item: groupIdC, type: 'UserGroup' }],
        grantedUsers: [testUser1._id],
        parent: pageId7,
        descendantCount: 0,
      },
    ]);
  });

  const normalizeParentRecursivelyByPages = async (pages, user) => {
    return crowi.pageService.normalizeParentRecursivelyByPages(pages, user);
  };

  const normalizeParentByPage = async (page, user) => {
    return crowi.pageService.normalizeParentByPage(page, user);
  };

  describe('normalizeParentRecursivelyByPages()', () => {
    test('should migrate all pages specified by pageIds', async () => {
      jest.restoreAllMocks();

      const pagesToRun = await Page.find({
        path: { $in: ['/private1', '/dummyParent/private1'] },
      });

      // migrate
      await normalizeParentRecursivelyByPages(pagesToRun, testUser1);
      const migratedPages = await Page.find({
        path: {
          $in: [
            '/private1',
            '/dummyParent',
            '/dummyParent/private1',
            '/dummyParent/private1/private2',
            '/dummyParent/private1/private3',
          ],
        },
      });
      const migratedPagePaths = migratedPages
        .filter((doc) => doc.parent != null)
        .map((doc) => doc.path);

      const expected = [
        '/private1',
        '/dummyParent',
        '/dummyParent/private1',
        '/dummyParent/private1/private2',
        '/dummyParent/private1/private3',
      ];

      expect(migratedPagePaths.sort()).toStrictEqual(expected.sort());
    });

    test('should change all v4 pages with usergroup to v5 compatible and create new parent page', async () => {
      const page8 = await Page.findOne({ path: '/normalize_7/normalize_8_gA' });
      const page9 = await Page.findOne({
        path: '/normalize_7/normalize_8_gA/normalize_9_gB',
      });
      const page10 = await Page.findOne({
        path: '/normalize_7/normalize_8_gC',
      });
      const page11 = await Page.findOne({ path: '/normalize_7' });
      expect(page8).toBeTruthy();
      expect(page9).toBeTruthy();
      expect(page10).toBeTruthy();
      expect(page11).toBeNull();
      await normalizeParentRecursivelyByPages(
        [page8, page9, page10],
        testUser1,
      );

      // AM => After Migration
      const page7 = await Page.findOne({ path: '/normalize_7' });
      const page8AM = await Page.findOne({
        path: '/normalize_7/normalize_8_gA',
      });
      const page9AM = await Page.findOne({
        path: '/normalize_7/normalize_8_gA/normalize_9_gB',
      });
      const page10AM = await Page.findOne({
        path: '/normalize_7/normalize_8_gC',
      });
      expect(page7).toBeTruthy();
      expect(page8AM).toBeTruthy();
      expect(page9AM).toBeTruthy();
      expect(page10AM).toBeTruthy();

      expect(page7.isEmpty).toBe(true);

      expect(page7.parent).toStrictEqual(rootPage._id);
      expect(page8AM.parent).toStrictEqual(page7._id);
      expect(page9AM.parent).toStrictEqual(page8AM._id);
      expect(page10AM.parent).toStrictEqual(page7._id);
    });

    test("should replace empty page with same path with new non-empty page and update all related children's parent", async () => {
      const page1 = await Page.findOne({
        path: '/normalize_10',
        isEmpty: true,
        parent: { $ne: null },
      });
      const page2 = await Page.findOne({
        path: '/normalize_10/normalize_11_gA',
        _id: pageId8,
        isEmpty: true,
        parent: { $ne: null },
      });
      const page3 = await Page.findOne({
        path: '/normalize_10/normalize_11_gA',
        _id: pageId9,
        parent: null,
      }); // not v5
      const page4 = await Page.findOne({
        path: '/normalize_10/normalize_11_gA/normalize_11_gB',
        parent: { $ne: null },
      });
      const page5 = await Page.findOne({
        path: '/normalize_10/normalize_12_gC',
        parent: { $ne: null },
      });
      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();
      expect(page3).toBeTruthy();
      expect(page4).toBeTruthy();
      expect(page5).toBeTruthy();
      await normalizeParentRecursivelyByPages([page3], testUser1);

      // AM => After Migration
      const page1AM = await Page.findOne({ path: '/normalize_10' });
      const page2AM = await Page.findOne({
        path: '/normalize_10/normalize_11_gA',
        _id: pageId8,
      });
      const page3AM = await Page.findOne({
        path: '/normalize_10/normalize_11_gA',
        _id: pageId9,
      });
      const page4AM = await Page.findOne({
        path: '/normalize_10/normalize_11_gA/normalize_11_gB',
      });
      const page5AM = await Page.findOne({
        path: '/normalize_10/normalize_12_gC',
      });
      expect(page1AM).toBeTruthy();
      expect(page3AM).toBeTruthy();
      expect(page4AM).toBeTruthy();
      expect(page5AM).toBeTruthy();
      expect(page2AM).toBeNull();

      expect(page1AM.isEmpty).toBeTruthy();
      expect(page3AM.parent).toStrictEqual(page1AM._id);
      expect(page4AM.parent).toStrictEqual(page3AM._id);
      expect(page5AM.parent).toStrictEqual(page1AM._id);

      expect(page3AM.isEmpty).toBe(false);
    });
  });

  describe('should normalize only selected pages recursively (while observing the page permission rule)', () => {
    /*
     * # Test flow 1
     * - Existing pages
     *   - v5 compatible pages
     *     - /normalize_a (empty)
     *     - /normalize_a/normalize_b (public)
     *   - v4 pages
     *     - /normalize_a (user group)
     *     - /normalize_c (user group)
     *
     * - Normalize /normalize_a (user group)
     *   - Expect
     *     - Error should be thrown
     *
     *
     * # Test flow 2
     * - Existing pages
     *   - v5 compatible pages
     *     - /normalize_d (empty)
     *     - /normalize_d/normalize_e (user group)
     *   - v4 pages
     *     - /normalize_d (user group)
     *     - /normalize_f (user group)
     *
     * - Normalize /normalize_d (user group)
     *   - Expect
     *     - Normalization succeeds
     *     - /normalize_f (user group) remains in v4 schema
     *
     *
     * # Test flow 3 (should replace all unnecessary empty pages)
     * - Existing pages
     *   - v5 compatible pages
     *     - / (root)
     *     - /normalize_g (public)
     *   - v4 pages
     *     - /normalize_g/normalize_h (only me)
     *     - /normalize_g/normalize_i (only me)
     *     - /normalize_g/normalize_h/normalize_j (only me)
     *     - /normalize_g/normalize_i/normalize_k (only me)
     *
     * - Normalize /normalize_g/normalize_h/normalize_j (only me) & /normalize_g/normalize_i/normalize_k (only me)
     *   - Expect
     *     - /normalize_g/normalize_h (empty)
     *       - parent is /normalize_g (public)
     *     - /normalize_g/normalize_i (empty)
     *       - parent is /normalize_g (public)
     *     - /normalize_g/normalize_h/normalize_j (only me) is normalized
     *     - /normalize_g/normalize_i/normalize_k (only me) is normalized
     */

    beforeAll(async () => {
      // Prepare data
      const id1 = new mongoose.Types.ObjectId();
      const id2 = new mongoose.Types.ObjectId();
      const id3 = new mongoose.Types.ObjectId();
      const id4 = new mongoose.Types.ObjectId();

      await Page.insertMany([
        // 1
        {
          _id: id3,
          path: '/deep_path',
          grant: Page.GRANT_PUBLIC,
          parent: rootPage._id,
        },
        {
          _id: id1,
          path: '/deep_path/normalize_a',
          isEmpty: true,
          parent: id3,
        },
        {
          path: '/deep_path/normalize_a/normalize_b',
          grant: Page.GRANT_PUBLIC,
          parent: id1,
        },
        {
          path: '/deep_path/normalize_a',
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: [{ item: testUser1GroupId, type: 'UserGroup' }],
          parent: null,
        },
        {
          path: '/deep_path/normalize_c',
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: [{ item: testUser1GroupId, type: 'UserGroup' }],
          parent: null,
        },

        // 2
        {
          _id: id2,
          path: '/normalize_d',
          isEmpty: true,
          parent: rootPage._id,
        },
        {
          path: '/normalize_d',
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: [{ item: testUser1GroupId, type: 'UserGroup' }],
          parent: null,
        },
        {
          path: '/normalize_d/normalize_e',
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: [{ item: testUser1GroupId, type: 'UserGroup' }],
          parent: id2,
        },
        {
          path: '/normalize_f',
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: [{ item: testUser1GroupId, type: 'UserGroup' }],
          parent: null,
        },

        // 3
        {
          _id: id4,
          path: '/normalize_g',
          parent: rootPage._id,
        },
        {
          path: '/normalize_g/normalize_h',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          parent: null,
        },
        {
          path: '/normalize_g/normalize_i',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          parent: null,
        },
        {
          path: '/normalize_g/normalize_h/normalize_j',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          parent: null,
        },
        {
          path: '/normalize_g/normalize_i/normalize_k',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          parent: null,
        },
      ]);
    });

    test('should not run normalization when the target page is GRANT_USER_GROUP surrounded by public pages', async () => {
      const mockMainOperation = jest
        .spyOn(crowi.pageService, 'normalizeParentRecursivelyMainOperation')
        .mockImplementation((v) => v);
      const _page1 = await Page.findOne(
        onlyPublic({ path: '/deep_path/normalize_a', ...empty }),
      );
      const _page2 = await Page.findOne(
        onlyPublic({
          path: '/deep_path/normalize_a/normalize_b',
          ...normalized,
        }),
      );
      const _page3 = await Page.findOne(
        testUser1Group({ path: '/deep_path/normalize_a', ...notNormalized }),
      );
      const _page4 = await Page.findOne(
        testUser1Group({ path: '/deep_path/normalize_c', ...notNormalized }),
      );

      expect(_page1).not.toBeNull();
      expect(_page2).not.toBeNull();
      expect(_page3).not.toBeNull();
      expect(_page4).not.toBeNull();

      // Normalize
      await normalizeParentRecursivelyByPages([_page3], testUser1);

      expect(mockMainOperation).not.toHaveBeenCalled();

      mockMainOperation.mockRestore();
    });

    test('should not include siblings', async () => {
      const _page1 = await Page.findOne(
        onlyPublic({ path: '/normalize_d', ...empty }),
      );
      const _page2 = await Page.findOne(
        testUser1Group({ path: '/normalize_d/normalize_e', ...normalized }),
      );
      const _page3 = await Page.findOne(
        testUser1Group({ path: '/normalize_d', ...notNormalized }),
      );
      const _page4 = await Page.findOne(
        testUser1Group({ path: '/normalize_f', ...notNormalized }),
      );

      expect(_page1).not.toBeNull();
      expect(_page2).not.toBeNull();
      expect(_page3).not.toBeNull();
      expect(_page4).not.toBeNull();

      // Normalize
      await normalizeParentRecursivelyByPages([_page3], testUser1);

      const page1 = await Page.findOne(
        testUser1Group({ path: '/normalize_d/normalize_e' }),
      );
      const page2 = await Page.findOne(
        testUser1Group({ path: '/normalize_d' }),
      );
      const page3 = await Page.findOne(
        testUser1Group({ path: '/normalize_f' }),
      );
      const empty4 = await Page.findOne(
        onlyPublic({ path: '/normalize_d', ...empty }),
      );

      expect(page1).not.toBeNull();
      expect(page2).not.toBeNull();
      expect(page3).not.toBeNull();
      expect(empty4).toBeNull(); // empty page should be removed

      // Check parent
      expect(page1.parent).toStrictEqual(page2._id);
      expect(page2.parent).toStrictEqual(rootPage._id);
      expect(page3.parent).toBeNull(); // should not be normalized

      // Check descendantCount
      expect(page1.descendantCount).toBe(0);
      expect(page2.descendantCount).toBe(1);
      expect(page3.descendantCount).toBe(0); // should not be normalized
    });

    test('should replace all unnecessary empty pages and normalization succeeds', async () => {
      const _pageG = await Page.findOne(
        onlyPublic({ path: '/normalize_g', ...normalized }),
      );
      const _pageGH = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_g/normalize_h',
          ...notNormalized,
        }),
      );
      const _pageGI = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_g/normalize_i',
          ...notNormalized,
        }),
      );
      const _pageGHJ = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_g/normalize_h/normalize_j',
          ...notNormalized,
        }),
      );
      const _pageGIK = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_g/normalize_i/normalize_k',
          ...notNormalized,
        }),
      );

      expect(_pageG).not.toBeNull();
      expect(_pageGH).not.toBeNull();
      expect(_pageGI).not.toBeNull();
      expect(_pageGHJ).not.toBeNull();
      expect(_pageGIK).not.toBeNull();

      // Normalize
      await normalizeParentRecursivelyByPages([_pageGHJ, _pageGIK], testUser1);

      const countG = await Page.count({ path: '/normalize_g' });
      const countGH = await Page.count({ path: '/normalize_g/normalize_h' });
      const countGI = await Page.count({ path: '/normalize_g/normalize_i' });
      const countGHJ = await Page.count({
        path: '/normalize_g/normalize_h/normalize_j',
      });
      const countGIK = await Page.count({
        path: '/normalize_g/normalize_i/normalize_k',
      });

      expect(countG).toBe(1);
      expect(countGH).toBe(2);
      expect(countGI).toBe(2);
      expect(countGHJ).toBe(1);
      expect(countGIK).toBe(1);

      // -- normalized pages
      const pageG = await Page.findOne(onlyPublic({ path: '/normalize_g' }));
      const emptyGH = await Page.findOne({
        path: '/normalize_g/normalize_h',
        ...empty,
      });
      const emptyGI = await Page.findOne({
        path: '/normalize_g/normalize_i',
        ...empty,
      });
      const pageGHJ = await Page.findOne({
        path: '/normalize_g/normalize_h/normalize_j',
      });
      const pageGIK = await Page.findOne({
        path: '/normalize_g/normalize_i/normalize_k',
      });

      // Check existence
      expect(pageG).not.toBeNull();
      expect(pageGHJ).not.toBeNull();
      expect(pageGIK).not.toBeNull();
      expect(emptyGH).not.toBeNull();
      expect(emptyGI).not.toBeNull();
      // Check parent
      expect(pageG.parent).toStrictEqual(rootPage._id);
      expect(emptyGH.parent).toStrictEqual(pageG._id);
      expect(emptyGI.parent).toStrictEqual(pageG._id);
      expect(pageGHJ.parent).toStrictEqual(emptyGH._id);
      expect(pageGIK.parent).toStrictEqual(emptyGI._id);
      // Check descendantCount
      expect(pageG.descendantCount).toStrictEqual(2);
      expect(emptyGH.descendantCount).toStrictEqual(1);
      expect(emptyGI.descendantCount).toStrictEqual(1);
      expect(pageGHJ.descendantCount).toStrictEqual(0);
      expect(pageGIK.descendantCount).toStrictEqual(0);

      // -- not normalized pages
      const pageGH = await Page.findOne(
        ownedByTestUser1({ path: '/normalize_g/normalize_h' }),
      );
      const pageGI = await Page.findOne(
        ownedByTestUser1({ path: '/normalize_g/normalize_i' }),
      );
      // Check existence
      expect(pageGH).not.toBeNull();
      expect(pageGI).not.toBeNull();
      // Check parent
      expect(pageGH.parent).toBeNull(); // should not be normalized
      expect(pageGI.parent).toBeNull(); // should not be normalized
      // Check descendantCount
      expect(pageGH.descendantCount).toStrictEqual(0); // should not be normalized
      expect(pageGI.descendantCount).toStrictEqual(0); // should not be normalized
    });
  });

  describe('should normalize only selected pages recursively (especially should NOT normalize non-selected ancestors)', () => {
    /*
     * # Test flow
     * - Existing pages
     *   - All pages are NOT normalized
     *   - A, B, C, and D are owned by "testUser1"
     *   A. /normalize_A_owned
     *   B. /normalize_A_owned/normalize_B_owned
     *   C. /normalize_A_owned/normalize_B_owned/normalize_C_owned
     *   D. /normalize_A_owned/normalize_B_owned/normalize_C_owned/normalize_D_owned
     *   E. /normalize_A_owned/normalize_B_owned/normalize_C_owned/normalize_D_root
     *     - Owned by "rootUser"
     *   F. /normalize_A_owned/normalize_B_owned/normalize_C_owned/normalize_D_group
     *     - Owned by the userGroup "groupIdIsolate"
     *
     * 1. Normalize A and B one by one.
     *   - Expect
     *     - A and B are normalized
     *     - C and D are NOT normalized
     *     - E and F are NOT normalized
     * 2. Recursively normalize D.
     *   - Expect
     *     - A, B, and D are normalized
     *     - C is NOT normalized
     *       - C is substituted by an empty page whose path is "/normalize_A_owned/normalize_B_owned/normalize_C_owned"
     *     - E and F are NOT normalized
     * 3. Recursively normalize C.
     *   - Expect
     *     - A, B, C, and D are normalized
     *     - An empty page at "/normalize_A_owned/normalize_B_owned/normalize_C_owned" does NOT exist (removed)
     *     - E and F are NOT normalized
     */

    beforeAll(async () => {
      // Prepare data
      const id17 = new mongoose.Types.ObjectId();
      const id21 = new mongoose.Types.ObjectId();
      const id22 = new mongoose.Types.ObjectId();
      const id23 = new mongoose.Types.ObjectId();

      await Page.insertMany([
        // 1
        {
          path: '/normalize_13_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
        },
        {
          path: '/normalize_13_owned/normalize_14_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
        },
        {
          path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
        },
        {
          path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned/normalize_16_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
        },
        {
          path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned/normalize_16_root',
          grant: Page.GRANT_OWNER,
          grantedUsers: [rootUser._id],
        },
        {
          path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned/normalize_16_group',
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: [{ item: testUser1GroupId, type: 'UserGroup' }],
        },

        // 2
        {
          _id: id17,
          path: '/normalize_17_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          parent: rootPage._id,
        },
        {
          path: '/normalize_17_owned/normalize_18_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          parent: id17,
        },
        {
          path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
        },
        {
          path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned/normalize_20_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
        },
        {
          path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned/normalize_20_root',
          grant: Page.GRANT_OWNER,
          grantedUsers: [rootUser._id],
        },
        {
          path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned/normalize_20_group',
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: [{ item: rootUserGroupId, type: 'UserGroup' }],
        },

        // 3
        {
          _id: id21,
          path: '/normalize_21_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          parent: rootPage._id,
        },
        {
          _id: id22,
          path: '/normalize_21_owned/normalize_22_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          parent: id21,
        },
        {
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          parent: null,
        },
        {
          _id: id23,
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned',
          isEmpty: true,
          parent: id22,
        },
        {
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned/normalize_24_owned',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          parent: id23,
        },
        {
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned/normalize_24_root',
          grant: Page.GRANT_OWNER,
          grantedUsers: [rootUser._id],
        },
        {
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned/normalize_24_rootGroup',
          grant: Page.GRANT_USER_GROUP,
          grantedGroups: [{ item: rootUserGroupId, type: 'UserGroup' }],
        },
      ]);
    });

    test('Should normalize a single page without including other pages', async () => {
      const _owned13 = await Page.findOne(
        ownedByTestUser1({ path: '/normalize_13_owned', ...notNormalized }),
      );
      const _owned14 = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_13_owned/normalize_14_owned',
          ...notNormalized,
        }),
      );
      const _owned15 = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned',
          ...notNormalized,
        }),
      );
      const _owned16 = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned/normalize_16_owned',
          ...notNormalized,
        }),
      );
      const _root16 = await Page.findOne(
        root({
          path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned/normalize_16_root',
          ...notNormalized,
        }),
      );
      const _group16 = await Page.findOne(
        testUser1Group({
          path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned/normalize_16_group',
          ...notNormalized,
        }),
      );

      expect(_owned13).not.toBeNull();
      expect(_owned14).not.toBeNull();
      expect(_owned15).not.toBeNull();
      expect(_owned16).not.toBeNull();
      expect(_root16).not.toBeNull();
      expect(_group16).not.toBeNull();

      // Normalize
      await normalizeParentByPage(_owned14, testUser1);

      const owned13 = await Page.findOne({ path: '/normalize_13_owned' });
      const empty13 = await Page.findOne({
        path: '/normalize_13_owned',
        ...empty,
      });
      const owned14 = await Page.findOne({
        path: '/normalize_13_owned/normalize_14_owned',
      });
      const owned15 = await Page.findOne({
        path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned',
      });
      const owned16 = await Page.findOne({
        path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned/normalize_16_owned',
      });
      const root16 = await Page.findOne(
        root({
          path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned/normalize_16_root',
        }),
      );
      const group16 = await Page.findOne(
        testUser1Group({
          path: '/normalize_13_owned/normalize_14_owned/normalize_15_owned/normalize_16_group',
        }),
      );

      expect(owned13).not.toBeNull();
      expect(empty13).not.toBeNull();
      expect(owned14).not.toBeNull();
      expect(owned15).not.toBeNull();
      expect(owned16).not.toBeNull();
      expect(root16).not.toBeNull();
      expect(group16).not.toBeNull();

      // Check parent
      expect(owned13.parent).toBeNull();
      expect(empty13.parent).toStrictEqual(rootPage._id);
      expect(owned14.parent).toStrictEqual(empty13._id);
      expect(owned15.parent).toBeNull();
      expect(owned16.parent).toBeNull();
      expect(root16.parent).toBeNull();
      expect(group16.parent).toBeNull();

      // Check descendantCount
      expect(owned13.descendantCount).toBe(0);
      expect(empty13.descendantCount).toBe(1);
      expect(owned14.descendantCount).toBe(0);
    });

    test('Should normalize pages recursively excluding the pages not selected', async () => {
      const _owned17 = await Page.findOne(
        ownedByTestUser1({ path: '/normalize_17_owned', ...normalized }),
      );
      const _owned18 = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_17_owned/normalize_18_owned',
          ...normalized,
        }),
      );
      const _owned19 = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned',
          ...notNormalized,
        }),
      );
      const _owned20 = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned/normalize_20_owned',
          ...notNormalized,
        }),
      );
      const _root20 = await Page.findOne(
        root({
          path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned/normalize_20_root',
          ...notNormalized,
        }),
      );
      const _group20 = await Page.findOne(
        rootUserGroup({
          path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned/normalize_20_group',
          ...notNormalized,
        }),
      );

      expect(_owned17).not.toBeNull();
      expect(_owned18).not.toBeNull();
      expect(_owned19).not.toBeNull();
      expect(_owned20).not.toBeNull();
      expect(_root20).not.toBeNull();
      expect(_group20).not.toBeNull();

      // Normalize
      await normalizeParentRecursivelyByPages([_owned20], testUser1);

      const owned17 = await Page.findOne({ path: '/normalize_17_owned' });
      const owned18 = await Page.findOne({
        path: '/normalize_17_owned/normalize_18_owned',
      });
      const owned19 = await Page.findOne({
        path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned',
      });
      const empty19 = await Page.findOne({
        path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned',
        ...empty,
      });
      const owned20 = await Page.findOne({
        path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned/normalize_20_owned',
      });
      const root20 = await Page.findOne(
        root({
          path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned/normalize_20_root',
        }),
      );
      const group20 = await Page.findOne(
        rootUserGroup({
          path: '/normalize_17_owned/normalize_18_owned/normalize_19_owned/normalize_20_group',
        }),
      );

      expect(owned17).not.toBeNull();
      expect(owned18).not.toBeNull();
      expect(owned19).not.toBeNull();
      expect(empty19).not.toBeNull();
      expect(owned20).not.toBeNull();
      expect(root20).not.toBeNull();
      expect(group20).not.toBeNull();

      // Check parent
      expect(owned17.parent).toStrictEqual(rootPage._id);
      expect(owned18.parent).toStrictEqual(owned17._id);
      expect(owned19.parent).toBeNull();
      expect(empty19.parent).toStrictEqual(owned18._id);
      expect(owned20.parent).toStrictEqual(empty19._id);
      expect(root20.parent).toBeNull();
      expect(group20.parent).toBeNull();

      // Check isEmpty
      expect(owned17.isEmpty).toBe(false);
      expect(owned18.isEmpty).toBe(false);
    });

    test("Should normalize pages recursively excluding the pages of not user's & Should delete unnecessary empty pages", async () => {
      const _owned21 = await Page.findOne(
        ownedByTestUser1({ path: '/normalize_21_owned', ...normalized }),
      );
      const _owned22 = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_21_owned/normalize_22_owned',
          ...normalized,
        }),
      );
      const _owned23 = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned',
          ...notNormalized,
        }),
      );
      const _empty23 = await Page.findOne({
        path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned',
        ...normalized,
        ...empty,
      });
      const _owned24 = await Page.findOne(
        ownedByTestUser1({
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned/normalize_24_owned',
          ...normalized,
        }),
      );
      const _root24 = await Page.findOne(
        root({
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned/normalize_24_root',
          ...notNormalized,
        }),
      );
      const _rootGroup24 = await Page.findOne(
        rootUserGroup({
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned/normalize_24_rootGroup',
          ...notNormalized,
        }),
      );

      expect(_owned21).not.toBeNull();
      expect(_owned22).not.toBeNull();
      expect(_owned23).not.toBeNull();
      expect(_empty23).not.toBeNull();
      expect(_owned24).not.toBeNull();
      expect(_root24).not.toBeNull();
      expect(_rootGroup24).not.toBeNull();

      // Normalize
      await normalizeParentRecursivelyByPages([_owned23], testUser1);

      const owned21 = await Page.findOne({ path: '/normalize_21_owned' });
      const owned22 = await Page.findOne({
        path: '/normalize_21_owned/normalize_22_owned',
      });
      const owned23 = await Page.findOne({
        path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned',
      });
      const empty23 = await Page.findOne({
        path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned',
        ...empty,
      });
      const owned24 = await Page.findOne({
        path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned/normalize_24_owned',
      });
      const root24 = await Page.findOne(
        root({
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned/normalize_24_root',
        }),
      );
      const rootGroup24 = await Page.findOne(
        rootUserGroup({
          path: '/normalize_21_owned/normalize_22_owned/normalize_23_owned/normalize_24_rootGroup',
        }),
      );

      expect(owned21).not.toBeNull();
      expect(owned22).not.toBeNull();
      expect(owned23).not.toBeNull();
      expect(empty23).toBeNull(); // removed
      expect(owned24).not.toBeNull();
      expect(root24).not.toBeNull();
      expect(rootGroup24).not.toBeNull();

      // Check parent
      expect(owned21.parent).toStrictEqual(rootPage._id);
      expect(owned22.parent).toStrictEqual(owned21._id);
      expect(owned23.parent).toStrictEqual(owned22._id);
      expect(owned24.parent).toStrictEqual(owned23._id); // not empty23._id
      expect(root24.parent).toBeNull();
      expect(rootGroup24.parent).toBeNull(); // excluded from the pages to be normalized

      // Check isEmpty
      expect(owned21.isEmpty).toBe(false);
      expect(owned22.isEmpty).toBe(false);
      expect(owned23.isEmpty).toBe(false);
    });
  });

  describe('normalizeAllPublicPages()', () => {
    jest.setTimeout(60000);
    let createPagePaths;
    let allPossiblePagePaths;
    beforeAll(async () => {
      createPagePaths = [
        '/publicA',
        '/publicA/privateB',
        '/publicA/privateB/publicC',
        '/parenthesis/(a)[b]{c}d',
        '/parenthesis/(a)[b]{c}d/public',
        '/migratedD',
      ];
      allPossiblePagePaths = [...createPagePaths, '/parenthesis', '/'];

      // initialize pages for test
      await Page.insertMany([
        {
          path: '/publicA',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/publicA/privateB',
          grant: Page.GRANT_OWNER,
          creator: testUser1,
          lastUpdateUser: testUser1,
          grantedUsers: [testUser1._id],
        },
        {
          path: '/publicA/privateB/publicC',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parenthesis/(a)[b]{c}d',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parenthesis/(a)[b]{c}d/public',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
      ]);

      const parent = await Page.find({ path: '/' });
      await Page.insertMany([
        {
          path: '/migratedD',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
          parent: parent._id,
        },
      ]);

      // migrate
      await crowi.pageService.normalizeAllPublicPages(Page.GRANT_PUBLIC);
      jest.setTimeout(30000);
    });

    test('should migrate all public pages', async () => {
      const migratedPages = await Page.find({
        path: {
          $in: allPossiblePagePaths,
        },
        parent: { $ne: null },
      });
      const migratedEmptyPages = await Page.find({
        path: {
          $in: allPossiblePagePaths,
        },
        isEmpty: true,
        parent: { $ne: null },
      });
      const nonMigratedPages = await Page.find({
        path: {
          $in: allPossiblePagePaths,
        },
        parent: null,
      });

      const migratedPaths = migratedPages.map((page) => page.path).sort();
      const migratedEmptyPaths = migratedEmptyPages
        .map((page) => page.path)
        .sort();
      const nonMigratedPaths = nonMigratedPages.map((page) => page.path).sort();

      const expectedMigratedPaths = allPossiblePagePaths
        .filter((path) => path !== '/')
        .sort();
      const expectedMigratedEmptyPaths = [
        '/publicA/privateB',
        '/parenthesis',
      ].sort();
      const expectedNonMigratedPaths = ['/publicA/privateB', '/'].sort();

      expect(migratedPaths).toStrictEqual(expectedMigratedPaths);
      expect(migratedEmptyPaths).toStrictEqual(expectedMigratedEmptyPaths);
      expect(nonMigratedPaths).toStrictEqual(expectedNonMigratedPaths);
    });
  });

  describe('normalizeParentByPage()', () => {
    test('it should normalize not v5 page with usergroup that has parent group', async () => {
      const page1 = await Page.findOne({
        _id: pageId1,
        path: '/normalize_1',
        isEmpty: true,
      });
      const page2 = await Page.findOne({
        _id: pageId2,
        path: '/normalize_1/normalize_2',
        parent: page1._id,
      });
      const page3 = await Page.findOne({ _id: pageId3, path: '/normalize_1' }); // NOT v5
      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();
      expect(page3).toBeTruthy();

      await normalizeParentByPage(page3, testUser1);

      // AM => After Migration
      const page1AM = await Page.findOne({
        _id: pageId1,
        path: '/normalize_1',
        isEmpty: true,
      });
      const page2AM = await Page.findOne({
        _id: pageId2,
        path: '/normalize_1/normalize_2',
      });
      const page3AM = await Page.findOne({
        _id: pageId3,
        path: '/normalize_1',
      }); // v5 compatible
      expect(page2AM).toBeTruthy();
      expect(page3AM).toBeTruthy();
      expect(page1AM).toBeNull();

      expect(page2AM.parent).toStrictEqual(page3AM._id);
      expect(page3AM.parent).toStrictEqual(rootPage._id);
    });

    test('should throw error if a page with isolated group becomes the parent of other page with different group after normalizing', async () => {
      const page4 = await Page.findOne({
        _id: pageId4,
        path: '/normalize_4',
        isEmpty: true,
      });
      const page5 = await Page.findOne({
        _id: pageId5,
        path: '/normalize_4/normalize_5',
        parent: page4._id,
      });
      const page6 = await Page.findOne({ _id: pageId6, path: '/normalize_4' }); // NOT v5
      expect(page4).toBeTruthy();
      expect(page5).toBeTruthy();
      expect(page6).toBeTruthy();

      let isThrown;
      try {
        await normalizeParentByPage(page6, testUser1);
      } catch (err) {
        isThrown = true;
      }

      // AM => After Migration
      const page4AM = await Page.findOne({
        _id: pageId4,
        path: '/normalize_4',
        isEmpty: true,
      });
      const page5AM = await Page.findOne({
        _id: pageId5,
        path: '/normalize_4/normalize_5',
        parent: page4._id,
      });
      const page6AM = await Page.findOne({
        _id: pageId6,
        path: '/normalize_4',
      }); // NOT v5
      expect(isThrown).toBe(true);
      expect(page4AM).toBeTruthy();
      expect(page5AM).toBeTruthy();
      expect(page6AM).toBeTruthy();
      expect(page4AM).toStrictEqual(page4);
      expect(page5AM).toStrictEqual(page5);
      expect(page6AM).toStrictEqual(page6);
    });
  });

  test('replace private parents with empty pages', async () => {
    const replacedPathPages = await Page.find({ path: '/publicA/privateB' }); // ex-private page

    const _newEmptyPage = replacedPathPages.filter(
      (page) => page.parent != null,
    )[0];
    const newEmptyPage = {
      path: _newEmptyPage.path,
      grant: _newEmptyPage.grant,
      isEmpty: _newEmptyPage.isEmpty,
    };
    const expectedNewEmptyPage = {
      path: '/publicA/privateB',
      grant: Page.GRANT_PUBLIC,
      isEmpty: true,
    };

    const _privatePage = replacedPathPages.filter(
      (page) => page.parent == null,
    )[0];
    const privatePage = {
      path: _privatePage.path,
      grant: _privatePage.grant,
      isEmpty: _privatePage.isEmpty,
    };
    const expectedPrivatePage = {
      path: '/publicA/privateB',
      grant: Page.GRANT_OWNER,
      isEmpty: false,
    };

    expect(replacedPathPages.length).toBe(2);
    expect(newEmptyPage).toStrictEqual(expectedNewEmptyPage);
    expect(privatePage).toStrictEqual(expectedPrivatePage);
  });

  describe('normalizeParentByPath', () => {
    const normalizeParentByPath = async (path, user) => {
      const mock = jest
        .spyOn(crowi.pageService, 'normalizeParentRecursivelyMainOperation')
        .mockReturnValue(null);
      const result = await crowi.pageService.normalizeParentByPath(path, user);
      const args = mock.mock.calls[0];

      mock.mockRestore();

      await crowi.pageService.normalizeParentRecursivelyMainOperation(...args);

      return result;
    };

    beforeAll(async () => {
      const pageIdD = new mongoose.Types.ObjectId();
      const pageIdG = new mongoose.Types.ObjectId();

      await Page.insertMany([
        {
          path: '/norm_parent_by_path_A',
          grant: Page.GRANT_OWNER,
          grantedUsers: [testUser1._id],
          creator: testUser1._id,
          lastUpdateUser: testUser1._id,
          parent: rootPage._id,
        },
        {
          path: '/norm_parent_by_path_B/norm_parent_by_path_C',
          grant: Page.GRANT_OWNER,
          grantedUsers: [rootUser._id],
          creator: rootUser._id,
          lastUpdateUser: rootUser._id,
        },
        {
          _id: pageIdD,
          path: '/norm_parent_by_path_D',
          isEmpty: true,
          parent: rootPage._id,
          descendantCount: 1,
        },
        {
          path: '/norm_parent_by_path_D/norm_parent_by_path_E',
          grant: Page.GRANT_PUBLIC,
          creator: rootUser._id,
          lastUpdateUser: rootUser._id,
          parent: pageIdD,
        },
        {
          path: '/norm_parent_by_path_D/norm_parent_by_path_F',
          grant: Page.GRANT_OWNER,
          grantedUsers: [rootUser._id],
          creator: rootUser._id,
          lastUpdateUser: rootUser._id,
        },
        {
          _id: pageIdG,
          path: '/norm_parent_by_path_G',
          grant: Page.GRANT_PUBLIC,
          creator: rootUser._id,
          lastUpdateUser: rootUser._id,
          parent: rootPage._id,
          descendantCount: 1,
        },
        {
          path: '/norm_parent_by_path_G/norm_parent_by_path_H',
          grant: Page.GRANT_PUBLIC,
          creator: rootUser._id,
          lastUpdateUser: rootUser._id,
          parent: pageIdG,
        },
        {
          path: '/norm_parent_by_path_G/norm_parent_by_path_I',
          grant: Page.GRANT_OWNER,
          grantedUsers: [rootUser._id],
          creator: rootUser._id,
          lastUpdateUser: rootUser._id,
        },
      ]);
    });

    test('should fail when the user is not allowed to edit the target page found by path', async () => {
      const pageTestUser1 = await Page.findOne(
        ownedByTestUser1({ path: '/norm_parent_by_path_A' }),
      );

      expect(pageTestUser1).not.toBeNull();

      await expect(
        normalizeParentByPath('/norm_parent_by_path_A', rootUser),
      ).rejects.toThrowError();
    });

    test('should normalize all granted pages under the path when no page exists at the path', async () => {
      const _pageB = await Page.findOne({ path: '/norm_parent_by_path_B' });
      const _pageBC = await Page.findOne(
        root({ path: '/norm_parent_by_path_B/norm_parent_by_path_C' }),
      );

      expect(_pageB).toBeNull();
      expect(_pageBC).not.toBeNull();

      await normalizeParentByPath('/norm_parent_by_path_B', rootUser);

      const pagesB = await Page.find({ path: '/norm_parent_by_path_B' }); // did not exist before running normalizeParentByPath
      const pageBC = await Page.findById(_pageBC._id);

      // -- check count
      expect(pagesB.length).toBe(1);

      const pageB = pagesB[0];

      // -- check existance
      expect(pageB.path).toBe('/norm_parent_by_path_B');
      expect(pageBC.path).toBe('/norm_parent_by_path_B/norm_parent_by_path_C');

      // -- check parent
      expect(pageB.parent).toStrictEqual(rootPage._id);
      expect(pageBC.parent).toStrictEqual(pageB._id);

      // -- check descendantCount
      expect(pageB.descendantCount).toBe(1);
      expect(pageBC.descendantCount).toBe(0);
    });

    test('should normalize all granted pages under the path when an empty page exists at the path', async () => {
      const _emptyD = await Page.findOne({
        path: '/norm_parent_by_path_D',
        ...empty,
        ...normalized,
      });
      const _pageDE = await Page.findOne(
        onlyPublic({
          path: '/norm_parent_by_path_D/norm_parent_by_path_E',
          ...normalized,
        }),
      );
      const _pageDF = await Page.findOne(
        root({
          path: '/norm_parent_by_path_D/norm_parent_by_path_F',
          ...notNormalized,
        }),
      );

      expect(_emptyD).not.toBeNull();
      expect(_pageDE).not.toBeNull();
      expect(_pageDF).not.toBeNull();

      await normalizeParentByPath('/norm_parent_by_path_D', rootUser);

      const countD = await Page.count({ path: '/norm_parent_by_path_D' });

      // -- check count
      expect(countD).toBe(1);

      const pageD = await Page.findById(_emptyD._id);
      const pageDE = await Page.findById(_pageDE._id);
      const pageDF = await Page.findById(_pageDF._id);

      // -- check existance
      expect(pageD.path).toBe('/norm_parent_by_path_D');
      expect(pageDE.path).toBe('/norm_parent_by_path_D/norm_parent_by_path_E');
      expect(pageDF.path).toBe('/norm_parent_by_path_D/norm_parent_by_path_F');

      // -- check isEmpty of pageD
      // pageD should not be empty because growi system will create a non-empty page while running normalizeParentByPath
      expect(pageD.isEmpty).toBe(false);

      // -- check parent
      expect(pageD.parent).toStrictEqual(rootPage._id);
      expect(pageDE.parent).toStrictEqual(pageD._id);
      expect(pageDF.parent).toStrictEqual(pageD._id);

      // -- check descendantCount
      expect(pageD.descendantCount).toBe(2);
      expect(pageDE.descendantCount).toBe(0);
      expect(pageDF.descendantCount).toBe(0);
    });

    test('should normalize all granted pages under the path when a non-empty page exists at the path', async () => {
      const _pageG = await Page.findOne(
        onlyPublic({ path: '/norm_parent_by_path_G', ...normalized }),
      );
      const _pageGH = await Page.findOne(
        onlyPublic({
          path: '/norm_parent_by_path_G/norm_parent_by_path_H',
          ...normalized,
        }),
      );
      const _pageGI = await Page.findOne(
        root({
          path: '/norm_parent_by_path_G/norm_parent_by_path_I',
          ...notNormalized,
        }),
      );

      expect(_pageG).not.toBeNull();
      expect(_pageGH).not.toBeNull();
      expect(_pageGI).not.toBeNull();

      await normalizeParentByPath('/norm_parent_by_path_G', rootUser);

      const countG = await Page.count({ path: '/norm_parent_by_path_G' });

      // -- check count
      expect(countG).toBe(1);

      const pageG = await Page.findById(_pageG._id);
      const pageGH = await Page.findById(_pageGH._id);
      const pageGI = await Page.findById(_pageGI._id);

      // -- check existance
      expect(pageG.path).toBe('/norm_parent_by_path_G');
      expect(pageGH.path).toBe('/norm_parent_by_path_G/norm_parent_by_path_H');
      expect(pageGI.path).toBe('/norm_parent_by_path_G/norm_parent_by_path_I');

      // -- check parent
      expect(pageG.parent).toStrictEqual(rootPage._id);
      expect(pageGH.parent).toStrictEqual(pageG._id);
      expect(pageGI.parent).toStrictEqual(pageG._id);

      // -- check descendantCount
      expect(pageG.descendantCount).toBe(2);
      expect(pageGH.descendantCount).toBe(0);
      expect(pageGI.descendantCount).toBe(0);
    });
  });
});
