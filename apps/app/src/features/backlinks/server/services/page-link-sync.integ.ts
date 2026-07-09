import { Types } from 'mongoose';

import type { IPageLink } from '../../interfaces/page-link';
import PageLink from '../models/page-link';
import { syncOutboundLinks } from './page-link-sync';

describe('syncOutboundLinks (integration)', () => {
  const fromPage = new Types.ObjectId();

  beforeEach(async () => {
    await PageLink.deleteMany({ fromPage });
  });

  // Fetch this page's outbound rows in a stable, comparable shape.
  const outboundRows = () =>
    PageLink.find({ fromPage })
      .select('toPath toPage -_id')
      .sort({ toPath: 1 })
      .lean();

  it('is idempotent — running twice with the same set yields identical rows', async () => {
    const targetA = new Types.ObjectId();
    const rows: IPageLink[] = [
      { fromPage, toPath: '/a', toPage: targetA },
      // a broken row (unresolved target) must survive both runs, not be re-churned
      { fromPage, toPath: '/missing', toPage: null },
    ];
    // Absolute expectation: the resolved target id is cached in toPage, and the
    // broken row is stored with a null target.
    const expected = [
      { toPath: '/a', toPage: targetA },
      { toPath: '/missing', toPage: null },
    ];

    await syncOutboundLinks(fromPage, rows);
    const afterFirst = await outboundRows();

    await syncOutboundLinks(fromPage, rows);
    const afterSecond = await outboundRows();

    // Content is correct after the first run...
    expect(afterFirst).toEqual(expected);
    // ...and the second run changes nothing: no duplicate insert on the
    // { fromPage, toPath } upsert filter, no deletion+reinsert churn.
    expect(afterSecond).toEqual(expected);
  });

  it('replaces the previous set — removes dropped links, adds new ones, keeps unchanged', async () => {
    const targetA = new Types.ObjectId();
    const targetB = new Types.ObjectId();
    const targetC = new Types.ObjectId();

    await syncOutboundLinks(fromPage, [
      { fromPage, toPath: '/a', toPage: targetA },
      { fromPage, toPath: '/b', toPage: targetB },
    ]);

    // /b removed, /c added, /a unchanged
    await syncOutboundLinks(fromPage, [
      { fromPage, toPath: '/a', toPage: targetA },
      { fromPage, toPath: '/c', toPage: targetC },
    ]);

    const rows = await outboundRows();
    // Assert full rows: /a keeps its original target, /c is added, /b is gone.
    expect(rows).toEqual([
      { toPath: '/a', toPage: targetA },
      { toPath: '/c', toPage: targetC },
    ]);
  });

  it('excludes a self-permalink row end-to-end', async () => {
    const other = new Types.ObjectId();

    await syncOutboundLinks(fromPage, [
      { fromPage, toPath: '/other', toPage: other },
      // link to the source page's own permalink — must never become its own backlink
      { fromPage, toPath: `/${fromPage.toString()}`, toPage: fromPage },
    ]);

    const rows = await outboundRows();
    // Only the non-self link survives, with its target cached.
    expect(rows).toEqual([{ toPath: '/other', toPage: other }]);
  });

  it('clears all outbound rows when the page has no links left', async () => {
    const targetA = new Types.ObjectId();
    await syncOutboundLinks(fromPage, [
      { fromPage, toPath: '/a', toPage: targetA },
    ]);
    expect(await outboundRows()).toHaveLength(1);

    await syncOutboundLinks(fromPage, []);

    expect(await outboundRows()).toEqual([]);
  });
});
