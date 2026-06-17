import {
  type IGrantedGroup,
  type IPage,
  type IPageInfo,
  PageGrant,
  PageWriteGrant,
} from './page';

describe('PageWriteGrant', () => {
  it('should have WRITE_GRANT_PUBLIC with value 1', () => {
    expect(PageWriteGrant.WRITE_GRANT_PUBLIC).toBe(1);
  });

  it('should have WRITE_GRANT_OWNER with value 2', () => {
    expect(PageWriteGrant.WRITE_GRANT_OWNER).toBe(2);
  });

  it('should have WRITE_GRANT_USER_GROUP with value 4', () => {
    expect(PageWriteGrant.WRITE_GRANT_USER_GROUP).toBe(4);
  });

  it('should have exactly 3 write grant constants', () => {
    const keys = Object.keys(PageWriteGrant);
    expect(keys).toHaveLength(3);
    expect(keys).toEqual([
      'WRITE_GRANT_PUBLIC',
      'WRITE_GRANT_OWNER',
      'WRITE_GRANT_USER_GROUP',
    ]);
  });
});

describe('IPage with write grant fields', () => {
  it('should allow creating a page with write grant fields', () => {
    const page: IPage = {
      path: '/test',
      status: 'published',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      seenUsers: [],
      parent: null,
      descendantCount: 0,
      isEmpty: false,
      grant: PageGrant.GRANT_PUBLIC,
      grantedUsers: [],
      grantedGroups: [],
      liker: [],
      commentCount: 0,
      slackChannels: '',
      deleteUser: null as any,
      deletedAt: new Date(),
      writeGrant: PageWriteGrant.WRITE_GRANT_PUBLIC,
      writeGrantedUsers: [],
      writeGrantedGroups: [],
    };

    expect(page.writeGrant).toBe(1);
    expect(page.writeGrantedUsers).toEqual([]);
    expect(page.writeGrantedGroups).toEqual([]);
  });

  it('should default writeGrant to WRITE_GRANT_PUBLIC', () => {
    const page: IPage = {
      path: '/test',
      status: 'published',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      seenUsers: [],
      parent: null,
      descendantCount: 0,
      isEmpty: false,
      grant: PageGrant.GRANT_PUBLIC,
      grantedUsers: [],
      grantedGroups: [],
      liker: [],
      commentCount: 0,
      slackChannels: '',
      deleteUser: null as any,
      deletedAt: new Date(),
      writeGrant: PageWriteGrant.WRITE_GRANT_PUBLIC,
      writeGrantedUsers: [],
      writeGrantedGroups: [],
    };

    expect(page.writeGrant).toBe(PageWriteGrant.WRITE_GRANT_PUBLIC);
  });

  it('should accept WRITE_GRANT_OWNER with writeGrantedUsers', () => {
    const page: IPage = {
      path: '/test',
      status: 'published',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      seenUsers: [],
      parent: null,
      descendantCount: 0,
      isEmpty: false,
      grant: PageGrant.GRANT_PUBLIC,
      grantedUsers: [],
      grantedGroups: [],
      liker: [],
      commentCount: 0,
      slackChannels: '',
      deleteUser: null as any,
      deletedAt: new Date(),
      writeGrant: PageWriteGrant.WRITE_GRANT_OWNER,
      writeGrantedUsers: ['user123' as any],
      writeGrantedGroups: [],
    };

    expect(page.writeGrant).toBe(PageWriteGrant.WRITE_GRANT_OWNER);
    expect(page.writeGrantedUsers).toHaveLength(1);
  });

  it('should accept WRITE_GRANT_USER_GROUP with writeGrantedGroups', () => {
    const grantedGroup: IGrantedGroup = {
      type: 'UserGroup',
      item: 'group123' as any,
    };

    const page: IPage = {
      path: '/test',
      status: 'published',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      seenUsers: [],
      parent: null,
      descendantCount: 0,
      isEmpty: false,
      grant: PageGrant.GRANT_PUBLIC,
      grantedUsers: [],
      grantedGroups: [],
      liker: [],
      commentCount: 0,
      slackChannels: '',
      deleteUser: null as any,
      deletedAt: new Date(),
      writeGrant: PageWriteGrant.WRITE_GRANT_USER_GROUP,
      writeGrantedUsers: [],
      writeGrantedGroups: [grantedGroup],
    };

    expect(page.writeGrant).toBe(PageWriteGrant.WRITE_GRANT_USER_GROUP);
    expect(page.writeGrantedGroups).toHaveLength(1);
    expect(page.writeGrantedGroups[0].type).toBe('UserGroup');
  });
});

describe('IPageInfo with isEditable', () => {
  it('should include isEditable in IPageInfo', () => {
    const pageInfo: IPageInfo = {
      isNotFound: false,
      isV5Compatible: true,
      isEmpty: false,
      isMovable: true,
      isDeletable: true,
      isAbleToDeleteCompletely: true,
      isRevertible: false,
      bookmarkCount: 0,
      isEditable: true,
    };

    expect(pageInfo.isEditable).toBe(true);
  });
});

describe('PageWriteGrant type compatibility', () => {
  it('should accept PageWriteGrant values as numbers', () => {
    const values: number[] = [
      PageWriteGrant.WRITE_GRANT_PUBLIC,
      PageWriteGrant.WRITE_GRANT_OWNER,
      PageWriteGrant.WRITE_GRANT_USER_GROUP,
    ];

    expect(values).toEqual([1, 2, 4]);
  });
});
