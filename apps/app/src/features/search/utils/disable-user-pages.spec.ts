import type { QueryTerms } from '~/server/interfaces/search';

import { excludeUserPagesFromQuery } from './disable-user-pages';

describe('excludeUserPagesFromQuery()', () => {
  it('should exclude user page strings from query prefix', () => {
    const userString = '/user';
    const userStringSlash = '/user/';
    const userStringSubPath = '/user/settings';
    const userStringSubPathDeep = '/user/profile/edit';
    const userStringSubPathQuery = '/user/settings?ref=top';

    const query: QueryTerms = {
      match: [],
      not_match: [],
      phrase: [],
      not_phrase: [],
      prefix: [
        userString,
        userStringSlash,
        userStringSubPath,
        userStringSubPathDeep,
        userStringSubPathQuery,
      ],
      not_prefix: [],
      tag: [],
      not_tag: [],
    };

    excludeUserPagesFromQuery(query);

    expect(query.prefix).not.toContain(userString);
    // Should only contain '/user'
    expect(query.not_prefix).toContain(userString);

    expect(query.prefix).not.toContain(userStringSlash);
    expect(query.not_prefix).not.toContain(userStringSlash);

    expect(query.prefix).not.toContain(userStringSubPath);
    expect(query.not_prefix).not.toContain(userStringSubPath);

    expect(query.prefix).not.toContain(userStringSubPathDeep);
    expect(query.not_prefix).not.toContain(userStringSubPathDeep);

    expect(query.prefix).not.toContain(userStringSubPathQuery);
    expect(query.not_prefix).not.toContain(userStringSubPathQuery);
  });

  it('should not exclude strings similar to /user from query prefix', () => {
    const userRouter = '/userouter';
    const userRoot = '/useroot';
    const userSettings = '/user-settings';
    const apiUser = '/api/user';
    const emptyString = '';
    const rootOnly = '/';
    const upperCase = '/USER';
    const doubleSlashStart = '//user/new';
    const doubleSlashSub = '/user//new';

    const query: QueryTerms = {
      match: [],
      not_match: [],
      phrase: [],
      not_phrase: [],
      prefix: [
        userRouter,
        userRoot,
        userSettings,
        apiUser,
        emptyString,
        rootOnly,
        upperCase,
        doubleSlashStart,
        doubleSlashSub,
      ],
      not_prefix: [],
      tag: [],
      not_tag: [],
    };

    excludeUserPagesFromQuery(query);

    expect(query.prefix).toContain(userRouter);
    expect(query.not_prefix).not.toContain(userRouter);

    expect(query.prefix).toContain(userRoot);
    expect(query.not_prefix).not.toContain(userRoot);

    expect(query.prefix).toContain(userSettings);
    expect(query.not_prefix).not.toContain(userSettings);

    expect(query.prefix).toContain(apiUser);
    expect(query.not_prefix).not.toContain(apiUser);

    expect(query.prefix).toContain(emptyString);
    expect(query.not_prefix).not.toContain(emptyString);

    expect(query.prefix).toContain(rootOnly);
    expect(query.not_prefix).not.toContain(rootOnly);

    expect(query.prefix).toContain(upperCase);
    expect(query.not_prefix).not.toContain(upperCase);

    expect(query.prefix).toContain(doubleSlashStart);
    expect(query.not_prefix).not.toContain(doubleSlashStart);

    expect(query.prefix).toContain(doubleSlashSub);
    expect(query.not_prefix).not.toContain(doubleSlashSub);
  });

  it('should add /user to not_prefix when it is empty', () => {
    const query: QueryTerms = {
      match: [],
      not_match: [],
      phrase: [],
      not_phrase: [],
      prefix: [],
      not_prefix: [],
      tag: [],
      not_tag: [],
    };

    excludeUserPagesFromQuery(query);

    expect(query.prefix).toHaveLength(0);
    expect(query.not_prefix).toContain('/user');
    expect(query.not_prefix).toHaveLength(1);
  });

  it('should remove existing /user strings and leave not_prefix with just one /user string', () => {
    const userString = '/user';

    const query: QueryTerms = {
      match: [],
      not_match: [],
      phrase: [],
      not_phrase: [],
      prefix: [userString, userString],
      not_prefix: [userString, userString],
      tag: [],
      not_tag: [],
    };

    excludeUserPagesFromQuery(query);

    expect(query.prefix).toHaveLength(0);
    expect(query.not_prefix).toContain('/user');
    expect(query.not_prefix).toHaveLength(1);
  });
});
