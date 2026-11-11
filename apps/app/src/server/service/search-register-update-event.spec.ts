import type { IPage, IUserHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import BookmarkEvent from '~/server/events/bookmark';
import PageEvent, {
  PAGE_EVENT_UPDATE_ABORTED_AFTER_SAVE,
} from '~/server/events/page';
import TagEvent from '~/server/events/tag';

import SearchService from './search';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

vi.mock('~/server/models/named-query', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('~/utils/prisma', () => ({ prisma: {} }));
vi.mock('~/server/service/config-manager/config-manager', () => ({
  default: { getConfig: vi.fn() },
  configManager: { getConfig: vi.fn() },
}));

class TestSearchService extends SearchService {
  // biome-ignore lint/complexity/noUselessConstructor: widens the protected base ctor (factory pattern) to public so the test can instantiate and wire mocks
  public constructor() {
    super();
  }
}

describe('SearchService.registerUpdateEvent()', () => {
  it.each([
    'update',
    PAGE_EVENT_UPDATE_ABORTED_AFTER_SAVE,
  ])("re-indexes the page on a '%s' page event", (eventName) => {
    const eventOwner = mock<Crowi>();
    const pageEvent = new PageEvent(eventOwner);
    const delegator = mock<ElasticsearchDelegator>();
    const service = new TestSearchService();
    service.crowi = mock<Crowi>({
      events: {
        page: pageEvent,
        bookmark: new BookmarkEvent(eventOwner),
        tag: new TagEvent(eventOwner),
      },
    });
    service.fullTextSearchDelegator = delegator;
    service.registerUpdateEvent();
    const page = mock<IPage>();
    const user = mock<IUserHasId>();

    pageEvent.emit(eventName, page, user);

    expect(delegator.syncPageUpdated).toHaveBeenCalledExactlyOnceWith(
      page,
      user,
    );
  });
});
