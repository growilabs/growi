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
  reads the wiki tree, constructs its OWN correct save location as a measuring stick,
  and ranks the proposals by plausibility so hit-rate ("is the right place in the
  top N") can be aggregated. Trigger it even when the user only says
  "check"/"score"/"rank" suggest-path results without saying "evaluator".
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

## What "a save location" means here (read this before anything else)

suggest-path does **not** name the new page. It returns the **parent path to save
UNDER** — always a directory-style path with a trailing slash (e.g. `/資料/内部仕様/`).
The new document becomes a *child* of that path. In GROWI there is no separate notion
of "folder" vs "page": every page can have children, so a parent path is usually the
full path of an **existing page** that the document belongs under.

The evaluator must speak the **same units**. When Claude builds its own answer, it also
produces a **parent path to save under**, not the full path of a hypothetical new page.
Comparing suggest-path's parent path against Claude's parent path is the whole game —
they must be at the same granularity or every comparison is off by one level.

> Wrong (granularity mismatch): Claude's answer = `/資料/内部仕様/プレゼンテーション/アルゴリズム`
> (a full path for the new page). suggest-path's answer = `/資料/内部仕様/プレゼンテーション/`.
> These describe the *same intent* but look one level apart — a false miss.
>
> Right: Claude's answer = `/資料/内部仕様/プレゼンテーション/` (the parent to save under).
> Now it lines up with suggest-path's units and the comparison is meaningful.

## The one rule that defines this skill

**Claude builds its own correct save location FIRST, then judges suggest-path against it.**

This is the difference between a useful evaluator and a useless one. If Claude only
looked at suggest-path's list and ranked *within* it, it could never detect the case
that matters most: **suggest-path missed entirely** — none of its proposals are right.
By forming an independent answer first, Claude can say "all of these are wrong, the
document actually belongs under X", which is exactly the signal needed to find wiki
domains where suggest-path is weak.

Claude's own answer is a **measuring stick, not a deliverable.** The skill does not exist
to propose new paths to the user. Surface Claude's answer only as the *rationale* for the
verdict, so a human can look at it and tune the evaluator ("you marked that a miss, but
this page already exists — why didn't you see it?").

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

### 3. Build your own correct save location — the sibling test

Before looking hard at suggest-path's ranking, decide where **you** would save this
document. Use one general question that covers every case:

> **If I dropped this document into the existing tree, which existing pages would it sit
> NEXT TO as a sibling? The parent of those siblings is the save location.**

This single test handles the situations that look different but aren't:

- **A topic page already exists.** A document about "presentation algorithms" and an
  existing page `/資料/内部仕様/プレゼンテーション/アーキテクチャ` are both *about
  presentation internals* — they're siblings under `/資料/内部仕様/プレゼンテーション/`.
  So the save location is `/資料/内部仕様/プレゼンテーション/`. It is **not**
  `…/プレゼンテーション/アーキテクチャ/` (the document isn't *about* the architecture
  page's sub-topic — don't nest it under a sibling) and it is **not** `/資料/内部仕様/`
  (that's the grandparent — don't step up past the real topic page).
- **Only same-kind records exist.** A `20260615_定例` meeting-note and an existing
  `会議/議事録/20260608_定例` are siblings: both are dated 定例 records. They sit side by
  side under `会議/議事録/`. Do **not** nest the new note *under* `20260608_定例` just
  because the two are similar — similar ≠ contained. The parent `会議/議事録/` is the answer.

Both bullets are the same move: find the siblings, return their parent. The recurring
mistakes are the two directions of getting the depth wrong — **nesting under a sibling**
(one level too deep) or **stepping up to a grandparent** (one level too shallow). Aim for
the exact parent of the sibling set.

A document can legitimately have **more than one** save location when the wiki has two
equally-good sibling sets (e.g. two different `会議室` trees). Capture all of them.

If the document has **no siblings anywhere** — it's genuinely new to this wiki — that is
a real and expected outcome; handle it as the "no-sibling world" below.

#### Self-consistency gate: prove you judged the right body

Before you commit to a save location, prove you reasoned about **this** document and not
a neighbouring one. While forming the answer, also write a one-line **body digest** for
the document: its subject plus 3–5 proper nouns / feature names taken verbatim from the
body (`{ "subject": "...", "key_terms": ["...", ...] }`).

Then verify the digest against the body itself: **every key term must actually appear in
the body you read.** If a term you "remember" isn't in the text, you summarised a
different document — discard the answer, re-read this document's body from scratch, and
redo step 3.

This catches the single most damaging batch error: **filing the right reasoning under the
wrong document.** When several documents are judged in one pass (especially across
parallel sub-agents), it is easy to carry the previous document's content into the next
one's verdict; the digest-vs-body check exposes that mechanically. Crucially it needs
**only the body** — no human answer key — so it works on any wiki and never leaks ground
truth into the blind judgment.

### 4. Rank suggest-path's proposals, and compare against your answer

Order suggest-path's proposals from most to least plausible **as a save location for
this document**. This is a **relative ranking, not an absolute score.** Do not emit
"7 out of 10" numbers — absolute points drift every run because the scale has no fixed
anchor, whereas a relative order stays stable because you are only ever comparing
proposals to each other. (Per-domain numeric scores come later, by aggregation — see
below — not by asking for points here.)

Then compare each proposal's path against your own correct save location. Because both
are parent paths (step 0 / step 3), the comparison is path-vs-path at the same level.
Classify the document's outcome:

**When the document HAS siblings (a home exists in the tree):**

- **hit@N** — a proposal's path equals your correct save location (the sibling-set
  parent), sitting at rank N. Exact same parent = hit.
- **near-miss** — a proposal is on the right line but at the wrong depth: it is an
  **ancestor or descendant** of your correct save location (e.g. you said
  `/資料/内部仕様/プレゼンテーション/`, the proposal said `/資料/内部仕様/` — the parent,
  one level too shallow; or it dived one level too deep). The neighborhood is right, the
  level is off. This is the dominant real-world failure (stopping at the category instead
  of the topic page), so it gets its own bucket rather than being lumped into miss.
- **miss** — no proposal is your save location or an ancestor/descendant of it. The
  correct home exists but suggest-path pointed at a different subtree (or only at
  coincidental string matches).

**When the document has NO siblings (a new path is the right answer):**

Here a brand-new path is the *correct* behavior — suggest-path is explicitly allowed to
propose new directories, and so are you. String equality is the wrong test (two sensible
new paths rarely match character-for-character), so judge intent instead:

- **hit (new)** — suggest-path proposed a genuinely new path at a sensible level of the
  taxonomy, matching the *intent* of the new home you'd create (same neighborhood, same
  altitude), even if the exact wording differs.
