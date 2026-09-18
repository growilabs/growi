#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${RUNNER_TEMP}/flaky-repro"
mkdir -p "$LOG_DIR"

# --- What one run is ---------------------------------------------
case "$PROJECT" in
  app-unit)        SUITE_SCRIPT='test:unit' ;;
  app-components)  SUITE_SCRIPT='test:components' ;;
  app-integration|app-integration-exclusive) SUITE_SCRIPT='test:integ' ;;
  *)
    echo "::error::flaky-repro: no test script is mapped to project ${PROJECT}"
    exit 1
    ;;
esac

VITEST_ARGS=(run "--project=${PROJECT}")
case "$PROJECT" in
  # Same fork cap as the `test:integ` script, so a repro contends for
  # the runner's CPUs the way the CI job does — that contention is
  # itself a source of the non-determinism being measured (#11752).
  app-integration|app-integration-exclusive)
    VITEST_ARGS+=(--poolOptions.forks.maxForks=4)
    ;;
esac

# `$SPEC` stays quoted everywhere: the allowlist permits `[` and `]`
# for Next.js dynamic-route directories, which are glob characters.
run_once() {
  case "$MODE" in
    file)  pnpm vitest "${VITEST_ARGS[@]}" "$SPEC" ;;
    suite) pnpm run "$SUITE_SCRIPT" ;;
  esac
}

# `suite` mode is one run of the whole project by definition; Repeat
# only applies to `file` mode.
if [ "$MODE" = 'suite' ]; then
  REPEAT=1
fi

# --- Run and tally -------------------------------------------------
RUNS=0
FAILED=0
PER_RUN=''
FIRST_FAILED_RUN=0

for i in $(seq 1 "$REPEAT"); do
  LOG="${LOG_DIR}/run-${i}.log"
  RC=0
  # `if ! …` keeps a failing run from tripping `set -e`. Here a failed
  # test is the measurement, not an error: the job's conclusion says
  # only whether the measurement could be taken.
  if ! run_once > "$LOG" 2>&1; then
    RC=1
  fi
  echo "::group::flaky-repro run ${i}/${REPEAT}"
  cat "$LOG"
  echo "::endgroup::"

  # A first run that matched no test file measured nothing — which
  # happens when the spec exists but belongs to another project (an
  # `app-unit` request for a `*.spec.tsx`, say). Recording it as a
  # failure would read as "deterministic regression", so it fails the
  # job instead: nothing was measured.
  #
  # Only the first run is checked. Once one run has collected the
  # spec, the spec/project pairing is proven, and the same message
  # from a later run is a symptom of that run — counting it as `fail`
  # keeps the runs already measured instead of discarding them.
  if [ "$i" -eq 1 ] && grep -qF 'No test files found' "$LOG"; then
    {
      echo
      echo "### Flaky repro: nothing was measured"
      echo
      echo "vitest matched no test file for \`${SPEC}\` in project \`${PROJECT}\`."
      echo "Check that the spec belongs to that project (see apps/app/vitest.workspace.mts)."
    } >> "$GITHUB_STEP_SUMMARY"
    echo "::error::flaky-repro: no test file matched ${SPEC} in project ${PROJECT}"
    exit 1
  fi

  RUNS=$((RUNS + 1))
  if [ "$RC" -eq 0 ]; then
    PER_RUN="${PER_RUN:+${PER_RUN}, }pass"
  else
    PER_RUN="${PER_RUN:+${PER_RUN}, }fail"
    FAILED=$((FAILED + 1))
    if [ "$FIRST_FAILED_RUN" -eq 0 ]; then
      FIRST_FAILED_RUN="$i"
    fi
  fi
done

# --- The failing run's excerpt -------------------------------------
EXCERPT=''
if [ "$FIRST_FAILED_RUN" -ne 0 ]; then
  EXCERPT="${LOG_DIR}/excerpt.txt"
  FAIL_LOG="${LOG_DIR}/run-${FIRST_FAILED_RUN}.log"
  # From vitest's first `FAIL` line, or the tail of the log when the
  # run died before printing one (a crashed worker, a setup timeout).
  START="$(grep -n -m1 -E '(^|[[:space:]])FAIL([[:space:]]|$)' "$FAIL_LOG" | cut -d: -f1 || true)"
  if [ -n "$START" ]; then
    tail -n "+${START}" "$FAIL_LOG" | head -n 40 > "$EXCERPT"
  else
    tail -n 40 "$FAIL_LOG" > "$EXCERPT"
  fi
  # vitest colours its output even without a TTY here; strip the ANSI
  # escapes (and CRs) so the excerpt reads cleanly in the issue comment.
  sed -i -E 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r$//' "$EXCERPT"
fi

# --- The result, rendered once -------------------------------------
# Written to a file rather than assembled twice: the job summary and
# the issue comment (the `### Repro result` contract in
# .kiro/specs/ci-flaky-test-detection design.md) must carry the same text, and the
# routine parses `- Runs:` / `- Failed:` out of whichever it reads.
RESULT_MD="${LOG_DIR}/result.md"
{
  echo "### Repro result"
  echo
  echo "- Commit: ${GITHUB_SHA}"
  echo "- Branch: ${GITHUB_REF_NAME}"
  echo "- Mode: ${MODE}"
  echo "- Runs: ${RUNS}"
  echo "- Failed: ${FAILED}"
  echo "- Per-run: ${PER_RUN}"
  echo "- Workflow run: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
  # `suite` mode runs the project's whole test script, and `test:integ`
  # is the script of BOTH integration projects. So a tally produced
  # from an `app-integration-exclusive` request also contains
  # `app-integration`'s result, which the reader of `- Mode: suite`
  # cannot tell on its own. Written as its own paragraph after the
  # fixed `- Key: value` lines so that their order — the part the
  # routine reads — stays uninterrupted.
  if [ "$MODE" = 'suite' ] && [ "$SUITE_SCRIPT" = 'test:integ' ]; then
    echo
    echo "Note: \`suite\` mode ran \`pnpm run test:integ\` once, which covers both \`app-integration\` and \`app-integration-exclusive\` — a failure counted here may come from either project."
  fi
  if [ -n "$EXCERPT" ]; then
    echo
    # Four backticks: GROWI's own specs carry Markdown fixtures, so a
    # three-backtick line inside the excerpt is not far-fetched.
    echo '````'
    cat "$EXCERPT"
    echo '````'
  fi
} > "$RESULT_MD"

cat "$RESULT_MD" >> "$GITHUB_STEP_SUMMARY"
# Echo the same block to the job log so the tally can be read with
# `gh run view --log` without opening the summary UI.
cat "$RESULT_MD"

{
  echo "runs=${RUNS}"
  echo "failed=${FAILED}"
  echo "per_run=${PER_RUN}"
  echo "first_failed_run=${FIRST_FAILED_RUN}"
  # Paths, not contents: `$GITHUB_OUTPUT` is a single-line key=value
  # file and the excerpt is up to 40 lines.
  echo "log_dir=${LOG_DIR}"
  echo "result_path=${RESULT_MD}"
  echo "excerpt_path=${EXCERPT}"
} >> "$GITHUB_OUTPUT"

# Failing tests are the answer this job exists to produce, so they
# must not colour its conclusion. Only the steps before this one can
# turn the job red.
exit 0
