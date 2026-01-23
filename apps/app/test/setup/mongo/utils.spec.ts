import { describe, expect, it } from 'vitest';

import { replaceMongoDbName } from './utils';

describe('replaceMongoDbName', () => {
  describe('single-host URIs', () => {
    it('should replace database name in basic URI', () => {
      const result = replaceMongoDbName(
        'mongodb://localhost:27017/growi_test',
        'new_db',
      );
      expect(result).toBe('mongodb://localhost:27017/new_db');
    });

    it('should add database name when URI has no database', () => {
      const result = replaceMongoDbName('mongodb://localhost:27017', 'new_db');
      expect(result).toBe('mongodb://localhost:27017/new_db');
    });

    it('should add database name when URI ends with slash', () => {
      const result = replaceMongoDbName('mongodb://localhost:27017/', 'new_db');
      expect(result).toBe('mongodb://localhost:27017/new_db');
    });

    it('should preserve query parameters', () => {
      const result = replaceMongoDbName(
        'mongodb://localhost:27017?param=value',
        'new_db',
      );
      expect(result).toBe('mongodb://localhost:27017/new_db?param=value');
    });

    it('should replace database name and preserve query parameters', () => {
      const result = replaceMongoDbName(
        'mongodb://localhost:27017/growi_test?param=value',
        'new_db',
      );
      expect(result).toBe('mongodb://localhost:27017/new_db?param=value');
    });

    it('should handle authentication credentials', () => {
      const result = replaceMongoDbName(
        'mongodb://user:pass@localhost:27017/growi_test',
        'new_db',
      );
      expect(result).toBe('mongodb://user:pass@localhost:27017/new_db');
    });

    it('should handle authentication credentials with query parameters', () => {
      const result = replaceMongoDbName(
        'mongodb://user:pass@localhost:27017/growi_test?authSource=admin',
        'new_db',
      );
      expect(result).toBe(
        'mongodb://user:pass@localhost:27017/new_db?authSource=admin',
      );
    });

    it('should handle URL-encoded credentials', () => {
      const result = replaceMongoDbName(
        'mongodb://user%40name:p%40ss@localhost:27017/growi_test',
        'new_db',
      );
      expect(result).toBe(
        'mongodb://user%40name:p%40ss@localhost:27017/new_db',
      );
    });
  });

  describe('replica set URIs (multiple hosts)', () => {
    it('should replace database name in replica set URI', () => {
      const result = replaceMongoDbName(
        'mongodb://host1:27017,host2:27017/growi_test?replicaSet=rs0',
        'new_db',
      );
      expect(result).toBe(
        'mongodb://host1:27017,host2:27017/new_db?replicaSet=rs0',
      );
    });

    it('should add database name to replica set URI without database', () => {
      const result = replaceMongoDbName(
        'mongodb://host1:27017,host2:27017,host3:27017?replicaSet=rs0',
        'new_db',
      );
      expect(result).toBe(
        'mongodb://host1:27017,host2:27017,host3:27017/new_db?replicaSet=rs0',
      );
    });

    it('should handle replica set URI with authentication', () => {
      const result = replaceMongoDbName(
        'mongodb://user:pass@host1:27017,host2:27017/growi_test?replicaSet=rs0',
        'new_db',
      );
      expect(result).toBe(
        'mongodb://user:pass@host1:27017,host2:27017/new_db?replicaSet=rs0',
      );
    });

    it('should handle replica set URI without query parameters', () => {
      const result = replaceMongoDbName(
        'mongodb://host1:27017,host2:27017/growi_test',
        'new_db',
      );
      expect(result).toBe('mongodb://host1:27017,host2:27017/new_db');
    });
  });

  describe('edge cases', () => {
    it('should handle different database names', () => {
      const result = replaceMongoDbName(
        'mongodb://localhost:27017/growi_test',
        'growi_test_1',
      );
      expect(result).toBe('mongodb://localhost:27017/growi_test_1');
    });

    it('should handle database names with underscores and numbers', () => {
      const result = replaceMongoDbName(
        'mongodb://localhost:27017/old_db_123',
        'new_db_456',
      );
      expect(result).toBe('mongodb://localhost:27017/new_db_456');
    });

    it('should preserve all query parameters', () => {
      const result = replaceMongoDbName(
        'mongodb://localhost:27017/growi_test?authSource=admin&retryWrites=true&w=majority',
        'new_db',
      );
      expect(result).toBe(
        'mongodb://localhost:27017/new_db?authSource=admin&retryWrites=true&w=majority',
      );
    });
  });

  describe('error handling', () => {
    it('should throw error for invalid URI protocol', () => {
      // mongodb-connection-string-url validates protocol
      expect(() =>
        replaceMongoDbName('http://localhost:27017/db', 'new_db'),
      ).toThrow();
    });

    it('should throw error for malformed URI', () => {
      expect(() => replaceMongoDbName('not-a-uri', 'new_db')).toThrow();
    });
  });
});
