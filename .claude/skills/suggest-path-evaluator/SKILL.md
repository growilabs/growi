---
name: suggest-path-evaluator
description: >-
  Evaluate the quality of GROWI's suggest-path output by judging each proposed save-path as
  o (usable) / △ (usable but improvable) / x (not usable) for a document, with a
  wiki-agnostic plausibility rubric — NOT by matching one "correct" path. For each document
  it reads the wiki content (page bodies, not just path strings), judges each candidate
  against THIS wiki's own organization, AND drills down the tree to build the document's own
  ideal home so a candidate is only ruled x once a better place is known (multiple candidates
  may be usable — the correct place is not unique). Use it to score suggest-path's proposals
  as a reviewer would — e.g. "evaluate suggest-path on this document", "score / check /
  review these path suggestions", "are these save paths usable", "how good is suggest-path
  for this wiki", or when dogfooding suggest-path and you want a per-candidate verdict instead
  of eyeballing it. Trigger it even when the user only says "check"/"score"/"review"
  suggest-path results without the word "evaluator".
---

# suggest-path Evaluator (plausibility-domain, wiki-aware, drilldown-backed)

## What this is

GROWI's `suggest-path` takes a document body and proposes parent paths to save it under.
This skill **reviews each proposal** and marks it **○ (usable)** / **△ (usable but a better
place exists)** / **× (not usable)**, and — because a candidate can only be ruled out once
you know where the document *should* live — it also **drills down the wiki to build the
document's own ideal home** and reports it (including "this is a new path" when nothing fits).
It is a measurement/tuning tool for suggest-path, not part of the production feature; it does
not modify suggest-path or GROWI.

## The evaluation paradigm: plausibility domain, not answer-key

The correct save location is **not unique**. A meeting-note could reasonably live under a
minutes tree OR a dev-log tree OR a "discussion" area under an API-spec — all are legitimate.
So this skill does **not** pick one canonical answer and grade against it. Instead it asks of
*each* candidate: **"is placing this document here reasonable, and is there a clearly better
home?"** Multiple ○'s are expected and correct.

The drilldown (Phase B) builds a *recommended* home, but that home is a **reference**, not a
single must-match key: it tells you when a candidate is *beaten* (→ △ with the better place
named), never that a candidate must *equal* it. This is the deliberate middle ground — explore
enough to know when a candidate is beaten, without collapsing the answer to one point.

## ★★ The non-negotiable constraint: wiki-agnostic

This skill is used on **an unknown wiki** (wiki-agnostic). It **must not be optimized to any
one wiki** (= overfitting).

The same kind of document may correctly live in very different places depending on the wiki —
a spec might sit at `/docs/spec/`, or root-level `/spec/`, or `/project/<name>/spec/`. **All
are correct — only the filing convention differs.** The job is: *given THIS wiki's own
organization, is placing this document at this candidate path reasonable, and is there a
clearly better home?* — never *does it match a specific canonical tree?*

Hard rules that follow:

- **Never encode specific path strings or directory names** into the judgement. Reason from
  structure, not from memorized paths. The moment a concrete path becomes a fixed criterion,
  this becomes a single-wiki tool.
- **Infer the wiki's classification system from the tree itself** (the candidate tree and what
  you see while drilling down), then judge whether the document's character fits it. Example:
  if this wiki keeps separate trees for different document kinds (specs vs manuals vs minutes),
  respect that separation — but the *criterion* is "respect the separation THIS wiki makes",
  not any particular directory name being canonical.

## The judgement stance

Aim to **draw the boundary of plausibility**, not to hit one narrow correct answer.

- **Clear mis-placement → ×.** (meeting-notes vs a UI-design tree = obviously different.)
- **Reasonably plausible → ○**, and **be generous: multiple candidates can be ○.**
  (meeting-notes could sit under a minutes tree OR a dev-log tree OR a "discussion" area under
  an API-spec — all ○.)
- **Right direction but a clearly better home exists → △** (usable, but improvable). △ is not
  a hedge — it means "you *could* file it here, but the drilldown found a place that fits
  better; here it is." Always pair a △ with that better place.
- **Genuinely ambiguous content gets a wider ○**, not a forced single pick. ("a meeting where
  an API spec was discussed" may belong under minutes *or* under a spec-discussion area — allow
  both ○.) But "put an API definition into the meeting-minutes tree" → ×.

