import { loadDockerfile, loadPackageManifest } from './deploy-files';
import {
  copyOperands,
  type DockerfileModel,
  execForm,
  finalStage,
  instructionsOf,
  runCommand,
  type Stage,
} from './dockerfile-model';

// Static checks of apps/attachment-text-extractor/docker/Dockerfile. Building the
// image needs docker, so these read the file; research.md 22.3 maps Python's
// test_deploy_config.py (TestDockerfile) here, and 22.7 and 23.7 list what the
// Node image adds (prlimit in the final stage, pnpm deploy, no WORKERS, no
// /dev/shm). Requirements 8.1, 8.3, 8.6, 8.7.

const SERVICE_PACKAGE = '@growi/attachment-text-extractor';
const PINNED_NODE_SLIM =
  /^node:24\.\d+\.\d+-(?:(?:bookworm|trixie)-)?slim(?:@sha256:[0-9a-f]{64})?$/;
const LICENSES_DIRECTORY = /(^|\/)licenses(\/|$)/i;
const SHIPPED_PATHS = new Set(['dist', 'node_modules', 'package.json']);

const stageByReference = (model: DockerfileModel, reference: string): Stage => {
  const byName = model.stages.find((stage) => stage.name === reference);
  const byIndex = model.stages[Number(reference)];
  const stage = byName ?? (/^\d+$/.test(reference) ? byIndex : undefined);
  if (stage === undefined)
    throw new Error(`COPY --from=${reference} names no stage`);
  return stage;
};

const lastSegment = (path: string): string =>
  path
    .replace(/\/\.?$/, '')
    .split('/')
    .pop() ?? '';

const isLicenseCopy = (destination: string): boolean =>
  LICENSES_DIRECTORY.test(destination);

// The shell commands of a stage's RUN instructions, one entry per `&&`, `;` or `|`.
const shellSegments = (stage: Stage): readonly string[] =>
  instructionsOf(stage, 'RUN').flatMap((run) =>
    runCommand(run)
      .split(/&&|\|\||;|\|/)
      .map((part) => part.trim()),
  );

// The stage that a final-stage COPY of `shippedName` (dist, node_modules) takes from.
const sourceStageOf = (model: DockerfileModel, shippedName: string): Stage => {
  const copy = instructionsOf(finalStage(model), 'COPY')
    .map(copyOperands)
    .find((operands) =>
      operands.sources.some((s) => lastSegment(s) === shippedName),
    );
  if (copy === undefined) {
    throw new Error(`the final stage copies no ${shippedName}`);
  }
  if (copy.from === null) {
    throw new Error(
      `the final stage copies ${shippedName} from the build context, not from a build stage`,
    );
  }
  return stageByReference(model, copy.from);
};

describe('Dockerfile base images', () => {
  it('pins every build stage to an exact Node 24 slim patch version', () => {
    const model = loadDockerfile();
    const stageNames = new Set(model.stages.map((stage) => stage.name));
    const bases = model.stages
      .map((stage) => stage.image)
      .filter((image) => !stageNames.has(image));
    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) {
      expect(base).toMatch(PINNED_NODE_SLIM);
    }
  });

  it('starts the final stage from a pinned Node base image, not from a build stage', () => {
    const model = loadDockerfile();
    const stageNames = new Set(model.stages.map((stage) => stage.name));
    expect(finalStage(model).image).toMatch(PINNED_NODE_SLIM);
    expect(stageNames.has(finalStage(model).image)).toBe(false);
  });

  it('uses a glibc (Debian) base, not Alpine, so that the -gnu native part of anydoc is chosen', () => {
    const images = loadDockerfile().stages.map((stage) => stage.image);
    for (const image of images) {
      expect(image).not.toMatch(/alpine|musl/i);
    }
  });
});

