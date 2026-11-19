import {
  copyOperands,
  execForm,
  finalStage,
  instructionsOf,
  parseDockerfile,
  runCommand,
} from './dockerfile-model';

const SAMPLE = [
  '# syntax=docker/dockerfile:1',
  'ARG NODE_VERSION=24.1.2',
  `FROM node:\${NODE_VERSION}-slim AS builder`,
  'RUN --mount=type=cache,target=/pnpm/store \\',
  '  # pnpm install --not-run \\',
  '  pnpm install --frozen-lockfile',
  '',
  'FROM node:$NODE_VERSION-slim',
  'ENV GREETING="hello world"',
  'COPY --from=builder --chown=node:node /out/dist /out/node_modules ./',
  'USER 10001',
  'CMD ["node", "dist/main.js"]',
].join('\n');

describe('parseDockerfile', () => {
  it('splits stages, names them and expands the global ARG default in FROM', () => {
    const model = parseDockerfile(SAMPLE);
    expect(model.stages.map((stage) => [stage.name, stage.image])).toEqual([
      ['builder', 'node:24.1.2-slim'],
      [null, 'node:24.1.2-slim'],
    ]);
  });

  it('joins continuations and drops a comment line inside a continued RUN', () => {
    const [run] = instructionsOf(parseDockerfile(SAMPLE).stages[0], 'RUN');
    expect(runCommand(run)).toBe('pnpm install --frozen-lockfile');
  });

  it('reads the final stage instructions in order', () => {
    const keywords = finalStage(parseDockerfile(SAMPLE)).instructions.map(
      (instruction) => instruction.keyword,
    );
    expect(keywords).toEqual(['ENV', 'COPY', 'USER', 'CMD']);
  });

  it('throws on a variable it cannot resolve and on heredocs', () => {
    expect(() => parseDockerfile(`FROM node:\${MISSING}-slim`)).toThrow(
      'MISSING',
    );
    expect(() => parseDockerfile('FROM x\nRUN <<EOF\nls\nEOF')).toThrow(
      'heredoc',
    );
    expect(() => parseDockerfile('# only a comment')).toThrow('no FROM');
  });
});

describe('instruction readers', () => {
  const stage = finalStage(parseDockerfile(SAMPLE));

  it('reads COPY flags, sources and destination', () => {
    const [copy] = instructionsOf(stage, 'COPY');
    expect(copyOperands(copy)).toEqual({
      from: 'builder',
      sources: ['/out/dist', '/out/node_modules'],
      destination: './',
    });
  });

  it('reads the exec form of CMD, and null for the shell form', () => {
    const [cmd] = instructionsOf(stage, 'CMD');
    expect(execForm(cmd)).toEqual(['node', 'dist/main.js']);
    expect(execForm({ keyword: 'CMD', args: 'node dist/main.js' })).toBeNull();
  });
});