## The judgement principles (wiki-agnostic)

Transferable reasoning, **no fixed path strings**. The ordering matters: the **firm axes** are
applied decisively; the **soft axis (depth)** must not be applied rigidly — there, lean ○/△,
not ×.

### Firm axes — apply decisively

1. **Clear mis-placement is × — this is the core job.** A candidate whose subject or
   document-kind plainly does not belong (meeting-notes proposed under a UI-design tree; an API
   definition under a minutes tree) is × with confidence. The "obvious no" is the most reliable
   verdict this skill makes — spend your confidence here.
2. **"Usable" = you would actually file it here**, not merely "same broad genre". Genre match
   alone is not enough; it must be a place a careful person would actually choose.
3. **Personal/private areas are × for shared content** (a candidate under someone's personal
   user space, for content that should be a shared wiki asset). It won't become a shared asset
   there.
4. **Classification-axis mismatch is × even if the topic matches.** If the document's *kind*
   (spec / manual / minutes / decision-record / …) conflicts with the candidate's
   classification — even when the subject name matches perfectly — it is ×. Read this
   **abstractly**: "if THIS wiki separates document kinds, a candidate in the wrong kind is ×",
   NOT "a specific pair of directory names is canonical". First determine what kind of document
   this is, then check the candidate's place is consistent with that kind, as THIS wiki
   expresses kinds. (Reading page **content**, per Phase A, is what lets you catch a
   kind-mismatch that the path name alone hides — and avoid a false × when the path name looks
   wrong but the content fits.)

### Soft axis — do NOT be rigid

5. **Depth is a soft call — when a candidate is right in subject/kind but arguably one level
   off, lean ○/△, never ×.** Depth is genuinely ambiguous: a careful person filing the same
   document twice may not even nest it the same way. So:
   - **Too shallow → ○ (or △).** A parent broader than ideal still leaves room to nest later;
     not fatal as long as subject/kind direction is right. Decide ○ vs △ by THIS wiki's habit
     (Phase A step on shallow candidates, below): if siblings under the candidate are organized
     into per-topic subdirectories, a too-shallow candidate is △ (a new subdir is the better
     home — name it in the △ note); if the area is run flat, it is ○. (Only a catch-all
     top-level bucket that *anything* falls into is too vague → ×, and that's really axis 1/2,
     not depth.)
   - **Too deep → usually ○, not ×.** A slightly-narrower box is a *soft* miss. Mark
     deep-but-on-topic candidates × **only** when the box is *clearly* narrower than the
     document's whole scope (a doc about a feature in general, proposed under one sub-detail of
     that feature). When it's a judgement call, lean ○/△. Do not manufacture strictness.

### Tie-breakers

6. **Multiple ○'s are expected.** If several parents are reasonable, mark them all ○; do not
   force a single best.
7. **"When in doubt, ×" applies to KIND/subject doubt, not depth doubt.** If you're unsure
   because the subject or document-kind might not fit (axes 1–4), lean ×. If you're unsure only
   about *how deep* an otherwise-fitting candidate sits (axis 5), lean ○/△.

## Inputs

1. **The document body** (required) — one document, or several for a batch.
2. **The wiki to evaluate against** — which GROWI instance is the tree/ground truth (the same
   instance suggest-path is called against). Default: the local GROWI in the devcontainer.

The user does not pre-run suggest-path; this skill calls it.

## The flow

For a single document, run Phase A and Phase B against the same wiki, then report. Phase B
runs **for every document** — it is what lets Phase A say × with confidence (you only rule a
candidate out once you know a better place exists).

### Step 0. Get suggest-path's proposals

Call suggest-path with the document body. Prefer the MCP tool; fall back to HTTP.

- **MCP (preferred):** `mcp__growi__suggestPath` with `{ body: <document> }`.
- **HTTP (fallback):** `POST /_api/v3/ai-tools/suggest-path` with `{ "body": "<document>" }`,
  auth via `?access_token=<token>`. Devcontainer: `http://localhost:3000/...`. Response:
  `{ "suggestions": [ { "type", "path", "label", "description", ... }, ... ] }`.

Keep every proposal, including obviously-wrong ones — the job is to mark each, not to
pre-filter. The `path` field is what you judge. **The `description` is suggest-path's own
justification — do not let it sway you; judge body × path on your own.** If suggest-path returns
zero proposals, record that as a result (nothing to mark usable), do not silently skip.

