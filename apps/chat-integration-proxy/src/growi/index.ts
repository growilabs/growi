// Public entry point of the `growi/` layer (design.md's File Structure Plan:
// 「この層の公開窓口」). Layers to the right of `growi/` -- `orchestration/`
// and `routes/` -- import from here, never from the files below.
//
// Complete as of task 6.3, the last task of this layer: the three modules
// design.md lists under `growi/` are all built, and what is re-exported below
// is what `orchestration/` needs to hold them -- `GrowiClient`,
// `FanOutCollector` and `SearchFusion` -- plus the result types a caller has
// to be able to name. The defaults those modules apply (the wait cap, how many
// requests may be out at once, the score's fall-off) stay module-private: a
// caller that wants a different value passes one, and exporting a second name
// for the same number is how two of them start to disagree.

export type {
  FanOutCollector,
  FanOutCollectorDeps,
  FanOutOutcome,
  FanOutRequest,
} from './fan-out-collector.js';
export { createFanOutCollector } from './fan-out-collector.js';
export type {
  GrowiCallFailure,
  GrowiCallResult,
  GrowiClient,
  GrowiClientDeps,
} from './growi-client.js';
export { createGrowiClient } from './growi-client.js';
export type {
  FusedResult,
  FusionOptions,
  FusionSource,
} from './search-fusion.js';
export { fuseResults } from './search-fusion.js';