- **near-miss (new)** — it proposed a new path but at an off level or slightly wrong
  neighborhood.
- **miss (mis-filed)** — it forced the document into an existing location that doesn't
  fit, instead of recognizing it needed a new home. (This is the inverse failure of the
  has-siblings case and just as important to surface.)

Deciding *whether* siblings exist is the evaluator's hardest and most error-prone step:
a real sibling you failed to find looks identical to "no siblings exist". Search the tree
honestly before concluding a document is new — a lazy search produces a false "new"
verdict, which then mis-blames suggest-path for mis-filing. When you do conclude "new",
say what you searched, so the human can challenge it.

"Match" everywhere means same intended save location, not a coincidental string prefix.
When a call is genuinely ambiguous, explain it in the rationale rather than forcing it.

### 5. Report

For each document, output:

- the ranked proposal list (most → least plausible),
- **your own correct save location(s)**, shown as the rationale for the verdict,
- the **verdict** (see step 4),
- a one- or two-line explanation of *why* — especially when you disagreed with
  suggest-path, so the evaluator itself can be tuned.

Use this structure per document:

```
## <document label>
- Body digest: <subject> | key terms: <term, term, ...>   (self-consistency check; all terms must be in the body)
- suggest-path proposals (ranked best->worst):
  1. <path>   — <why this rank; hit / near-miss(too shallow|too deep) / off-subtree>
  2. <path>   — ...
- Claude's correct save location: <parent path(s)>   (measuring stick, not a new proposal)
- Sibling basis: <which existing pages it would sit next to>  |  new (no siblings; searched: ...)
- Verdict: hit@N | near-miss | miss | hit(new) | near-miss(new) | miss(mis-filed)
- Note: <where suggest-path went wrong / why this was hard>
```

