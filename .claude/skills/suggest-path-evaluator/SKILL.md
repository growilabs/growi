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

> **★ STATUS (2026-06-18): rebuilt around the human's actual judging procedure.** An earlier
> generation of this skill fixed **one** "correct" save location and scored proposals
> hit/near-miss/miss against it — which over-punished any proposal that differed from that one
> pick (the "answer-key mismatch" problem). A later draft swung the other way: it judged each
> candidate from the path string alone (no wiki content) as a 2-value o/x, which systematically
> over-marked o (it could never say "x" with confidence because it never knew where the
> document *should* go), and was calibrated wiki-blind against wiki-blind human labels — the
> wrong target entirely. **This version is the synthesis:** it reads page **content**, drills
> down to build the document's ideal home (Phase B), but still scores each candidate on its own
> merits as **○/△/×** (Phase A). Calibration is now **eyeball-led** (a human spot-checks a few
> outputs; weighted κ is a reference number, not a pass/fail gate). The old κ≥0.6 ∧
> x-recall≥0.7 gate is **retired** (it was for the 2-value, wiki-blind setup). The Phase-B
> "drill before you rule out" flow is the central change; its premise (that judging without
> exploration drifts o because it can never name a better place) is a **hypothesis to confirm
> by spot-check after the skill runs**. See `tmp/calib-pilot/CALIBRATION-PROTOCOL.md` and the
> `suggest-path-evaluator-calibration` memory's "2026-06-18 セッション" section (the canonical
> design source).

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

This skill is used on **an unknown wiki** (wiki-agnostic). It is calibrated on the GROWI dev
wiki today, but **must not be optimized to the dev wiki** (= overfitting).

The same "spec document" may correctly live at `/資料/仕様/`, or root-level `/仕様/`, or
`/project/hoge/仕様/`, depending on the wiki. **All are correct — only the filing convention
differs.** The job is: *given THIS wiki's own organization, is placing this document at this
candidate path reasonable, and is there a clearly better home?* — never *does it match a
specific canonical tree?*

Hard rules that follow:

- **Never encode dev-wiki-specific path strings or directory names** (`/資料/内部仕様/` etc.)
  into the judgement. Reason from structure, not from memorized paths. The moment a concrete
  dev-wiki path becomes a criterion, this becomes a dev-wiki-only tool.
- **Infer the wiki's classification system from the tree itself** (the candidate tree and
  what you see while drilling down), then judge whether the document's character fits it.
  Example: if this wiki separates internal-spec from external-spec trees, respect that
  separation; but the *criterion* is "respect the separation THIS wiki makes", not "the words
  内部仕様/外部仕様 are canonical".
- The human-facing calibration rubric (`tmp/calib-pilot/RUBRIC.md`) contains dev-wiki examples
  on purpose (it is a tool for a human to label the dev-wiki sheet). **That rubric is raw
  material, not this skill's prompt.** Only the *distilled, wiki-agnostic principles* below
  come from it; the concrete examples do not transfer here.

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

## The judgement principles (wiki-agnostic; pinned 2026-06-18 against intra-rater data)

These are the wiki-agnostic principles distilled from the calibration rubric, then tuned by
what the human could **reproduce** across two passes. Transferable reasoning, **no dev-wiki
path strings**. The ordering matters: the **firm axes** are where the human never wavered —
apply them decisively. The **soft axis (depth)** is where the human's own labels swung on a
re-pass — so do not be rigid there; lean ○/△, not ×.

### Firm axes — apply decisively (the human reproduced these)

1. **Clear mis-placement is × — this is the core job.** A candidate whose subject or
   document-kind plainly does not belong (meeting-notes proposed under a UI-design tree; an API
   definition under a minutes tree) is × with confidence. In the calibration these "obvious no"
   verdicts were the most stable signal (159/187 ×-labels held across a re-pass). Spend your
   confidence here.
2. **"Usable" = you would actually file it here**, not merely "same broad genre". Genre match
   alone is not enough; it must be a place a careful person would actually choose.
3. **Personal/private areas are × for shared content** (a candidate under someone's personal
   user space, for content that should be a shared wiki asset). It won't become a shared asset
   there. (In the calibration this axis had **zero** re-pass disagreements — treat it as firm.)
4. **Classification-axis mismatch is × even if the topic matches.** If the document's *kind*
   (spec / manual / minutes / decision-record / …) conflicts with the candidate's
   classification — even when the subject name matches perfectly — it is ×. Read this
   **abstractly**: "if THIS wiki separates document kinds, a candidate in the wrong kind is ×",
   NOT "a specific pair of directory names is canonical". First determine what kind of document
   this is, then check the candidate's place is consistent with that kind, as THIS wiki
   expresses kinds. (Reading page **content**, per Phase A, is what lets you catch a
   kind-mismatch that the path name alone hides — and avoid a false × when the path name looks
   wrong but the content fits.)

### Soft axis — do NOT be rigid (the human could not reproduce strictness here)

5. **Depth is a soft call — when a candidate is right in subject/kind but arguably one level
   off, lean ○/△, never ×.** This is the single most important correction from the calibration:
   every intra-rater disagreement (38/38) was a depth call, and the human systematically
   *relaxed* toward ○ on the re-pass. So:
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
     that feature). When it's a judgement call, lean ○/△. Do not manufacture strictness the
     human herself doesn't hold.

