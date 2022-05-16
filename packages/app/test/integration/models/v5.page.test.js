import mongoose from 'mongoose';


import { getInstance } from '../setup-crowi';

describe('Page', () => {
  let crowi;
  let Page;
  let Revision;
  let User;
  let PageTagRelation;
  let Bookmark;
  let Comment;
  let ShareLink;
  let PageRedirect;
  let UserGroup;
  let UserGroupRelation;
  let xssSpy;

  let rootPage;
  let dummyUser1;
  let pModelUser1;
  let pModelUser2;
  let pModelUser3;
  let groupIdIsolate;
  let groupIdA;
  let groupIdB;
  let groupIdC;

  beforeAll(async() => {
    crowi = await getInstance();
    await crowi.configManager.updateConfigsInTheSameNamespace('crowi', { 'app:isV5Compatible': true });

    jest.restoreAllMocks();
    User = mongoose.model('User');
    Page = mongoose.model('Page');
    Revision = mongoose.model('Revision');
    PageTagRelation = mongoose.model('PageTagRelation');
    Bookmark = mongoose.model('Bookmark');
    Comment = mongoose.model('Comment');
    ShareLink = mongoose.model('ShareLink');
    PageRedirect = mongoose.model('PageRedirect');
    UserGroup = mongoose.model('UserGroup');
    UserGroupRelation = mongoose.model('UserGroupRelation');

    dummyUser1 = await User.findOne({ username: 'v5DummyUser1' });

    rootPage = await Page.findOne({ path: '/' });

    const pModelUserId1 = new mongoose.Types.ObjectId();
    const pModelUserId2 = new mongoose.Types.ObjectId();
    const pModelUserId3 = new mongoose.Types.ObjectId();
    await User.insertMany([
      {
        _id: pModelUserId1,
        name: 'pmodelUser1',
        username: 'pmodelUser1',
        email: 'pmodelUser1@example.com',
      },
      {
        _id: pModelUserId2,
        name: 'pmodelUser2',
        username: 'pmodelUser2',
        email: 'pmodelUser2@example.com',
      },
      {
        _id: pModelUserId3,
        name: 'pModelUser3',
        username: 'pModelUser3',
        email: 'pModelUser3@example.com',
      },
    ]);
    pModelUser1 = await User.findOne({ _id: pModelUserId1 });
    pModelUser2 = await User.findOne({ _id: pModelUserId2 });
    pModelUser3 = await User.findOne({ _id: pModelUserId3 });


    groupIdIsolate = new mongoose.Types.ObjectId();
    groupIdA = new mongoose.Types.ObjectId();
    groupIdB = new mongoose.Types.ObjectId();
    groupIdC = new mongoose.Types.ObjectId();
    await UserGroup.insertMany([
      {
        _id: groupIdIsolate,
        name: 'pModel_groupIsolate',
      },
      {
        _id: groupIdA,
        name: 'pModel_groupA',
      },
      {
        _id: groupIdB,
        name: 'pModel_groupB',
        parent: groupIdA,
      },
      {
        _id: groupIdC,
        name: 'pModel_groupC',
        parent: groupIdB,
      },
    ]);

    await UserGroupRelation.insertMany([
      {
        relatedGroup: groupIdIsolate,
        relatedUser: pModelUserId1,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdIsolate,
        relatedUser: pModelUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdA,
        relatedUser: pModelUserId1,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdA,
        relatedUser: pModelUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdA,
        relatedUser: pModelUserId3,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdB,
        relatedUser: pModelUserId2,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdB,
        relatedUser: pModelUserId3,
        createdAt: new Date(),
      },
      {
        relatedGroup: groupIdC,
        relatedUser: pModelUserId3,
        createdAt: new Date(),
      },
    ]);

    const pageIdCreate1 = new mongoose.Types.ObjectId();
    const pageIdCreate2 = new mongoose.Types.ObjectId();
    const pageIdCreate3 = new mongoose.Types.ObjectId();
    const pageIdCreate4 = new mongoose.Types.ObjectId();

    /**
     * create
     * mc_ => model create
     * emp => empty => page with isEmpty: true
     * pub => public => GRANT_PUBLIC
     */
    await Page.insertMany([
      {
        _id: pageIdCreate1,
        path: '/v5_empty_create_4',
        grant: Page.GRANT_PUBLIC,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        path: '/v5_empty_create_4/v5_create_5',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdCreate1,
        isEmpty: false,
      },
      {
        _id: pageIdCreate2,
        path: '/mc4_top/mc1_emp',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        path: '/mc4_top/mc1_emp/mc2_pub',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdCreate2,
        isEmpty: false,
      },
      {
        path: '/mc5_top/mc3_awl',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
      },
      {
        _id: pageIdCreate3,
        path: '/mc4_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        _id: pageIdCreate4,
        path: '/mc5_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
    ]);

    /**
     * update
     * mup_ => model update
     * emp => empty => page with isEmpty: true
     * pub => public => GRANT_PUBLIC
     * awl => Anyone with the link => GRANT_RESTRICTED
     */
    const pageIdUpd1 = new mongoose.Types.ObjectId();
    const pageIdUpd2 = new mongoose.Types.ObjectId();
    const pageIdUpd3 = new mongoose.Types.ObjectId();
    const pageIdUpd4 = new mongoose.Types.ObjectId();
    const pageIdUpd5 = new mongoose.Types.ObjectId();
    const pageIdUpd6 = new mongoose.Types.ObjectId();
    const pageIdUpd7 = new mongoose.Types.ObjectId();
    const pageIdUpd8 = new mongoose.Types.ObjectId();
    const pageIdUpd9 = new mongoose.Types.ObjectId();
    const pageIdUpd10 = new mongoose.Types.ObjectId();
    const pageIdUpd11 = new mongoose.Types.ObjectId();
    const pageIdUpd12 = new mongoose.Types.ObjectId();
    const pageIdUpd13 = new mongoose.Types.ObjectId();

    await Page.insertMany([
      {
        _id: pageIdUpd1,
        path: '/mup13_top/mup1_emp',
        grant: Page.GRANT_PUBLIC,
        parent: pageIdUpd8._id,
        isEmpty: true,
      },
      {
        _id: pageIdUpd2,
        path: '/mup13_top/mup1_emp/mup2_pub',
        grant: Page.GRANT_PUBLIC,
        parent: pageIdUpd1._id,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
      },
      {
        _id: pageIdUpd3,
        path: '/mup14_top/mup6_pub',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdUpd9,
        isEmpty: false,
        descendantCount: 1,
      },
      {
        path: '/mup14_top/mup6_pub/mup7_pub',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdUpd3,
        isEmpty: false,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd4,
        path: '/mup15_top/mup8_pub',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdUpd10._id,
        isEmpty: false,
      },
      {
        _id: pageIdUpd5,
        path: '/mup16_top/mup9_pub/mup10_pub/mup11_awl',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
      },
      {
        _id: pageIdUpd6,
        path: '/mup17_top/mup12_emp',
        isEmpty: true,
        parent: pageIdUpd12._id,
        descendantCount: 1,
      },
      {
        _id: pageIdUpd7,
        path: '/mup17_top/mup12_emp',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
      },
      {
        path: '/mup17_top/mup12_emp/mup18_pub',
        isEmpty: false,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdUpd6._id,
      },
      {
        _id: pageIdUpd8,
        path: '/mup13_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 2,
      },
      {
        _id: pageIdUpd9,
        path: '/mup14_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 2,
      },
      {
        _id: pageIdUpd10,
        path: '/mup15_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        _id: pageIdUpd11,
        path: '/mup16_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd12,
        path: '/mup17_top',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        path: '/mup19',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        path: '/mup20',
        grant: Page.GRANT_USER_GROUP,
        grantedGroup: groupIdA,
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        path: '/mup21',
        grant: Page.GRANT_RESTRICTED,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        descendantCount: 0,
      },
      {
        _id: pageIdUpd13,
        path: '/mup22',
        grant: Page.GRANT_PUBLIC,
        creator: pModelUser1,
        lastUpdateUser: pModelUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        path: '/mup22/mup23',
        grant: Page.GRANT_USER_GROUP,
        grantedGroup: groupIdA,
        creator: pModelUserId1,
        lastUpdateUser: pModelUserId1,
        isEmpty: false,
        parent: pageIdUpd13,
        descendantCount: 0,
      },
      {
        path: '/mup24',
        grant: Page.GRANT_OWNER,
        grantedUsers: [dummyUser1._id],
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
    ]);

    /**
     * getParentAndFillAncestors
     */
    const pageIdPAF1 = new mongoose.Types.ObjectId();
    const pageIdPAF2 = new mongoose.Types.ObjectId();
    const pageIdPAF3 = new mongoose.Types.ObjectId();

    await Page.insertMany([
      {
        _id: pageIdPAF1,
        path: '/PAF1',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        _id: pageIdPAF2,
        path: '/emp_anc3',
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
        descendantCount: 1,
        parent: rootPage._id,
      },
      {
        path: '/emp_anc3/PAF3',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        descendantCount: 0,
        parent: pageIdPAF2,
      },
      {
        _id: pageIdPAF3,
        path: '/emp_anc4',
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
        descendantCount: 1,
        parent: rootPage._id,
      },
      {
        path: '/emp_anc4/PAF4',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
        descendantCount: 0,
        parent: pageIdPAF3,
      },
      {
        path: '/emp_anc4',
        grant: Page.GRANT_OWNER,
        grantedUsers: [dummyUser1._id],
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        isEmpty: false,
      },
      {
        path: '/get_parent_A',
        creator: dummyUser1,
        lastUpdateUser: dummyUser1,
        parent: null,
      },
      {
        path: '/get_parent_A/get_parent_B',
        creator: dummyUser1,
        lastUpdateUser: dummyUser1,
        parent: null,
      },
      {
        path: '/get_parent_C',
        creator: dummyUser1,
        lastUpdateUser: dummyUser1,
        parent: rootPage._id,
      },
      {
        path: '/get_parent_C/get_parent_D',
        creator: dummyUser1,
        lastUpdateUser: dummyUser1,
        parent: null,
      },
    ]);

  });
  describe('create', () => {

    test('Should create single page', async() => {
      const page = await Page.create('/v5_create1', 'create1', dummyUser1, {});
      expect(page).toBeTruthy();
      expect(page.parent).toStrictEqual(rootPage._id);
    });

    test('Should create empty-child and non-empty grandchild', async() => {
      const grandchildPage = await Page.create('/v5_empty_create2/v5_create_3', 'grandchild', dummyUser1, {});
      const childPage = await Page.findOne({ path: '/v5_empty_create2' });

      expect(childPage.isEmpty).toBe(true);
      expect(grandchildPage).toBeTruthy();
      expect(childPage).toBeTruthy();
      expect(childPage.parent).toStrictEqual(rootPage._id);
      expect(grandchildPage.parent).toStrictEqual(childPage._id);
    });

    test('Should create on empty page', async() => {
      const beforeCreatePage = await Page.findOne({ path: '/v5_empty_create_4' });
      expect(beforeCreatePage.isEmpty).toBe(true);

      const childPage = await Page.create('/v5_empty_create_4', 'body', dummyUser1, {});
      const grandchildPage = await Page.findOne({ parent: childPage._id });

      expect(childPage).toBeTruthy();
      expect(childPage.isEmpty).toBe(false);
      expect(childPage.revision.body).toBe('body');
      expect(grandchildPage).toBeTruthy();
      expect(childPage.parent).toStrictEqual(rootPage._id);
      expect(grandchildPage.parent).toStrictEqual(childPage._id);
    });

    describe('Creating a page using existing path', () => {
      test('with grant RESTRICTED should only create the page and change nothing else', async() => {
        const pathT = '/mc4_top';
        const path1 = '/mc4_top/mc1_emp';
        const path2 = '/mc4_top/mc1_emp/mc2_pub';
        const pageT = await Page.findOne({ path: pathT, descendantCount: 1 });
        const page1 = await Page.findOne({ path: path1, grant: Page.GRANT_PUBLIC });
        const page2 = await Page.findOne({ path: path2 });
        const page3 = await Page.findOne({ path: path1, grant: Page.GRANT_RESTRICTED });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeTruthy();
        expect(page3).toBeNull();

        // use existing path
        await Page.create(path1, 'new body', dummyUser1, { grant: Page.GRANT_RESTRICTED });

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({ path: path1, grant: Page.GRANT_PUBLIC });
        const _page2 = await Page.findOne({ path: path2 });
        const _page3 = await Page.findOne({ path: path1, grant: Page.GRANT_RESTRICTED });
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_page3).toBeTruthy();
        expect(_pageT.descendantCount).toBe(1);
      });
    });
    describe('Creating a page under a page with grant RESTRICTED', () => {
      test('will create a new empty page with the same path as the grant RESTRECTED page and become a parent', async() => {
        const pathT = '/mc5_top';
        const path1 = '/mc5_top/mc3_awl';
        const pathN = '/mc5_top/mc3_awl/mc4_pub'; // used to create
        const pageT = await Page.findOne({ path: pathT });
        const page1 = await Page.findOne({ path: path1, grant: Page.GRANT_RESTRICTED });
        const page2 = await Page.findOne({ path: path1, grant: Page.GRANT_PUBLIC });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeNull();

        await Page.create(pathN, 'new body', dummyUser1, { grant: Page.GRANT_PUBLIC });

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({ path: path1, grant: Page.GRANT_RESTRICTED });
        const _page2 = await Page.findOne({ path: path1, grant: Page.GRANT_PUBLIC, isEmpty: true });
        const _pageN = await Page.findOne({ path: pathN, grant: Page.GRANT_PUBLIC }); // newly crated
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_pageN).toBeTruthy();
        expect(_pageN.parent).toStrictEqual(_page2._id);
        expect(_pageT.descendantCount).toStrictEqual(1);
      });
    });

  });

  describe('update', () => {

    const updatePage = async(page, newRevisionBody, oldRevisionBody, user, options = {}) => {
      const mockedRenameSubOperation = jest.spyOn(Page, 'emitPageEventUpdate').mockReturnValue(null);
      const savedPage = await Page.updatePage(page, newRevisionBody, oldRevisionBody, user, options);
      mockedRenameSubOperation.mockRestore();
      return savedPage;
    };

    describe('Changing grant from PUBLIC to RESTRICTED of', () => {
      test('an only-child page will delete its empty parent page', async() => {
        const pathT = '/mup13_top';
        const path1 = '/mup13_top/mup1_emp';
        const path2 = '/mup13_top/mup1_emp/mup2_pub';
        const pageT = await Page.findOne({ path: pathT, descendantCount: 2 });
        const page1 = await Page.findOne({ path: path1, isEmpty: true });
        const page2 = await Page.findOne({ path: path2, grant: Page.GRANT_PUBLIC });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeTruthy();

        const options = { grant: Page.GRANT_RESTRICTED, grantUserGroupId: null };
        await Page.updatePage(page2, 'newRevisionBody', 'oldRevisionBody', dummyUser1, options);

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({ path: path1 });
        const _page2 = await Page.findOne({ path: path2, grant: Page.GRANT_RESTRICTED });
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeNull();
        expect(_page2).toBeTruthy();
        expect(_pageT.descendantCount).toBe(1);
      });
      test('a page that has children will create an empty page with the same path and it becomes a new parent', async() => {
        const pathT = '/mup14_top';
        const path1 = '/mup14_top/mup6_pub';
        const path2 = '/mup14_top/mup6_pub/mup7_pub';
        const top = await Page.findOne({ path: pathT, descendantCount: 2 });
        const page1 = await Page.findOne({ path: path1, grant: Page.GRANT_PUBLIC });
        const page2 = await Page.findOne({ path: path2, grant: Page.GRANT_PUBLIC });
        expect(top).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeTruthy();

        await Page.updatePage(page1, 'newRevisionBody', 'oldRevisionBody', dummyUser1, { grant: Page.GRANT_RESTRICTED });

        const _top = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({ path: path1, grant: Page.GRANT_RESTRICTED });
        const _page2 = await Page.findOne({ path: path2 });
        const _pageN = await Page.findOne({ path: path1, grant: Page.GRANT_PUBLIC });
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_pageN).toBeTruthy();

        expect(_page1.parent).toBeNull();
        expect(_page2.parent).toStrictEqual(_pageN._id);
        expect(_pageN.parent).toStrictEqual(top._id);
        expect(_pageN.isEmpty).toBe(true);
        expect(_pageN.descendantCount).toBe(1);
        expect(_top.descendantCount).toBe(1);
      });
      test('of a leaf page will NOT have an empty page with the same path', async() => {
        const pathT = '/mup15_top';
        const path1 = '/mup15_top/mup8_pub';
        const pageT = await Page.findOne({ path: pathT, descendantCount: 1 });
        const page1 = await Page.findOne({ path: path1, grant: Page.GRANT_PUBLIC });
        const count = await Page.count({ path: path1 });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(count).toBe(1);

        await Page.updatePage(page1, 'newRevisionBody', 'oldRevisionBody', dummyUser1, { grant: Page.GRANT_RESTRICTED });

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({ path: path1, grant: Page.GRANT_RESTRICTED });
        const _pageNotExist = await Page.findOne({ path: path1, isEmpty: true });
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeTruthy();
        expect(_pageNotExist).toBeNull();
        expect(_pageT.descendantCount).toBe(0);
      });
    });

    describe('Changing grant to GRANT_RESTRICTED', () => {
      test('successfully change to GRANT_RESTRICTED from GRANT_OWNER', async() => {
        const path = '/mup24';
        const _page = await Page.findOne({ path, grant: Page.GRANT_OWNER, grantedUsers: [dummyUser1._id] });
        expect(_page).toBeTruthy();

        await updatePage(_page, 'newRevisionBody', 'oldRevisionBody', dummyUser1, { grant: Page.GRANT_RESTRICTED });

        const page = await Page.findOne({ path });
        expect(page).toBeTruthy();
        expect(page.grant).toBe(Page.GRANT_RESTRICTED);
        expect(page.grantedUsers).toStrictEqual([]);
      });
    });

    describe('Changing grant from RESTRICTED to PUBLIC of', () => {
      test('a page will create ancestors if they do not exist', async() => {
        const pathT = '/mup16_top';
        const path1 = '/mup16_top/mup9_pub';
        const path2 = '/mup16_top/mup9_pub/mup10_pub';
        const path3 = '/mup16_top/mup9_pub/mup10_pub/mup11_awl';
        const top = await Page.findOne({ path: pathT });
        const page1 = await Page.findOne({ path: path1 });
        const page2 = await Page.findOne({ path: path2 });
        const page3 = await Page.findOne({ path: path3, grant: Page.GRANT_RESTRICTED });
        expect(top).toBeTruthy();
        expect(page3).toBeTruthy();
        expect(page1).toBeNull();
        expect(page2).toBeNull();

        await Page.updatePage(page3, 'newRevisionBody', 'oldRevisionBody', dummyUser1, { grant: Page.GRANT_PUBLIC });

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({ path: path1, isEmpty: true });
        const _page2 = await Page.findOne({ path: path2, isEmpty: true });
        const _page3 = await Page.findOne({ path: path3, grant: Page.GRANT_PUBLIC });
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();
        expect(_page3).toBeTruthy();
        expect(_page1.parent).toStrictEqual(top._id);
        expect(_page2.parent).toStrictEqual(_page1._id);
        expect(_page3.parent).toStrictEqual(_page2._id);
        expect(_pageT.descendantCount).toBe(1);
      });
      test('a page will replace an empty page with the same path if any', async() => {
        const pathT = '/mup17_top';
        const path1 = '/mup17_top/mup12_emp';
        const path2 = '/mup17_top/mup12_emp/mup18_pub';
        const pageT = await Page.findOne({ path: pathT, descendantCount: 1 });
        const page1 = await Page.findOne({ path: path1, isEmpty: true });
        const page2 = await Page.findOne({ path: path1, grant: Page.GRANT_RESTRICTED, isEmpty: false });
        const page3 = await Page.findOne({ path: path2 });
        expect(pageT).toBeTruthy();
        expect(page1).toBeTruthy();
        expect(page2).toBeTruthy();
        expect(page3).toBeTruthy();

        await Page.updatePage(page2, 'newRevisionBody', 'oldRevisionBody', dummyUser1, { grant: Page.GRANT_PUBLIC });

        const _pageT = await Page.findOne({ path: pathT });
        const _page1 = await Page.findOne({ path: path1, isEmpty: true }); // should be replaced
        const _page2 = await Page.findOne({ path: path1, grant: Page.GRANT_PUBLIC });
        const _page3 = await Page.findOne({ path: path2 });
        expect(_pageT).toBeTruthy();
        expect(_page1).toBeNull();
        expect(_page2).toBeTruthy();
        expect(_page3).toBeTruthy();
        expect(_page2.grant).toBe(Page.GRANT_PUBLIC);
        expect(_page2.parent).toStrictEqual(_pageT._id);
        expect(_page3.parent).toStrictEqual(_page2._id);
        expect(_pageT.descendantCount).toBe(2);
      });
    });

    describe('Changing grant to GRANT_OWNER(onlyme)', () => {
      test('successfully change to GRANT_OWNER from GRANT_PUBLIC', async() => {
        const path = '/mup19';
        const _page = await Page.findOne({ path, grant: Page.GRANT_PUBLIC });
        expect(_page).toBeTruthy();

        await updatePage(_page, 'newRevisionBody', 'oldRevisionBody', dummyUser1, { grant: Page.GRANT_OWNER });

        const page = await Page.findOne({ path });
        expect(page.grant).toBe(Page.GRANT_OWNER);
        expect(page.grantedUsers).toStrictEqual([dummyUser1._id]);

      });
      test('successfully change to GRANT_OWNER from GRANT_USER_GROUP', async() => {
        const path = '/mup20';
        const _page = await Page.findOne({ path, grant: Page.GRANT_USER_GROUP, grantedGroup: groupIdA });
        expect(_page).toBeTruthy();

        await updatePage(_page, 'newRevisionBody', 'oldRevisionBody', pModelUser1, { grant: Page.GRANT_OWNER });

        const page = await Page.findOne({ path });
        expect(page.grant).toBe(Page.GRANT_OWNER);
        expect(page.grantedUsers).toStrictEqual([pModelUser1._id]);
        expect(page.grantedGroup).toBeNull();
      });
      test('successfully change to GRANT_OWNER from GRANT_RESTRICTED', async() => {
        const path = '/mup21';
        const _page = await Page.findOne({ path, grant: Page.GRANT_RESTRICTED });
        expect(_page).toBeTruthy();

        await updatePage(_page, 'newRevisionBody', 'oldRevisionBody', dummyUser1, { grant: Page.GRANT_OWNER });

        const page = await Page.findOne({ path });
        expect(page.grant).toBe(Page.GRANT_OWNER);
        expect(page.grantedUsers).toStrictEqual([dummyUser1._id]);
      });
      test('Failed to change to GRANT_OWNER if one of the ancestors is GRANT_USER_GROUP page', async() => {
        const path1 = '/mup22';
        const path2 = '/mup22/mup23';
        const _page1 = await Page.findOne({ path: path1, grant: Page.GRANT_PUBLIC });
        const _page2 = await Page.findOne({ path: path2, grant: Page.GRANT_USER_GROUP, grantedGroup: groupIdA });
        expect(_page1).toBeTruthy();
        expect(_page2).toBeTruthy();

        await expect(updatePage(_page1, 'newRevisionBody', 'oldRevisionBody', dummyUser1, { grant: Page.GRANT_OWNER }))
          .rejects.toThrow(new Error('The selected grant or grantedGroup is not assignable to this page.'));

        const page1 = await Page.findOne({ path1 });
        expect(page1).toBeTruthy();
        expect(page1.grant).toBe(Page.GRANT_PUBLIC);
        expect(page1.grantedUsers).not.toStrictEqual([dummyUser1._id]);
      });
    });

  });

  describe('getParentAndFillAncestors', () => {
    test('return parent if exist', async() => {
      const page1 = await Page.findOne({ path: '/PAF1' });
      const parent = await Page.getParentAndFillAncestors(page1.path, dummyUser1);
      expect(parent).toBeTruthy();
      expect(page1.parent).toStrictEqual(parent._id);
    });
    test('create parent and ancestors when they do not exist, and return the new parent', async() => {
      const path1 = '/emp_anc1';
      const path2 = '/emp_anc1/emp_anc2';
      const path3 = '/emp_anc1/emp_anc2/PAF2';
      const _page1 = await Page.findOne({ path: path1 }); // not exist
      const _page2 = await Page.findOne({ path: path2 }); // not exist
      const _page3 = await Page.findOne({ path: path3 }); // not exist
      expect(_page1).toBeNull();
      expect(_page2).toBeNull();
      expect(_page3).toBeNull();

      const parent = await Page.getParentAndFillAncestors(path3, dummyUser1);
      const page1 = await Page.findOne({ path: path1 });
      const page2 = await Page.findOne({ path: path2 });
      const page3 = await Page.findOne({ path: path3 });

      expect(parent._id).toStrictEqual(page2._id);
      expect(parent.path).toStrictEqual(page2.path);
      expect(parent.parent).toStrictEqual(page2.parent);

      expect(parent).toBeTruthy();
      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();
      expect(page3).toBeNull();

      expect(page1.parent).toStrictEqual(rootPage._id);
      expect(page2.parent).toStrictEqual(page1._id);
    });
    test('return parent even if the parent page is empty', async() => {
      const path1 = '/emp_anc3';
      const path2 = '/emp_anc3/PAF3';
      const _page1 = await Page.findOne({ path: path1, isEmpty: true });
      const _page2 = await Page.findOne({ path: path2, isEmpty: false });
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();

      const parent = await Page.getParentAndFillAncestors(_page2.path, dummyUser1);
      const page1 = await Page.findOne({ path: path1, isEmpty: true }); // parent
      const page2 = await Page.findOne({ path: path2, isEmpty: false });

      // check for the parent (should be the same as page1)
      expect(parent._id).toStrictEqual(page1._id);
      expect(parent.path).toStrictEqual(page1.path);
      expect(parent.parent).toStrictEqual(page1.parent);

      expect(page1.parent).toStrictEqual(rootPage._id);
      expect(page2.parent).toStrictEqual(page1._id);
    });
    test('should find parent while NOT updating private legacy page\'s parent', async() => {
      const path1 = '/emp_anc4';
      const path2 = '/emp_anc4/PAF4';
      const _page1 = await Page.findOne({ path: path1, isEmpty: true, grant: Page.GRANT_PUBLIC });
      const _page2 = await Page.findOne({ path: path2, isEmpty: false, grant: Page.GRANT_PUBLIC });
      const _page3 = await Page.findOne({ path: path1, isEmpty: false, grant: Page.GRANT_OWNER });
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_page3).toBeTruthy();
      expect(_page3.parent).toBeNull();

      const parent = await Page.getParentAndFillAncestors(_page2.path, dummyUser1);
      const page1 = await Page.findOne({ path: path1, isEmpty: true, grant: Page.GRANT_PUBLIC });
      const page2 = await Page.findOne({ path: path2, isEmpty: false, grant: Page.GRANT_PUBLIC });
      const page3 = await Page.findOne({ path: path1, isEmpty: false, grant: Page.GRANT_OWNER });
      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();
      expect(page3).toBeTruthy();
      expect(page3.parent).toBeNull(); // parent property of page in private legacy pages should be null

      expect(page1._id).toStrictEqual(parent._id);
      expect(page2.parent).toStrictEqual(parent._id);

    });
    test('should find parent while NOT creating unnecessary empty pages with all v4 public pages', async() => {
      // All pages does not have parent (v4 schema)
      const _pageA = await Page.findOne({
        path: '/get_parent_A',
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        parent: null,
      });
      const _pageAB = await Page.findOne({
        path: '/get_parent_A/get_parent_B',
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        parent: null,
      });
      const _emptyA = await Page.findOne({
        path: '/get_parent_A',
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      const _emptyAB = await Page.findOne({
        path: '/get_parent_A/get_parent_B',
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });

      expect(_pageA).not.toBeNull();
      expect(_pageAB).not.toBeNull();
      expect(_emptyA).toBeNull();
      expect(_emptyAB).toBeNull();

      const parent = await Page.getParentAndFillAncestors('/get_parent_A/get_parent_B/get_parent_C', dummyUser1);

      const pageA = await Page.findOne({ path: '/get_parent_A', grant: Page.GRANT_PUBLIC, isEmpty: false });
      const pageAB = await Page.findOne({ path: '/get_parent_A/get_parent_B', grant: Page.GRANT_PUBLIC, isEmpty: false });
      const emptyA = await Page.findOne({ path: '/get_parent_A', grant: Page.GRANT_PUBLIC, isEmpty: true });
      const emptyAB = await Page.findOne({ path: '/get_parent_A/get_parent_B', grant: Page.GRANT_PUBLIC, isEmpty: true });

      // -- Check existance
      expect(parent).not.toBeNull();
      expect(pageA).not.toBeNull();
      expect(pageAB).not.toBeNull();
      expect(emptyA).toBeNull();
      expect(emptyAB).toBeNull();

      // -- Check parent
      expect(pageA.parent).not.toBeNull();
      expect(pageAB.parent).not.toBeNull();
    });
    test('should find parent while NOT creating unnecessary empty pages with some v5 public pages', async() => {
      const _pageC = await Page.findOne({
        path: '/get_parent_C',
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        parent: { $ne: null },
      });
      const _pageCD = await Page.findOne({
        path: '/get_parent_C/get_parent_D',
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
      });
      const _emptyC = await Page.findOne({
        path: '/get_parent_C',
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });
      const _emptyCD = await Page.findOne({
        path: '/get_parent_C/get_parent_D',
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
      });

      expect(_pageC).not.toBeNull();
      expect(_pageCD).not.toBeNull();
      expect(_emptyC).toBeNull();
      expect(_emptyCD).toBeNull();

      const parent = await Page.getParentAndFillAncestors('/get_parent_C/get_parent_D/get_parent_E', dummyUser1);

      const pageC = await Page.findOne({ path: '/get_parent_C', grant: Page.GRANT_PUBLIC, isEmpty: false });
      const pageCD = await Page.findOne({ path: '/get_parent_C/get_parent_D', grant: Page.GRANT_PUBLIC, isEmpty: false });
      const emptyC = await Page.findOne({ path: '/get_parent_C', grant: Page.GRANT_PUBLIC, isEmpty: true });
      const emptyCD = await Page.findOne({ path: '/get_parent_C/get_parent_D', grant: Page.GRANT_PUBLIC, isEmpty: true });

      // -- Check existance
      expect(parent).not.toBeNull();
      expect(pageC).not.toBeNull();
      expect(pageCD).not.toBeNull();
      expect(emptyC).toBeNull();
      expect(emptyCD).toBeNull();

      // -- Check parent attribute
      expect(pageC.parent).toStrictEqual(rootPage._id);
      expect(pageCD.parent).toStrictEqual(pageC._id);

      // -- Check the found parent
      expect(parent).toStrictEqual(pageCD);
    });
  });
});
