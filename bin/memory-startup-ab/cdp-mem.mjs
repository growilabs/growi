// One-shot: fetch process.memoryUsage() from a node process via CDP inspector.
// Usage: node cdp-mem.mjs <inspector-port>
const port = process.argv[2];

const res = await fetch(`http://127.0.0.1:${port}/json`);
const targets = await res.json();
const target = targets[0];

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('ws connect failed'));
});

const value = await new Promise((resolve, reject) => {
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === 1) resolve(m.result?.result?.value ?? JSON.stringify(m));
  };
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: 'JSON.stringify(process.memoryUsage())',
        returnByValue: true,
      },
    }),
  );
  setTimeout(() => reject(new Error('timeout')), 8000);
});

console.log(value);
ws.close();
