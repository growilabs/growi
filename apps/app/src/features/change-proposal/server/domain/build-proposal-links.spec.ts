import type { LinkedProposalFacts } from './build-proposal-links';
import { buildProposalLinks } from './build-proposal-links';

const fact = (
  proposalId: string,
  operationKeys: readonly string[],
  overrides: Partial<LinkedProposalFacts> = {},
): LinkedProposalFacts => ({
  proposalId,
  relation: 'follow-up',
  operationKeys,
  isVisibleToViewer: true,
  ...overrides,
});

describe('buildProposalLinks', () => {
  it('returns an empty map when nothing is linked', () => {
    expect(buildProposalLinks(['a'], []).size).toBe(0);
  });

  it('attaches a link to each returned base operation the derived proposal points at', () => {
    const links = buildProposalLinks(['a', 'b'], [fact('p1', ['a', 'b'])]);
    expect(links.get('a')).toEqual([
      { proposalId: 'p1', relation: 'follow-up' },
    ]);
    expect(links.get('b')).toEqual([
      { proposalId: 'p1', relation: 'follow-up' },
    ]);
  });

  it('carries the relation of each derived proposal', () => {
    const links = buildProposalLinks(
      ['a'],
      [fact('p1', ['a']), fact('p2', ['a'], { relation: 'rework' })],
    );
    expect(links.get('a')).toEqual([
      { proposalId: 'p1', relation: 'follow-up' },
      { proposalId: 'p2', relation: 'rework' },
    ]);
  });

  it('does not attach links to base operations that are not returned to the viewer', () => {
    const links = buildProposalLinks(['a'], [fact('p1', ['a', 'hidden'])]);
    expect(links.has('hidden')).toBe(false);
    expect(links.get('a')).toEqual([
      { proposalId: 'p1', relation: 'follow-up' },
    ]);
  });

  it('omits links to proposals the viewer cannot open', () => {
    const links = buildProposalLinks(
      ['a'],
      [
        fact('secret', ['a'], { isVisibleToViewer: false }),
        fact('open', ['a']),
      ],
    );
    expect(links.get('a')).toEqual([
      { proposalId: 'open', relation: 'follow-up' },
    ]);
    expect(JSON.stringify([...links])).not.toContain('secret');
  });

  it('leaves no entry for an operation whose only links are not visible', () => {
    const links = buildProposalLinks(
      ['a'],
      [fact('secret', ['a'], { isVisibleToViewer: false })],
    );
    expect(links.size).toBe(0);
  });

  it('keeps the input order (newest first) per operation', () => {
    const links = buildProposalLinks(
      ['a'],
      [fact('new', ['a']), fact('mid', ['a']), fact('old', ['a'])],
    );
    expect(links.get('a')?.map((l) => l.proposalId)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('exposes only proposalId and relation on each link', () => {
    const links = buildProposalLinks(['a'], [fact('p1', ['a'])]);
    expect(Object.keys(links.get('a')?.[0] ?? {}).sort()).toEqual([
      'proposalId',
      'relation',
    ]);
  });

  it('returns no links when no operation is returned', () => {
    expect(buildProposalLinks([], [fact('p1', ['a'])]).size).toBe(0);
  });

  it('does not mutate its inputs', () => {
    const returned = ['a'];
    const linked = [fact('p1', ['a'])];
    buildProposalLinks(returned, linked);
    expect(returned).toEqual(['a']);
    expect(linked).toEqual([fact('p1', ['a'])]);
  });
});
