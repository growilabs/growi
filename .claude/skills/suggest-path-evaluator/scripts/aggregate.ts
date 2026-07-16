#!/usr/bin/env node
/**
 * Aggregate per-document evaluator verdicts (o / △ / x) into per-domain rates.
 *
 * This turns the per-candidate verdicts produced by the suggest-path-evaluator skill into
 * the numbers a human uses to find weak wiki domains and weak suggest-path behaviors. It
 * speaks the skill's CURRENT vocabulary — the plausibility-domain o/△/x marks (SKILL.md
 * "The judgement stance" / "Step 4. Report"), NOT the retired hit/near-miss/miss ranks.
 *
 * It derives every number FROM THE PER-CANDIDATE MARKS — there is no absolute "N out of 10"
 * score, because absolute scores drift between runs while the o/△/x marks do not.
 *
 * Verdict vocabulary (matches SKILL.md):
 *
 *   per candidate
 *     "o"   usable          — placing the document here is reasonable
 *     "△"   usable-improvable — usable, but the drilldown found a clearly better home
 *     "x"   not-usable      — clear mis-placement / axis-mismatch / personal-area / vague
 *
 *   per document (recall signal, from Phase B)
 *     recommended_home_in_candidates : boolean
 *         true  if Phase B's recommended home equals one of suggest-path's proposals
 *         false if suggest-path never proposed the place the drilldown judged best
 *               (= a recall miss: a better home existed that suggest-path didn't offer)
 *
 * Input: a JSON file (or stdin) shaped as a list of per-document records:
 *
 *     [
 *       {
 *         "label": "presentation algorithm spec",   // free-form, for your own reference
 *         "domain": "dev-wiki",                      // the grouping axis (wiki area, doc type)
 *         "candidates": [
 *           { "verdict": "o" },
 *           { "verdict": "x", "reason": "axis-mismatch" },   // reason: see X_REASONS below
 *           { "verdict": "△", "reason": "too-shallow" },
 *           ...
 *         ],
 *         "recommended_home_in_candidates": false    // Phase B recall signal (optional;
 *                                                    //   omit when Phase B was not run)
 *       },
 *       ...
 *     ]
 *
 * The `reason` on a candidate is free-form but, to feed the x-by-reason table, an x should
 * use one of the SKILL.md principle tags (clear-misplacement / axis-mismatch / personal-area
 * / vague-catch-all / too-deep). Unknown/blank reasons fall into "(unspecified)".
 *
 * Usage (Node >= 23.6 runs TypeScript natively; on 22.6+ add --experimental-strip-types):
 *     node aggregate.ts verdicts.json            # read a file
 *     node aggregate.ts < verdicts.json          # read stdin
 *
 * Output: a per-domain table (usable-rate, o/△/x candidate rates, recall-miss rate) plus an
 * overall row, then an x-by-reason breakdown. No absolute scoring anywhere.
 */

import { readFileSync } from 'node:fs';

interface Candidate {
  verdict?: string;
  reason?: string;
}

interface DocumentRecord {
  label?: string;
  domain?: string;
  candidates: Candidate[];
  recommended_home_in_candidates?: boolean;
}

interface GroupStats {
  documents: number;
  usable_rate: number;
  candidates: number;
  o_rate: number;
  tri_rate: number;
  x_rate: number;
  recall_miss_rate: number | null;
}

type Row = GroupStats & { domain: string };

const O = 'o';
const TRIANGLE = '△';
const X = 'x';
const USABLE = new Set([O, TRIANGLE]); // both o and △ are "usable" (△ = usable but improvable)
const VALID_VERDICTS = new Set([O, TRIANGLE, X]);

// Canonical x reasons (SKILL.md principles). Free-form is tolerated; these just order the table.
const X_REASONS = ['clear-misplacement', 'axis-mismatch', 'personal-area', 'vague-catch-all', 'too-deep'];

function loadRecords(path: string | undefined): DocumentRecord[] {
  // fd 0 = stdin; works on Windows too
  const raw = readFileSync(path ?? 0, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('input must be a JSON list of per-document records');
  }
  // shape is enforced by validate() before any aggregation
  return data as DocumentRecord[];
}

function normalizeVerdict(v: string | undefined): string | undefined {
  // accept ASCII fallbacks so a sheet typed without the triangle glyph still parses
  if (v === undefined) return v;
  if (['△', 'tri', 'triangle', 'delta'].includes(v)) return TRIANGLE;
  if (['o', 'O', '○', '0'].includes(v)) return O; // '○' full-width and stray '0' both mean usable
  if (['x', 'X', '×'].includes(v)) return X;
  return v;
}

function validate(rec: DocumentRecord, index: number): void {
  const cands = rec.candidates;
  if (!Array.isArray(cands)) {
    throw new Error(`record ${index}: 'candidates' must be a list, got ${JSON.stringify(cands)}`);
  }
  cands.forEach((c, j) => {
    const v = normalizeVerdict(c.verdict);
    if (v === undefined || !VALID_VERDICTS.has(v)) {
      throw new Error(
        `record ${index} candidate ${j}: verdict must be one of o/△/x, got ${JSON.stringify(c.verdict)}`,
      );
    }
  });
}

