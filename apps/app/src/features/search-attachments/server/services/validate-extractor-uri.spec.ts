import { describe, expect, it } from 'vitest';

import { validateExtractorUri } from './validate-extractor-uri';

describe('validateExtractorUri', () => {
  describe('should REJECT with invalid_url', () => {
    it('rejects empty string', () => {
      expect(validateExtractorUri('')).toEqual({
        ok: false,
        reason: 'invalid_url',
      });
    });

    it('rejects non-URI string', () => {
      expect(validateExtractorUri('not-a-uri')).toEqual({
        ok: false,
        reason: 'invalid_url',
      });
    });
  });

  describe('should REJECT with invalid_scheme', () => {
    it('rejects file:// scheme', () => {
      expect(validateExtractorUri('file:///etc/passwd')).toEqual({
        ok: false,
        reason: 'invalid_scheme',
      });
    });

    it('rejects ftp:// scheme', () => {
      expect(validateExtractorUri('ftp://host.example.com/path')).toEqual({
        ok: false,
        reason: 'invalid_scheme',
      });
    });

    it('rejects data: scheme', () => {
      expect(validateExtractorUri('data:text/plain,hello')).toEqual({
        ok: false,
        reason: 'invalid_scheme',
      });
    });

    it('rejects javascript: scheme', () => {
      expect(validateExtractorUri('javascript:alert(1)')).toEqual({
        ok: false,
        reason: 'invalid_scheme',
      });
    });
  });

  describe('should REJECT with metadata_ip', () => {
    it('rejects AWS/GCP/Azure link-local metadata IP (http)', () => {
      expect(
        validateExtractorUri('http://169.254.169.254/latest/meta-data'),
      ).toEqual({ ok: false, reason: 'metadata_ip' });
    });

    it('rejects AWS/GCP/Azure link-local metadata IP (https)', () => {
      expect(validateExtractorUri('https://169.254.169.254')).toEqual({
        ok: false,
        reason: 'metadata_ip',
      });
    });

    it('rejects Alibaba Cloud metadata IP', () => {
      expect(
        validateExtractorUri('http://100.100.100.200/latest/meta-data'),
      ).toEqual({ ok: false, reason: 'metadata_ip' });
    });

    it('rejects GCP internal metadata IP', () => {
      expect(validateExtractorUri('http://192.0.0.192')).toEqual({
        ok: false,
        reason: 'metadata_ip',
      });
    });

    it('rejects AWS IPv6 metadata IP', () => {
      expect(validateExtractorUri('http://[fd00:ec2::254]')).toEqual({
        ok: false,
        reason: 'metadata_ip',
      });
    });
  });

  describe('should ACCEPT (ok: true)', () => {
    it('accepts docker-compose service name', () => {
      expect(validateExtractorUri('http://markitdown-extractor:8000')).toEqual({
        ok: true,
      });
    });

    it('accepts k8s FQDN with .svc.cluster.local', () => {
      expect(
        validateExtractorUri(
          'https://markitdown-extractor.svc.cluster.local:8000',
        ),
      ).toEqual({ ok: true });
    });

    it('accepts k8s FQDN with namespace.svc.cluster.local', () => {
      expect(
        validateExtractorUri(
          'http://markitdown-extractor.default.svc.cluster.local',
        ),
      ).toEqual({ ok: true });
    });

    it('accepts loopback IPv4', () => {
      expect(validateExtractorUri('http://127.0.0.1:8000')).toEqual({
        ok: true,
      });
    });

    it('accepts loopback hostname', () => {
      expect(validateExtractorUri('http://localhost:8000')).toEqual({
        ok: true,
      });
    });

    it('accepts RFC1918 10.x.x.x', () => {
      expect(validateExtractorUri('http://10.0.0.100:8000')).toEqual({
        ok: true,
      });
    });

    it('accepts RFC1918 172.16.x.x', () => {
      expect(validateExtractorUri('http://172.16.0.1:8000')).toEqual({
        ok: true,
      });
    });

    it('accepts RFC1918 192.168.x.x', () => {
      expect(validateExtractorUri('http://192.168.1.1:8000')).toEqual({
        ok: true,
      });
    });

    it('accepts public HTTPS endpoint', () => {
      expect(
        validateExtractorUri('https://external-service.example.com/extract'),
      ).toEqual({ ok: true });
    });
  });
});
