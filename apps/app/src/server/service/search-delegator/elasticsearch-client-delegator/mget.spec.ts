const { es8Mget, es9Mget } = vi.hoisted(() => ({
  es8Mget: vi.fn(),
  es9Mget: vi.fn(),
}));

vi.mock('@elastic/elasticsearch8', () => ({
  Client: vi.fn(() => ({ mget: es8Mget })),
}));
vi.mock('@elastic/elasticsearch9', () => ({
  Client: vi.fn(() => ({ mget: es9Mget })),
}));

import { ES8ClientDelegator } from './es8-client-delegator';
import { ES9ClientDelegator } from './es9-client-delegator';

describe.each([
  {
    name: 'ES8ClientDelegator',
    create: () => new ES8ClientDelegator({ node: 'http://es:9200' }, false),
    clientMget: es8Mget,
  },
  {
    name: 'ES9ClientDelegator',
    create: () => new ES9ClientDelegator({ node: 'http://es:9200' }, false),
    clientMget: es9Mget,
  },
])('$name.mget', ({ create, clientMget }) => {
  it('passes the request parameters to the client unchanged and returns its response', async () => {
    const response = {
      docs: [{ _index: 'pages', _id: 'p1', found: true, _source: {} }],
    };
    clientMget.mockResolvedValue(response);
    const params = {
      index: 'pages',
      ids: ['p1', 'p2'],
      _source_includes: ['grant'],
    };

    await expect(create().mget(params)).resolves.toBe(response);
    expect(clientMget).toHaveBeenCalledWith(params);
  });

  it('propagates a client failure instead of reporting documents', async () => {
    clientMget.mockRejectedValue(new Error('parsing_exception'));

    await expect(
      create().mget({ index: 'pages', ids: ['p1'] }),
    ).rejects.toThrow('parsing_exception');
  });
});