### Tie-breakers

6. **Multiple ○'s are expected.** If several parents are reasonable, mark them all ○; do not
   force a single best.
7. **"When in doubt, ×" applies to KIND/subject doubt, not depth doubt.** If you're unsure
   because the subject or document-kind might not fit (axes 1–4), lean ×. If you're unsure only
   about *how deep* an otherwise-fitting candidate sits (axis 5), lean ○/△. This split is
   exactly where the human's reproducible judgement and her wavering judgement divide.

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
> **Vault interface** — see `references/tree-source.md` for how to source it today (devcontainer
> GROWI via MongoDB direct-read) and the Vault boundary to preserve. Judge **content fit**, not
> path-string similarity: a path can string-match a surface word yet be the wrong home (exactly
> suggest-path's own failure mode).

### Phase A — judge each candidate ○ / △ / ×

For **each** proposed parent path:

1. **Understand the document's meaning** (subject + kind) from the body.
2. **Decompose the candidate path into its hierarchy, and look at each level's page:**
   - **Page has a body** → use that level's content (a snippet is enough) to tell *what kind of
     page it is*.
   - **Box page** (`$lsx()`-only / empty / non-existent intermediate — a grouping page) → its
     body says nothing; **look at its children (titles + snippets) to learn what the box is
     for.** In GROWI, parent directories tend to be `$lsx()`-only; the box's identity is told by
     its contents, not its own body. (Measured on the dev wiki: ~44% of candidate levels are
     boxes — so this is the common case, not the exception.) Without reading children you cannot
     judge a box; do not guess from its path name.
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
  node is the recommended save location. Depth cap **5 levels** as a backstop (also a cycle
  guard); the real stop is "no better child", not the cap. (Dev-wiki candidate paths average
  ~2.5 deep; max observed 7. 5 is plenty for the common case — note it if you hit the cap.)
- If nothing along the descent fits, conclude **"new path"** and state where it would hang.

"Better fit" is a **judgement call you make** (LLM judgement) — do **not** reduce it to a
numeric threshold; thresholds invite the arbitrariness this skill exists to avoid.

Phase A and Phase B **share work**: in both you read a node's children to understand the wiki's
granularity habit. Do it once and reuse it — the box-identity reads in Phase A step 2 and the
child-listing in Phase B are the same kind of access.

> **Cost caveat (unverified).** Reading up to 3 full bodies per level can add up on deep trees.
> The snippet cost is measured and light (~505 chars/case average); **full-body reads in Phase B
> are not yet measured.** Run the defaults above (beam ≤3, full-reads ≤3, depth ≤5) on a few
> cases first, measure the real cost, and retune the beam/depth if needed. Don't assume it's
> free.

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

## Calibration: how this skill's verdicts are checked (eyeball-led)

The ○/△/× verdict is the same unit a human labels in calibration. Calibration asks whether
*this skill's* verdicts agree with a human's — but the check is now **eyeball-led, not a numeric
gate**:

- **The pass/fail is a human spot-check**: a human reads a handful of this skill's outputs and
  decides whether the verdicts and the drilldown homes are sane; then repeats on a small sample
  from **another** wiki to confirm it transfers. That judgement is the gate.
- **Weighted κ is a reference number, not a gate.** Compute it against human ○/△/× labels as one
  diagnostic among others; do not pass/fail on it. Use a **linear** weight matrix: ○↔△ = 0.5
  (light), △↔× = 0.5 (medium), ○↔× = 1.0 (full) — adjacent classes are half-penalised, the two
  extremes are full-penalised. (`tmp/calib-pilot/intra-kappa.js` is the 2-value version; a
  weighted-κ variant must be written for ○/△/×.)
- The **old gate is retired**: κ≥0.6 ∧ x-recall≥0.7 was for the 2-value, wiki-blind setup whose
  premises the 2026-06-18 session overturned. Do not reinstate it.
- Human labels are the gold standard but **not absolute truth**: a human marks candidates, while
  this skill, seeing the whole tree via Phase B, may know a better home the human overlooked. So
  **human-○ / skill-△ (and vice versa) is expected, not a bug** — don't chase κ=1.0; the ceiling
  is the human's own test-retest agreement.
- When tuning this skill after a spot-check, fix disagreements **only** by sharpening
  wiki-agnostic principles — **never** by adding concrete dev-wiki paths to raise agreement (that
  raises the number but breaks on other wikis).
- Human labels for calibration must be re-taken **wiki-aware and in ○/△/×** to match this flow;
  the older wiki-blind, 2-value labels are not a valid target for this skill.

## References

- `references/tree-source.md` — how to source the wiki tree **and page content** today (Vault
  adapter: devcontainer GROWI via MongoDB direct-read) and the Vault-interface boundary to
  preserve. Phase A (box-identity reads) and Phase B (beam descent) both go through it.
- `scripts/reconcile-digests.py` — deterministic self-consistency gate for batch mode (every
  key term in a document's digest must appear in that document's body; exits non-zero on a
  suspected body-swap).
- `scripts/aggregate.py` — aggregates per-document ○/△/× verdicts into the per-domain table
  (usable-rate, per-candidate ○/△/× rates, recall-miss rate from Phase B, and an ×-by-reason
  breakdown). Input is a JSON list of per-document records (`candidates` + an optional
  `recommended_home_in_candidates` recall flag); see the script's header for the shape.
