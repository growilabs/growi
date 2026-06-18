#!/usr/bin/env python3
"""Aggregate per-document evaluator verdicts (o / △ / x) into per-domain rates.

This turns the per-candidate verdicts produced by the suggest-path-evaluator skill into
the numbers a human uses to find weak wiki domains and weak suggest-path behaviors. It
speaks the skill's CURRENT vocabulary — the plausibility-domain o/△/x marks (SKILL.md
"The judgement stance" / "Step 4. Report"), NOT the retired hit/near-miss/miss ranks.

It derives every number FROM THE PER-CANDIDATE MARKS — there is no absolute "N out of 10"
score, because absolute scores drift between runs while the o/△/x marks do not.

Verdict vocabulary (matches SKILL.md):

  per candidate
    "o"   usable          — placing the document here is reasonable
    "△"   usable-improvable — usable, but the drilldown found a clearly better home
    "x"   not-usable      — clear mis-placement / axis-mismatch / personal-area / vague

  per document (recall signal, from Phase B)
    recommended_home_in_candidates : bool
        true  if Phase B's recommended home equals one of suggest-path's proposals
        false if suggest-path never proposed the place the drilldown judged best
              (= a recall miss: a better home existed that suggest-path didn't offer)

Input: a JSON file (or stdin) shaped as a list of per-document records:

    [
      {
        "label": "presentation algorithm spec",   # free-form, for your own reference
        "domain": "dev-wiki",                      # the grouping axis (wiki area, doc type)
        "candidates": [
          { "verdict": "o" },
          { "verdict": "x", "reason": "axis-mismatch" },   # reason: see X_REASONS below
          { "verdict": "△", "reason": "too-shallow" },
          ...
        ],
        "recommended_home_in_candidates": false    # Phase B recall signal (optional;
                                                    #   omit when Phase B was not run)
      },
      ...
    ]

The `reason` on a candidate is free-form but, to feed the x-by-reason table, an x should
use one of the SKILL.md principle tags (clear-misplacement / axis-mismatch / personal-area
/ vague-catch-all / too-deep). Unknown/blank reasons fall into "(unspecified)".

Usage:
    python aggregate.py verdicts.json            # read a file
    python aggregate.py < verdicts.json          # read stdin

Output: a per-domain table (usable-rate, o/△/x candidate rates, recall-miss rate) plus an
overall row, then an x-by-reason breakdown. No absolute scoring anywhere.
"""

import argparse
import json
import sys
from collections import Counter, defaultdict

O = "o"
TRIANGLE = "△"
X = "x"
USABLE = {O, TRIANGLE}  # both o and △ are "usable" (△ = usable but improvable)
VALID_VERDICTS = {O, TRIANGLE, X}

# Canonical x reasons (SKILL.md principles). Free-form is tolerated; these just order the table.
X_REASONS = ["clear-misplacement", "axis-mismatch", "personal-area", "vague-catch-all", "too-deep"]


def load_records(path):
    raw = sys.stdin.read() if path is None else open(path, encoding="utf-8").read()
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("input must be a JSON list of per-document records")
    return data


def normalize_verdict(v):
    # accept ASCII fallbacks so a sheet typed without the triangle glyph still parses
    if v in ("△", "tri", "triangle", "delta"):
        return TRIANGLE
    if v in ("o", "O", "○", "0"):  # '○' full-width and stray '0' both mean usable
        return O
    if v in ("x", "X", "×"):
        return X
    return v


def validate(rec, index):
    cands = rec.get("candidates")
    if not isinstance(cands, list):
        raise ValueError(f"record {index}: 'candidates' must be a list, got {cands!r}")
    for j, c in enumerate(cands):
        v = normalize_verdict(c.get("verdict"))
        if v not in VALID_VERDICTS:
            raise ValueError(
                f"record {index} candidate {j}: verdict must be one of o/△/x, "
                f"got {c.get('verdict')!r}"
            )


def summarize(records):
    """Return a stats dict for one group of per-document records."""
    docs = len(records)
    all_cands = [normalize_verdict(c.get("verdict")) for r in records for c in r["candidates"]]
    n_cands = len(all_cands)

    def doc_has_usable(r):
        return any(normalize_verdict(c.get("verdict")) in USABLE for c in r["candidates"])

    usable_docs = sum(1 for r in records if doc_has_usable(r))

    # recall miss: Phase B's recommended home was NOT among the proposals.
    # only counts docs that carry the (optional) signal.
    recall_docs = [r for r in records if "recommended_home_in_candidates" in r]
    recall_misses = sum(1 for r in recall_docs if not r["recommended_home_in_candidates"])

    def rate(n, d):
        return n / d if d else 0.0

    return {
        "documents": docs,
        "usable_rate": rate(usable_docs, docs),         # >=1 o/△ candidate (precision-side)
        "candidates": n_cands,
        "o_rate": rate(all_cands.count(O), n_cands),
        "tri_rate": rate(all_cands.count(TRIANGLE), n_cands),
        "x_rate": rate(all_cands.count(X), n_cands),
        "recall_miss_rate": rate(recall_misses, len(recall_docs)) if recall_docs else None,
    }


def x_reason_counts(records):
    counts = Counter()
    for r in records:
        for c in r["candidates"]:
            if normalize_verdict(c.get("verdict")) == X:
                reason = (c.get("reason") or "").strip() or "(unspecified)"
                counts[reason] += 1
    return counts


def fmt(value):
    if value is None:
        # ASCII placeholder: a Windows cp932 console cannot encode an em-dash.
        return "n/a"
    if isinstance(value, float):
        return f"{value:.0%}"
    return str(value)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("path", nargs="?", help="verdicts JSON file (default: stdin)")
    args = parser.parse_args()

    records = load_records(args.path)
    for i, r in enumerate(records):
        validate(r, i)

    groups = defaultdict(list)
    for r in records:
        groups[r.get("domain", "(no domain)")].append(r)

    columns = [
        ("domain", "domain"),
        ("documents", "docs"),
        ("usable_rate", "usable"),     # precision-side: >=1 o/△
        ("candidates", "cands"),
        ("o_rate", "o"),
        ("tri_rate", "tri"),
        ("x_rate", "x"),
        ("recall_miss_rate", "recall-miss"),
    ]

    rows = []
    for domain in sorted(groups):
        stats = summarize(groups[domain])
        stats["domain"] = domain
        rows.append(stats)
    overall = summarize(records)
    overall["domain"] = "ALL"
    rows.append(overall)

    widths = {
        key: max(len(header), max(len(fmt(r.get(key))) for r in rows))
        for key, header in columns
    }
    print("  ".join(header.ljust(widths[key]) for key, header in columns))
    print("  ".join("-" * widths[key] for key, _ in columns))
    for r in rows:
        print("  ".join(fmt(r.get(key)).ljust(widths[key]) for key, _ in columns))

    # x-by-reason: which principle is sending candidates to x (where to fix suggest-path).
    reasons = x_reason_counts(records)
    if reasons:
        print()
        print("x by reason (overall):")
        ordered = [k for k in X_REASONS if k in reasons] + sorted(
            k for k in reasons if k not in X_REASONS
        )
        rwidth = max(len(k) for k in ordered)
        for k in ordered:
            print(f"  {k.ljust(rwidth)}  {reasons[k]}")

    print()
    print("usable-rate is precision-side (>=1 usable candidate); it cannot see a good place")
    print("suggest-path never proposed. recall-miss (Phase B) is the recall signal: a better")
    print("home existed that was not among the proposals.")


if __name__ == "__main__":
    main()
