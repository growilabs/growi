import { getDepthOfPath } from './depth-utils';

describe('getDepthOfPath()', () => {
  it('returns 0 when the path does not include slash', () => {
    // when
    const result = getDepthOfPath('Sandbox');

    // then
    expect(result).toBe(0);
  });
});
