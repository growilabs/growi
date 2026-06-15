---
name: suggest-path-evaluator
description: >-
  Evaluate the quality of GROWI's suggest-path output by having Claude act as an
  answer-key checker. Use this whenever you want to measure how good suggest-path's
  proposed save paths are — e.g. "evaluate suggest-path on this document", "score
  the path suggestions for this content", "how accurate is suggest-path for this
  wiki", "run a hit-rate check on suggest-path", or when dogfooding suggest-path
  and needing an objective rank of its proposals instead of eyeballing them. Given
  a document body and a GROWI wiki, the skill self-drives: it calls suggest-path,
  reads the wiki tree, constructs its OWN correct path as a measuring stick, and
  ranks the proposals by plausibility so hit-rate ("is the right path in the top N")
  can be aggregated. Trigger it even when the user only says "check"/"score"/"rank"
  suggest-path results without saying "evaluator".
---

# suggest-path Evaluator

## What this is

GROWI's `suggest-path` feature takes a document body and proposes where in the wiki
to save it. The proposals are only ever *plausible*, never provably *correct* — the
wiki tree is the ground truth, and "the right place" is a judgment call a human makes
by analogy ("last week's meeting notes live here, so this week's go here too").

This skill measures how good those proposals are **without a human scoring each one by
hand**. It does that by making Claude the **answer-key checker**: Claude looks at the
wiki and the document, decides where *it* would file the document, and then checks
whether suggest-path's proposals agree.

This is for **dogfooding and tuning** suggest-path. It is a measurement tool, not part
of the production feature — it does not modify suggest-path or GROWI.

## The one rule that defines this skill

**Claude builds its own correct path FIRST, then judges suggest-path against it.**

This is the difference between a useful evaluator and a useless one. If Claude only
looked at suggest-path's list and ranked *within* it, it could never detect the case
that matters most: **suggest-path missed entirely** — none of its proposals are right.
By forming an independent answer first, Claude can say "all of these are wrong, the
document actually belongs at X", which is exactly the signal needed to find wiki
domains where suggest-path is weak.

Claude's own path is a **measuring stick, not a deliverable.** The skill does not exist
to propose new paths to the user. Surface Claude's path only as the *rationale* for the
score, so a human can look at it and tune the evaluator ("you scored that low, but this
page already exists — why didn't you see it?").

## Inputs

You need two things from the user:

1. **The document body** (required) — the content suggest-path will be asked to file.
   One document, or several for a batch run.
2. **The wiki to evaluate against** — which GROWI instance is the ground truth. This is
   the same instance suggest-path will be called against, so the tree and the proposals
   stay consistent. Default: the local GROWI running in the devcontainer.

The user does **not** pre-run suggest-path. This skill calls it for them — they hand
over the document, the skill does the rest.

## The flow (self-driving)

For a single document:

### 1. Get suggest-path's proposals

Call suggest-path with the document body. Prefer the MCP tool; fall back to HTTP.

- **MCP (preferred):** call `mcp__growi__suggestPath` with `{ body: <document> }`. It
  returns the proposal list directly. Simplest when the GROWI MCP server is connected.
- **HTTP (fallback):** `POST /_api/v3/ai-tools/suggest-path` with JSON `{ "body": "<document>" }`.
  Auth via `?access_token=<token>` (or a bearer header). Against the devcontainer GROWI
  this is `http://localhost:3000/_api/v3/ai-tools/suggest-path`. Response shape:
  `{ "suggestions": [ { "type", "path", "label", "description", "grant", "informationType?" }, ... ] }`.

Keep every proposal — including the obviously-wrong ones. suggest-path is allowed to
emit junk (e.g. a path it latched onto from a surface word); the evaluator's job is to
rank, not to pre-filter. The `path` field is what you rank; `informationType` (flow vs
stock) is useful context for your own judgment.

If suggest-path returns zero proposals (everything got cut), that is itself a result —
record it as a total miss, do not silently skip the document.

### 2. Read the wiki tree

Load enough of the wiki to form a real judgment: the tree structure (paths) **and** the
content of the candidate-relevant pages, so you can judge content-to-location fit, not
just path-string similarity.

Treat the tree as coming through a **Vault interface**: a set of local files mirroring
the wiki's page hierarchy. GROWI Vault (the feature that exposes the wiki as a local git
clone) is not implemented yet, so for now read the tree through an adapter — see
`references/tree-source.md` for how to source it (currently: the devcontainer GROWI's
search/page API). Write your reasoning against "the wiki tree", not against a specific
API, so the day Vault lands the only thing that changes is the adapter.

