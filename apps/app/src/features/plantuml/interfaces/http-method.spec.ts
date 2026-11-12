import { resolvePlantumlHttpMethod } from './http-method';

describe('resolvePlantumlHttpMethod', () => {
  describe('explicit GET setting', () => {
    it.each([
      ['get', 'http://localhost:8080/plantuml'],
      ['GET', 'http://localhost:8080/plantuml'],
      ['Get', 'https://plantuml.example.com'],
    ])('returns get for configured %s even with self-hosted URI %s', (configured, uri) => {
      expect(resolvePlantumlHttpMethod(uri, configured)).toBe('get');
    });
  });

  describe('auto-selection from the destination', () => {
    it.each([
      ['https://www.plantuml.com/plantuml', 'get'],
      ['https://plantuml.com/plantuml', 'get'],
      ['https://WWW.PLANTUML.COM/plantuml', 'get'],
      ['http://localhost:8080/plantuml', 'post'],
      ['https://plantuml.example.com', 'post'],
      ['https://plantuml.com.example.org', 'post'],
      ['https://notplantuml.com', 'post'],
      ['', 'get'],
      ['not a url', 'get'],
    ])('returns %s -> %s when unset', (uri, expected) => {
      expect(resolvePlantumlHttpMethod(uri, undefined)).toBe(expected);
    });
  });

  describe('configured values other than get are ignored', () => {
    it.each([
      ['post', 'http://localhost:8080/plantuml', 'post'],
      ['post', 'https://www.plantuml.com/plantuml', 'get'],
      ['foo', 'http://localhost:8080/plantuml', 'post'],
      ['foo', 'https://www.plantuml.com/plantuml', 'get'],
      ['', 'http://localhost:8080/plantuml', 'post'],
      ['', 'https://www.plantuml.com/plantuml', 'get'],
    ])('configured %j with %s -> %s', (configured, uri, expected) => {
      expect(resolvePlantumlHttpMethod(uri, configured)).toBe(expected);
    });
  });
});
