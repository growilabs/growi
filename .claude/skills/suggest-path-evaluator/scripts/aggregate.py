#!/usr/bin/env python3
"""Aggregate per-document evaluator verdicts into per-domain hit-rate / rank stats.

This turns the rankings produced by the suggest-path-evaluator skill into the numbers
a human uses to find weak wiki domains. It deliberately derives every number FROM THE
RANKINGS — it never reads an absolute "N out of 10" score, because absolute scores drift
between runs while relative rank does not.

Input: a JSON file (or stdin) shaped as a list of per-document verdicts:

    [
      {
        "label": "auto-scroll spec",     # free-form, for your own reference
        "domain": "dev-wiki",            # the grouping axis (wiki area, doc type, ...)
        "verdict": "hit",                # "hit" | "miss-reachable" | "miss-total"
        "rank": 1                        # 1-based position of the correct path; required
                                         #   when verdict == "hit", omit/None otherwise
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
MISS_REACHABLE = "miss-reachable"
MISS_TOTAL = "miss-total"
VALID_VERDICTS = {HIT, MISS_REACHABLE, MISS_TOTAL}


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
    if verdict == HIT:
        rank = entry.get("rank")
        if not isinstance(rank, int) or rank < 1:
            raise ValueError(
                f"entry {index}: a 'hit' needs a 1-based integer 'rank', got {rank!r}"
            )


def summarize(entries, top_n):
    """Return a stats dict for one group of verdicts."""
    total = len(entries)
    hits = [e for e in entries if e["verdict"] == HIT]
    top1 = sum(1 for e in hits if e["rank"] == 1)
    topn = sum(1 for e in hits if e["rank"] <= top_n)
    miss_reachable = sum(1 for e in entries if e["verdict"] == MISS_REACHABLE)
    miss_total = sum(1 for e in entries if e["verdict"] == MISS_TOTAL)
    mean_rank = sum(e["rank"] for e in hits) / len(hits) if hits else None

    def rate(n):
        return n / total if total else 0.0

    return {
        "documents": total,
        "top1_rate": rate(top1),
        f"top{top_n}_rate": rate(topn),
        "mean_rank_when_hit": mean_rank,
        "miss_reachable": miss_reachable,  # selection problem (parent/sibling proposed)
        "miss_total": miss_total,          # retrieval problem (correct page never reached)
    }


def fmt(value):
    if value is None:
        return "—"
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
        ("mean_rank_when_hit", "mean-rank"),
        ("miss_reachable", "miss-reach"),
        ("miss_total", "miss-total"),
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
