// What `startProxyCluster` promises to task 11.4: several proxy instances are
// brought up together, one of them can be stopped on its own, and nothing is
// left running when the test ends -- including when one instance fails to
// start.
//
// `start` is a parameter (`.claude/rules/coding-style.md`, "executors take
// their work-set as input"), so every property below is checked without a
// database, a port or a chat connection. The instances a real test starts are
// the same shape; only the function that produces them differs.

import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { ProxyConfig, RunningProxy } from '../runtime/index.js';
import { startProxyCluster } from './proxy-cluster.js';

const config = (port: number): ProxyConfig => ({
  platformApp: { stateConnectionString: 'unused' },
  closedNetwork: { allowList: [], trustedCaCertsFor: () => [] },
  cipher: { encrypt: (value) => value, decrypt: (value) => value },
  databaseUrl: 'unused',
  http: { port, bodyLimitBytes: 1024 },
  mattermostInstallations: [],
});

/** A `start` that records what it was asked to do and never touches anything. */
const recordingStart = (options?: { readonly failOn?: string }) => {
  const stopped: string[] = [];
  const started: number[] = [];
  const start = vi.fn((proxyConfig: ProxyConfig) => {
    if (options?.failOn === String(proxyConfig.http.port)) {
      return Promise.reject(
        new Error(`refused to start on ${proxyConfig.http.port}`),
      );
    }
    started.push(proxyConfig.http.port);
    return Promise.resolve(
      mock<RunningProxy>({
        port: proxyConfig.http.port,
        stop: () => {
          stopped.push(String(proxyConfig.http.port));
          return Promise.resolve();
        },
      }),
    );
  });
  return { start, started, stopped };
};

describe('starting', () => {
  it('starts one instance per spec and keeps them addressable by name', async () => {
    const { start, started } = recordingStart();

    const cluster = await startProxyCluster(
      [
        { name: 'first', config: config(4001) },
        { name: 'second', config: config(4002) },
      ],
      { start },
    );

    expect(started).toEqual([4001, 4002]);
    expect(cluster.names()).toEqual(['first', 'second']);
    expect(cluster.get('second').proxy.port).toBe(4002);
  });

  it('passes each instance its own overrides through untouched', async () => {
    const { start } = recordingStart();
    const listen = vi.fn();

    await startProxyCluster(
      [{ name: 'only', config: config(4001), overrides: { listen } }],
      { start },
    );

    // 11.4 needs the REAL platform facade on some instances and a fake on
    // others; a cluster that decided the overrides itself could not serve both.
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ http: { port: 4001, bodyLimitBytes: 1024 } }),
      { listen },
    );
  });

  it('stops the instances it already started when a later one fails', async () => {
    const { start, stopped } = recordingStart({ failOn: '4002' });

    await expect(
      startProxyCluster(
        [
          { name: 'first', config: config(4001) },
          { name: 'second', config: config(4002) },
        ],
        { start },
      ),
    ).rejects.toThrow(/refused to start on 4002/);

    // Left running, the first instance keeps a lock and the next test in the
    // file fails for a reason that has nothing to do with what it checks.
    expect(stopped).toEqual(['4001']);
  });
});

describe('stopping', () => {
  it('stops one instance without touching the others', async () => {
    const { start, stopped } = recordingStart();
    const cluster = await startProxyCluster(
      [
        { name: 'first', config: config(4001) },
        { name: 'second', config: config(4002) },
      ],
      { start },
    );

    await cluster.stop('first');

    expect(stopped).toEqual(['4001']);
    expect(cluster.names()).toEqual(['second']);
  });

  it('does nothing the second time the same instance is stopped', async () => {
    const { start, stopped } = recordingStart();
    const cluster = await startProxyCluster(
      [{ name: 'only', config: config(4001) }],
      { start },
    );

    await cluster.stop('only');
    await cluster.stopAll();

    // 11.4 stops the owner and then tears the cluster down; running the same
    // teardown twice would disconnect storage a second time.
    expect(stopped).toEqual(['4001']);
  });

  it('refuses a name it never started', async () => {
    const { start } = recordingStart();
    const cluster = await startProxyCluster(
      [{ name: 'only', config: config(4001) }],
      { start },
    );

    await expect(cluster.stop('other')).rejects.toThrow(/other/);
  });

  it('stops every remaining instance even when one of them throws', async () => {
    const stopped: string[] = [];
    const start = vi.fn((proxyConfig: ProxyConfig) =>
      Promise.resolve(
        mock<RunningProxy>({
          port: proxyConfig.http.port,
          stop: () => {
            if (proxyConfig.http.port === 4001) {
              return Promise.reject(new Error('teardown failed'));
            }
            stopped.push(String(proxyConfig.http.port));
            return Promise.resolve();
          },
        }),
      ),
    );

    const cluster = await startProxyCluster(
      [
        { name: 'first', config: config(4001) },
        { name: 'second', config: config(4002) },
      ],
      { start },
    );

    await expect(cluster.stopAll()).rejects.toThrow(/teardown failed/);
    // The failure is reported, but not before the rest have been let go of.
    expect(stopped).toEqual(['4002']);
    expect(cluster.names()).toEqual([]);
  });
});
