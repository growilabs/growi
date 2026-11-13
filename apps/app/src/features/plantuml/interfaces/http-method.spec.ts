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

  describe('explicit POST setting', () => {
    it.each([
      ['post', 'http://localhost:8080/plantuml'],
      ['POST', 'https://plantuml.example.com'],
      ['Post', 'https://www.plantuml.com/plantuml'],
      ['post', 'https://plantuml.com/plantuml'],
    ])('returns post for configured %s even with URI %s', (configured, uri) => {
      expect(resolvePlantumlHttpMethod(uri, configured)).toBe('post');
    });

    it.each([
      ['', 'an empty destination'],
      ['not a url', 'an unparseable destination'],
    ])('still returns get for %j (%s)', (uri) => {
      expect(resolvePlantumlHttpMethod(uri, 'post')).toBe('get');
    });
  });

  describe('configured values other than get and post are ignored', () => {
    it.each([
      ['foo', 'http://localhost:8080/plantuml', 'post'],
      ['foo', 'https://www.plantuml.com/plantuml', 'get'],
      ['', 'http://localhost:8080/plantuml', 'post'],
      ['', 'https://www.plantuml.com/plantuml', 'get'],
    ])('configured %j with %s -> %s', (configured, uri, expected) => {
      expect(resolvePlantumlHttpMethod(uri, configured)).toBe(expected);
    });
  });
});
