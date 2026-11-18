import type { IPage, IUser } from '@growi/core/dist/interfaces';

import { S2cMessagePageUpdated } from './s2c-message';

// WHY: IPage and IUser carry dozens of required fields the message never reads;
// only the fields below take part in what is sent to clients.
// toObject() mirrors the Mongoose document the message receives in production:
// serializePageSecurely depopulates that copy, not the page itself.
const buildPage = (): IPage => {
  const fields = () => ({
    _id: '6655f0000000000000000001',
    revision: {
      _id: '6655f0000000000000000002',
      body: '# body',
      origin: undefined,
    },
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  return { ...fields(), toObject: fields } as unknown as IPage;
};

const buildEditor = (overrides: Partial<IUser> = {}): IUser =>
  ({
    _id: '6655f0000000000000000003',
    name: 'Editor',
    username: 'editor',
    imageUrlCached: '/images/icons/user.svg',
    password: 'hashed-password',
    apiToken: 'legacy-api-token',
    email: 'editor@example.com',
    isEmailPublished: false,
    ...overrides,
  }) as unknown as IUser;

// Socket.IO and the S2S relay serialize the message with JSON.stringify
const toWirePayload = (message: S2cMessagePageUpdated) =>
  JSON.parse(JSON.stringify(message));

describe('S2cMessagePageUpdated', () => {
  it('does not send the editor password, apiToken or private email to clients', () => {
    const payload = toWirePayload(
      new S2cMessagePageUpdated(buildPage(), buildEditor()),
    );

    expect(payload.remoteLastUpdateUser).not.toHaveProperty('password');
    expect(payload.remoteLastUpdateUser).not.toHaveProperty('apiToken');
    expect(payload.remoteLastUpdateUser).not.toHaveProperty('email');
  });

  it('keeps the editor fields the client displays', () => {
    const payload = toWirePayload(
      new S2cMessagePageUpdated(buildPage(), buildEditor()),
    );

    expect(payload.remoteLastUpdateUser).toMatchObject({
      _id: '6655f0000000000000000003',
      name: 'Editor',
      username: 'editor',
      imageUrlCached: '/images/icons/user.svg',
    });
    expect(payload.lastUpdateUsername).toBe('Editor');
  });

  it('sends the editor email only when the editor published it', () => {
    const payload = toWirePayload(
      new S2cMessagePageUpdated(
        buildPage(),
        buildEditor({ isEmailPublished: true }),
      ),
    );

    expect(payload.remoteLastUpdateUser.email).toBe('editor@example.com');
  });
});
