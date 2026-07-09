#!/usr/bin/env python3
"""Reconcile each document's body digest against the body it claims to describe.

This is the self-consistency gate from SKILL.md step 3 / Batch mode. It catches the
single most damaging batch error: judging document A but filing the reasoning under
document B (a "body swap"), which happens easily when documents are fanned out across
parallel sub-agents and one document's content bleeds into the next one's verdict.

It uses ONLY the bodies — no human answer key — so it works on any wiki and never leaks
ground truth into a blind judgment. It is a deterministic string check on purpose: an
LLM re-judging its own digests could drift the same way the original mistake did, so the
gate must be mechanical.

How it decides: for each document, every key term in the digest must actually appear in
that document's body. Terms are split on separators (`/ ( ) （ ） ・`) into atoms first,
so a compound term like "yjs/CRDT" or "自動保存(Draft)" passes when its parts are present
even though the literal joined string is not — this avoids false swap alarms from
formatting while still catching a digest that describes a different document entirely.

Input: a JSON file (or stdin) shaped as a list of per-document digests:

    [
      {
        "id": "bulk-01",                              # must match a body file name
        "subject": "...",                             # free-form, for your reference
        "key_terms": ["QuetionnaireOrder", "アンケートセンター", ...]
      },
      ...
    ]

Bodies are read from --bodies-dir as `<id>.md` (one file per document).

Usage:
    python reconcile-digests.py digests.json --bodies-dir ./bodies
    python reconcile-digests.py < digests.json --bodies-dir ./bodies
    python reconcile-digests.py digests.json --bodies-dir ./bodies --threshold 0.5  # tolerate partial digests

Output: a PASS line per document plus a final summary. Exit code is non-zero when any
document fails — wire it into the batch so a swap blocks aggregation until re-judged.
Quarantined ids are listed so they can be sent back through step 3.
"""

import argparse
import json
import re
import sys
from pathlib import Path

SEPARATORS = re.compile(r"[\/()（）・]")
# strip whitespace and a few punctuation marks so "smtp.gmail.com" vs "SMTP" style
# spacing/casing differences don't cause spurious misses; comparison is lowercase.
NOISE = re.compile(r"[\s（）()・,、。\-]")


def normalize(s: str) -> str:
    return NOISE.sub("", (s or "").lower())


def explode(term: str):
    """Split a compound key term into atoms; keep atoms of length >= 2.

    An atom is also dropped when it normalizes to the empty string (e.g. a
    symbol-only atom like "--" or "（）"): `"" in body` is always True, so such an
    atom would count as a spurious hit and let a body swap slip through the gate.
    """
    return [a.strip() for a in SEPARATORS.split(term)
            if len(a.strip()) >= 2 and normalize(a)]


def reconcile_one(digest: dict, body: str) -> dict:
    body_n = normalize(body)
    atoms = [a for t in (digest.get("key_terms") or []) for a in explode(t)]
    if not atoms:
        # a digest with no usable terms can't be verified — treat as a fail to force a redo
        return {"id": digest.get("id"), "ratio": 0.0, "hits": 0, "atoms": 0, "missing": []}
    hits = [a for a in atoms if normalize(a) in body_n]
    missing = [a for a in atoms if normalize(a) not in body_n]
    return {
        "id": digest.get("id"),
        "ratio": len(hits) / len(atoms),
        "hits": len(hits),
        "atoms": len(atoms),
        "missing": missing,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("digests", nargs="?", help="JSON file of per-document digests (default: stdin)")
    ap.add_argument("--bodies-dir", required=True, help="directory holding <id>.md body files")
    ap.add_argument("--threshold", type=float, default=1.0,
                    help="minimum fraction of key-term atoms that must appear in the body "
                         "(default 1.0 — every atom must appear, matching the SKILL.md gate; "
                         "lower it explicitly to tolerate partial digests)")
    args = ap.parse_args()

    raw = Path(args.digests).read_text(encoding="utf-8") if args.digests else sys.stdin.read()
    digests = json.loads(raw)
    bodies_dir = Path(args.bodies_dir)

    results = []
    for d in digests:
        body_path = bodies_dir / f"{d['id']}.md"
        if not body_path.exists():
            results.append({"id": d.get("id"), "ratio": None, "hits": 0, "atoms": 0,
                            "missing": [], "error": f"body file not found: {body_path}"})
            continue
        results.append(reconcile_one(d, body_path.read_text(encoding="utf-8")))

    failed = []
    for r in sorted(results, key=lambda x: (x["ratio"] is not None, x["ratio"] if x["ratio"] is not None else -1)):
        if r.get("error"):
            print(f"ERROR  {r['id']}: {r['error']}")
            failed.append(r["id"])
            continue
        ok = r["ratio"] >= args.threshold
        tag = "PASS " if ok else "FAIL "
        line = f"{tag} {r['id']}  {r['hits']}/{r['atoms']} ({r['ratio']*100:.0f}%)"
        if not ok:
            line += f"  missing: {', '.join(r['missing'][:6])}"
        print(line)
        if not ok:
            failed.append(r["id"])

    print()
    total = len(results)
    print(f"reconciled {total} documents; {total - len(failed)} pass, {len(failed)} suspected body swap")
    if failed:
        print("quarantine (re-run step 3 on these in isolation, then re-reconcile):")
        print("  " + " ".join(failed))
        sys.exit(1)
    # ASCII only: a Windows cp932 console cannot encode an em-dash.
    print("all digests consistent with their bodies - no body swap, safe to aggregate")


if __name__ == "__main__":
    main()
