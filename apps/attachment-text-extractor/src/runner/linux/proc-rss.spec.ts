import { readFileSync } from 'node:fs';

import { parseStatusMemory, readStatusMemory } from './proc-rss';

// Python test_conversion_runner.py test_parse_status_memory_reads_rss_and_high_water_mark,
// plus the reads of a live and a missing process.

describe('parseStatusMemory', () => {
  it('reads the resident set and its high-water mark in KiB', () => {
    const status =
      'Name:\tnode\nVmHWM:\t  41000 kB\nVmRSS:\t   39000 kB\nThreads:\t1\n';

    expect(parseStatusMemory(status)).toEqual({ rssKib: 39000, hwmKib: 41000 });
  });

  it('reads VmRSS, not the RssAnon / RssFile breakdown next to it', () => {
    const status = [
      'Name:\tnode',
      'VmHWM:\t   90000 kB',
      'VmRSS:\t   80000 kB',
      'RssAnon:\t   70000 kB',
      'RssFile:\t   10000 kB',
      'RssShmem:\t       0 kB',
      '',
    ].join('\n');

    expect(parseStatusMemory(status)).toEqual({ rssKib: 80000, hwmKib: 90000 });
  });

  it('gives null for a zombie, which has no memory lines', () => {
    expect(parseStatusMemory('Name:\tnode\nState:\tZ (zombie)\n')).toEqual({
      rssKib: null,
      hwmKib: null,
    });
  });

  it.each([
    ['a value that is not a number', 'VmRSS:\t  abc kB\nVmHWM:\t 41000 kB\n'],
    ['a line without a value', 'VmRSS:\nVmHWM:\t 41000 kB\n'],
    ['an empty file', ''],
  ])('gives null for the field with %s', (_case, status) => {
    expect(parseStatusMemory(status).rssKib).toBeNull();
  });
});

describe.skipIf(process.platform !== 'linux')('readStatusMemory', () => {
  it('reads a live process', () => {
    const memory = readStatusMemory(process.pid);

    expect(memory?.rssKib).toBeGreaterThan(0);
    expect(memory?.hwmKib).toBeGreaterThanOrEqual(memory?.rssKib ?? 0);
  });

  it('gives null for a pid no process can have', () => {
    const pidMax = Number(readFileSync('/proc/sys/kernel/pid_max', 'utf8'));

    expect(readStatusMemory(pidMax + 1)).toBeNull();
  });
});
