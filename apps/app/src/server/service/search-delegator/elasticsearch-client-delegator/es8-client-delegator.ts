import { Client, type ClientOptions, type estypes } from '@elastic/elasticsearch8';

export class ES8ClientDelegator {

  private client: Client;

  delegatorVersion = 8 as const;

  constructor(options: ClientOptions, rejectUnauthorized: boolean) {
    this.client = new Client({ ...options, tls: { rejectUnauthorized } });
  }

  bulk(params: estypes.BulkRequest): Promise<estypes.BulkResponse> {
    return this.client.bulk(params);
  }

  cat = {
    aliases: (params: estypes.CatAliasesRequest): Promise<estypes.CatAliasesResponse> => this.client.cat.aliases(params),
    indices: (params: estypes.CatIndicesRequest): Promise<estypes.CatIndicesResponse> => this.client.cat.indices(params),
  };

  cluster = {
    health: (): Promise<estypes.ClusterHealthResponse> => this.client.cluster.health(),
  };

  indices = {
    create: (params: estypes.IndicesCreateRequest): Promise<estypes.IndicesCreateResponse> => this.client.indices.create(params),
    delete: (params: estypes.IndicesDeleteRequest): Promise<estypes.IndicesDeleteResponse> => this.client.indices.delete(params),
    exists: (params: estypes.IndicesExistsRequest): Promise<estypes.IndicesExistsResponse> => this.client.indices.exists(params),
    existsAlias: (params: estypes.IndicesExistsAliasRequest): Promise<estypes.IndicesExistsAliasResponse> => this.client.indices.existsAlias(params),
    putAlias: (params: estypes.IndicesPutAliasRequest): Promise<estypes.IndicesPutAliasResponse> => this.client.indices.putAlias(params),
    getAlias: (params: estypes.IndicesGetAliasRequest): Promise<estypes.IndicesGetAliasResponse> => this.client.indices.getAlias(params),
    updateAliases: (params: estypes.IndicesUpdateAliasesRequest): Promise<estypes.IndicesUpdateAliasesResponse> => this.client.indices.updateAliases(params),
    validateQuery: (params: estypes.IndicesValidateQueryRequest): Promise<estypes.IndicesValidateQueryResponse> => this.client.indices.validateQuery(params),
    stats: (params: estypes.IndicesStatsRequest): Promise<estypes.IndicesStatsResponse> => this.client.indices.stats(params),
  };

  nodes = {
    info: (): Promise<estypes.NodesInfoResponse> => this.client.nodes.info(),
  };

  ping(): Promise<estypes.PingResponse> {
    return this.client.ping();
  }

  reindex(indexName: string, tmpIndexName: string): Promise<estypes.ReindexResponse> {
    return this.client.reindex({ wait_for_completion: false, source: { index: indexName }, dest: { index: tmpIndexName } });
  }

  search(params: estypes.SearchRequest): Promise<estypes.SearchResponse> {
    return this.client.search(params);
  }

}
