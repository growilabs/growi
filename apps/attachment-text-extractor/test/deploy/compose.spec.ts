import { dirname, resolve } from 'node:path';

import {
  COMPOSE_PATH,
  COMPOSE_SERVICE,
  DOCKERFILE_PATH,
  loadYamlFile,
  REPO_ROOT,
  sizeToMiB,
} from './deploy-files';
import {
  arrayAt,
  isObject,
  objectAt,
  stringAt,
  stringsAt,
  valueAt,
  type YamlObject,
} from './yaml-access';

// Static checks of the attachment-text-extractor entry in infra/docker/compose.yaml.
// Req 8.4: the entry uses the Node image and keeps the Python version's other
// settings (environment, tmpfs, safety settings). Python's test_deploy_config.py
// TestCompose maps here (research.md 22.3); `WORKERS` is gone (D1). The build
// context and the healthcheck only change when 8.2 switches the entry to the
// Node version, so those two fail until then (tasks.md 6.11).

const service = (): YamlObject =>
  objectAt(loadYamlFile(COMPOSE_PATH), 'services', COMPOSE_SERVICE);

// `environment` may be a mapping or a list of KEY=VALUE strings.
const environmentOf = (entry: YamlObject): Readonly<Record<string, string>> => {
  const environment = entry.environment;
  if (environment === undefined || environment === null) return {};
  if (isObject(environment)) {
    return Object.fromEntries(
      Object.entries(environment).map(([key, value]) => [key, String(value)]),
    );
  }
  return Object.fromEntries(
    stringsAt(entry, 'environment').map((item) => {
      const separator = item.indexOf('=');
      return separator === -1
        ? [item, '']
        : [item.slice(0, separator), item.slice(separator + 1)];
    }),
  );
};

const SECONDS_PER_UNIT: Readonly<Record<string, number>> = {
  ms: 0.001,
  s: 1,
  m: 60,
  h: 3600,
};

const durationToSeconds = (duration: string): number => {
  const parts = [...duration.matchAll(/(\d+)(ms|s|m|h)/g)];
  if (parts.length === 0) throw new Error(`unreadable duration: ${duration}`);
  return parts.reduce(
    (total, [, amount, unit]) =>
      total + Number(amount) * SECONDS_PER_UNIT[unit],
    0,
  );
};

describe('compose entry: filesystem and users', () => {
  it('has a read-only rootfs', () => {
    expect(service().read_only).toBe(true);
  });

  it('mounts /tmp as the only tmpfs, with a size limit that counts against the memory limit', () => {
    const tmpfs = stringsAt(service(), 'tmpfs');
    expect(tmpfs.map((entry) => entry.split(':')[0])).toEqual(['/tmp']);
    const size = /(?:^|[:,])size=([^,]+)/.exec(tmpfs[0])?.[1];
    expect(size, 'the /tmp tmpfs needs a size= option').toBeDefined();
    expect(sizeToMiB(size ?? '')).toBeLessThanOrEqual(128);
  });

  it('runs as uid 10001', () => {
    expect(String(service().user).split(':')[0]).toBe('10001');
  });

  it('drops all capabilities and forbids privilege escalation', () => {
    expect(service().cap_drop).toEqual(['ALL']);
    expect(stringsAt(service(), 'security_opt')).toContain(
      'no-new-privileges:true',
    );
  });

  it('has no persistent volume', () => {
    const volumes = service().volumes;
    expect(
      volumes === undefined || (Array.isArray(volumes) && volumes.length === 0),
    ).toBe(true);
  });

  it('runs an init process that reaps orphaned conversion children', () => {
    expect(service().init).toBe(true);
  });
});

describe('compose entry: memory and environment', () => {
  it('limits memory to the 2Gi budget, without swap and with a process limit', () => {
    const entry = service();
    expect(['2g', '2048m']).toContain(entry.mem_limit);
    expect(entry.memswap_limit).toBe(entry.mem_limit);
    expect(typeof entry.pids_limit === 'number' && entry.pids_limit > 0).toBe(
      true,
    );
  });

  it('sets no address-space ulimit (the child limit is derived from the parent hard limit, research.md 20.12)', () => {
    const ulimits = valueAt(service(), 'ulimits');
    expect(isObject(ulimits) ? Object.keys(ulimits) : []).not.toContain('as');
  });

  it('sets MAX_CONCURRENCY to 3 and no longer sets WORKERS (D1)', () => {
    const environment = environmentOf(service());
    expect(environment.MAX_CONCURRENCY).toBe('3');
    expect(Object.keys(environment)).not.toContain('WORKERS');
  });
});

describe('compose entry: health check', () => {
  const healthcheck = (): { command: string; timeoutSeconds: number } => {
    const entry = service();
    const test = valueAt(entry, 'healthcheck', 'test');
    const command = Array.isArray(test) ? test.join(' ') : String(test);
    return {
      command,
      timeoutSeconds: durationToSeconds(
        stringAt(entry, 'healthcheck', 'timeout'),
      ),
    };
  };

  it('asks /readyz on the app port with Node (the slim image has no python, curl or wget)', () => {
    const { command } = healthcheck();
    expect(command).toMatch(/\bnode\b/);
    expect(command).toContain('8000/readyz');
    expect(command).not.toMatch(/\b(python3?|curl|wget)\b/);
  });

  it('allows /readyz longer than the readiness probe takes (timeout of at least 15 seconds)', () => {
    expect(healthcheck().timeoutSeconds).toBeGreaterThanOrEqual(15);
  });
});

describe('compose entry: network', () => {
  it('defines the internal network without outbound traffic', () => {
    const networks = objectAt(loadYamlFile(COMPOSE_PATH), 'networks');
    expect(objectAt(networks, 'internal').internal).toBe(true);
  });

  it('attaches the service to that network only', () => {
    const attached = valueAt(service(), 'networks');
    const names = isObject(attached)
      ? Object.keys(attached)
      : arrayAt(service(), 'networks');
    expect(names).toEqual(['internal']);
  });
});

describe('compose entry: build', () => {
  it('builds the Node service Dockerfile with the repository root as the context (pnpm deploy needs the workspace)', () => {
    const build = valueAt(service(), 'build');
    const context = isObject(build)
      ? stringAt(build, 'context')
      : String(build);
    const dockerfile =
      isObject(build) && build.dockerfile !== undefined
        ? stringAt(build, 'dockerfile')
        : 'Dockerfile';
    const contextDir = resolve(dirname(COMPOSE_PATH), context);
    expect(contextDir).toBe(REPO_ROOT);
    expect(resolve(contextDir, dockerfile)).toBe(DOCKERFILE_PATH);
  });
});

describe('compose entry: no shared memory (Req 8.6)', () => {
  it('uses no /dev/shm, shm_size or host IPC namespace', () => {
    const entry = service();
    expect(entry.shm_size).toBeUndefined();
    expect(entry.ipc).not.toBe('host');
    const mounts = [entry.tmpfs, entry.volumes].flatMap((value) =>
      Array.isArray(value) ? value.map(String) : [],
    );
    expect(mounts.filter((mount) => mount.includes('/dev/shm'))).toEqual([]);
  });
});