### 3. Build your own correct path

Before looking hard at suggest-path's ranking, decide where **you** would file this
document. Reason like the human would:

- What *kind* of document is this — flow (time-bound: meeting notes, dev log) or stock
  (reference: a spec, a how-to)? This narrows the part of the tree that fits.
- Where do *similar existing documents* live? The wiki's current state is the ground
  truth. If last week's meeting notes sit under `/.../会議室/`, this week's belong there
  too. A spec belongs alongside other specs.
- Prefer the **most specific** existing location that fits, not just a top-level
  category. "Somewhere under `/資料/`" is a weak answer; "under `/資料/内部仕様/`,
  next to the other specs" is a real one.

It is fine for your answer to be more than one path when the wiki genuinely has two
equally-good homes (e.g. two different `会議室` trees). Capture all of them.

### 4. Rank suggest-path's proposals, and locate your answer in the ranking

Order suggest-path's proposals from most to least plausible **as a save location for
this document**. This is a **relative ranking, not an absolute score.** Do not emit
"7 out of 10" numbers — absolute points drift every run because the scale has no fixed
anchor, whereas a relative order stays stable because you are only ever comparing
proposals to each other. (Per-domain numeric scores come later, by aggregation — see
below — not by asking for points here.)

Then state the hit: **is your own correct path present in the proposal list, and if so
at what rank?** Three outcomes:

- **Hit at rank N** — one of the proposals matches your correct path; it sits at
  position N in your ranking.
- **Miss, reachable** — your correct path is a real existing page, but suggest-path did
  not propose it (it proposed the parent, a sibling, or unrelated places).
- **Miss, total** — none of the proposals are anywhere near right.

"Match" means the proposal points at the same save location you chose — same page / same
parent directory, not a coincidental string prefix. When in doubt, explain the call in
the rationale rather than forcing a binary.

### 5. Report

For each document, output:

- the ranked proposal list (most → least plausible),
- **your own correct path(s)**, shown as the rationale for the verdict,
- the **hit verdict**: hit@N / miss-reachable / miss-total,
- a one- or two-line explanation of *why* — especially when you disagreed with
  suggest-path, so the evaluator itself can be tuned.

Use this structure per document:

```
## <document label>
- suggest-path proposals (ranked best->worst):
  1. <path>   — <why this rank>
  2. <path>   — ...
- Claude's correct path: <path(s)>   (measuring stick, not a new proposal)
- Verdict: hit@1 | hit@N | miss-reachable | miss-total
- Note: <where suggest-path went wrong / why this was hard>
```

## Batch mode and per-domain scores

A single document is the core unit. For a batch, run steps 1–5 for each document, then
aggregate. The point of aggregating is to find **which wiki domains suggest-path is weak
in** — e.g. it does well on the dev wiki but misses everything under a management/HR
tree, which is the kind of blind spot a human can't see from one run.

Derive the per-domain numbers **by aggregation from the rankings**, never by asking for
absolute points (same drift reason as step 4):

- **top-1 rate** — fraction of documents whose correct path is the #1 proposal.
- **top-N rate** — fraction where it lands within the top N (N is a cutoff you choose, e.g. 3).
- **mean rank** — average position of the correct path when it's a hit.
- **miss breakdown** — how many were miss-reachable vs miss-total (reachable misses are a
  selection problem; total misses are a retrieval problem — different fixes).

Group these by whatever "domain" makes sense for the batch (wiki area, document type).
`scripts/aggregate.py` takes the per-document verdicts as JSON and produces this summary;
see its header for the input shape. If you bound coverage in any way (sampled documents,
capped the proposal list), say so in the report — a silent cap reads as "measured
everything" when it didn't.

## Tuning the evaluator itself

This evaluator is **expected to be wrong sometimes**, and that's part of the loop. The
human's sense of "the right place" is the final authority; Claude's judgment is an
approximation of it. When the human says "you scored that proposal low but it's actually
fine — that page does exist," that's a signal to refine *this skill's* judgment
criteria, not to discard the result. This is why step 3's correct path is always
surfaced: without seeing Claude's reasoning, the human can't correct it. A run where the
evaluator's verdicts and the human's gut start agreeing — including agreeing that a
change *lowered* quality — is the evaluator working, not failing.

## References

- `references/tree-source.md` — how to source the wiki tree today (Vault adapter:
  devcontainer GROWI search/page API) and the Vault-interface boundary to preserve.
- `scripts/aggregate.py` — turn per-document verdicts into per-domain hit-rate / rank stats.
