import { parseYaml } from './yaml-parse';

describe('parseYaml', () => {
  it('gives booleans, numbers, null and strings their YAML types, and quoted values stay strings', () => {
    expect(
      parseYaml(
        [
          'read_only: true',
          'port: 8000',
          'ratio: 0.5',
          'nothing: null',
          'uid: "10001"',
          'memory: 2Gi',
          'tmpfs: /tmp:size=64m,mode=1777',
        ].join('\n'),
      ),
    ).toEqual({
      read_only: true,
      port: 8000,
      ratio: 0.5,
      nothing: null,
      uid: '10001',
      memory: '2Gi',
      tmpfs: '/tmp:size=64m,mode=1777',
    });
  });

  it('reads anchors, merge keys, folded block scalars and multi-line flow collections', () => {
    expect(
      parseYaml(
        [
          'base: &base',
          '  init: true',
          'service:',
          '  <<: *base',
          '  command: >-',
          '    node -e',
          '    "go()"',
          '  list: [',
          '    a,',
          '    b',
          '  ]',
        ].join('\n'),
      ),
    ).toEqual({
      base: { init: true },
      service: { init: true, command: 'node -e "go()"', list: ['a', 'b'] },
    });
  });

  it('throws on invalid YAML', () => {
    expect(() => parseYaml('a: b: c')).toThrow();
    expect(() => parseYaml('a: [unclosed')).toThrow();
    expect(() => parseYaml('a: 1\na: 2')).toThrow();
  });

  it('throws unless the text holds exactly one document', () => {
    expect(() => parseYaml('# nothing')).toThrow('exactly one');
    expect(() => parseYaml('a: 1\n---\nb: 2')).toThrow('exactly one');
    expect(parseYaml('---\na: 1\n')).toEqual({ a: 1 });
  });
});