## Batch mode and per-domain scores

A single document is the core unit. For a batch, run steps 1–5 for each document, then
aggregate. The point of aggregating is to find **which wiki domains suggest-path is weak
in** — e.g. it does well on the dev wiki but misses everything under a management/HR
tree, which is the kind of blind spot a human can't see from one run.

**Batches are where bodies get swapped — gate every document.** A batch is usually fanned
out across parallel sub-agents, each handling a slice of documents; that is exactly the
setup where one document's content bleeds into another's verdict (the failure step 3's
self-consistency gate exists to catch). So in batch mode the gate is **not optional**:

1. Each document carries its **body digest** (step 3) through to the report.
2. Before aggregating, reconcile every digest against its own body file: each digest's
   key terms must appear in the body it claims to describe.
3. Any document that fails reconciliation is a **suspected body swap** — do not score it.
   Send it back through step 3 (re-read that document's body in isolation, redo the
   judgment), then re-reconcile. Only documents that pass the gate enter the aggregate.

This is a closed self-repair loop: it uses only the bodies, so it corrects swaps without
ever consulting a human answer key. Reconciliation is a cheap mechanical string check —
keep it as a deterministic pass (e.g. a small script), not another LLM judgment, so it
can't drift the same way the original mistake did. If any documents were quarantined and
re-judged, say how many in the report — a silent re-judge hides how shaky the first pass was.

Derive the per-domain numbers **by aggregation from the rankings**, never by asking for
absolute points (same drift reason as step 4):

- **top-1 rate** — fraction of documents whose correct save location is the #1 proposal.
- **top-N rate** — fraction where it lands within the top N (N is a cutoff you choose, e.g. 3).
- **mean rank** — average position of the correct save location when it's a hit.
- **outcome breakdown** — counts of hit / near-miss / miss (and the new-path variants).
  near-miss concentration means a depth-selection problem (right neighborhood, wrong
  level); miss concentration means a retrieval problem (wrong subtree entirely);
  mis-filed concentration means suggest-path won't create new paths when it should.
  These point at different fixes.

Group these by whatever "domain" makes sense for the batch (wiki area, document type).
`scripts/aggregate.py` takes the per-document verdicts as JSON and produces this summary;
see its header for the input shape and how near-miss is counted. If you bound coverage in
any way (sampled documents, capped the proposal list), say so in the report — a silent cap
reads as "measured everything" when it didn't.

## Tuning the evaluator itself

This evaluator is **expected to be wrong sometimes**, and that's part of the loop. The
human's sense of "the right place" is the final authority; Claude's judgment is an
approximation of it. When the human says "you marked that a miss but it's actually fine —
that page does exist," that's a signal to refine *this skill's* judgment criteria, not to
discard the result. This is why step 3's save location and sibling basis are always
surfaced: without seeing Claude's reasoning, the human can't correct it. A run where the
evaluator's verdicts and the human's gut start agreeing — including agreeing that a change
*lowered* quality — is the evaluator working, not failing.

## References

- `references/tree-source.md` — how to source the wiki tree today (Vault adapter:
  devcontainer GROWI search/page API) and the Vault-interface boundary to preserve.
- `scripts/aggregate.py` — turn per-document verdicts into per-domain hit-rate / rank stats.
