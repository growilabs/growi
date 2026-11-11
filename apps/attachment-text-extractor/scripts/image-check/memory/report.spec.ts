import {
  answerProblems,
  type BaselineMeasurement,
  childPeakOfRequest,
  extractLogLines,
  failuresOf,
  type LoadRun,
  type Measurements,
  toMarkdown,
  warningsOf,
} from './report';

// Req 3.14 / 11.2 (tasks 6.12): what the memory measurement decides from its
// numbers. Only the spec's budget fails the check: the container stays within
// 2 Gi (2,048 MiB) under the heaviest loads. The two baseline files against
// 0.95 x MAX_CHILD_RSS_MB (304 MB) is a warning: the margin there is smaller
// than the difference between machines. research.md 20.10, 20.12.

const loadRun = (scenario: 'S1' | 'S2', highestMib: number): LoadRun => ({
  scenario,
  idleMib: 70,
  highestMib,
  workingSetHighestMib: null,
  unexpected: [],
});

const baseline = (
  file: BaselineMeasurement['file'],
  childPeakRssMb: readonly (number | null)[],
): BaselineMeasurement => ({ file, childPeakRssMb });

const withinLimits = (): Measurements => ({
  where: 'inside the image',
  loadRuns: [
    ...[1200, 1210, 1220].map((mib) => loadRun('S1', mib)),
    ...[1250, 1260, 2048].map((mib) => loadRun('S2', mib)),
  ],
  baselines: [
    baseline('xlsx-70000-cells', [290, 291, 304]),
    baseline('docx-12-images-48mb', [270, 281, 280]),
    baseline('pdf-2-million-characters', [305, 306, 306]),
  ],
});

const overTheLine = (file: BaselineMeasurement['file']): Measurements => {
  const measured = withinLimits();
  return {
    ...measured,
    baselines: measured.baselines.map((entry) =>
      entry.file === file ? baseline(file, [290, 305, 290]) : entry,
    ),
  };
};

