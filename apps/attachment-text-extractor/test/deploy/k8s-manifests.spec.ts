import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  APP_PORT,
  K8S_DIR,
  K8S_MANIFEST_FILES,
  kubernetesMemoryToMiB,
  listK8sFiles,
  loadYamlFile,
} from './deploy-files';
import {
  arrayAt,
  isObject,
  numberAt,
  objectAt,
  stringAt,
  valueAt,
  type YamlObject,
} from './yaml-access';
import type { YamlValue } from './yaml-parse';

// Static checks of the sample Kubernetes manifests in
// apps/attachment-text-extractor/deploy/k8s. No cluster is available, so the
// specs parse the YAML and check the hardening and sizing contract. Python's
// test_k8s_manifests.py (27 cases) maps here (research.md 22.3), with
// WORKERS removed (D1) and the memory budget from research.md 20.7 / 20.10.
// Requirements 8.5 and 8.6.

const TIMEOUT_S = 55;
const UPLOAD_TIMEOUT_S = 15;
const READINESS_PROBE_TIMEOUT_S = 10;

// research.md 20.7: estimate = idle parent + MAX_CONCURRENCY x (child RSS limit +
// monitor lag + parent memory per request) + /tmp tmpfs, in MiB, for the parent
// that writes its response in pieces (the shape decided in 20.10).
const IDLE_PARENT_MIB = 69;
const MONITOR_LAG_MIB = 148;
const PARENT_PER_REQUEST_MIB = 157;
const DEFAULT_MAX_CHILD_RSS_MB = 320;

const manifest = (name: string): YamlValue => loadYamlFile(join(K8S_DIR, name));
const deployment = (): YamlValue => manifest('deployment.yaml');
const podSpec = (): YamlObject =>
  objectAt(deployment(), 'spec', 'template', 'spec');

const container = (): YamlObject => {
  const containers = arrayAt(podSpec(), 'containers');
  expect(containers).toHaveLength(1);
  return objectAt(containers[0]);
};

// The Deployment's container env: variable name -> its entry.
const envEntries = (): Readonly<Record<string, YamlObject>> =>
  Object.fromEntries(
    arrayAt(container(), 'env').map((entry) => [
      stringAt(entry, 'name'),
      objectAt(entry),
    ]),
  );

const envValue = (name: string): string | undefined => {
  const entry = envEntries()[name];
  return entry === undefined ? undefined : stringAt(entry, 'value');
};

const isSubset = (small: YamlObject, large: YamlObject): boolean =>
  Object.entries(small).every(([key, value]) => large[key] === value);

describe('k8s manifests: the set of files', () => {
  it('holds the Deployment, Service, HPA and NetworkPolicy examples', () => {
    expect(listK8sFiles()).toEqual(
      expect.arrayContaining([...K8S_MANIFEST_FILES]),
    );
  });

  it('carries no TODO markers, no WORKERS and no forkserver wording in any manifest', () => {
    const files = listK8sFiles().filter((name) => name.endsWith('.yaml'));
    expect(files.length).toBeGreaterThanOrEqual(K8S_MANIFEST_FILES.length);
    for (const name of files) {
      const text = readFileSync(join(K8S_DIR, name), 'utf8');
      expect(text, name).not.toMatch(/TODO/);
      expect(text, name).not.toMatch(/\bWORKERS\b/);
      expect(text, name).not.toMatch(/forkserver/i);
    }
  });
});

describe('k8s manifests: security context', () => {
  it('hardens the container (non-root uid 10001, read-only rootfs, no privilege escalation, no capabilities, RuntimeDefault seccomp)', () => {
    const security = objectAt(container(), 'securityContext');
    expect(security.runAsNonRoot).toBe(true);
    expect(security.runAsUser).toBe(10001);
    expect(security.readOnlyRootFilesystem).toBe(true);
    expect(security.allowPrivilegeEscalation).toBe(false);
    expect(objectAt(security, 'capabilities').drop).toEqual(['ALL']);
    expect(objectAt(security, 'capabilities').add).toBeUndefined();
    expect(objectAt(security, 'seccompProfile').type).toBe('RuntimeDefault');
  });

  it('runs the pod as the image user with the default seccomp profile', () => {
    const security = objectAt(podSpec(), 'securityContext');
    expect(security.runAsNonRoot).toBe(true);
    expect(security.runAsUser).toBe(10001);
    expect(objectAt(security, 'seccompProfile').type).toBe('RuntimeDefault');
  });

  it('does not mount the service account token', () => {
    expect(podSpec().automountServiceAccountToken).toBe(false);
  });

  it('uses no host network, PID or IPC namespace', () => {
    for (const key of ['hostNetwork', 'hostPID', 'hostIPC']) {
      expect(podSpec()[key] ?? false).toBe(false);
    }
  });
});

