# Source

- **Constructed.** The `test/setup/**` exception — a denylist string appearing
  in the failure of a hook registered under `test/setup/`, which makes **every**
  failure in that job log noise — has no recorded real example: the real
  shared setup-hook failures in the tracker (#11752) are `Hook timed out in
  20000ms`, a timeout rather than a denylisted infrastructure error.
- **What is copied from real data**: both halves come from files next to this
  one. The file-level FAIL line shape
  (`FAIL app-integration <path> [ <path> ]`) and the setup frame
  (` ❯ test/setup/migrate-mongo.ts:52:1`) are #11752's real shapes; the error
  text `getaddrinfo ENOTFOUND mongo` is the procedure's own denylist entry,
  spelled as Node spells it. Colour sequences are true ESC bytes and every
  line carries the endpoint's timestamp prefix, like a real fetched log.
- **What is constructed**: putting the two together. The first block carries
  the denylist string **and** a `test/setup/` frame, so `denylist.match`
  returns `scope: 'job'` for it; the second block is an ordinary hook timeout
  in the same log, which is what a reader of the `job` scope goes on to drop.
- **Generated**: 2026-09-16.
