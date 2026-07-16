#!/usr/bin/env node
/**
 * Reconcile each document's body digest against the body it claims to describe.
 *
 * This is the self-consistency gate from SKILL.md step 3 / Batch mode. It catches the
 * single most damaging batch error: judging document A but filing the reasoning under
 * document B (a "body swap"), which happens easily when documents are fanned out across
 * parallel sub-agents and one document's content bleeds into the next one's verdict.
 *
 * It uses ONLY the bodies — no human answer key — so it works on any wiki and never leaks
 * ground truth into a blind judgment. It is a deterministic string check on purpose: an
 * LLM re-judging its own digests could drift the same way the original mistake did, so the
 * gate must be mechanical.
 *
 * How it decides: for each document, every key term in the digest must actually appear in
 * that document's body. Terms are split on separators (`/ ( ) （ ） ・`) into atoms first,
 * so a compound term like "yjs/CRDT" or "自動保存(Draft)" passes when its parts are present
 * even though the literal joined string is not — this avoids false swap alarms from
 * formatting while still catching a digest that describes a different document entirely.
 *
 * Input: a JSON file (or stdin) shaped as a list of per-document digests:
 *
 *     [
 *       {
 *         "id": "bulk-01",                              // must match a body file name
 *         "subject": "...",                             // free-form, for your reference
 *         "key_terms": ["QuetionnaireOrder", "アンケートセンター", ...]
 *       },
 *       ...
 *     ]
 *
 * Bodies are read from --bodies-dir as `<id>.md` (one file per document).
 *
 * Usage:
 *     node reconcile-digests.mjs digests.json --bodies-dir ./bodies
 *     node reconcile-digests.mjs < digests.json --bodies-dir ./bodies
 *     node reconcile-digests.mjs digests.json --bodies-dir ./bodies --threshold 0.5  # tolerate partial digests
 *
 * Output: a PASS line per document plus a final summary. Exit code is non-zero when any
 * document fails — wire it into the batch so a swap blocks aggregation until re-judged.
 * Quarantined ids are listed so they can be sent back through step 3.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEPARATORS = /[/()（）・]/;
// strip whitespace and a few punctuation marks so "smtp.gmail.com" vs "SMTP" style
// spacing/casing differences don't cause spurious misses; comparison is lowercase.
const NOISE = /[\s（）()・,、。-]/g;

function normalize(s) {
  return (s ?? '').toLowerCase().replace(NOISE, '');
}

/**
 * Split a compound key term into atoms; keep atoms of length >= 2.
 *
 * An atom is also dropped when it normalizes to the empty string (e.g. a
 * symbol-only atom like "--" or "（）"): `body.includes('')` is always true, so such an
 * atom would count as a spurious hit and let a body swap slip through the gate.
 */
function explode(term) {
  return term
    .split(SEPARATORS)
    .map((a) => a.trim())
    .filter((a) => a.length >= 2 && normalize(a));
}

function reconcileOne(digest, body) {
  const bodyN = normalize(body);
  const atoms = (digest.key_terms ?? []).flatMap((t) => explode(t));
  if (atoms.length === 0) {
    // a digest with no usable terms can't be verified — treat as a fail to force a redo
    return { id: digest.id, ratio: 0, hits: 0, atoms: 0, missing: [] };
  }
  const missing = atoms.filter((a) => !bodyN.includes(normalize(a)));
  const hits = atoms.length - missing.length;
  return {
    id: digest.id,
    ratio: hits / atoms.length,
    hits,
    atoms: atoms.length,
    missing,
  };
}

function printUsage() {
  console.log('usage: node reconcile-digests.mjs [digests.json] --bodies-dir <dir> [--threshold <0..1>]');
  console.log('  digests.json defaults to stdin. See the header comment of this file for the input shape.');
}

function parseArgs(argv) {
  const args = { digests: null, bodiesDir: null, threshold: 1.0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      printUsage();
      process.exit(0);
    }
    else if (a === '--bodies-dir') {
      args.bodiesDir = argv[++i];
    }
    else if (a.startsWith('--bodies-dir=')) {
      args.bodiesDir = a.slice('--bodies-dir='.length);
    }
    else if (a === '--threshold') {
      args.threshold = Number(argv[++i]);
    }
    else if (a.startsWith('--threshold=')) {
      args.threshold = Number(a.slice('--threshold='.length));
    }
    else {
      args.digests = a;
    }
  }
  if (!args.bodiesDir) {
    console.error('error: --bodies-dir is required');
    printUsage();
    process.exit(2);
  }
  if (Number.isNaN(args.threshold)) {
    console.error('error: --threshold must be a number');
    process.exit(2);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  // fd 0 = stdin; works on Windows too
  const raw = readFileSync(args.digests ?? 0, 'utf-8');
  const digests = JSON.parse(raw);

  const results = [];
  for (const d of digests) {
    const bodyPath = join(args.bodiesDir, `${d.id}.md`);
    if (!existsSync(bodyPath)) {
      results.push({
        id: d.id, ratio: null, hits: 0, atoms: 0, missing: [], error: `body file not found: ${bodyPath}`,
      });
      continue;
    }
    results.push(reconcileOne(d, readFileSync(bodyPath, 'utf-8')));
  }

  // errors (ratio: null) first, then ascending ratio — worst offenders at the top
  results.sort((a, b) => {
    const aHas = a.ratio != null ? 1 : 0;
    const bHas = b.ratio != null ? 1 : 0;
    if (aHas !== bHas) return aHas - bHas;
    return (a.ratio ?? -1) - (b.ratio ?? -1);
  });

  const failed = [];
  for (const r of results) {
    if (r.error) {
      console.log(`ERROR  ${r.id}: ${r.error}`);
      failed.push(r.id);
      continue;
    }
    const ok = r.ratio >= args.threshold;
    const tag = ok ? 'PASS ' : 'FAIL ';
    let line = `${tag} ${r.id}  ${r.hits}/${r.atoms} (${Math.round(r.ratio * 100)}%)`;
    if (!ok) {
      line += `  missing: ${r.missing.slice(0, 6).join(', ')}`;
      failed.push(r.id);
    }
    console.log(line);
  }

  console.log();
  const total = results.length;
  console.log(`reconciled ${total} documents; ${total - failed.length} pass, ${failed.length} suspected body swap`);
  if (failed.length > 0) {
    console.log('quarantine (re-run step 3 on these in isolation, then re-reconcile):');
    console.log(`  ${failed.join(' ')}`);
    process.exit(1);
  }
  // ASCII only: a Windows cp932 console cannot encode an em-dash.
  console.log('all digests consistent with their bodies - no body swap, safe to aggregate');
}

main();