describe('k8s manifests: writable space and shared memory', () => {
  it('has /tmp as the only writable mount, a size-limited memory emptyDir', () => {
    const mounts = arrayAt(container(), 'volumeMounts').map((mount) =>
      objectAt(mount),
    );
    expect(mounts.map((mount) => mount.mountPath)).toEqual(['/tmp']);
    const volumes = arrayAt(podSpec(), 'volumes').map((volume) =>
      objectAt(volume),
    );
    expect(volumes).toHaveLength(1);
    expect(volumes[0].name).toBe(mounts[0].name);
    expect(objectAt(volumes[0], 'emptyDir').medium).toBe('Memory');
    expect(
      kubernetesMemoryToMiB(stringAt(volumes[0], 'emptyDir', 'sizeLimit')),
    ).toBeLessThanOrEqual(128);
  });

  it('uses no shared memory: nothing is mounted at /dev/shm and no volume is named for it (Req 8.6)', () => {
    const mountPaths = arrayAt(container(), 'volumeMounts').map((mount) =>
      stringAt(mount, 'mountPath'),
    );
    expect(mountPaths.filter((path) => path.startsWith('/dev/shm'))).toEqual(
      [],
    );
    const volumeNames = arrayAt(podSpec(), 'volumes').map((volume) =>
      stringAt(volume, 'name'),
    );
    expect(
      volumeNames.filter((name) => /shm|shared-memory/i.test(name)),
    ).toEqual([]);
  });

  it('has no persistent storage', () => {
    expect(valueAt(deployment(), 'kind')).toBe('Deployment');
    const volumes = arrayAt(podSpec(), 'volumes').map((volume) =>
      objectAt(volume),
    );
    expect(volumes.some((volume) => 'persistentVolumeClaim' in volume)).toBe(
      false,
    );
  });
});

describe('k8s manifests: resources', () => {
  it('requests 512Mi and limits 2Gi of memory (decided in research.md 20.10)', () => {
    const resources = objectAt(container(), 'resources');
    expect(objectAt(resources, 'requests').memory).toBe('512Mi');
    expect(objectAt(resources, 'limits').memory).toBe('2Gi');
  });

  it('sets CPU requests and limits', () => {
    const resources = objectAt(container(), 'resources');
    expect(objectAt(resources, 'requests').cpu).toBeDefined();
    expect(objectAt(resources, 'limits').cpu).toBeDefined();
  });

  it('keeps the research.md 20.7 formula within the limit for the configured MAX_CONCURRENCY (scales the limit with the settings)', () => {
    const concurrency = Number(envValue('MAX_CONCURRENCY'));
    const childRss = Number(
      envValue('MAX_CHILD_RSS_MB') ?? DEFAULT_MAX_CHILD_RSS_MB,
    );
    const tmpfs = kubernetesMemoryToMiB(
      stringAt(arrayAt(podSpec(), 'volumes')[0], 'emptyDir', 'sizeLimit'),
    );
    const estimate =
      IDLE_PARENT_MIB +
      concurrency * (childRss + MONITOR_LAG_MIB + PARENT_PER_REQUEST_MIB) +
      tmpfs;
    expect(estimate).toBeLessThanOrEqual(
      kubernetesMemoryToMiB(
        stringAt(container(), 'resources', 'limits', 'memory'),
      ),
    );
  });
});

