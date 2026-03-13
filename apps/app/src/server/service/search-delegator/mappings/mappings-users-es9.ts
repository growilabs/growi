import type { estypes } from '@elastic/elasticsearch9';

type Mappings = {
  mappings: estypes.IndicesCreateRequest['mappings'];
};
export const mappings: Mappings = {
  mappings: {
    properties: {
      username: {
        type: 'keyword',
      },
      status: {
        type: 'integer',
      },
    },
  },
};
