import { faker } from '@faker-js/faker';
import { SCOPE, type Scope } from '@growi/core/dist/interfaces';
import type { AccessTokenParserReq } from '@growi/core/dist/interfaces/server';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import type { Response } from 'express';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';
import { AccessToken } from '~/server/models/access-token';

import { parserForAccessToken } from './access-token';

vi.mock('@growi/core/dist/models/serializers', { spy: true });

describe('access-token-parser middleware for access token with scopes', () => {
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let User;

  beforeAll(async () => {
    const crowiMock = mock<Crowi>({
      events: {
        user: mock<UserEvent>({
          on: vi.fn(),
        }),
      },
    });
    const userModelFactory = (await import('../../models/user')).default;
    User = userModelFactory(crowiMock);
  });

  it('should call next if no access token is provided', async () => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();

    await parserForAccessToken([])(reqMock, resMock);

    expect(reqMock.user).toBeUndefined();
  });

  it('should not authenticate with no scopes', async () => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // prepare a user
    const targetUser = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
    });

    // generate token with read:user:info scope
    const { token } = await AccessToken.generateToken(
      targetUser._id,
      new Date(Date.now() + 1000 * 60 * 60 * 24),
    );

    // act
    reqMock.query.access_token = token;
    await parserForAccessToken([])(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeUndefined();
    expect(serializeUserSecurely).not.toHaveBeenCalled();
  });

  it('should authenticate with specific scope', async () => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // prepare a user
    const targetUser = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
    });

    // generate token with read:user:info scope
    const { token } = await AccessToken.generateToken(
      targetUser._id,
      new Date(Date.now() + 1000 * 60 * 60 * 24),
      [SCOPE.READ.USER_SETTINGS.INFO],
    );

    // act
    reqMock.query.access_token = token;
    await parserForAccessToken([SCOPE.READ.USER_SETTINGS.INFO])(
      reqMock,
      resMock,
    );

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should reject with insufficient scopes', async () => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // prepare a user
    const targetUser = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
    });

    // generate token with read:user:info scope
    const { token } = await AccessToken.generateToken(
      targetUser._id,
      new Date(Date.now() + 1000 * 60 * 60 * 24),
      [SCOPE.READ.USER_SETTINGS.INFO],
    );

    // act - try to access with write:user:info scope
    reqMock.query.access_token = token;
    await parserForAccessToken([SCOPE.WRITE.USER_SETTINGS.INFO])(
      reqMock,
      resMock,
    );

    // // assert
    expect(reqMock.user).toBeUndefined();
    expect(serializeUserSecurely).not.toHaveBeenCalled();
  });

  it('should authenticate with write scope implying read scope', async () => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // prepare a user
    const targetUser = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
    });

    // generate token with write:user:info scope
    const { token } = await AccessToken.generateToken(
      targetUser._id,
      new Date(Date.now() + 1000 * 60 * 60 * 24),
      [SCOPE.WRITE.USER_SETTINGS.INFO],
    );

    // act - try to access with read:user:info scope
    reqMock.query.access_token = token;
    await parserForAccessToken([SCOPE.READ.USER_SETTINGS.INFO])(
      reqMock,
      resMock,
    );

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should authenticate with token supplied in X-GROWI-ACCESS-TOKEN header', async () => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // prepare a user
    const targetUser = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
    });

    // generate token with a wildcard (parent) scope
    const { token } = await AccessToken.generateToken(
      targetUser._id,
      new Date(Date.now() + 1000 * 60 * 60 * 24),
      [SCOPE.READ.USER_SETTINGS.ALL],
    );

    // act - supply the token via the X-GROWI-ACCESS-TOKEN header (Express lowercases keys),
    // and require a narrower scope to also exercise scope satisfaction
    reqMock.headers['x-growi-access-token'] = token;
    await parserForAccessToken([SCOPE.READ.USER_SETTINGS.INFO])(
      reqMock,
      resMock,
    );

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should authenticate with wildcard scope', async () => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();

    // prepare a user
    const targetUser = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
    });

    // generate token with read:user:* scope
    const { token } = await AccessToken.generateToken(
      targetUser._id,
      new Date(Date.now() + 1000 * 60 * 60 * 24),
      [SCOPE.READ.USER_SETTINGS.ALL],
    );

    // act - try to access with read:user:info scope
    reqMock.query.access_token = token;
    await parserForAccessToken([
      SCOPE.READ.USER_SETTINGS.INFO,
      SCOPE.READ.USER_SETTINGS.API.ACCESS_TOKEN,
    ])(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  describe('admin scopes', () => {
    const oneDayLater = () => new Date(Date.now() + 1000 * 60 * 60 * 24);

    const createUser = (admin: boolean) =>
      User.create({
        name: faker.person.fullName(),
        username: faker.string.uuid(),
        password: faker.internet.password(),
        lang: 'en_US',
        admin,
      });

    const parse = async (token: string, requiredScopes: Scope[]) => {
      const reqMock = mock<AccessTokenParserReq>({ user: undefined });
      reqMock.query.access_token = token;
      await parserForAccessToken(requiredScopes)(reqMock, mock<Response>());
      return reqMock.user;
    };

    it('should not authenticate a non-admin user holding an admin scope on an admin route', async () => {
      // a token minted before issuance rejected admin scopes for non-admins
      const user = await createUser(false);
      const { token } = await AccessToken.generateToken(
        user._id,
        oneDayLater(),
        [SCOPE.WRITE.ADMIN.ALL],
      );

      const parsedUser = await parse(token, [SCOPE.READ.ADMIN.APP]);

      expect(parsedUser).toBeUndefined();
    });

    it('should still authenticate a non-admin user holding an admin scope on a non-admin route', async () => {
      const user = await createUser(false);
      const { token } = await AccessToken.generateToken(
        user._id,
        oneDayLater(),
        [SCOPE.WRITE.ALL],
      );

      const parsedUser = await parse(token, [SCOPE.READ.FEATURES.PAGE]);

      expect(parsedUser?._id).toStrictEqual(user._id);
    });

    it('should authenticate an admin user on an admin route', async () => {
      const user = await createUser(true);
      const { token } = await AccessToken.generateToken(
        user._id,
        oneDayLater(),
        [SCOPE.WRITE.ADMIN.ALL],
      );

      const parsedUser = await parse(token, [SCOPE.READ.ADMIN.APP]);

      expect(parsedUser?._id).toStrictEqual(user._id);
    });

    it('should not authenticate on an admin route once the token owner is demoted from admin', async () => {
      const user = await createUser(true);
      const { token } = await AccessToken.generateToken(
        user._id,
        oneDayLater(),
        [SCOPE.WRITE.ADMIN.ALL],
      );
      await User.updateOne({ _id: user._id }, { admin: false });

      const parsedUser = await parse(token, [SCOPE.READ.ADMIN.APP]);

      expect(parsedUser).toBeUndefined();
    });
  });
});
