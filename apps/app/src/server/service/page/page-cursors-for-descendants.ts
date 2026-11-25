import type { Cursor, HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { Readable } from 'stream';

import type { PageDocument, PageModel } from '~/server/models/page';

import { BULK_REINDEX_SIZE } from './consts';

// TODO: improve type
export class PageCursorsForDescendantsFactory {
  private user: any; // TODO: Typescriptize model

  private rootPage: any; // TODO: wait for mongoose update

  private shouldIncludeEmpty: boolean;

  private initialCursor: Cursor<any> | never[]; // TODO: wait for mongoose update

  constructor(user: any, rootPage: any, shouldIncludeEmpty: boolean) {
    this.user = user;
    this.rootPage = rootPage;
    this.shouldIncludeEmpty = shouldIncludeEmpty;
  }

  // prepare initial cursor
  private async init() {
    const initialCursor = await this.generateCursorToFindChildren(
      this.rootPage,
    );
    this.initialCursor = initialCursor;
  }

  /**
   * Returns Iterable that yields only descendant pages unorderedly
   * @returns Promise<AsyncGenerator>
   */
  async generateIterable(): Promise<AsyncGenerator<PageDocument> | never[]> {
    // initialize cursor
    await this.init();

    return this.isNeverArray(this.initialCursor)
      ? []
      : this.generateOnlyDescendants(this.initialCursor);
  }

  /**
   * Returns Readable that produces only descendant pages unorderedly
   * @returns Promise<Readable>
   */
  async generateReadable(): Promise<Readable> {
    return Readable.from(await this.generateIterable());
  }

  /**
   * Generator that unorderedly yields descendant pages (lean documents)
   */
  private async *generateOnlyDescendants(
    cursor: Cursor<PageDocument>,
  ): AsyncGenerator<PageDocument> {
    // Leaving the for-await early (the consumer breaking or throwing reaches
    // here as return()) does not close a QueryCursor, so close it explicitly.
    try {
      for await (const page of cursor) {
        const nextCursor = await this.generateCursorToFindChildren(page);
        if (!this.isNeverArray(nextCursor)) {
          yield* this.generateOnlyDescendants(nextCursor); // recursively yield
        }

        yield page;
      }
    } finally {
      await cursor.close();
    }
  }

  private async generateCursorToFindChildren(
    page: any,
  ): Promise<Cursor<any> | never[]> {
    if (page == null) {
      return [];
    }

    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );
    const { PageQueryBuilder } = Page;

    const builder = new PageQueryBuilder(Page.find(), this.shouldIncludeEmpty);
    builder.addConditionToFilteringByParentId(page._id);

    const cursor = builder.query
      .lean()
      .cursor({ batchSize: BULK_REINDEX_SIZE }) as Cursor<any>;

    return cursor;
  }

  private isNeverArray(val: Cursor<any> | never[]): val is never[] {
    return 'length' in val && val.length === 0;
  }
}
