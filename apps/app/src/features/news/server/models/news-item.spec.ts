import type { INewsItemHasId } from '../../interfaces/news-item';
import { NewsItem } from './news-item';

describe('NewsItem model', () => {
  describe('schema structure', () => {
    test('should have required fields defined in schema', () => {
      const schemaPaths = NewsItem.schema.paths;
      expect(schemaPaths.externalId).toBeDefined();
      expect(schemaPaths.title).toBeDefined();
      expect(schemaPaths.publishedAt).toBeDefined();
      expect(schemaPaths.fetchedAt).toBeDefined();
    });

    test('should have optional fields defined in schema', () => {
      const schemaPaths = NewsItem.schema.paths;
      expect(schemaPaths.body).toBeDefined();
      expect(schemaPaths.emoji).toBeDefined();
      expect(schemaPaths.url).toBeDefined();
      expect(schemaPaths['conditions.targetRoles']).toBeDefined();
    });

    test('externalId should have unique index', () => {
      const externalIdPath = NewsItem.schema.paths.externalId as unknown as {
        options: Record<string, unknown>;
      };
      expect(externalIdPath.options.unique).toBe(true);
    });

    test('fetchedAt should have TTL expires option', () => {
      const schema = NewsItem.schema;
      // Verify TTL index exists by checking index definitions
      const indexes = schema.indexes() as unknown as Array<
        [Record<string, unknown>, Record<string, unknown>]
      >;
      const ttlIndex = indexes.find(
        (indexDef) =>
          indexDef[0].fetchedAt !== undefined &&
          indexDef[1].expireAfterSeconds !== undefined,
      );
      expect(ttlIndex).toBeDefined();
    });
  });

  describe('type compatibility', () => {
    test('should be assignable to INewsItemHasId', () => {
      const item = new NewsItem({
        externalId: 'test-001',
        title: { ja_JP: 'テスト' },
        publishedAt: new Date(),
        fetchedAt: new Date(),
      });
      const typed: INewsItemHasId = item as unknown as INewsItemHasId;
      expect(typed.externalId).toBe('test-001');
    });
  });
});
