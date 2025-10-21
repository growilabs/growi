import type { Request } from 'express';
import { mock } from 'vitest-mock-extended';

import isSimpleRequest from './is-simple-request';

describe('isSimpleRequest', () => {
  // method
  describe('When request method is checked', () => {
    // allow
    describe('When allowed method is given', () => {
      const allowedMethods = ['GET', 'HEAD', 'POST'];
      it.each(allowedMethods)('returns true for %s method', (method) => {
        const reqMock = mock<Request>();
        reqMock.method = method;
        reqMock.headers = { 'content-type': 'text/plain' };
        expect(isSimpleRequest(reqMock)).toBe(true);
      });
    });

    // disallow
    describe('When disallowed method is given', () => {
      const disallowedMethods = ['PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE'];
      it.each(disallowedMethods)('returns false for %s method', (method) => {
        const reqMock = mock<Request>();
        reqMock.method = method;
        reqMock.headers = {};
        expect(isSimpleRequest(reqMock)).toBe(false);
      });
    });
  });

  // headers
  describe('When request headers are checked', () => {
    // allow(Other than content-type)
    describe('When only safe headers are given', () => {
      const safeHeaders = [
        'accept',
        'accept-language',
        'content-language',
        'range',
        'referer',
        'dpr',
        'downlink',
        'save-data',
        'viewport-width',
        'width',
      ];
      it.each(safeHeaders)('returns true for safe header: %s', (headerName) => {
        const reqMock = mock<Request>();
        reqMock.method = 'POST';
        reqMock.headers = {
          [headerName]: 'test-value',
        };
        expect(isSimpleRequest(reqMock)).toBe(true);
      });
      // content-type
      it('returns true for valid content-type values', () => {
        const validContentTypes = [
          'application/x-www-form-urlencoded',
          'multipart/form-data',
          'text/plain',
        ];
        validContentTypes.forEach((contentType) => {
          const reqMock = mock<Request>();
          reqMock.method = 'POST';
          reqMock.headers = { 'content-type': contentType };
          expect(isSimpleRequest(reqMock)).toBe(true);
        });
      });
      // combination
      it('returns true for combination of safe headers', () => {
        const reqMock = mock<Request>();
        reqMock.method = 'POST';
        reqMock.headers = {
          Accept: 'application/json',
          'content-Type': 'text/plain',
          'Accept-Language': 'en-US',
        };
        expect(isSimpleRequest(reqMock)).toBe(true);
      });
    });

    // disallow
    describe('When unsafe headers are given', () => {
      const unsafeHeaders = [
        'X-Custom-Header',
        'Authorization',
        'X-Requested-With',
        'X-CSRF-Token',
      ];
      it.each(unsafeHeaders)(
        'returns false for unsafe header: %s',
        (headerName) => {
          const reqMock = mock<Request>({
            method: 'POST',
            headers: { [headerName]: 'test-value' },
          });
          expect(isSimpleRequest(reqMock)).toBe(false);
        },
      );
      // combination
      it('returns false when safe and unsafe headers are mixed', () => {
        const reqMock = mock<Request>();
        reqMock.method = 'POST';
        reqMock.headers = {
          Accept: 'application/json', // Safe
          'X-Custom-Header': 'custom-value', // Unsafe
        };
        expect(isSimpleRequest(reqMock)).toBe(false);
      });
    });
  });

  // content-type
  describe('When content-type is checked', () => {
    // allow
    describe('When a safe content-type is given', () => {
      const safeContentTypes = [
        'application/x-www-form-urlencoded',
        'multipart/form-data',
        'text/plain',
        // parameters
        'application/x-www-form-urlencoded; charset=UTF-8',
        'multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW',
        'text/plain; charset=iso-8859-1',
      ];
      it.each(safeContentTypes)('returns true for %s', (contentType) => {
        const reqMock = mock<Request>();
        reqMock.method = 'POST';
        reqMock.headers = {
          'content-type': contentType,
        };
        expect(isSimpleRequest(reqMock)).toBe(true);
      });
    });
    // absent
    describe('When content-type is absent', () => {
      it('returns true when no content-type header is set', () => {
        const reqMock = mock<Request>();
        reqMock.method = 'POST';
        reqMock.headers = {};
        expect(isSimpleRequest(reqMock)).toBe(true);
      });
    });

    // disallow
    describe('When disallowed content-type is given', () => {
      const disallowedContentTypes = [
        'application/json',
        'application/xml',
        'text/html',
        'application/octet-stream',
      ];
      it.each(disallowedContentTypes)('returns false for %s', (contentType) => {
        const reqMock = mock<Request>();
        reqMock.method = 'POST';
        reqMock.headers = { 'content-type': contentType };
        expect(isSimpleRequest(reqMock)).toBe(false);
      });
    });
  });

  // integration
  describe('When multiple conditions are checked', () => {
    describe('When all conditions are met', () => {
      it('returns true', () => {
        const reqMock = mock<Request>();
        reqMock.method = 'POST';
        reqMock.headers = {
          'content-type': 'application/x-www-form-urlencoded',
        };
        expect(isSimpleRequest(reqMock)).toBe(true);
      });
    });

    describe('When method is disallowed but headers are safe', () => {
      it('returns false', () => {
        const reqMock = mock<Request>();
        reqMock.method = 'PUT';
        reqMock.headers = { 'content-type': 'text/plain' };
        expect(isSimpleRequest(reqMock)).toBe(false);
      });
    });

    describe('When method is allowed but headers are non-safe', () => {
      it('returns false', () => {
        const reqMock = mock<Request>();
        reqMock.method = 'POST';
        reqMock.headers = { 'X-Custom-Header': 'custom-value' };
        expect(isSimpleRequest(reqMock)).toBe(false);
      });
    });
  });
});
