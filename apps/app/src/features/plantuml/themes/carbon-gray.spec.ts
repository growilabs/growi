import carbonGrayCommonStyles from './carbon-gray-common.puml';
import carbonGrayDarkStyles from './carbon-gray-dark.puml';
import carbonGrayLightStyles from './carbon-gray-light.puml';

const themes = [
  ['light', carbonGrayLightStyles],
  ['dark', carbonGrayDarkStyles],
  ['common', carbonGrayCommonStyles],
] as const;

describe.each(themes)('carbon-gray %s theme', (_name, styles) => {
  const lines = styles.split('\n');

  it('has no PlantUML comment lines', () => {
    expect(lines.filter((line) => line.trimStart().startsWith("'"))).toEqual(
      [],
    );
  });

  it('has no blank lines', () => {
    expect(lines.filter((line) => line.trim() === '')).toEqual([]);
  });

  it('has no lines with leading whitespace', () => {
    expect(lines.filter((line) => /^\s/.test(line))).toEqual([]);
  });
});

describe.each([
  ['light', carbonGrayLightStyles],
  ['dark', carbonGrayDarkStyles],
] as const)('carbon-gray %s composed theme', (_name, styles) => {
  it.each([
    'sequenceDiagram {',
    'timingDiagram {',
    'boardDiagram {',
    'ganttDiagram {',
    'jsonDiagram {',
    'mindmapDiagram {',
    'saltDiagram {',
    'wbsDiagram {',
    'wireDiagram {',
    'yamlDiagram {',
    'skinparam BoxPadding 30',
  ])('keeps the definition "%s"', (definition) => {
    const normalized = styles
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .join('\n');
    expect(normalized).toContain(definition);
  });

  it('does not declare skinparam ParticipantPadding / Padding', () => {
    expect(styles).not.toMatch(/skinparam\s+(ParticipantPadding|Padding)\b/);
  });
});