describe('Dockerfile final stage: runtime settings', () => {
  it('runs as uid 10001 (the last USER of the final stage)', () => {
    const users = instructionsOf(finalStage(loadDockerfile()), 'USER').map(
      (instruction) => instruction.args,
    );
    expect(users.length).toBeGreaterThan(0);
    expect(users[users.length - 1]).toMatch(/^10001(:10001)?$/);
  });

  it('starts the service with the exec form `node dist/main.js` so that Node is PID 1 and receives SIGTERM', () => {
    const stage = finalStage(loadDockerfile());
    const entrypoint = instructionsOf(stage, 'ENTRYPOINT').at(-1);
    const cmd = instructionsOf(stage, 'CMD').at(-1);
    expect(entrypoint ?? cmd).toBeDefined();
    const parts = [entrypoint, cmd].flatMap((instruction) => {
      if (instruction === undefined) return [];
      const argv = execForm(instruction);
      if (argv === null) {
        throw new Error(
          `${instruction.keyword} must use the exec form: ${instruction.args}`,
        );
      }
      return argv;
    });
    expect(parts[0]).toBe('node');
    expect(parts).toContain('dist/main.js');
  });

  it('does not set MALLOC_ARENA_MAX (the runner sets it in the child environment only)', () => {
    const stage = finalStage(loadDockerfile());
    const text = stage.instructions
      .map((instruction) => instruction.args)
      .join('\n');
    expect(text).not.toMatch(/MALLOC_ARENA_MAX/);
  });

  it('does not set NODE_OPTIONS or the V8 and WASM memory flags (the runner passes them in the child argv)', () => {
    const stage = finalStage(loadDockerfile());
    const text = stage.instructions
      .map((instruction) => instruction.args)
      .join('\n');
    expect(text).not.toMatch(/NODE_OPTIONS/);
    expect(text).not.toMatch(/--max-semi-space-size/);
    expect(text).not.toMatch(/--wasm-max-mem-pages/);
  });
});

describe('Dockerfile: no WORKERS, no shared memory', () => {
  it('has no WORKERS setting anywhere (D1: one Node process, MAX_CONCURRENCY is the whole limit)', () => {
    const text = loadDockerfile()
      .stages.flatMap((stage) => stage.instructions)
      .map((instruction) => instruction.args)
      .join('\n');
    expect(text).not.toMatch(/\bWORKERS\b/);
  });

  it('does not use /dev/shm or a shared memory size (Req 8.6)', () => {
    const text = loadDockerfile()
      .stages.flatMap((stage) => stage.instructions)
      .map((instruction) => instruction.args)
      .join('\n');
    expect(text).not.toMatch(/\/dev\/shm|--shm-size|\bshm_size\b/);
  });
});

describe('Dockerfile: prlimit check in the final stage (Req 8.7)', () => {
  const prlimitRuns = (): readonly string[] =>
    instructionsOf(finalStage(loadDockerfile()), 'RUN')
      .map(runCommand)
      .filter((command) => /prlimit/.test(command));

  it('runs /usr/bin/prlimit --version by absolute path in the final stage', () => {
    const runs = prlimitRuns();
    expect(runs.length).toBeGreaterThan(0);
    expect(
      runs.some((command) =>
        /(^|[\s;&|(])\/usr\/bin\/prlimit\s+--version(\s|;|&|\||\)|$)/.test(
          command,
        ),
      ),
    ).toBe(true);
  });

  it('lets a missing or broken prlimit fail the build (the check is not made optional)', () => {
    const runs = prlimitRuns();
    expect(runs.length).toBeGreaterThan(0);
    // The version call must end its own `&&` chain: nothing after it separated by
    // `;` or `|` may swallow its exit status, and `set +e` is not allowed.
    const failsTheRun = (command: string): boolean => {
      const match =
        /(?:^|&&|;)\s*\/usr\/bin\/prlimit\s+--version\s*((?:&&.*)?)$/.exec(
          command,
        );
      return (
        match !== null && !/;|\|/.test(match[1]) && !/set\s+\+e/.test(command)
      );
    };
    expect(runs.some(failsTheRun)).toBe(true);
  });
});