> **Note on the wiki source.** Both phases read the wiki tree **and page content** through a
> **Vault interface** — see `references/tree-source.md` for how to source it today and the
> Vault boundary to preserve. Judge **content fit**, not path-string similarity: a path can
> string-match a surface word yet be the wrong home (exactly suggest-path's own failure mode).

### Phase A — judge each candidate ○ / △ / ×

For **each** proposed parent path:

1. **Understand the document's meaning** (subject + kind) from the body.
2. **Decompose the candidate path into its hierarchy, and look at each level's page:**
   - **Page has a body** → use that level's content (a snippet is enough) to tell *what kind of
     page it is*.
   - **Box page** (`$lsx()`-only / empty / non-existent intermediate — a grouping page) → its
     body says nothing; **look at its children (titles + snippets) to learn what the box is
     for.** In GROWI, parent directories tend to be `$lsx()`-only; the box's identity is told by
     its contents, not its own body. A large share of candidate levels are such boxes, so this
     is the common case, not the exception. Without reading children you cannot judge a box; do
     not guess from its path name.
   - A path/title can look wrong while the content fits (or vice versa) — reading the snippet is
     what catches kind-mismatches (axis 4) and prevents false ×.
3. **Score the candidate on its own merits** (do not overturn it just because Phase B found
   somewhere else — Phase B informs ○-vs-△, not the candidate's intrinsic fit):
   - whole path fits in subject **and** kind → **○**
   - part of the path is off but it's still a usable home → **△**, and name the better place
   - **shallow candidate** (right direction, but the wiki would normally nest one level
     deeper): look at the candidate's children to read THIS wiki's habit — per-topic
     subdirectories ⇒ **△** (a new subdir is the better home); flat area ⇒ **○**. Not a blanket
     rule; depends on how organized this part of the wiki is.
   - subject/kind clearly wrong (any depth) → **×**
4. **Self-consistency gate** (below) so you prove you judged THIS document.

#### Self-consistency gate: prove you judged the right body

Write a one-line **body digest**: subject + 3–5 proper nouns / feature names taken verbatim
from the body (`{ "subject": "...", "key_terms": ["...", ...] }`). Then verify every key term
actually appears in the body you read. If a term you "remember" isn't in the text, you
summarised a different document — discard, re-read this body, redo Phase A. This catches the
most damaging batch error: **filing the right reasoning under the wrong document**. It needs
only the body (no answer key), so it works on any wiki and leaks no ground truth.
`scripts/reconcile-digests.py` runs this check mechanically over a batch (see Batch mode).

### Phase B — drilldown to the document's ideal home (always run)

Build, from the wiki, where this document *should* go. This is the reference that lets Phase A
distinguish ○ from △ (and rule × with confidence). It is a **beam descent** from the root:

From the root, at each level:

- **a.** List the level's children (titles + snippets).
- **b.** Pick the candidates worth descending into — **the "plausible" children, up to 3**
  (keep a child whose snippet fits even if its title looks marginal; don't drop on title alone
  — that's how a good-but-oddly-named home gets missed).
- **c.** Read the **full body of those kept children (up to 3)** and choose the best fit to
  descend into. Don't commit to one child on a single glance — that prunes a better branch too
  early.
- **d.** Stop when **no child fits the document better than the current node** — the current
  node is the recommended save location. Depth cap **5 levels** as a backstop and cycle guard;
  the real stop is "no better child", not the cap. Most save locations are far shallower than
  5, so the cap rarely bites — note it if you hit it.
- If nothing along the descent fits, conclude **"new path"** and state where it would hang.

"Better fit" is a **judgement call you make** (LLM judgement) — do **not** reduce it to a
numeric threshold; thresholds invite the arbitrariness this skill exists to avoid.

Phase A and Phase B **share work**: in both you read a node's children to understand the wiki's
granularity habit. Do it once and reuse it — the box-identity reads in Phase A step 2 and the
child-listing in Phase B are the same kind of access.

> **Cost caveat.** Reading up to 3 full bodies per level can add up on deep trees. Listing
> children with short snippets is cheap; the full-body reads are the cost to watch. Run the
> defaults above (beam ≤3, full-reads ≤3, depth ≤5) on a few cases first, measure the real
> cost, and retune the beam/depth if needed. Don't assume it's free.

### Step 4. Report

Per document:

```
## <document label>
- Body digest: <subject> | key terms: <term, term, ...>   (self-consistency check; all terms must be in the body)
- This wiki's inferred organization: <one line: how it separates kinds / nests topics>
- suggest-path proposals, each judged:
  1. <path>   — ○ | △ | ×  — <one-line why: which principle; for △, the better place>
  2. <path>   — ○ | △ | ×  — ...
- Recommended home (Phase B drilldown): <path, or "new path under <parent>">
- Usable count: <#○+#△> / <#candidates>   (○: <#○>, △: <#△>, ×: <#×>)
- Note: <where suggest-path went wrong, or why a call was hard / genuinely ambiguous>
```

- **△ always carries its better place** — either a sibling/child path the drilldown found, or
  the Phase B recommended home.
- The Phase B **recommended home** appears once per document (not per candidate); a candidate
  may equal it (→ that candidate is ○), be beaten by it (→ △), or be unrelated (judge on its own
  axes).
- Do not emit absolute point scores (they drift run-to-run). The ○/△/× marks are the output;
  aggregate them across documents (below) for rates.

## Batch mode and per-domain rates

A single document is the core unit. For a batch, run the flow per document, then aggregate.
**Batches are where bodies get swapped — gate every document** (Phase A's self-consistency gate
is mandatory in batch mode; a body that fails reconciliation is a suspected swap: re-judge it in
isolation before it enters the aggregate; reconciliation is a deterministic string check, not
another LLM pass). `scripts/reconcile-digests.py` runs this gate over a directory of bodies and
exits non-zero on a suspected swap, so it can block aggregation.

Aggregate from the ○/△/× marks (`scripts/aggregate.py` turns per-document verdicts into the
per-domain table):

- **usable-rate (case-level)** — fraction of documents with ≥1 usable (○ or △) candidate. This
  is a **precision-side** number: "did suggest-path put at least one reasonable place in its
  list". It cannot measure recall (whether a good place existed that suggest-path never
  proposed) — but Phase B's recommended home gives a recall signal: **count cases where the
  recommended home matched no proposed candidate** (= suggest-path missed a better place it
  should have offered). Report both, and label the usable-rate as precision-side.
- **per-candidate ○/△/× rates** — fraction of all candidates in each class.
- **×-concentration by reason** — group ×'s by which principle triggered them (clear
  mis-placement / axis-mismatch / personal-area / vague-catch-all). Different reasons point at
  different suggest-path fixes. Depth is, by design, rarely a × here.

Group by whatever "domain" fits the batch (wiki area, document type). If you bound coverage
(sampled docs, capped the proposal list, hit the depth cap), **say so** — a silent cap reads as
"measured everything".

## On the verdict unit (why ○/△/× and not hit/miss)

The ○/△/× verdict is deliberately a **plausibility** judgement, not an answer-key match. A
human reviewing the same proposals marks candidates the same way — so this skill's output can
be sanity-checked by a human reading a handful of cases. Two things to keep in mind when doing
that:

- The human's marks are a useful reference but **not absolute truth**: a human marks candidates
  one by one, while this skill, seeing the whole tree via Phase B, may know a better home the
  human overlooked. So **human-○ / skill-△ (and vice versa) is expected, not a bug** — the two
  will not agree perfectly, and shouldn't be forced to.
- If the skill ever needs tuning, fix disagreements **only** by sharpening the wiki-agnostic
  principles above — **never** by adding concrete paths to make one wiki's numbers look better
  (that helps one wiki and breaks every other).

## References

- `references/tree-source.md` — how to source the wiki tree **and page content** today (the
  current adapter and the Vault-interface boundary to preserve). Phase A (box-identity reads)
  and Phase B (beam descent) both go through it.
- `scripts/reconcile-digests.py` — deterministic self-consistency gate for batch mode (every
  key term in a document's digest must appear in that document's body; exits non-zero on a
  suspected body-swap).
- `scripts/aggregate.py` — aggregates per-document ○/△/× verdicts into the per-domain table
  (usable-rate, per-candidate ○/△/× rates, recall-miss rate from Phase B, and an ×-by-reason
  breakdown). Input is a JSON list of per-document records (`candidates` + an optional
  `recommended_home_in_candidates` recall flag); see the script's header for the shape.
