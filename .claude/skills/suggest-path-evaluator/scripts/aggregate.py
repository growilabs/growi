#!/usr/bin/env python3
"""Aggregate per-document evaluator verdicts into per-domain hit-rate / rank stats.

This turns the rankings produced by the suggest-path-evaluator skill into the numbers
a human uses to find weak wiki domains. It deliberately derives every number FROM THE
RANKINGS — it never reads an absolute "N out of 10" score, because absolute scores drift
between runs while relative rank does not.

Verdict vocabulary (matches SKILL.md step 4):

  has-sibling world (a home already exists in the tree)
    "hit"            correct save location is among the proposals; needs "rank"
    "near-miss"      a proposal is an ancestor/descendant of the correct location —
                     right neighborhood, wrong depth (the dominant real failure:
                     stopping at the category instead of the topic page)
    "miss"           no proposal is the location or an ancestor/descendant of it

  no-sibling world (a brand-new path is the correct behavior)
    "hit-new"        proposed a sensible new path matching the intended new home
    "near-miss-new"  proposed a new path but at an off level/neighborhood
    "miss-misfiled"  forced the document into an existing location instead of a new one

Input: a JSON file (or stdin) shaped as a list of per-document verdicts:

    [
      {
        "label": "presentation algorithm spec",  # free-form, for your own reference
        "domain": "dev-wiki",                     # the grouping axis (wiki area, doc type)
        "verdict": "hit",                         # one of the seven above
        "rank": 1                                 # 1-based position of the correct save
                                                  #   location; REQUIRED for "hit",
                                                  #   omit/None for every other verdict
      },
      ...
    ]

Usage:
    python aggregate.py verdicts.json            # read a file
    python aggregate.py < verdicts.json          # read stdin
    python aggregate.py verdicts.json --top-n 3  # change the top-N cutoff (default 3)

Output: a per-domain table plus an overall row. No absolute scoring anywhere.
"""

import argparse
import json
import sys
from collections import defaultdict

HIT = "hit"
NEAR_MISS = "near-miss"
MISS = "miss"
HIT_NEW = "hit-new"
NEAR_MISS_NEW = "near-miss-new"
MISS_MISFILED = "miss-misfiled"

# Verdicts that carry a numeric rank (only the has-sibling exact hit does).
RANKED_VERDICTS = {HIT}
VALID_VERDICTS = {HIT, NEAR_MISS, MISS, HIT_NEW, NEAR_MISS_NEW, MISS_MISFILED}


def load_verdicts(path):
    raw = sys.stdin.read() if path is None else open(path, encoding="utf-8").read()
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("input must be a JSON list of verdict objects")
    return data


def validate(entry, index):
    verdict = entry.get("verdict")
    if verdict not in VALID_VERDICTS:
        raise ValueError(
            f"entry {index}: verdict must be one of {sorted(VALID_VERDICTS)}, "
            f"got {verdict!r}"
        )
    if verdict in RANKED_VERDICTS:
        rank = entry.get("rank")
        if not isinstance(rank, int) or rank < 1:
            raise ValueError(
                f"entry {index}: a {verdict!r} needs a 1-based integer 'rank', "
                f"got {rank!r}"
            )


def summarize(entries, top_n):
    """Return a stats dict for one group of verdicts."""
    total = len(entries)
    ranked_hits = [e for e in entries if e["verdict"] in RANKED_VERDICTS]
    top1 = sum(1 for e in ranked_hits if e["rank"] == 1)
    topn = sum(1 for e in ranked_hits if e["rank"] <= top_n)
    mean_rank = (
        sum(e["rank"] for e in ranked_hits) / len(ranked_hits) if ranked_hits else None
    )

    def count(verdict):
        return sum(1 for e in entries if e["verdict"] == verdict)

    def rate(n):
        return n / total if total else 0.0

    return {
        "documents": total,
        "top1_rate": rate(top1),
        f"top{top_n}_rate": rate(topn),
        "hit_new": count(HIT_NEW),
        "mean_rank_when_hit": mean_rank,
        "near_miss": count(NEAR_MISS) + count(NEAR_MISS_NEW),
        "miss": count(MISS),
        "misfiled": count(MISS_MISFILED),
    }


def fmt(value):
    if value is None:
        # ASCII placeholder: a Windows cp932 console cannot encode an em-dash.
        return "-"
    if isinstance(value, float):
        return f"{value:.0%}" if value <= 1.0 else f"{value:.2f}"
    return str(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", help="verdicts JSON file (default: stdin)")
    parser.add_argument("--top-n", type=int, default=3, help="top-N cutoff (default 3)")
    args = parser.parse_args()

    entries = load_verdicts(args.path)
    for i, e in enumerate(entries):
        validate(e, i)

    groups = defaultdict(list)
    for e in entries:
        groups[e.get("domain", "(no domain)")].append(e)

    top_n = args.top_n
    topn_key = f"top{top_n}_rate"
    columns = [
        ("domain", "domain"),
        ("documents", "docs"),
        ("top1_rate", "top1"),
        (topn_key, f"top{top_n}"),
        ("hit_new", "hit-new"),
        ("mean_rank_when_hit", "mean-rank"),
        ("near_miss", "near-miss"),
        ("miss", "miss"),
        ("misfiled", "misfiled"),
    ]

    rows = []
    for domain in sorted(groups):
        stats = summarize(groups[domain], top_n)
        stats["domain"] = domain
        rows.append(stats)
    overall = summarize(entries, top_n)
    overall["domain"] = "ALL"
    rows.append(overall)

    widths = {
        key: max(len(header), max(len(fmt(r.get(key))) for r in rows))
        for key, header in columns
    }
    header_line = "  ".join(header.ljust(widths[key]) for key, header in columns)
    print(header_line)
    print("  ".join("-" * widths[key] for key, _ in columns))
    for r in rows:
        print("  ".join(fmt(r.get(key)).ljust(widths[key]) for key, _ in columns))


if __name__ == "__main__":
    main()
