
import { faker } from '@faker-js/faker';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import type { Response } from 'express';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';

import { parserForApiToken } from './api-token';
import type { AccessTokenParserReq } from './interfaces';


vi.mock('@growi/core/dist/models/serializers', { spy: true });


describe('access-token-parser middleware', () => {

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

    expect(reqMock.user).toBeUndefined();

    // act
    await parserForApiToken(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeUndefined();
    expect(serializeUserSecurely).not.toHaveBeenCalled();
  });

  it('should call next if the given access token is invalid', async() => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // act
    reqMock.query.access_token = 'invalidToken';
    await parserForApiToken(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeUndefined();
    expect(serializeUserSecurely).not.toHaveBeenCalled();
  });

  it('should set req.user with a valid api token in query', async() => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();
    const nextMock = vi.fn();

    expect(reqMock.user).toBeUndefined();

    // prepare a user with an access token
    const targetUser = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
      apiToken: faker.internet.password(),
    });

    // act
    reqMock.query.access_token = targetUser.apiToken;
    await parserForApiToken(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should set req.user with a valid api token in body', async() => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // prepare a user with an access token
    const targetUser = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
      apiToken: faker.internet.password(),
    });

    // act
    reqMock.body.access_token = targetUser.apiToken;
    await parserForApiToken(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should set req.user with a valid Bearer token in Authorization header', async() => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
      headers: {
        authorization: undefined,
      },
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // prepare a user with an access token
    const targetUser = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
      apiToken: faker.internet.password(),
    });

    // act
    reqMock.headers.authorization = `Bearer ${targetUser.apiToken}`;
    await parserForApiToken(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeDefined();
    expect(reqMock.user?._id).toStrictEqual(targetUser._id);
    expect(serializeUserSecurely).toHaveBeenCalledOnce();
  });

  it('should ignore non-Bearer Authorization header', async() => {
    // arrange
    const reqMock = mock<AccessTokenParserReq>({
      user: undefined,
      headers: {
        authorization: undefined,
      },
    });
    const resMock = mock<Response>();

    expect(reqMock.user).toBeUndefined();

    // Generate random string that is guaranteed to be invalid for Basic auth (1024 chars)
    const randomString = faker.string.alpha(1024);

    // act
    reqMock.headers.authorization = `Basic ${randomString}`; // Basic auth header with random string
    await parserForApiToken(reqMock, resMock);

    // assert
    expect(reqMock.user).toBeUndefined();
    expect(serializeUserSecurely).not.toHaveBeenCalled();
  });

});
