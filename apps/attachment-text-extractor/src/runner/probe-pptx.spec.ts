import { buildPptx } from '../../test/fixtures';
import { PROBE_PPTX } from './probe-pptx';

describe('PROBE_PPTX', () => {
  it('is the one-slide deck the fixtures build for the probe text', () => {
    expect(Buffer.from(PROBE_PPTX)).toEqual(
      buildPptx([{ title: 'readiness probe' }]),
    );
  });
});
