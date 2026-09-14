import { describe, expect, it } from 'vitest';

import { SUMMARIZE_INSTRUCTIONS } from './instructions';

// The instructions text is the sole behavioral contract for the LLM. These
// assertions check that the four mandated policies (design.md "SummarizeAgent"
// Responsibilities & Constraints, points a-d) are present as concrete
// instructions, not that the LLM actually follows them (that is outside what
// a unit test can prove — see design.md's LLM Test Double Strategy).
//
// Each assertion below targets a PHRASE that spans the discriminating
// semantics (not a bare keyword), so a mutation that inverts or deletes the
// instruction's meaning turns the test RED even when the keyword itself
// survives elsewhere in the text. Verified by mutation-testing this suite
// against the implementation (see the task's review round 2 remediation):
// inverting "omit offset on the first call", deleting the
// hasMore===undefined warning, and deleting the totalLines-is-not-a-stop-
// condition bullet each independently turn at least one assertion RED.
describe('SUMMARIZE_INSTRUCTIONS', () => {
  it('instructs to omit offset specifically on the first call (not merely mentioning "offset" and "first call" separately)', () => {
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(/first call,?\s*omit\s+`?offset`?/i);
  });

  it('instructs that a call returning only the outline means nothing has been read yet, not that reading is finished', () => {
    // Targets the specific negation: hasMore === undefined must NOT be read
    // as "finished". A mutation that deletes this warning (leaving only the
    // generic mentions of "outline"/"hasMore" elsewhere) turns this RED.
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(
      /do not treat `?hasMore === undefined`? as ("finished reading"|finished reading)/i,
    );
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(
      /have not read any body content yet/i,
    );
  });

  it('instructs to add a call’s line count to the running total ONLY when content was returned', () => {
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(
      /only when that call returned `?content`?/i,
    );
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(
      /content`? is `?undefined`?[\s\S]{0,80}add zero/i,
    );
  });

  it('instructs the three stop conditions (hasMore false / limit_exceeded / not_found_or_forbidden) and no other', () => {
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(
      /exactly one of these three reasons, and no other/i,
    );
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(/hasMore.{0,10}is.{0,10}false/i);
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(/limit_exceeded/);
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(/not_found_or_forbidden/);
  });

  it('instructs to state that the summary is partial when limit_exceeded is received', () => {
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(
      /limit_exceeded[\s\S]{0,250}(partial|PARTIAL)/i,
    );
  });

  it('instructs the output format: one lead sentence plus 3-5 bullet points', () => {
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(/lead sentence|one[- ]sentence/i);
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(/3[-–]5|three to five/i);
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(/bullet/i);
  });

  it('instructs to respond in the user’s input language', () => {
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(/same language/i);
  });

  it('instructs that totalLines is never a stop condition by itself (not merely mentioning the word)', () => {
    // A text that merely mentions "totalLines" (e.g. even one that instructed
    // stopping at totalLines) must NOT satisfy this — the assertion targets
    // the explicit negative claim.
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(
      /never use `?totalLines`? itself as a stop condition/i,
    );
    // And the positive claim: totalLines is reference-only.
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(/reference-only/i);
  });

  it('instructs not to shortcut past reading the body just because the outline is available (design.md a-2/a-3)', () => {
    // Two independent anti-shortcut sentences, one per point in the reading
    // procedure. A mutation deleting either one (while leaving the generic
    // "outline" mentions elsewhere intact) must turn this RED.
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(
      /do not decide[\s\S]{0,15}the outline is enough/i,
    );
    expect(SUMMARIZE_INSTRUCTIONS).toMatch(
      /do not stop early just because the outline/i,
    );
  });
});
