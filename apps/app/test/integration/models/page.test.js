const mongoose = require('mongoose');

const { getInstance } = require('../setup-crowi');

let testUser0;
let testUser1;
let testUser2;
let testGroup0;
let parentPage;

describe('Page', () => {
  // eslint-disable-next-line no-unused-vars
  let crowi;
  let Page;
  let PageQueryBuilder;
  let User;
  let UserGroup;
  let UserGroupRelation;

  beforeAll(async () => {
    crowi = await getInstance();

    User = mongoose.model('User');
    UserGroup = mongoose.model('UserGroup');
    UserGroupRelation = mongoose.model('UserGroupRelation');
    Page = mongoose.model('Page');
    PageQueryBuilder = Page.PageQueryBuilder;

    await User.insertMany([
      {
        name: 'Anon 0',
        username: 'anonymous0',
        email: 'anonymous0@example.com',
      },
      {
        name: 'Anon 1',
        username: 'anonymous1',
        email: 'anonymous1@example.com',
      },
      {
        name: 'Anon 2',
        username: 'anonymous2',
        email: 'anonymous2@example.com',
      },
    ]);

    await UserGroup.insertMany([
      { name: 'TestGroup0' },
      { name: 'TestGroup1' },
    ]);

    testUser0 = await User.findOne({ username: 'anonymous0' });
    testUser1 = await User.findOne({ username: 'anonymous1' });
    testUser2 = await User.findOne({ username: 'anonymous2' });

    testGroup0 = await UserGroup.findOne({ name: 'TestGroup0' });

    await UserGroupRelation.insertMany([
      {
        relatedGroup: testGroup0,
        relatedUser: testUser0,
      },
      {
        relatedGroup: testGroup0,
        relatedUser: testUser1,
      },
    ]);

    await Page.insertMany([
      {
        path: '/user/anonymous0/memo',
        grant: Page.GRANT_RESTRICTED,
        grantedUsers: [testUser0],
        creator: testUser0,
      },
      {
        path: '/grant',
        grant: Page.GRANT_PUBLIC,
        grantedUsers: [testUser0],
        creator: testUser0,
      },
      {
        path: '/grant/public',
        grant: Page.GRANT_PUBLIC,
        grantedUsers: [testUser0],
        creator: testUser0,
      },
      {
        path: '/grant/restricted',
        grant: Page.GRANT_RESTRICTED,
        grantedUsers: [testUser0],
        creator: testUser0,
      },
      {
        path: '/grant/specified',
        grant: Page.GRANT_SPECIFIED,
        grantedUsers: [testUser0],
        creator: testUser0,
      },
      {
        path: '/grant/owner',
        grant: Page.GRANT_OWNER,
        grantedUsers: [testUser0],
        creator: testUser0,
      },
      {
        path: '/page/child/without/parents',
        grant: Page.GRANT_PUBLIC,
        creator: testUser0,
      },
      {
        path: '/grant/groupacl',
        grant: Page.GRANT_USER_GROUP,
        grantedUsers: [],
        grantedGroups: [{ item: testGroup0, type: 'UserGroup' }],
        creator: testUser1,
      },
      {
        path: '/page1',
        grant: Page.GRANT_PUBLIC,
        creator: testUser0,
      },
      {
        path: '/page1/child1',
        grant: Page.GRANT_PUBLIC,
        creator: testUser0,
      },
      {
        path: '/page2',
        grant: Page.GRANT_PUBLIC,
        creator: testUser0,
      },
    ]);

    parentPage = await Page.findOne({ path: '/grant' });
  });

  describe('.isPublic', () => {
    describe('with a public page', () => {
      test('should return true', async () => {
        const page = await Page.findOne({ path: '/grant/public' });
        expect(page.isPublic()).toEqual(true);
      });
    });

    ['restricted', 'specified', 'owner'].forEach((grant) => {
      describe(`with a ${grant} page`, () => {
        test('should return false', async () => {
          const page = await Page.findOne({ path: `/grant/${grant}` });
          expect(page.isPublic()).toEqual(false);
        });
      });
    });
  });

  describe('.getDeletedPageName', () => {
    test('should return trash page name', () => {
      expect(Page.getDeletedPageName('/hoge')).toEqual('/trash/hoge');
      expect(Page.getDeletedPageName('hoge')).toEqual('/trash/hoge');
    });
  });
  describe('.getRevertDeletedPageName', () => {
    test('should return reverted trash page name', () => {
      expect(Page.getRevertDeletedPageName('/hoge')).toEqual('/hoge');
      expect(Page.getRevertDeletedPageName('/trash/hoge')).toEqual('/hoge');
      expect(Page.getRevertDeletedPageName('/trash/hoge/trash')).toEqual(
        '/hoge/trash',
      );
    });
  });

  describe('.isAccessiblePageByViewer', () => {
    describe('with a granted page', () => {
      test('should return true with granted user', async () => {
        const user = await User.findOne({ email: 'anonymous0@example.com' });
        const page = await Page.findOne({ path: '/user/anonymous0/memo' });

        const bool = await Page.isAccessiblePageByViewer(page.id, user);
        expect(bool).toEqual(true);
      });
      test('should return false without user', async () => {
        const user = null;
        const page = await Page.findOne({ path: '/user/anonymous0/memo' });

        const bool = await Page.isAccessiblePageByViewer(page.id, user);
        expect(bool).toEqual(true);
      });
    });

    describe('with a public page', () => {
      test('should return true with user', async () => {
        const user = await User.findOne({ email: 'anonymous1@example.com' });
        const page = await Page.findOne({ path: '/grant/public' });

        const bool = await Page.isAccessiblePageByViewer(page.id, user);
        expect(bool).toEqual(true);
      });
      test('should return true with out', async () => {
        const user = null;
        const page = await Page.findOne({ path: '/grant/public' });

        const bool = await Page.isAccessiblePageByViewer(page.id, user);
        expect(bool).toEqual(true);
      });
    });

    describe('with a restricted page', () => {
      test('should return false with user who has no grant', async () => {
        const user = await User.findOne({ email: 'anonymous1@example.com' });
        const page = await Page.findOne({ path: '/grant/owner' });

        const bool = await Page.isAccessiblePageByViewer(page.id, user);
        expect(bool).toEqual(false);
      });
      test('should return false without user', async () => {
        const user = null;
        const page = await Page.findOne({ path: '/grant/owner' });

        const bool = await Page.isAccessiblePageByViewer(page.id, user);
        expect(bool).toEqual(false);
      });
    });
  });

  describe('.findPage', () => {
    describe('findByIdAndViewer', () => {
      test('should find page (public)', async () => {
        const expectedPage = await Page.findOne({ path: '/grant/public' });
        const page = await Page.findByIdAndViewer(expectedPage.id, testUser0);
        expect(page).not.toBeNull();
        expect(page.path).toEqual(expectedPage.path);
      });

      test('should find page (anyone knows link)', async () => {
        const expectedPage = await Page.findOne({ path: '/grant/restricted' });
        const page = await Page.findByIdAndViewer(expectedPage.id, testUser1);
        expect(page).not.toBeNull();
        expect(page.path).toEqual(expectedPage.path);
      });

      test('should find page (only me)', async () => {
        const expectedPage = await Page.findOne({ path: '/grant/owner' });
        const page = await Page.findByIdAndViewer(expectedPage.id, testUser0);
        expect(page).not.toBeNull();
        expect(page.path).toEqual(expectedPage.path);
      });

      test('should not be found by grant (only me)', async () => {
        const expectedPage = await Page.findOne({ path: '/grant/owner' });
        const page = await Page.findByIdAndViewer(expectedPage.id, testUser1);
        expect(page).toBeNull();
      });
    });

    describe('findByIdAndViewer granted userGroup', () => {
      test('should find page', async () => {
        const expectedPage = await Page.findOne({ path: '/grant/groupacl' });
        const page = await Page.findByIdAndViewer(expectedPage.id, testUser0);
        expect(page).not.toBeNull();
        expect(page.path).toEqual(expectedPage.path);
      });

      test('should not be found by grant', async () => {
        const expectedPage = await Page.findOne({ path: '/grant/groupacl' });
        const page = await Page.findByIdAndViewer(expectedPage.id, testUser2);
        expect(page).toBeNull();
      });
    });
  });

  describe('PageQueryBuilder.addConditionToListWithDescendants', () => {
    test('can retrieve descendants of /page', async () => {
      const builder = new PageQueryBuilder(Page.find());
      builder.addConditionToListWithDescendants('/page');

      const result = await builder.query.exec();

      // assert totalCount
      expect(result.length).toEqual(1);
      // assert paths
      const pagePaths = result.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/page/child/without/parents');
    });

    test('can retrieve descendants of /page1', async () => {
      const builder = new PageQueryBuilder(Page.find());
      builder.addConditionToListWithDescendants('/page1/');

      const result = await builder.query.exec();

      // assert totalCount
      expect(result.length).toEqual(2);
      // assert paths
      const pagePaths = result.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/page1');
      expect(pagePaths).toContainEqual('/page1/child1');
    });
  });

  describe('PageQueryBuilder.addConditionToListOnlyDescendants', () => {
    test('can retrieve only descendants of /page', async () => {
      const builder = new PageQueryBuilder(Page.find());
      builder.addConditionToListOnlyDescendants('/page');

      const result = await builder.query.exec();

      // assert totalCount
      expect(result.length).toEqual(1);
      // assert paths
      const pagePaths = result.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/page/child/without/parents');
    });

    test('can retrieve only descendants of /page1', async () => {
      const builder = new PageQueryBuilder(Page.find());
      builder.addConditionToListOnlyDescendants('/page1');

      const result = await builder.query.exec();

      // assert totalCount
      expect(result.length).toEqual(1);
      // assert paths
      const pagePaths = result.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/page1/child1');
    });
  });

  describe('PageQueryBuilder.addConditionToListByStartWith', () => {
    test('can retrieve pages which starts with /page', async () => {
      const builder = new PageQueryBuilder(Page.find());
      builder.addConditionToListByStartWith('/page');

      const result = await builder.query.exec();

      // assert totalCount
      expect(result.length).toEqual(4);
      // assert paths
      const pagePaths = result.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/page/child/without/parents');
      expect(pagePaths).toContainEqual('/page1');
      expect(pagePaths).toContainEqual('/page1/child1');
      expect(pagePaths).toContainEqual('/page2');
    });
  });

  describe('.findListWithDescendants', () => {
    test('can retrieve all pages with testUser0', async () => {
      const result = await Page.findListWithDescendants('/grant', testUser0);
      const { pages } = result;

      // assert totalCount
      expect(pages.length).toEqual(5);

      // assert paths
      const pagePaths = await pages.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/grant/groupacl');
      expect(pagePaths).toContainEqual('/grant/specified');
      expect(pagePaths).toContainEqual('/grant/owner');
      expect(pagePaths).toContainEqual('/grant/public');
      expect(pagePaths).toContainEqual('/grant');
    });

    test('can retrieve all pages with testUser1', async () => {
      const result = await Page.findListWithDescendants('/grant', testUser1);
      const { pages } = result;

      // assert totalCount
      expect(pages.length).toEqual(5);

      // assert paths
      const pagePaths = await pages.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/grant/groupacl');
      expect(pagePaths).toContainEqual('/grant/specified');
      expect(pagePaths).toContainEqual('/grant/owner');
      expect(pagePaths).toContainEqual('/grant/public');
      expect(pagePaths).toContainEqual('/grant');
    });

    test('can retrieve all pages with testUser2', async () => {
      const result = await Page.findListWithDescendants('/grant', testUser2);
      const { pages } = result;

      // assert totalCount
      expect(pages.length).toEqual(5);

      // assert paths
      const pagePaths = await pages.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/grant/groupacl');
      expect(pagePaths).toContainEqual('/grant/specified');
      expect(pagePaths).toContainEqual('/grant/owner');
      expect(pagePaths).toContainEqual('/grant/public');
      expect(pagePaths).toContainEqual('/grant');
    });

    test('can retrieve all pages without user', async () => {
      const result = await Page.findListWithDescendants('/grant', null);
      const { pages } = result;

      // assert totalCount
      expect(pages.length).toEqual(5);

      // assert paths
      const pagePaths = await pages.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/grant/groupacl');
      expect(pagePaths).toContainEqual('/grant/specified');
      expect(pagePaths).toContainEqual('/grant/owner');
      expect(pagePaths).toContainEqual('/grant/public');
      expect(pagePaths).toContainEqual('/grant');
    });
  });

  describe('.findManageableListWithDescendants', () => {
    test('can retrieve all pages with testUser0', async () => {
      const pages = await Page.findManageableListWithDescendants(
        parentPage,
        testUser0,
      );

      // assert totalCount
      expect(pages.length).toEqual(5);

      // assert paths
      const pagePaths = await pages.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/grant/groupacl');
      expect(pagePaths).toContainEqual('/grant/specified');
      expect(pagePaths).toContainEqual('/grant/owner');
      expect(pagePaths).toContainEqual('/grant/public');
      expect(pagePaths).toContainEqual('/grant');
    });

    test('can retrieve group page and public page which starts with testUser1', async () => {
      const pages = await Page.findManageableListWithDescendants(
        parentPage,
        testUser1,
      );

      // assert totalCount
      expect(pages.length).toEqual(3);

      // assert paths
      const pagePaths = await pages.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/grant/groupacl');
      expect(pagePaths).toContainEqual('/grant/public');
      expect(pagePaths).toContainEqual('/grant');
    });

    test('can retrieve only public page which starts with testUser2', async () => {
      const pages = await Page.findManageableListWithDescendants(
        parentPage,
        testUser2,
      );

      // assert totalCount
      expect(pages.length).toEqual(2);

      // assert paths
      const pagePaths = await pages.map((page) => {
        return page.path;
      });
      expect(pagePaths).toContainEqual('/grant/public');
      expect(pagePaths).toContainEqual('/grant');
    });

    test('can retrieve only public page which starts without user', async () => {
      const pages = await Page.findManageableListWithDescendants(
        parentPage,
        null,
      );

      // assert totalCount
      expect(pages).toBeNull();
    });
  });
});
