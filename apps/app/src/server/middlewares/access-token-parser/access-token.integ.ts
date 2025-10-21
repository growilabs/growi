import { faker } from '@faker-js/faker';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import type { Response } from 'express';
import { mock } from 'vitest-mock-extended';

import { SCOPE } from '@growi/core/dist/interfaces';
import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';
import { AccessToken } from '~/server/models/access-token';

import { parserForAccessToken } from './access-token';
import type { AccessTokenParserReq } from './interfaces';

vi.mock('@growi/core/dist/models/serializers', { spy: true });


describe('access-token-parser middleware for access token with scopes', () => {

  let User;

  beforeAll(async() => {
    const crowiMock = mock<Crowi>({
      event: vi.fn().mockImplementation((eventName) => {
        if (eventName === 'user') {
          return mock<UserEvent>({
            on: vi.fn(),
          });
        }
      }),
    });
    const userModelFactory = (await import('../../models/user')).default;
    User = userModelFactory(crowiMock);
  });

  it('should call next if no access token is provided', async() => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();

    await parserForAccessToken([])(reqMock, resMock);

    expect(reqMock.user).toBeUndefined();
  });

  it('should not authenticate with no scopes', async() => {
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

  it('should authenticate with specific scope', async() => {
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
    await parserForAccessToken([SCOPE.READ.USER_SETTINGS.INFO])(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should reject with insufficient scopes', async() => {
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
    await parserForAccessToken([SCOPE.WRITE.USER_SETTINGS.INFO])(reqMock, resMock);

    // // assert
    expect(reqMock.user).toBeUndefined();
    expect(serializeUserSecurely).not.toHaveBeenCalled();
  });

  it('should authenticate with write scope implying read scope', async() => {
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
    await parserForAccessToken([SCOPE.READ.USER_SETTINGS.INFO])(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should authenticate with wildcard scope', async() => {
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
    await parserForAccessToken([SCOPE.READ.USER_SETTINGS.INFO, SCOPE.READ.USER_SETTINGS.API.ACCESS_TOKEN])(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should authenticate with x-growi-access-token header', async() => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
      headers: {},
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

    // act - set token in x-growi-access-token header
    reqMock.headers['x-growi-access-token'] = token;
    await parserForAccessToken([SCOPE.READ.USER_SETTINGS.INFO])(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should prefer Authorization header over x-growi-access-token header', async() => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
      headers: {},
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // prepare two users
    const targetUser1 = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
    });

    const targetUser2 = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
    });

    // generate tokens for both users
    const { token: authToken } = await AccessToken.generateToken(
      targetUser1._id,
      new Date(Date.now() + 1000 * 60 * 60 * 24),
      [SCOPE.READ.USER_SETTINGS.INFO],
    );

    const { token: headerToken } = await AccessToken.generateToken(
      targetUser2._id,
      new Date(Date.now() + 1000 * 60 * 60 * 24),
      [SCOPE.READ.USER_SETTINGS.INFO],
    );

    // act - set tokens in both Authorization and x-growi-access-token headers
    reqMock.headers.authorization = `Bearer ${authToken}`;
    reqMock.headers['x-growi-access-token'] = headerToken;
    await parserForAccessToken([SCOPE.READ.USER_SETTINGS.INFO])(reqMock, resMock);

    // assert - should use the user from Authorization header (targetUser1)
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser1._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should fall back to x-growi-access-token header when Authorization header is not present', async() => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
      headers: {},
      query: {},
      body: {},
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

    // generate token
    const { token } = await AccessToken.generateToken(
      targetUser._id,
      new Date(Date.now() + 1000 * 60 * 60 * 24),
      [SCOPE.READ.USER_SETTINGS.INFO],
    );

    // act - set token only in x-growi-access-token header
    reqMock.headers['x-growi-access-token'] = token;
    await parserForAccessToken([SCOPE.READ.USER_SETTINGS.INFO])(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should reject invalid token in x-growi-access-token header', async() => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
      headers: {},
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // act - set invalid token in x-growi-access-token header
    reqMock.headers['x-growi-access-token'] = 'invalid-token';
    await parserForAccessToken([SCOPE.READ.USER_SETTINGS.INFO])(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeUndefined();
    expect(serializeUserSecurely).not.toHaveBeenCalled();
  });

});
