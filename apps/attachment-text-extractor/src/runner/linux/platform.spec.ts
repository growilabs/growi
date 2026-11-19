import { limitedCommand } from './platform';
import { PRLIMIT_PATH } from './prlimit-args';

// Python test_platform_guards.py test_guards_are_no_ops_outside_linux: outside
// Linux (development machines) the child runs without prlimit; on Linux it
// always runs under it.

const COMMAND = ['/usr/local/bin/node', '/srv/child.js'];
const INPUT = {
  prlimitPath: PRLIMIT_PATH,
  maxChildRssMb: 320,
  timeoutS: 55,
  hardLimits: {
    addressSpaceBytes: Number.POSITIVE_INFINITY,
    cpuSeconds: Number.POSITIVE_INFINITY,
  },
  command: COMMAND,
};

describe('limitedCommand', () => {
  it('runs the child under prlimit on Linux', () => {
    const { file, args } = limitedCommand(INPUT, 'linux');

    expect(file).toBe(PRLIMIT_PATH);
    expect(args).toContain('--core=1');
    expect(args.slice(args.indexOf('--') + 1)).toEqual(COMMAND);
  });

  it('starts the command through the prlimit path it is given', () => {
    const { file } = limitedCommand(
      { ...INPUT, prlimitPath: '/opt/util-linux/bin/prlimit' },
      'linux',
    );

    expect(file).toBe('/opt/util-linux/bin/prlimit');
  });

  it.each<NodeJS.Platform>([
    'darwin',
    'win32',
  ])('runs the command as it is on %s', (platform) => {
    expect(limitedCommand(INPUT, platform)).toEqual({
      file: COMMAND[0],
      args: COMMAND.slice(1),
    });
  });
});
