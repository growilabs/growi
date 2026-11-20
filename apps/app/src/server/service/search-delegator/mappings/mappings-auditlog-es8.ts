import type { estypes } from '@elastic/elasticsearch8';

type Mappings = {
  mappings: estypes.IndicesCreateRequest['mappings'];
};

export const mappings: Mappings = {
  mappings: {
    properties: {
      username: { type: 'keyword' },
    },
  },
};
