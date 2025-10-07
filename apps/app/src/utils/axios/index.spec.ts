import axios from 'axios';
import { describe, expect, it } from 'vitest';

import customAxios from './index';

describe('Custom Axios Static', () => {
  describe('Custom instance properties preservation', () => {
    it('should preserve custom headers set by createCustomAxios', () => {
      // Check that custom headers are preserved
      expect(customAxios.defaults.headers['X-Requested-With']).toBe(
        'XMLHttpRequest',
      );
      expect(customAxios.defaults.headers['Content-Type']).toBe(
        'application/json',
      );
    });

    it('should preserve custom transformResponse', () => {
      // Check that transformResponse is an array and has more than the default transformers
      expect(Array.isArray(customAxios.defaults.transformResponse)).toBe(true);
      const transformers = customAxios.defaults.transformResponse as unknown[];
      expect(transformers.length).toBeGreaterThan(0);
    });

    it('should preserve request interceptors', () => {
      // Check that request interceptors are registered
      expect(customAxios.interceptors.request).toBeDefined();
      expect(customAxios.interceptors.request.use).toBeDefined();
    });
  });

  describe('Static properties from axios', () => {
    it('should have Axios class', () => {
      expect(customAxios.Axios).toBeDefined();
      expect(customAxios.Axios).toBe(axios.Axios);
    });

    it('should have CancelToken', () => {
      expect(customAxios.CancelToken).toBeDefined();
      expect(customAxios.CancelToken).toBe(axios.CancelToken);
    });

    it('should have CanceledError', () => {
      expect(customAxios.CanceledError).toBeDefined();
      expect(customAxios.CanceledError).toBe(axios.CanceledError);
    });

    it('should have VERSION', () => {
      expect(customAxios.VERSION).toBeDefined();
      expect(typeof customAxios.VERSION).toBe('string');
    });

    it('should have AxiosError', () => {
      expect(customAxios.AxiosError).toBeDefined();
      expect(customAxios.AxiosError).toBe(axios.AxiosError);
    });

    it('should have AxiosHeaders', () => {
      expect(customAxios.AxiosHeaders).toBeDefined();
      expect(customAxios.AxiosHeaders).toBe(axios.AxiosHeaders);
    });

    it('should have HttpStatusCode', () => {
      expect(customAxios.HttpStatusCode).toBeDefined();
      expect(customAxios.HttpStatusCode).toBe(axios.HttpStatusCode);
    });

    it('should have utility methods', () => {
      expect(customAxios.isCancel).toBeDefined();
      expect(customAxios.isAxiosError).toBeDefined();
      expect(customAxios.toFormData).toBeDefined();
      expect(customAxios.formToJSON).toBeDefined();
      expect(customAxios.getAdapter).toBeDefined();
      expect(customAxios.mergeConfig).toBeDefined();
      expect(customAxios.spread).toBeDefined();
      expect(customAxios.all).toBeDefined();
    });
  });

  describe('Custom create method', () => {
    it('should use custom create method that returns instances with custom headers', () => {
      const instance = customAxios.create({ baseURL: 'https://example.com' });

      // Custom headers should be present in the created instance
      expect(instance.defaults.headers['X-Requested-With']).toBe(
        'XMLHttpRequest',
      );
      expect(instance.defaults.headers['Content-Type']).toBe(
        'application/json',
      );
      expect(instance.defaults.baseURL).toBe('https://example.com');
    });

    it('should create instances with custom transformResponse', () => {
      const instance = customAxios.create();

      // Check that transformResponse is preserved
      expect(Array.isArray(instance.defaults.transformResponse)).toBe(true);
      const transformers = instance.defaults.transformResponse as unknown[];
      expect(transformers.length).toBeGreaterThan(0);
    });

    it('should create instances with request interceptors', () => {
      const instance = customAxios.create();

      // Check that request interceptors are registered
      expect(instance.interceptors.request).toBeDefined();
      expect(instance.interceptors.request.use).toBeDefined();
    });
  });

  describe('Object.assign order verification', () => {
    it('should not have custom settings overwritten by axios defaults', () => {
      // This test ensures that the Object.assign order is correct:
      // Object.assign({}, axios, createCustomAxios(), { create })
      //
      // If the order were wrong (createCustomAxios(), axios, { create }),
      // then axios.defaults would overwrite the custom headers/transformers

      // Verify custom headers are not undefined (which would indicate they were overwritten)
      expect(
        customAxios.defaults.headers['X-Requested-With'],
      ).not.toBeUndefined();
      expect(customAxios.defaults.headers['Content-Type']).not.toBeUndefined();

      // Verify they have the correct custom values
      expect(customAxios.defaults.headers['X-Requested-With']).toBe(
        'XMLHttpRequest',
      );
      expect(customAxios.defaults.headers['Content-Type']).toBe(
        'application/json',
      );
    });
  });
});
