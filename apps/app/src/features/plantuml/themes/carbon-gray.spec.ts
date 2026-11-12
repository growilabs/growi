import { encode } from 'plantuml-encoder';

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

// Composed theme lengths before the minify step; see .kiro/specs/plantuml/research.md.
const PRE_MINIFY_THEME_LENGTH = { light: 14581, dark: 14589 } as const;

// Longest total GET URL public plantuml.com accepted with browser-like headers;
// see .kiro/specs/plantuml/research.md.
const PUBLIC_PLANTUML_RELIABLE_GET_URL_LENGTH = 7022;
const PUBLIC_PLANTUML_SVG_URL_PREFIX = 'https://www.plantuml.com/plantuml/svg/';

const modes = [
  ['light', carbonGrayLightStyles],
  ['dark', carbonGrayDarkStyles],
] as const;

describe.each(modes)('carbon-gray %s theme size', (mode, styles) => {
  it('is shorter than before minification', () => {
    expect(styles.length).toBeLessThan(PRE_MINIFY_THEME_LENGTH[mode]);
  });
});

// Deterministic PRNG (mulberry32) so the fictitious diagram never changes.
const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const LOWER = 'abcdefghijklmnopqrstuvwxyz';

// A fictitious class diagram sized like a large real-world diagram:
// 3 namespaces x 6 classes (3 fields, 2 methods each) and 17 associations.
const createLongClassDiagram = (): string => {
  const random = createRandom(1);
  const word = (min: number, max: number): string => {
    const length = min + Math.floor(random() * (max - min + 1));
    let result = '';
    for (let i = 0; i < length; i++) {
      result += LOWER[Math.floor(random() * LOWER.length)];
    }
    return result;
  };
  const capitalize = (w: string): string => w[0].toUpperCase() + w.slice(1);
  const identifier = (): string => word(3, 7) + capitalize(word(3, 7));
  const typeName = (): string =>
    capitalize(word(3, 8)) + capitalize(word(3, 8));

  const lines = ['@startuml'];
  const qualifiedNames: string[] = [];
  for (let n = 0; n < 3; n++) {
    const namespace = `${word(4, 8)}.${word(4, 8)}`;
    lines.push(`namespace ${namespace} {`);
    for (let c = 0; c < 6; c++) {
      const className = typeName();
      qualifiedNames.push(`${namespace}.${className}`);
      lines.push(`  class ${className} {`);
      for (let f = 0; f < 3; f++) {
        lines.push(`    -${identifier()} : ${typeName()}`);
      }
      for (let m = 0; m < 2; m++) {
        lines.push(
          `    +${identifier()}(${identifier()} : ${typeName()}) : ${typeName()}`,
        );
      }
      lines.push('  }');
    }
    lines.push('}');
  }
  for (let i = 1; i < qualifiedNames.length; i++) {
    const target = Math.floor(random() * i);
    lines.push(`${qualifiedNames[i]} --> ${qualifiedNames[target]}`);
  }
  lines.push('@enduml');
  return lines.join('\n');
};

const ordinaryDiagram = [
  '@startuml',
  'Alice -> Bob : Authentication Request',
  'Bob --> Alice : Authentication Response',
  'Alice -> Bob : Another request',
  'Bob --> Alice : Another response',
  '@enduml',
].join('\n');

const longDiagram = createLongClassDiagram();

const diagrams = [
  ['ordinary', ordinaryDiagram],
  ['long', longDiagram],
] as const;

// Composed the same way as services/plantuml.ts does before encoding.
const toGetUrl = (themeStyles: string, diagram: string): string =>
  `${PUBLIC_PLANTUML_SVG_URL_PREFIX}${encode(`${themeStyles}\n${diagram}`)}`;

describe('long fictitious diagram fixture', () => {
  it('is large enough to be a meaningful regression guard', () => {
    expect(
      encode(longDiagram).length + PUBLIC_PLANTUML_SVG_URL_PREFIX.length,
    ).toBeGreaterThan(3000);
  });
});

describe.each(modes)('carbon-gray %s GET URL length', (_mode, styles) => {
  it.each(
    diagrams,
  )('keeps the %s diagram within the public plantuml.com limit', (_label, diagram) => {
    expect(toGetUrl(styles, diagram).length).toBeLessThanOrEqual(
      PUBLIC_PLANTUML_RELIABLE_GET_URL_LENGTH,
    );
  });
});
