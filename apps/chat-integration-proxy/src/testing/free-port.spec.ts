// `listenOnFreePort`'s contract: the URL it reports is the one the app is
// actually served at, and reading it too early says so instead of naming a
// port nothing is listening on.

import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { listenOnFreePort } from './free-port.js';

const started: Array<() => void> = [];

afterEach(() => {
  for (const close of started.splice(0)) close();
});

describe('listenOnFreePort', () => {
  it('reports the address the app can actually be reached at', async () => {
    const app = new Hono();
    app.get('/probe', (c) => c.text('served'));

    const listener = listenOnFreePort();
    const server = listener.listen(app, 0);
    started.push(() => server.close());

    const response = await fetch(`${await listener.baseUrl()}/probe`);

    expect(await response.text()).toBe('served');
  });

  it('gives two listeners two different ports', async () => {
    const first = listenOnFreePort();
    const second = listenOnFreePort();
    const firstServer = first.listen(new Hono(), 0);
    const secondServer = second.listen(new Hono(), 0);
    started.push(
      () => firstServer.close(),
      () => secondServer.close(),
    );

    // 11.4 runs several instances at once; two that shared a port would fail
    // to bind rather than compete for the lock the test is about.
    expect(await first.baseUrl()).not.toBe(await second.baseUrl());
  });

  it('refuses to report an address before anything has been bound', async () => {
    await expect(listenOnFreePort().baseUrl()).rejects.toThrow(
      /has not bound a port/i,
    );
  });
});
