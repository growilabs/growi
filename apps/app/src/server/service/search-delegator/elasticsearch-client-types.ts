/* eslint-disable camelcase */
export type NodesInfoResponse = {
  nodes: Record<
    string,
    {
      version: string
      plugins: Plugin[]
    }
  >
}

export type CatIndicesResponse = {
  index: string
}[]

export type IndicesExistsResponse = boolean

export type IndicesExistsAliasResponse = boolean

export type CatAliasesResponse = {
  alias: string
  index: string
  filter: string
}[]

export type BulkResponse = {
  took: number
  errors: boolean
  items: Record<string, any>[]
}

export type SearchResponse = {
  took: number
  timed_out: boolean
  _shards: {
    total: number
    successful: number
    skipped: number
    failed: number
  }
  hits: {
    total: number | {
      value: number
      relation: string
    } // 6.x.x | 7.x.x
    max_score: number | null
    hits: Record<string, {
      _index: string
      _type: string
      _id: string
      _score: number
      _source: any
    }>[]
  }
}

export type ValidateQueryResponse = {
  valid: boolean,
  _shards: {
    total: number,
    successful: number,
    failed: number
  },
  explanations: Record<string, any>[]
}

export type ClusterHealthResponse = {
  cluster_name: string,
  status: string,
  timed_out: boolean,
  number_of_nodes: number,
  number_of_data_nodes: number,
  active_primary_shards: number,
  active_shards: number,
  relocating_shards: number,
  initializing_shards: number,
  unassigned_shards: number,
  delayed_unassigned_shards: number,
  number_of_pending_tasks: number,
  number_of_in_flight_fetch: number,
  task_max_waiting_in_queue_millis: number,
  active_shards_percent_as_number: number
}

export type IndicesStatsResponse = {
  _shards: {
    total: number,
    successful: number,
    failed: number
  },
  _all: {
    primaries: any,
    total: any
  },
  indices: any
}

export type ReindexResponse = {
  took: number,
  timed_out: boolean,
  total: number,
  updated: number,
  created: number,
  deleted: number,
  batches: number,
  noops: number,
  version_conflicts: number,
  retries: number,
  throttled_millis: number,
  requests_per_second: number,
  throttled_until_millis: number,
  failures: any | null
}