/** Return a stats object for one group of per-document records. */
function summarize(records: DocumentRecord[]): GroupStats {
  const docs = records.length;
  const allCands = records.flatMap((r) => r.candidates.map((c) => normalizeVerdict(c.verdict)));
  const nCands = allCands.length;

  const docHasUsable = (r: DocumentRecord): boolean => (
    r.candidates.some((c) => USABLE.has(normalizeVerdict(c.verdict) ?? ''))
  );
  const usableDocs = records.filter(docHasUsable).length;

  // recall miss: Phase B's recommended home was NOT among the proposals.
  // only counts docs that carry the (optional) signal.
  const recallDocs = records.filter((r) => 'recommended_home_in_candidates' in r);
  const recallMisses = recallDocs.filter((r) => !r.recommended_home_in_candidates).length;

  const rate = (n: number, d: number): number => (d ? n / d : 0);
  const count = (verdict: string): number => allCands.filter((v) => v === verdict).length;

  return {
    documents: docs,
    usable_rate: rate(usableDocs, docs), // >=1 o/△ candidate (precision-side)
    candidates: nCands,
    o_rate: rate(count(O), nCands),
    tri_rate: rate(count(TRIANGLE), nCands),
    x_rate: rate(count(X), nCands),
    recall_miss_rate: recallDocs.length ? rate(recallMisses, recallDocs.length) : null,
  };
}

function xReasonCounts(records: DocumentRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    for (const c of r.candidates) {
      if (normalizeVerdict(c.verdict) === X) {
        const reason = (c.reason ?? '').trim() || '(unspecified)';
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }
  }
  return counts;
}

// Column kinds drive formatting: 'rate' renders as a percentage, everything else verbatim.
interface Column {
  key: keyof Row;
  header: string;
  kind: 'str' | 'int' | 'rate';
}

const COLUMNS: Column[] = [
  { key: 'domain', header: 'domain', kind: 'str' },
  { key: 'documents', header: 'docs', kind: 'int' },
  { key: 'usable_rate', header: 'usable', kind: 'rate' }, // precision-side: >=1 o/△
  { key: 'candidates', header: 'cands', kind: 'int' },
  { key: 'o_rate', header: 'o', kind: 'rate' },
  { key: 'tri_rate', header: 'tri', kind: 'rate' },
  { key: 'x_rate', header: 'x', kind: 'rate' },
  { key: 'recall_miss_rate', header: 'recall-miss', kind: 'rate' },
];

function fmt(value: string | number | null, kind: Column['kind']): string {
  if (value == null) {
    // ASCII placeholder: a Windows cp932 console cannot encode an em-dash.
    return 'n/a';
  }
  if (kind === 'rate' && typeof value === 'number') {
    return `${Math.round(value * 100)}%`;
  }
  return String(value);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('usage: node aggregate.ts [verdicts.json]   (default: stdin)');
    console.log('See the header comment of this file for the input shape.');
    return;
  }
  const path = argv[0];

  const records = loadRecords(path);
  records.forEach((r, i) => validate(r, i));

  const groups = new Map<string, DocumentRecord[]>();
  for (const r of records) {
    const domain = r.domain ?? '(no domain)';
    const group = groups.get(domain) ?? [];
    group.push(r);
    groups.set(domain, group);
  }

  const rows: Row[] = [];
  for (const domain of [...groups.keys()].sort()) {
    rows.push({ ...summarize(groups.get(domain) ?? []), domain });
  }
  rows.push({ ...summarize(records), domain: 'ALL' });

  const widths = new Map<string, number>();
  for (const { key, header, kind } of COLUMNS) {
    widths.set(key, Math.max(header.length, ...rows.map((r) => fmt(r[key], kind).length)));
  }
  const width = (key: string): number => widths.get(key) ?? 0;
  console.log(COLUMNS.map(({ key, header }) => header.padEnd(width(key))).join('  '));
  console.log(COLUMNS.map(({ key }) => '-'.repeat(width(key))).join('  '));
  for (const r of rows) {
    console.log(COLUMNS.map(({ key, kind }) => fmt(r[key], kind).padEnd(width(key))).join('  '));
  }

  // x-by-reason: which principle is sending candidates to x (where to fix suggest-path).
  const reasons = xReasonCounts(records);
  if (reasons.size > 0) {
    console.log();
    console.log('x by reason (overall):');
    const ordered = [
      ...X_REASONS.filter((k) => reasons.has(k)),
      ...[...reasons.keys()].filter((k) => !X_REASONS.includes(k)).sort(),
    ];
    const rwidth = Math.max(...ordered.map((k) => k.length));
    for (const k of ordered) {
      console.log(`  ${k.padEnd(rwidth)}  ${reasons.get(k)}`);
    }
  }

  console.log();
  console.log('usable-rate is precision-side (>=1 usable candidate); it cannot see a good place');
  console.log('suggest-path never proposed. recall-miss (Phase B) is the recall signal: a better');
  console.log('home existed that was not among the proposals.');
}

main();
