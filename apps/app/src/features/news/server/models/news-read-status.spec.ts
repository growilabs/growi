import { NewsReadStatus } from './news-read-status';

describe('NewsReadStatus model', () => {
  describe('schema structure', () => {
    test('should have userId and newsItemId fields', () => {
      const schemaPaths = NewsReadStatus.schema.paths;
      expect(schemaPaths.userId).toBeDefined();
      expect(schemaPaths.newsItemId).toBeDefined();
    });

    test('should have readAt field', () => {
      const schemaPaths = NewsReadStatus.schema.paths;
      expect(schemaPaths.readAt).toBeDefined();
    });

    test('should have compound unique index on userId + newsItemId', () => {
      const schema = NewsReadStatus.schema;
      const indexes = schema.indexes() as unknown as Array<
        [Record<string, unknown>, Record<string, unknown>]
      >;
      const compoundIndex = indexes.find((indexDef) => {
        const fieldKeys = Object.keys(indexDef[0]);
        return fieldKeys.includes('userId') && fieldKeys.includes('newsItemId');
      });
      expect(compoundIndex).toBeDefined();
      expect(compoundIndex?.[1].unique).toBe(true);
    });
  });
});
