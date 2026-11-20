# Source

- **Real**: `gh api repos/growilabs/growi/commits/807c3628fc85bbf29335840d004660ce8c195f64/check-runs?per_page=100`.
  Same commit as `api/compare/master-diverged-807c3628.json` and
  `api/commits/807c3628-pulls.json` (PR #11919, feature branch
  `feat/185872-backlinks`) — a real duplicate-name case: every `ci-app-*` job
  ran twice under the same name (a `push` event at `09:17:0x` and a
  `pull_request` event at `09:19:1x`), and the newest of the pair is not
  always the successful one — `ci-app-test-integration (24.x, 8.0, 9, 9.3.3)`'s
  newest entry (`09:19:17Z`, id `104737289243`) is `cancelled`, superseding an
  older `success`. No `flaky-repro` check-run is present (an ordinary PR
  branch, not a `flaky-repro/**` branch).
- **Captured**: 2026-09-16.
