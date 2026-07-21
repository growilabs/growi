import { mock } from 'vitest-mock-extended';

import type { SocketIoService } from '~/server/service/socket-io';

import { configManager } from '../config-manager';
import ElasticsearchDelegator from './elasticsearch';

// Contract of dropping Elasticsearch 7 support: the delegator must be
// constructable only for the supported versions (8, 9) and must reject any
// other value of ELASTICSEARCH_VERSION with a clear error instead of silently
// falling back.
describe('ElasticsearchDelegator constructor — supported version gate', () => {
  const socketIoService = mock<SocketIoService>();

  const stubElasticsearchVersion = (version: number | undefined) => {
    vi.spyOn(configManager, 'getConfig').mockImplementation((key) => {
      if (key === 'app:elasticsearchVersion') return version;
      if (key === 'app:elasticsearchReindexOnBoot') return false;
      return undefined;
    });
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([8, 9])('accepts supported version %i', (version) => {
    stubElasticsearchVersion(version);
    expect(() => new ElasticsearchDelegator(socketIoService)).not.toThrow();
  });

  it('rejects Elasticsearch 7 (support removed)', () => {
    stubElasticsearchVersion(7);
    expect(() => new ElasticsearchDelegator(socketIoService)).toThrow(
      'Unsupported Elasticsearch version',
    );
  });

  it.each([
    6,
    10,
    undefined,
  ])('rejects unsupported/invalid version %s', (version) => {
    stubElasticsearchVersion(version);
    expect(() => new ElasticsearchDelegator(socketIoService)).toThrow(
      'Unsupported Elasticsearch version',
    );
  });
});
