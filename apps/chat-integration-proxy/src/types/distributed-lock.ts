// `DistributedLock` re-exposes the Chat SDK state's distributed lock in the
// proxy's own vocabulary (design.md: "Chat SDK の state が持つ分散ロックを、
// proxy 自身の型で外へ出す"). Both `ConnectionManager` (`platform/`) and
// `runtime/sweeper.ts` use this -- `sweeper.ts` "`DistributedLock` を引数で
// 受け取る（facade 全体は受け取らない）" per the File Structure Plan, so this
// type must be expressible without importing the facade or any SDK type.
export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  renew(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}
