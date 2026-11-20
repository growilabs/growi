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

  describe('should REJECT other spellings of a metadata address', () => {
    it.each([
      ['the IPv4-mapped IPv6 form', 'http://[::ffff:169.254.169.254]/'],
      ['the IPv4-mapped IPv6 form in hex', 'http://[::ffff:a9fe:a9fe]/'],
      ['an IPv4-mapped Alibaba address', 'http://[::ffff:100.100.100.200]/'],
      ['a decimal IPv4 literal', 'http://2852039166/'],
      ['a hexadecimal IPv4 literal', 'http://0xa9fea9fe/'],
      ['another link-local IPv4 address', 'http://169.254.1.1:8000/'],
      ['the start of the link-local range', 'http://169.254.0.0/'],
      ['the end of the link-local range', 'http://169.254.255.255/'],
      ['an expanded AWS IPv6 address', 'http://[fd00:ec2:0:0:0:0:0:254]/'],
      [
        'the GCP metadata host name',
        'http://metadata.google.internal/computeMetadata/v1',
      ],
      [
        'the GCP metadata host name in upper case',
        'http://METADATA.GOOGLE.INTERNAL/',
      ],
      [
        'the GCP metadata host name with a trailing dot',
        'http://metadata.google.internal./',
      ],
    ])('rejects %s', (_label, uri) => {
      expect(validateExtractorUri(uri)).toEqual({
        ok: false,
        reason: 'metadata_ip',
      });
    });
  });

  describe('should ACCEPT (ok: true)', () => {
    it.each([
      ['an address next to the link-local range', 'http://169.253.255.255/'],
      ['an address after the link-local range', 'http://169.255.0.1/'],
      ['an IPv4-mapped private address', 'http://[::ffff:10.0.0.1]/'],
      ['IPv6 loopback', 'http://[::1]:8000/'],
      [
        'a host name that only contains the metadata name',
        'http://metadata.google.internal.example.com/',
      ],
    ])('accepts %s', (_label, uri) => {
      expect(validateExtractorUri(uri)).toEqual({ ok: true });
    });

    it('accepts docker-compose service name', () => {
      expect(
        validateExtractorUri('http://attachment-text-extractor:8000'),
      ).toEqual({
        ok: true,
      });
    });

    it('accepts k8s FQDN with .svc.cluster.local', () => {
      expect(
        validateExtractorUri(
          'https://attachment-text-extractor.svc.cluster.local:8000',
        ),
      ).toEqual({ ok: true });
    });

    it('accepts k8s FQDN with namespace.svc.cluster.local', () => {
      expect(
        validateExtractorUri(
          'http://attachment-text-extractor.default.svc.cluster.local',
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
