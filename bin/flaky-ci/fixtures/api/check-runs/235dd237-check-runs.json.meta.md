# Source

- **Real**: `gh api repos/growilabs/growi/commits/235dd23767763951a25bbdb796e35be3d5c6c354/check-runs?per_page=100`.
  A fix-branch push that re-ran every `ci-app-*` job twice (7 names, 14
  runs — a `push` event then a `pull_request` event once the PR opened, the
  same shape 6-A's module doc describes). After dedup, two names still read
  `failure` on their newest run (`ci-app-test (24.x, 8.0)`,
  `ci-app-test-integration (24.x, 8.0, 8, 8.19.16)`), which is the real-data
  basis for `ciApp.notSuccess[]`. No `flaky-repro` check-run is present on
  this commit (captured separately from a fix-verification run whose
  `flaky-repro` measurement had already expired from the API).
- **Captured**: 2026-09-16.
