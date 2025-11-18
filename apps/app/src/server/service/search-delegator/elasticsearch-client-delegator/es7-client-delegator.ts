// TODO: https://redmine.weseek.co.jp/issues/168446
import {
  Client,
  type ClientOptions,
  type ApiResponse,
  type RequestParams,
  type estypes,
} from '@elastic/elasticsearch7';

import type { ES7SearchQuery } from './interfaces';

export class ES7ClientDelegator {

  private client: Client;

  delegatorVersion = 7 as const;

  constructor(options: ClientOptions, rejectUnauthorized: boolean) {
    this.client = new Client({ ...options, ssl: { rejectUnauthorized } });
  }

  async bulk(params: RequestParams.Bulk): Promise<estypes.BulkResponse> {
    const res = (await this.client.bulk(params)).body as estypes.BulkResponse;
    return res;
  }

  cat = {
    aliases: (params: RequestParams.CatAliases): Promise<ApiResponse<estypes.CatAliasesResponse>> => this.client.cat.aliases(params),
    indices: (params: RequestParams.CatIndices): Promise<ApiResponse<estypes.CatIndicesResponse>> => this.client.cat.indices(params),
  };

  cluster = {
    health: (): Promise<ApiResponse<estypes.ClusterHealthResponse>> => this.client.cluster.health(),
  };

  indices = {
    create: (params: RequestParams.IndicesCreate): Promise<ApiResponse<estypes.IndicesCreateResponse>> => this.client.indices.create(params),
    delete: (params: RequestParams.IndicesDelete): Promise<ApiResponse<estypes.IndicesDeleteResponse>> => this.client.indices.delete(params),
    exists: async(params: RequestParams.IndicesExists): Promise<estypes.IndicesExistsResponse> => {
      return (await this.client.indices.exists(params)).body;
    },
    existsAlias: async(params: RequestParams.IndicesExistsAlias): Promise<estypes.IndicesExistsAliasResponse> => {
      return (await this.client.indices.existsAlias(params)).body;
    },
    putAlias: (params: RequestParams.IndicesPutAlias): Promise<ApiResponse<estypes.IndicesUpdateAliasesResponse>> => this.client.indices.putAlias(params),
    getAlias: async(params: RequestParams.IndicesGetAlias): Promise<estypes.IndicesGetAliasResponse> => {
      return (await this.client.indices.getAlias<estypes.IndicesGetAliasResponse>(params)).body;
    },
    updateAliases: (params: RequestParams.IndicesUpdateAliases['body']): Promise<ApiResponse<estypes.IndicesUpdateAliasesResponse>> => {
      return this.client.indices.updateAliases({ body: params });
    },
    validateQuery: async(params: RequestParams.IndicesValidateQuery<{ query?: estypes.QueryDslQueryContainer }>)
      : Promise<estypes.IndicesValidateQueryResponse> => {
      return (await this.client.indices.validateQuery<estypes.IndicesValidateQueryResponse>(params)).body;
    },
    stats: async(params: RequestParams.IndicesStats): Promise<estypes.IndicesStatsResponse> => {
      return (await this.client.indices.stats<estypes.IndicesStatsResponse>(params)).body;
    },
  };

  nodes = {
    info: (): Promise<ApiResponse<estypes.NodesInfoResponse>> => this.client.nodes.info(),
  };

  ping(): Promise<ApiResponse<estypes.PingResponse>> {
    return this.client.ping();
  }

  reindex(indexName: string, tmpIndexName: string): Promise<ApiResponse<estypes.ReindexResponse>> {
    return this.client.reindex({ wait_for_completion: false, body: { source: { index: indexName }, dest: { index: tmpIndexName } } });
  }

  async search(params: ES7SearchQuery): Promise<estypes.SearchResponse> {
    return (await this.client.search<estypes.SearchResponse>(params)).body;
  }

}
