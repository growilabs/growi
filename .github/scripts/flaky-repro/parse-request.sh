#!/usr/bin/env bash
set -euo pipefail

reject() {
  {
    echo "## Flaky repro request rejected"
    echo
    echo "$1"
    echo
    echo "Head commit: \`${GITHUB_SHA:-$(git log -1 --format=%H)}\`"
    echo
    echo '```'
    git log -1 --format=%B
    echo '```'
    echo
    echo "Expected trailer block, as the last paragraph of the commit message:"
    echo
    echo '```'
    echo "Flaky-Repro-Spec: <path under apps/app, e.g. src/server/util/foo.spec.ts>"
    echo "Flaky-Repro-Project: app-unit | app-components | app-integration | app-integration-exclusive"
    echo "Flaky-Repro-Mode: file | suite            # optional, default file"
    echo "Flaky-Repro-Repeat: <1-10>                # optional, default 3"
    echo "Flaky-Repro-Issue: <issue number>         # optional"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
  echo "::error::flaky-repro: $1"
  exit 1
}

# Every trailer must sit in ONE trailer block, i.e. the LAST paragraph of the
# commit message. `git commit -m a -m b` makes each -m its own paragraph, so
# only the last one is read as a trailer block and the rest are silently
# invisible here. Producers must pass the whole block as a single -m (or -F).
# Result lands in TRAILER_VALUE: a plain return keeps `reject` in this shell,
# where its `exit 1` actually stops the step.
TRAILER_VALUE=''
read_trailer() {
  local key="$1" value
  value="$(git log -1 --format="%(trailers:key=${key},valueonly)")"
  if [ "$(printf '%s\n' "$value" | wc -l)" -gt 1 ]; then
    reject "Trailer \`${key}\` appears more than once in the head commit. Give it exactly one value."
  fi
  # Strip surrounding whitespace so a stray trailing space is not a rejection.
  value="${value#"${value%%[![:space:]]*}"}"
  TRAILER_VALUE="${value%"${value##*[![:space:]]}"}"
}

read_trailer Flaky-Repro-Spec;    SPEC="$TRAILER_VALUE"
read_trailer Flaky-Repro-Project; PROJECT="$TRAILER_VALUE"
read_trailer Flaky-Repro-Mode;    MODE="$TRAILER_VALUE"
read_trailer Flaky-Repro-Repeat;  REPEAT="$TRAILER_VALUE"
read_trailer Flaky-Repro-Issue;   ISSUE="$TRAILER_VALUE"

# A `fix/flaky-**` branch is an ordinary fix branch that happens to be named
# after a flaky issue, and design.md keeps one case deliberately trailer-less:
# a Playwright fix, whose verification is the `run-playwright` job that runs
# once the PR enters the merge queue. reusable-app-prod.yml gates that job on
# `head_ref` starting with `mergify/merge-queue/` (or on workflow_dispatch), so
# it does NOT run when the PR is opened. Such a push is not a repro request at
# all, so it is reported as "nothing to measure"
# rather than as a rejected request — otherwise every Playwright fix PR would
# carry a red `flaky-repro` check. A `flaky-repro/**` branch exists only to be
# measured, so an empty request there is still an error.
if [ -z "${SPEC}${PROJECT}${MODE}${REPEAT}${ISSUE}" ]; then
  case "${GITHUB_REF_NAME:-}" in
    fix/flaky-*)
      {
        echo "## Flaky repro: nothing to measure"
        echo
        echo "The head commit of \`${GITHUB_REF_NAME}\` carries no \`Flaky-Repro-*\` trailer,"
        echo "so no repro was requested."
      } >> "$GITHUB_STEP_SUMMARY"
      echo "requested=false" >> "$GITHUB_OUTPUT"
      exit 0
      ;;
  esac
fi

MODE="${MODE:-file}"
REPEAT="${REPEAT:-3}"

# --- Flaky-Repro-Spec: mandatory, apps/app-relative, must exist ---------------
[ -n "$SPEC" ] || reject "Trailer \`Flaky-Repro-Spec\` is missing."
# The value is later handed to vitest as an argument. Restricting it to this
# character set keeps it free of anything a shell or YAML expression could act
# on, so no other layer has to re-sanitise it. Square brackets are in the set
# because Next.js dynamic-route directories need them (src/pages/[[...path]]/);
# they are glob characters, so every use of the value must stay quoted.
if [[ ! $SPEC =~ ^[]A-Za-z0-9._/[-]+$ ]]; then
  reject "\`Flaky-Repro-Spec\` may only contain A-Z a-z 0-9 and . _ / - [ ] but was \`${SPEC}\`."
fi
case "$SPEC" in
  /*) reject "\`Flaky-Repro-Spec\` must be relative to \`apps/app\`, not an absolute path (\`${SPEC}\`)." ;;
  apps/app/*) reject "\`Flaky-Repro-Spec\` must be relative to \`apps/app\`. Drop the \`apps/app/\` prefix: \`${SPEC#apps/app/}\`." ;;
  ..|../*|*/..|*/../*) reject "\`Flaky-Repro-Spec\` must not leave \`apps/app\` (\`${SPEC}\`)." ;;
esac
[ -f "apps/app/${SPEC}" ] || reject "\`Flaky-Repro-Spec\` does not exist in this commit: \`apps/app/${SPEC}\`."

# --- Flaky-Repro-Project: mandatory, allowlisted ------------------------------
# Keep in sync with the vitest project names in apps/app/vitest.workspace.mts and
# the test:* scripts in apps/app/package.json (Revalidation Trigger).
[ -n "$PROJECT" ] || reject "Trailer \`Flaky-Repro-Project\` is missing."
case "$PROJECT" in
  app-unit|app-components|app-integration|app-integration-exclusive) ;;
  *) reject "\`Flaky-Repro-Project\` must be one of app-unit, app-components, app-integration, app-integration-exclusive but was \`${PROJECT}\`." ;;
esac

# --- Flaky-Repro-Mode: optional, default file ---------------------------------
case "$MODE" in
  file|suite) ;;
  *) reject "\`Flaky-Repro-Mode\` must be \`file\` or \`suite\` but was \`${MODE}\`." ;;
esac

# --- Flaky-Repro-Repeat: optional, default 3, 1..10 ---------------------------
case "$REPEAT" in
  [1-9]|10) ;;
  *) reject "\`Flaky-Repro-Repeat\` must be an integer from 1 to 10 but was \`${REPEAT}\`." ;;
esac

# --- Flaky-Repro-Issue: optional, positive integer ----------------------------
if [ -n "$ISSUE" ]; then
  case "$ISSUE" in
    0*|*[!0-9]*) reject "\`Flaky-Repro-Issue\` must be a positive issue number but was \`${ISSUE}\`." ;;
  esac
fi

{
  echo "requested=true"
  echo "spec=${SPEC}"
  echo "project=${PROJECT}"
  echo "mode=${MODE}"
  echo "repeat=${REPEAT}"
  echo "issue=${ISSUE}"
} >> "$GITHUB_OUTPUT"

{
  echo "## Flaky repro request"
  echo
  echo "| Field | Value |"
  echo "| --- | --- |"
  echo "| Spec | \`${SPEC}\` |"
  echo "| Project | \`${PROJECT}\` |"
  echo "| Mode | \`${MODE}\` |"
  echo "| Repeat | ${REPEAT} |"
  echo "| Issue | ${ISSUE:-none (the result stays in this summary only)} |"
} >> "$GITHUB_STEP_SUMMARY"
