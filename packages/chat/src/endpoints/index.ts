// Public barrel for `endpoints/` -- the op vocabulary (op <-> path <->
// direction) and the base type every signed request body must extend
// (design.md "口の一覧"). Client-safe: re-exported from the top-level
// `src/index.ts`.

export type {
  OpDirection,
  OpEndpointDescriptor,
  OpName,
  OpOnlyRequest,
  RequestEnvelope,
} from './op-names.js';
export { OP_ENDPOINTS, OP_NAMES } from './op-names.js';
