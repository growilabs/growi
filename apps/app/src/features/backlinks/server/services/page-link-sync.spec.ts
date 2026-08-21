import { Types } from 'mongoose';

import type { IPageLink } from '../../interfaces/page-link';
// vi.mock is hoisted above these imports, so PageLink is the mocked default export.
import PageLink from '../models/page-link';
import {
  dropSelfLinks,
  reResolveByToPath,
  syncOutboundLinks,
} from './page-link-sync';
import { resolveToPages } from './target-page-resolution';

vi.mock('../models/page-link', () => ({
  default: {
    replaceOutboundLinks: vi.fn(),
    repointInboundLinks: vi.fn(),
  },
}));

vi.mock('./target-page-resolution', () => ({
  resolveToPages: vi.fn(),
}));

const row = (toPage: Types.ObjectId | null, toPath = '/target'): IPageLink => ({
  fromPage: new Types.ObjectId(),
  toPath,
  toPage,
});

describe('dropSelfLinks', () => {
  it('drops a row whose target is the source page itself (self-permalink)', () => {
    const fromPageId = new Types.ObjectId();
    const rows = [row(fromPageId, '/self-by-permalink')];

    const result = dropSelfLinks(fromPageId, rows);

    expect(result).toEqual([]);
  });

  it('drops a self-link when the target is a distinct ObjectId instance with the same value', () => {
    const fromPageId = new Types.ObjectId();
    const target = new Types.ObjectId(fromPageId.toHexString());

    expect(
      dropSelfLinks(fromPageId, [row(target, '/self-by-permalink')]),
    ).toEqual([]);
  });

  it('keeps an unresolved (broken) row — toPage null is not a self-link', () => {
    const fromPageId = new Types.ObjectId();
    const brokenRow = row(null, '/does-not-exist');

    const result = dropSelfLinks(fromPageId, [brokenRow]);

    expect(result).toEqual([brokenRow]);
  });

  it('keeps a row pointing at a different page', () => {
    const fromPageId = new Types.ObjectId();
    const otherRow = row(new Types.ObjectId(), '/other');

    const result = dropSelfLinks(fromPageId, [otherRow]);

    expect(result).toEqual([otherRow]);
  });

  it('drops only the self rows from a mixed set, preserving order', () => {
    const fromPageId = new Types.ObjectId();
    const other = row(new Types.ObjectId(), '/other');
    const broken = row(null, '/broken');
    const self = row(fromPageId, '/self');

    const result = dropSelfLinks(fromPageId, [other, self, broken]);

    expect(result).toEqual([other, broken]);
  });

  it('returns an empty array for empty input', () => {
    expect(dropSelfLinks(new Types.ObjectId(), [])).toEqual([]);
  });

  it('does not mutate its input', () => {
    const fromPageId = new Types.ObjectId();
    const rows = [
      row(fromPageId, '/self'),
      row(new Types.ObjectId(), '/other'),
    ];
    const snapshot = [...rows];

    dropSelfLinks(fromPageId, rows);

    expect(rows).toEqual(snapshot);
  });
});

describe('syncOutboundLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the self-filtered set (broken rows preserved) to replaceOutboundLinks', async () => {
    const fromPageId = new Types.ObjectId();
    const other = row(new Types.ObjectId(), '/other');
    const broken = row(null, '/broken');
    const self = row(fromPageId, '/self');

    await syncOutboundLinks(fromPageId, [other, self, broken]);

    expect(PageLink.replaceOutboundLinks).toHaveBeenCalledTimes(1);
    expect(PageLink.replaceOutboundLinks).toHaveBeenCalledWith(fromPageId, [
      other,
      broken,
    ]);
  });

  it('still calls replaceOutboundLinks with [] when every row is a self-link (clears stale rows)', async () => {
    const fromPageId = new Types.ObjectId();
    const self = row(fromPageId, '/self');

    await syncOutboundLinks(fromPageId, [self]);

    expect(PageLink.replaceOutboundLinks).toHaveBeenCalledWith(fromPageId, []);
  });
});

describe('reResolveByToPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('repoints the path at the page the resolver reports for it', async () => {
    const occupant = new Types.ObjectId();
    // Two entries, so reading the wrong key fails instead of passing by luck.
    vi.mocked(resolveToPages).mockResolvedValue(
      new Map([
        ['/other', new Types.ObjectId()],
        ['/target', occupant],
      ]),
    );

    await reResolveByToPath('/target');

    expect(PageLink.repointInboundLinks).toHaveBeenCalledTimes(1);
    expect(PageLink.repointInboundLinks).toHaveBeenCalledWith(
      '/target',
      occupant,
    );
  });

  it('repoints to null when nothing resolves at the path (rows become broken)', async () => {
    // The resolver omits unresolvable inputs; an absent key must become a null
    // write, not a skipped one.
    vi.mocked(resolveToPages).mockResolvedValue(new Map());

    await reResolveByToPath('/target');

    expect(PageLink.repointInboundLinks).toHaveBeenCalledWith('/target', null);
  });
});
