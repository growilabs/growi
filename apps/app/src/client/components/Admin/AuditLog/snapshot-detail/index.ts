// Public surface of the snapshot-detail module: the dispatcher only.
// The renderer registry and the individual renderers are internal — consumers
// (ActivityTableRow) must not depend on them directly.
export { ActivitySnapshotDetail } from './ActivitySnapshotDetail';
