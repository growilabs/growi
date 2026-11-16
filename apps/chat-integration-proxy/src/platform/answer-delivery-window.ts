// How long one answer delivery may hold its claim, and the per-call Slack
// bound that keeps a delivery inside it. Both live here, in `platform/`, so
// the bound can be checked against the window without `platform/` importing
// `orchestration/`.

/**
 * How old a `delivering` mark must be before another delivery may take it
 * over (design.md AnswerFlow, `ANSWER_DELIVERY_RECLAIM_MS`).
 */
export const ANSWER_DELIVERY_RECLAIM_MS = 2 * 60 * 1000;

/**
 * The longest one Slack Web API call may take, with no retry or rate-limit
 * wait after it. A channel answer makes at most five calls in a row
 * (`chat.postEphemeral`, `conversations.open`, `chat.postMessage`,
 * `reactions.add`, the notice `chat.postMessage`) after at most
 * `MAX_ORDERING_DELAY_MS` of ordering wait: 5 x 10 s + 1.5 s = 51.5 s, under
 * half of the 120 s window. So a mark older than the window belongs to a
 * delivery that has ended, and taking it over cannot post the answer twice.
 */
export const SLACK_REQUEST_DEADLINE_MS = 10_000;
