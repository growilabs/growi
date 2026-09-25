import { Types } from 'mongoose';
import { mockDeep } from 'vitest-mock-extended';

import PageRedirect from '~/server/models/page-redirect';
import type { PrismaClient } from '~/utils/prisma';

import type { IPageLink } from '../../interfaces/page-link';
import {
  dropSelfLinks,
  reconcileDeletedPages,
  reResolveByToPath,
  syncOutboundLinks,
} from './page-link-sync';
import { findPagesById, resolveToPageIds } from './target-page-resolution';

const mockPrisma = mockDeep<PrismaClient>();

vi.mock('~/utils/prisma', () => ({
  get prisma() {
    return mockPrisma;
  },
}));

vi.mock('./target-page-resolution', () => ({
  findPagesById: vi.fn(),
  resolveToPageIds: vi.fn(),
  REDIRECT_CHAIN_MAX_DEPTH: 50,
}));

vi.mock('~/server/models/page-redirect', () => ({
  default: { retrieveFromPathsRedirectingTo: vi.fn() },
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

    expect(mockPrisma.pagelinks.replaceOutboundLinks).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pagelinks.replaceOutboundLinks).toHaveBeenCalledWith(
      fromPageId,
      [other, broken],
    );
  });

  it('still calls replaceOutboundLinks with [] when every row is a self-link (clears stale rows)', async () => {
    const fromPageId = new Types.ObjectId();
    const self = row(fromPageId, '/self');

    await syncOutboundLinks(fromPageId, [self]);

    expect(mockPrisma.pagelinks.replaceOutboundLinks).toHaveBeenCalledWith(
      fromPageId,
      [],
    );
  });
});

describe('reResolveByToPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(PageRedirect.retrieveFromPathsRedirectingTo).mockResolvedValue(
      [],
    );
  });

  it('repoints the path at the page the resolver reports for it', async () => {
    const occupant = new Types.ObjectId();
    // Two entries, so reading the wrong key fails instead of passing by luck.
    vi.mocked(resolveToPageIds).mockResolvedValue(
      new Map([
        ['/other', new Types.ObjectId()],
        ['/target', occupant],
      ]),
    );

    await reResolveByToPath('/target');

    // Pin the path handed to the resolver: without this, resolving the wrong
    // path still reads '/target' out of the stubbed map and passes.
    expect(resolveToPageIds).toHaveBeenCalledWith(['/target']);
    expect(mockPrisma.pagelinks.repointInboundLinks).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pagelinks.repointInboundLinks).toHaveBeenCalledWith(
      '/target',
      occupant,
    );
  });

  it('repoints to null when nothing resolves at the path (rows become broken)', async () => {
    // The resolver omits unresolvable inputs; an absent key must become a null
    // write, not a skipped one.
    vi.mocked(resolveToPageIds).mockResolvedValue(new Map());

    await reResolveByToPath('/target');

    expect(resolveToPageIds).toHaveBeenCalledWith(['/target']);
    expect(mockPrisma.pagelinks.repointInboundLinks).toHaveBeenCalledWith(
      '/target',
      null,
    );
  });

  it('resolves and writes the paths that redirect here, not just the path itself', async () => {
    const occupant = new Types.ObjectId();
    const elsewhere = new Types.ObjectId();
    vi.mocked(PageRedirect.retrieveFromPathsRedirectingTo).mockResolvedValue([
      '/old',
      '/older',
    ]);
    // '/older' resolves elsewhere: a redirect reaching '/target' does not make the
    // target the answer, so each candidate carries the resolver's own verdict.
    vi.mocked(resolveToPageIds).mockResolvedValue(
      new Map([
        ['/target', occupant],
        ['/old', occupant],
        ['/older', elsewhere],
      ]),
    );

    await reResolveByToPath('/target');

    expect(resolveToPageIds).toHaveBeenCalledWith([
      '/target',
      '/old',
      '/older',
    ]);
    expect(mockPrisma.pagelinks.repointInboundLinks).toHaveBeenCalledTimes(3);
    expect(mockPrisma.pagelinks.repointInboundLinks).toHaveBeenCalledWith(
      '/target',
      occupant,
    );
    expect(mockPrisma.pagelinks.repointInboundLinks).toHaveBeenCalledWith(
      '/old',
      occupant,
    );
    expect(mockPrisma.pagelinks.repointInboundLinks).toHaveBeenCalledWith(
      '/older',
      elsewhere,
    );
  });
});

/*
 * B5.2 — contract: a page that still exists is left alone; only a truly gone one has its rows
 * settled, and the whole batch settles in one call.
 */
describe('reconcileDeletedPages', () => {
  /**
   * What `findPagesById` resolves to. Always fresh ObjectId instances: a real round
   * trip never hands back the caller's own, and a survivor check keyed on instance identity rather
   * than value passes against reused ones while reporting every page in the batch as gone.
   */
  const resolveFoundPages = (ids: Types.ObjectId[]): void => {
    vi.mocked(findPagesById).mockResolvedValue(
      ids.map((id) => ({ _id: new Types.ObjectId(id.toHexString()) })),
    );
  };

  /** Every id handed to removeLinksForPages, across all calls, as hex. */
  const idsRemoved = (): string[] =>
    mockPrisma.pagelinks.removeLinksForPages.mock.calls
      .flatMap(([ids]) => ids)
      .map((id) => id.toString());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves a page that still exists alone, even when it is only trashed', async () => {
    // A soft delete keeps the document, so the page is found and its rows already read `trashed`.
    const trashed = new Types.ObjectId();
    resolveFoundPages([trashed]);

    await reconcileDeletedPages([trashed]);

    expect(idsRemoved()).toEqual([]);
  });

  it('settles the rows of a page that is truly gone', async () => {
    const gone = new Types.ObjectId();
    resolveFoundPages([]);

    await reconcileDeletedPages([gone]);

    expect(idsRemoved()).toEqual([gone.toString()]);
  });

  it('settles only the gone pages of a mixed batch', async () => {
    const trashed = new Types.ObjectId();
    const gone = new Types.ObjectId();
    resolveFoundPages([trashed]);

    await reconcileDeletedPages([trashed, gone]);

    expect(idsRemoved()).toEqual([gone.toString()]);
  });

  it('settles the whole batch in a single call', async () => {
    // removeLinksForPages sends every id in one command, so never an accumulated list.
    const gone = [
      new Types.ObjectId(),
      new Types.ObjectId(),
      new Types.ObjectId(),
    ];
    resolveFoundPages([]);

    await reconcileDeletedPages(gone);

    expect(mockPrisma.pagelinks.removeLinksForPages).toHaveBeenCalledTimes(1);
  });

  it('does not touch either database for an empty batch', async () => {
    await reconcileDeletedPages([]);

    expect(findPagesById).not.toHaveBeenCalled();
    expect(mockPrisma.pagelinks.removeLinksForPages).not.toHaveBeenCalled();
  });
});
