// Public barrel for `permission/` -- the pure channel-permission judgement
// both sides must share (design.md "ChannelPermission"). Client-safe:
// re-exported from the top-level `src/index.ts`.

export type {
  BroadcastTarget,
  PermissionVerdict,
} from './channel-permission.js';
export { filterBroadcastTargets, judge } from './channel-permission.js';