describe('k8s manifests: environment', () => {
  it('sets MAX_CONCURRENCY to 3', () => {
    expect(stringAt(envEntries().MAX_CONCURRENCY ?? null, 'value')).toBe('3');
  });

  it('no longer sets WORKERS (D1)', () => {
    expect(Object.keys(envEntries())).not.toContain('WORKERS');
  });

  it('takes the token from a Secret, never a literal', () => {
    const entry = envEntries().ATTACHMENT_EXTRACTOR_SERVICE_TOKEN;
    expect(entry).toBeDefined();
    expect(entry.value).toBeUndefined();
    const reference = objectAt(entry, 'valueFrom', 'secretKeyRef');
    expect(stringAt(reference, 'name')).not.toBe('');
    expect(stringAt(reference, 'key')).not.toBe('');
  });

  it('pins the image to a version tag or digest, never latest', () => {
    const image = stringAt(container(), 'image');
    expect(image.split('/').pop()).toMatch(/:|@sha256:/);
    expect(image.endsWith(':latest')).toBe(false);
  });
});

describe('k8s manifests: probes', () => {
  it('uses /healthz on the app port for the startup and liveness probes', () => {
    for (const key of ['startupProbe', 'livenessProbe']) {
      expect(stringAt(container(), key, 'httpGet', 'path'), key).toBe(
        '/healthz',
      );
      expect(numberAt(container(), key, 'httpGet', 'port'), key).toBe(APP_PORT);
    }
  });

  it('uses /readyz for readiness with a timeout above the readiness probe time', () => {
    const probe = objectAt(container(), 'readinessProbe');
    expect(stringAt(probe, 'httpGet', 'path')).toBe('/readyz');
    expect(numberAt(probe, 'httpGet', 'port')).toBe(APP_PORT);
    expect(numberAt(probe, 'timeoutSeconds')).toBeGreaterThanOrEqual(
      READINESS_PROBE_TIMEOUT_S + 5,
    );
    expect(numberAt(probe, 'periodSeconds')).toBeGreaterThanOrEqual(
      numberAt(probe, 'timeoutSeconds'),
    );
    expect(numberAt(probe, 'failureThreshold')).toBeGreaterThanOrEqual(2);
  });

  it('does not let liveness kill a busy pod (at least 30 seconds of failures)', () => {
    const probe = objectAt(container(), 'livenessProbe');
    expect(
      numberAt(probe, 'failureThreshold') * numberAt(probe, 'periodSeconds'),
    ).toBeGreaterThanOrEqual(30);
  });

  it('allows a slow start (at least 30 seconds)', () => {
    const probe = objectAt(container(), 'startupProbe');
    expect(
      numberAt(probe, 'failureThreshold') * numberAt(probe, 'periodSeconds'),
    ).toBeGreaterThanOrEqual(30);
  });
});

describe('k8s manifests: rollout', () => {
  it('has a grace period that outlasts an upload and a conversion', () => {
    expect(
      numberAt(podSpec(), 'terminationGracePeriodSeconds'),
    ).toBeGreaterThanOrEqual(UPLOAD_TIMEOUT_S + TIMEOUT_S + 10);
  });

  it('keeps capacity during a rolling update (maxUnavailable 0)', () => {
    expect(
      valueAt(
        deployment(),
        'spec',
        'strategy',
        'rollingUpdate',
        'maxUnavailable',
      ),
    ).toBe(0);
  });
});

describe('k8s manifests: Service', () => {
  it('is a ClusterIP Service on the app port', () => {
    const service = manifest('service.yaml');
    expect(valueAt(service, 'kind')).toBe('Service');
    expect(valueAt(service, 'spec', 'type') ?? 'ClusterIP').toBe('ClusterIP');
    const ports = arrayAt(service, 'spec', 'ports').map((port) =>
      objectAt(port),
    );
    expect(ports.map((port) => port.port)).toEqual([APP_PORT]);
    expect(ports[0].targetPort).toBe(APP_PORT);
  });
});