describe('Dockerfile: production dependencies only (Req 8.3)', () => {
  it('takes the production dependencies of this package with `pnpm deploy --prod --filter`', () => {
    const model = loadDockerfile();
    const deployStage = sourceStageOf(model, 'node_modules');
    const deploys = shellSegments(deployStage).filter((segment) =>
      /\bpnpm\s+(?:--\S+\s+)*deploy\b/.test(segment),
    );
    expect(deploys.length).toBeGreaterThan(0);
    expect(
      deploys.some(
        (segment) =>
          /\s--prod(uction)?(\s|$)/.test(segment) &&
          new RegExp(`(--filter|-F)[ =]${SERVICE_PACKAGE}(\\s|$)`).test(
            segment,
          ),
      ),
    ).toBe(true);
  });

  it('never re-resolves the lockfile: every pnpm install uses --frozen-lockfile', () => {
    const installs = loadDockerfile()
      .stages.flatMap(shellSegments)
      .filter((segment) => /\bpnpm\s+(?:--\S+\s+)*(install|i)\b/.test(segment));
    expect(installs.length).toBeGreaterThan(0);
    for (const install of installs) {
      expect(install).toMatch(/--frozen-lockfile/);
    }
  });

  it('builds dist/ with the package build script in the stage that dist/ is copied from (research.md 23.5)', () => {
    const buildStage = sourceStageOf(loadDockerfile(), 'dist');
    expect(
      shellSegments(buildStage).some((segment) =>
        /\b(pnpm|turbo|npm)\b.*\bbuild\b/.test(segment),
      ),
    ).toBe(true);
  });

  it('has a build script in package.json that the Dockerfile can run (research.md 23.5)', () => {
    expect(loadPackageManifest().scripts.build).toBeTruthy();
  });

  it('copies only dist, node_modules and package.json (plus licence notices) into the final stage, from a build stage', () => {
    const copies = instructionsOf(finalStage(loadDockerfile()), 'COPY').map(
      copyOperands,
    );
    const shipped = copies.filter((copy) => !isLicenseCopy(copy.destination));
    expect(shipped.length).toBeGreaterThan(0);
    for (const copy of shipped) {
      expect(
        copy.from,
        `COPY ${copy.sources.join(' ')} must come from a build stage`,
      ).not.toBeNull();
      for (const source of copy.sources) {
        expect(
          SHIPPED_PATHS.has(lastSegment(source)),
          `unexpected COPY source ${source}`,
        ).toBe(true);
      }
    }
    const names = new Set(
      shipped.flatMap((copy) => copy.sources.map(lastSegment)),
    );
    expect(names.has('dist')).toBe(true);
    expect(names.has('node_modules')).toBe(true);
  });

  it('installs no package manager, build tool or compiler in the final stage', () => {
    const segments = shellSegments(finalStage(loadDockerfile()));
    for (const segment of segments) {
      expect(segment).not.toMatch(/\b(pnpm|npm|npx|yarn|corepack|turbo|tsc)\b/);
      expect(segment).not.toMatch(
        /\b(build-essential|gcc|g\+\+|make|python3?|git)\b/,
      );
    }
  });
});

describe('Dockerfile: third-party licence notices (research.md 21.5)', () => {
  it('puts the licence notices of the PDFium WASM into a licenses directory of the final stage', () => {
    const copies = instructionsOf(finalStage(loadDockerfile()), 'COPY').map(
      copyOperands,
    );
    const licenceCopies = copies.filter((copy) =>
      isLicenseCopy(copy.destination),
    );
    expect(licenceCopies.length).toBeGreaterThan(0);
    for (const copy of licenceCopies) {
      for (const source of copy.sources) {
        expect(source, 'a licence COPY copies licence files only').toMatch(
          /(^|\/)[^/]*(licen[cs]e|notice|copying)[^/]*\/?$/i,
        );
      }
    }
  });
});
