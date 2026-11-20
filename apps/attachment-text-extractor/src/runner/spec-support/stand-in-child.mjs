// A stand-in for the child entry, started by the runner in place of the real
// one (ConversionRunnerOptions.childEntry). It imports nothing from src/, so it
// runs before any of it is implemented and starts in about 25 ms.
//
// fd 0: header frame then file frame (4-byte big-endian length + bytes each),
// fd 3: one result frame, fd 4: liveness (EOF once the parent is gone).
// The file frame starts with "<mode> <argument> <trace>\n" ('-' for none): the
// mode picks what this child does, the way the Python tests' child_targets
// functions did; a trace path, when given, gets this child's pid first thing,
// so a test can tell that a child really ran.
import { execFileSync } from 'node:child_process';
import { readFileSync, readSync, writeFileSync, writeSync } from 'node:fs';
import { Socket } from 'node:net';

const INPUT_FD = 0;
const STDOUT_FD = 1;
const STDERR_FD = 2;
const RESULT_FD = 3;
const LIVENESS_FD = 4;
const MIB = 1024 * 1024;
const MODE_LINE_MAX = 4096;
// A stray stand-in must never outlive a test run by much.
const SAFETY_EXIT_MS = 60_000;

const sleepSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const readExact = (length) => {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    let read;
    try {
      read = readSync(INPUT_FD, buffer, filled, length - filled, null);
    } catch (error) {
      if (error.code === 'EAGAIN') {
        sleepSync(1);
        continue;
      }
      throw error;
    }
    if (read === 0) {
      throw new Error('input ended early');
    }
    filled += read;
  }
  return buffer;
};

const readFrameLength = () => readExact(4).readUInt32BE(0);

const writeAll = (fd, data) => {
  let written = 0;
  while (written < data.length) {
    try {
      written += writeSync(fd, data, written, data.length - written);
    } catch (error) {
      if (error.code !== 'EAGAIN') {
        throw error;
      }
      sleepSync(1);
    }
  }
};

const frame = (body) => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
};

const sendResult = (document) => {
  writeAll(RESULT_FD, frame(Buffer.from(JSON.stringify(document), 'utf8')));
};

const sendSuccess = (content, mimeType = 'text/plain') => {
  sendResult({
    ok: true,
    pages: [{ pageNumber: null, label: null, content }],
    mimeType,
  });
};

/** Resolves never: exits once the parent closes the liveness pipe. */
const exitWhenParentGoes = () => {
  const liveness = new Socket({
    fd: LIVENESS_FD,
    readable: true,
    writable: false,
  });
  const leave = () => process.exit(0);
  liveness.on('data', () => {});
  liveness.on('end', leave);
  liveness.on('close', leave);
  liveness.on('error', leave);
  setTimeout(leave, SAFETY_EXIT_MS).unref();
};

// Signals that dump core by default: make sure no core leaves the child even
// if the runner under test forgot --core=1.
const noCore = () => {
  execFileSync('/usr/bin/prlimit', ['--pid', String(process.pid), '--core=1']);
};

const hardCpuLimit = () => {
  const row = readFileSync('/proc/self/limits', 'utf8')
    .split('\n')
    .find((line) => line.startsWith('Max cpu time'));
  return row?.trim().split(/\s+/)[4] ?? 'unlimited';
};

// --- input ------------------------------------------------------------------

readExact(readFrameLength()); // the header frame: its fields are the runner's business
const bodyLength = readFrameLength();
let modeLine = '';
let consumed = 0;
while (consumed < bodyLength && consumed < MODE_LINE_MAX) {
  const byte = readExact(1);
  consumed += 1;
  if (byte[0] === 0x0a) {
    break;
  }
  modeLine += byte.toString('latin1');
}
const [mode, argument = '-', trace = '-'] = modeLine.split(' ');
if (trace !== '-') {
  writeFileSync(trace, String(process.pid));
}
const readRestOfBody = () => {
  for (
    let left = bodyLength - consumed;
    left > 0;
    left -= Math.min(left, MIB)
  ) {
    readExact(Math.min(left, MIB));
  }
  consumed = bodyLength;
};

// --- behaviour ----------------------------------------------------------------

