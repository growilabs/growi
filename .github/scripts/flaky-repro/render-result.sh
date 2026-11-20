#!/usr/bin/env bash
set -euo pipefail

# The body is `result.md` byte for byte — the same text the job
# summary carries, because the measuring step renders it once for both
# (the failing run's excerpt is already inside that file; appending it
# here would print it twice).
#
# One comment per pushed commit: this step runs once per job and never
# looks for an earlier comment to edit. Re-running the job by hand
# leaves a second comment for the same commit, which the routine
# tolerates by reading the newest one.
RESPONSE="${RUNNER_TEMP}/comment-response.txt"

# A failed POST must not fail the job. The routine reads this job's
# conclusion as the answer to "was a measurement taken at all?", so
# exiting non-zero because of a locked issue or a momentary GitHub
# outage would make it discard a tally that was in fact produced, and
# ask a human to decide instead. The failure is therefore reported the
# way a human notices it — an annotation plus the job summary, which
# already holds the full result — while the conclusion stays `success`.
if gh api "repos/${GITHUB_REPOSITORY}/issues/${ISSUE}/comments" \
     -X POST \
     -F "body=@${RESULT_PATH}" \
     --jq '.html_url' > "$RESPONSE" 2>&1; then
  {
    echo
    echo "Posted to issue #${ISSUE}: $(cat "$RESPONSE")"
  } >> "$GITHUB_STEP_SUMMARY"
else
  {
    echo
    # Not `### Repro result`: that heading is the routine's anchor for
    # a measured tally, and this section is the opposite of one.
    echo "### Could not post the repro result to issue #${ISSUE}"
    echo
    echo "The measurement finished; only the comment failed. The result is above in this summary."
    echo
    echo '```'
    cat "$RESPONSE"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
  echo "::warning::flaky-repro: could not post the result to issue #${ISSUE}; the tally is in the job summary"
fi