describe('k8s manifests: HorizontalPodAutoscaler', () => {
  it('scales the Deployment on CPU utilization between 2 and at most 50 replicas', () => {
    const hpa = manifest('hpa.yaml');
    expect(valueAt(hpa, 'apiVersion')).toBe('autoscaling/v2');
    expect(valueAt(hpa, 'kind')).toBe('HorizontalPodAutoscaler');
    expect(objectAt(hpa, 'spec', 'scaleTargetRef')).toEqual({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      name: stringAt(deployment(), 'metadata', 'name'),
    });
    const min = numberAt(hpa, 'spec', 'minReplicas');
    const max = numberAt(hpa, 'spec', 'maxReplicas');
    expect(min).toBeGreaterThanOrEqual(2);
    expect(min).toBeLessThan(max);
    expect(max).toBeLessThanOrEqual(50);
    const cpu = arrayAt(hpa, 'spec', 'metrics')
      .filter(isObject)
      .find(
        (metric) =>
          metric.type === 'Resource' &&
          objectAt(metric, 'resource').name === 'cpu',
      );
    expect(cpu).toBeDefined();
    expect(valueAt(cpu ?? null, 'resource', 'target', 'type')).toBe(
      'Utilization',
    );
    const utilization = numberAt(
      cpu ?? null,
      'resource',
      'target',
      'averageUtilization',
    );
    expect(utilization).toBeGreaterThanOrEqual(50);
    expect(utilization).toBeLessThanOrEqual(80);
  });

  it('scales down slowly (a stabilization window of at least 300 seconds)', () => {
    expect(
      numberAt(
        manifest('hpa.yaml'),
        'spec',
        'behavior',
        'scaleDown',
        'stabilizationWindowSeconds',
      ),
    ).toBeGreaterThanOrEqual(300);
  });
});

describe('k8s manifests: NetworkPolicy', () => {
  it('blocks all egress', () => {
    const policy = manifest('networkpolicy.yaml');
    expect(valueAt(policy, 'kind')).toBe('NetworkPolicy');
    expect(arrayAt(policy, 'spec', 'policyTypes')).toContain('Egress');
    expect(valueAt(policy, 'spec', 'egress') ?? []).toEqual([]);
  });

  it('allows ingress only on the app port, from named peers (no ipBlock)', () => {
    const policy = manifest('networkpolicy.yaml');
    expect(arrayAt(policy, 'spec', 'policyTypes')).toContain('Ingress');
    const rules = arrayAt(policy, 'spec', 'ingress');
    expect(rules).toHaveLength(1);
    expect(
      arrayAt(rules[0], 'ports').map((port) => objectAt(port).port),
    ).toEqual([APP_PORT]);
    const peers = arrayAt(rules[0], 'from');
    expect(peers.length).toBeGreaterThan(0);
    for (const peer of peers) {
      const selectors = objectAt(peer);
      const namedSelectors = [
        selectors.namespaceSelector,
        selectors.podSelector,
      ]
        .filter(isObject)
        .filter((selector) => Object.keys(selector).length > 0);
      expect(
        namedSelectors.length,
        'a peer needs a non-empty namespaceSelector or podSelector',
      ).toBeGreaterThan(0);
      expect(selectors.ipBlock).toBeUndefined();
    }
  });
});

describe('k8s manifests: consistency', () => {
  it('lines up the labels of the Deployment, Service and NetworkPolicy', () => {
    const podLabels = objectAt(
      deployment(),
      'spec',
      'template',
      'metadata',
      'labels',
    );
    expect(
      isSubset(
        objectAt(deployment(), 'spec', 'selector', 'matchLabels'),
        podLabels,
      ),
    ).toBe(true);
    expect(
      isSubset(
        objectAt(manifest('service.yaml'), 'spec', 'selector'),
        podLabels,
      ),
    ).toBe(true);
    expect(
      isSubset(
        objectAt(
          manifest('networkpolicy.yaml'),
          'spec',
          'podSelector',
          'matchLabels',
        ),
        podLabels,
      ),
    ).toBe(true);
  });

  it('puts all four resources in the same namespace', () => {
    const namespaces = K8S_MANIFEST_FILES.map((name) =>
      stringAt(manifest(name), 'metadata', 'namespace'),
    );
    expect(new Set(namespaces).size).toBe(1);
  });
});