const modes = {
  echo: () => {
    readRestOfBody();
    sendSuccess(`received ${bodyLength} bytes`);
    process.exit(0);
  },
  // Blocks before reading the rest, so a parent that writes the input
  // synchronously stalls its own event loop for the whole pause.
  'slow-echo': () => {
    sleepSync(Number(argument));
    readRestOfBody();
    sendSuccess(`received ${bodyLength} bytes`);
    process.exit(0);
  },
  hang: () => {
    readRestOfBody();
    exitWhenParentGoes();
  },
  'stop-reading': () => {
    exitWhenParentGoes();
  },
  exit: () => {
    process.exit(Number(argument));
  },
  abort: () => {
    noCore();
    readRestOfBody();
    process.abort();
  },
  segfault: () => {
    noCore();
    readRestOfBody();
    process.kill(process.pid, 'SIGSEGV');
  },
  sigkill: () => {
    readRestOfBody();
    process.kill(process.pid, 'SIGKILL');
  },
  sigxcpu: () => {
    noCore();
    readRestOfBody();
    process.kill(process.pid, 'SIGXCPU');
    exitWhenParentGoes();
  },
  // Lowers only the soft CPU limit (allowed without privilege) so the kernel
  // sends SIGXCPU after 1 s of CPU, long before the parent's deadline.
  'cpu-overrun': () => {
    noCore();
    readRestOfBody();
    execFileSync('/usr/bin/prlimit', [
      '--pid',
      String(process.pid),
      `--cpu=1:${hardCpuLimit()}`,
    ]);
    for (;;) {
      // spin on CPU
    }
  },
  grow: () => {
    readRestOfBody();
    const held = [];
    const step = () => {
      if (held.length < Number(argument)) {
        held.push(Buffer.alloc(8 * MIB, 1));
        setTimeout(step, 10);
      }
    };
    step();
    exitWhenParentGoes();
  },
  'oversize-header': () => {
    readRestOfBody();
    writeAll(RESULT_FD, Buffer.from([0xff, 0xff, 0xff, 0xff]));
    exitWhenParentGoes();
  },
  'partial-body': () => {
    readRestOfBody();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(1000, 0);
    writeAll(RESULT_FD, Buffer.concat([header, Buffer.from('{'.repeat(10))]));
    exitWhenParentGoes();
  },
  'truncated-body': () => {
    readRestOfBody();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(1000, 0);
    writeAll(RESULT_FD, Buffer.concat([header, Buffer.from('{'.repeat(10))]));
    process.exit(0);
  },
  // Sends the argument verbatim as the result body (protocol and Req 3.9 cases).
  'raw-result': () => {
    readRestOfBody();
    writeAll(
      RESULT_FD,
      frame(Buffer.from(decodeURIComponent(argument), 'utf8')),
    );
    process.exit(0);
  },
  // Stands in for a native destructor that never returns after the result.
  'result-then-stuck': () => {
    readRestOfBody();
    sendSuccess('done');
    sleepSync(SAFETY_EXIT_MS);
    process.exit(0);
  },
  'noisy-echo': () => {
    readRestOfBody();
    const noise = Buffer.alloc(Number(argument), 0x2e);
    writeAll(STDOUT_FD, noise);
    writeAll(STDERR_FD, noise);
    sendSuccess(`received ${bodyLength} bytes`);
    process.exit(0);
  },
  // Writes the decoded text to stderr `<repeat>` times ("<repeat>x<text>"),
  // then answers like echo. The pause lets the parent read a short text before
  // the exit; a long one blocks on the pipe until the parent reads anyway.
  'stderr-echo': () => {
    readRestOfBody();
    const cut = argument.indexOf('x');
    const text = Buffer.from(
      decodeURIComponent(argument.slice(cut + 1)),
      'utf8',
    );
    for (let left = Number(argument.slice(0, cut)); left > 0; left -= 1) {
      writeAll(STDERR_FD, text);
    }
    sleepSync(50);
    sendSuccess(`received ${bodyLength} bytes`);
    process.exit(0);
  },
  'report-self': () => {
    readRestOfBody();
    const environ = readFileSync('/proc/self/environ', 'latin1')
      .split('\0')
      .filter((entry) => entry !== '');
    sendSuccess(
      JSON.stringify({
        environ,
        execArgv: process.execArgv,
        limits: readFileSync('/proc/self/limits', 'utf8'),
      }),
      'application/json',
    );
    process.exit(0);
  },
};

const run = modes[mode];
if (run === undefined) {
  writeAll(STDERR_FD, Buffer.from(`unknown stand-in mode: ${mode}\n`));
  process.exit(70);
}
run();