describe('failuresOf', () => {
  it('finds nothing wrong when every value is at or under its limit', () => {
    expect(failuresOf(withinLimits())).toEqual([]);
  });

  it.each([
    'S1',
    'S2',
  ] as const)('reports %s when one run goes over 2,048 MiB', (scenario) => {
    const measured = withinLimits();
    const failures = failuresOf({
      ...measured,
      loadRuns: [...measured.loadRuns, loadRun(scenario, 2049)],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(scenario);
    expect(failures[0]).toContain('2049');
  });

  it.each([
    'xlsx-70000-cells',
    'docx-12-images-48mb',
  ] as const)('does not fail when one run puts the child of %s over 304 MB', (file) => {
    expect(failuresOf(overTheLine(file))).toEqual([]);
  });

  it('does not hold the 2-million-character PDF to the 304 MB line', () => {
    const measured = withinLimits();
    const failures = failuresOf({
      ...measured,
      baselines: measured.baselines.map((entry) =>
        entry.file === 'pdf-2-million-characters'
          ? baseline(entry.file, [319, 319, 319])
          : entry,
      ),
    });

    expect(failures).toEqual([]);
  });

  it('reports a scenario measured fewer than three times', () => {
    const measured = withinLimits();
    const failures = failuresOf({
      ...measured,
      loadRuns: measured.loadRuns.slice(1),
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('S1');
  });

  it('reports a baseline file measured fewer than three times', () => {
    const measured = withinLimits();
    const failures = failuresOf({
      ...measured,
      baselines: [
        baseline('xlsx-70000-cells', [290, 291]),
        ...measured.baselines.slice(1),
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('xlsx-70000-cells');
  });

  it('reports a baseline file that is missing altogether', () => {
    const measured = withinLimits();
    const failures = failuresOf({
      ...measured,
      baselines: measured.baselines.slice(1),
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('xlsx-70000-cells');
  });

  it('reports a child peak RSS the service did not log', () => {
    const measured = withinLimits();
    const failures = failuresOf({
      ...measured,
      baselines: [
        baseline('xlsx-70000-cells', [290, null, 291]),
        ...measured.baselines.slice(1),
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('xlsx-70000-cells');
  });

  it('reports a run whose requests did not end as the scenario intends', () => {
    const measured = withinLimits();
    const failures = failuresOf({
      ...measured,
      loadRuns: [
        ...measured.loadRuns,
        { ...loadRun('S2', 900), unexpected: ['a.csv: 200, expected 422'] },
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('a.csv: 200, expected 422');
  });
});

describe('warningsOf', () => {
  it('has nothing to warn about when every child peak is at or under 304 MB', () => {
    expect(warningsOf(withinLimits())).toEqual([]);
  });

  it.each([
    'xlsx-70000-cells',
    'docx-12-images-48mb',
  ] as const)('warns about %s when one run puts the child over 304 MB', (file) => {
    const warnings = warningsOf(overTheLine(file));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(file);
    expect(warnings[0]).toContain('305');
    // One line each: it is printed as a GitHub Actions annotation.
    expect(warnings[0]).not.toContain('\n');
  });

  it('does not warn about the 2-million-character PDF', () => {
    expect(warningsOf(overTheLine('pdf-2-million-characters'))).toEqual([]);
  });

  it('does not warn about the heaviest loads: over 2,048 MiB is a failure', () => {
    const measured = withinLimits();

    expect(
      warningsOf({
        ...measured,
        loadRuns: [...measured.loadRuns, loadRun('S2', 2049)],
      }),
    ).toEqual([]);
  });
});

describe('toMarkdown', () => {
  it('says where the numbers were measured and sets them against the limits', () => {
    const text = toMarkdown({ ...withinLimits(), where: 'outside the image' });

    expect(text).toContain('outside the image');
    expect(text).toContain('2048');
    expect(text).toContain('1230');
    expect(text).toContain('304');
  });

  it('shows the highest value of each scenario, and how far S2 is from the Python figure', () => {
    const text = toMarkdown(withinLimits());

    expect(text).toMatch(/\| S1 [^\n]*\| 1220 \| - \| 828 \|/);
    // 2,048 is 818 MiB over Python's 1,230 and leaves no room.
    expect(text).toMatch(/\| S2 [^\n]*\| 2048 \| \+818 \| 0 \|/);
  });

  it('lists what is not met', () => {
    const measured = withinLimits();
    const text = toMarkdown({
      ...measured,
      loadRuns: [...measured.loadRuns, loadRun('S2', 2049)],
    });

    expect(text).toContain('NOT met');
    expect(text).toContain('2049');
  });

  it('says the result is met without any warning when nothing crossed a line', () => {
    const text = toMarkdown(withinLimits());

    expect(text).toContain('Result: within the limits.');
    expect(text).not.toContain('WARNING');
  });

  it('shows a child over 304 MB as a warning, in its row and under a result that is still met', () => {
    const text = toMarkdown(overTheLine('xlsx-70000-cells'));

    expect(text).not.toContain('NOT met');
    expect(text).toMatch(/\| xlsx-70000-cells [^\n]*OVER by 1 MB/);
    expect(text).not.toMatch(/\| docx-12-images-48mb [^\n]*OVER/);
    expect(text).toMatch(/WARNING[^\n]*\n- xlsx-70000-cells[^\n]*305/);
  });

  it('keeps the warning next to a failure', () => {
    const measured = overTheLine('docx-12-images-48mb');
    const text = toMarkdown({
      ...measured,
      loadRuns: [...measured.loadRuns, loadRun('S1', 2049)],
    });

    expect(text).toContain('NOT met');
    expect(text).toMatch(/WARNING[^\n]*\n- docx-12-images-48mb[^\n]*305/);
  });
});

describe('extractLogLines', () => {
  it('reads the result and the child peak RSS of each POST /extract line, in order', () => {
    const log = [
      '2026-11-11T00:00:00.000Z INFO listening on http://0.0.0.0:8000',
      '2026-11-11T00:00:01.000Z INFO extract format=xlsx size=400000 duration_ms=900 result=ok child_peak_rss_mb=291',
      '2026-11-11T00:00:02.000Z INFO extract format=csv size=8388608 duration_ms=700 result=memory_exceeded child_peak_rss_mb=340',
      '2026-11-11T00:00:03.000Z INFO extract format=txt size=1 duration_ms=1 result=service_busy child_peak_rss_mb=unknown',
      '',
    ].join('\n');

    expect(extractLogLines(log)).toEqual([
      { format: 'xlsx', result: 'ok', childPeakRssMb: 291 },
      { format: 'csv', result: 'memory_exceeded', childPeakRssMb: 340 },
      { format: 'txt', result: 'service_busy', childPeakRssMb: null },
    ]);
  });
});

describe('answerProblems', () => {
  const growing = {
    fileName: 'growing.csv',
    expectedStatus: 422,
    expectedInBody: 'memory_exceeded',
  };
  const stoppedByMemory =
    '{"code":"resource_limit_exceeded","message":"memory_exceeded: the document needs more memory than allowed"}';

  it('finds nothing wrong with the status and the marker the load intends', () => {
    expect(answerProblems(growing, 422, stoppedByMemory)).toEqual([]);
  });

  it('reports another status', () => {
    const problems = answerProblems(growing, 200, stoppedByMemory);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('growing.csv');
    expect(problems[0]).toContain('200');
  });

  // The same 422 for another reason: the child did not grow to the limit.
  it.each([
    'limit_exceeded: the document exceeds a processing limit',
    'result_too_large: the extracted text exceeds the allowed size',
  ])('reports a 422 that was not the memory limit (%s)', (message) => {
    const problems = answerProblems(
      growing,
      422,
      JSON.stringify({ code: 'resource_limit_exceeded', message }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('memory_exceeded');
    expect(problems[0]).toContain(message);
  });

  it('checks the status alone when no marker is expected', () => {
    const plain = { fileName: 'control.txt', expectedStatus: 200 };

    expect(answerProblems(plain, 200, null)).toEqual([]);
    expect(answerProblems(plain, 422, null)).toHaveLength(1);
  });
});

describe('childPeakOfRequest', () => {
  const line = (result: string, childPeakRssMb: number | null) => ({
    format: 'xlsx',
    result,
    childPeakRssMb,
  });
  const earlier = [line('ok', 281), line('ok', 280)];

  it('is the value of the one line the request added', () => {
    expect(childPeakOfRequest(2, [...earlier, line('ok', 291)])).toEqual({
      state: 'found',
      childPeakRssMb: 291,
    });
  });

  it('waits while the line of the request has not appeared', () => {
    expect(childPeakOfRequest(2, earlier)).toEqual({ state: 'waiting' });
  });

  it('has no value when the request did not end ok', () => {
    expect(
      childPeakOfRequest(2, [...earlier, line('memory_exceeded', 340)]),
    ).toEqual({ state: 'found', childPeakRssMb: null });
  });

  it('has no value when more than one line appeared', () => {
    expect(
      childPeakOfRequest(2, [...earlier, line('ok', 291), line('ok', 100)]),
    ).toEqual({ state: 'found', childPeakRssMb: null });
  });

  it('has no value when the service logged none for the request', () => {
    expect(childPeakOfRequest(2, [...earlier, line('ok', null)])).toEqual({
      state: 'found',
      childPeakRssMb: null,
    });
  });
});
