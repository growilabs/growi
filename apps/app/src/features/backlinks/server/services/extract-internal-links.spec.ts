import { extractInternalLinks } from './extract-internal-links';

describe('extractInternalLinks()', () => {
  it('extracts HTML relative path link', async () => {
    const pageString = '<a href="./new">here</a>';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/page/new']);
  });

  it('extracts markdown relative path link', async () => {
    const pageString = '[test](./new)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/page/new']);
  });

  it('extracts HTML absolute path link', async () => {
    const pageString = '<a href="/docs/v2">here</a>';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/docs/v2']);
  });

  it('extracts markdown absolute path link', async () => {
    const pageString = '[one](/docs/v2)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/docs/v2']);
  });

  it('extracts absolute wiki-link', async () => {
    const pageString = '[[/docs/old]]';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/docs/old']);
  });

  it('extracts relative wiki-link', async () => {
    const pageString = '[[docs]]';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/page/test/docs']);
  });

  it('extracts internal URL link', async () => {
    const pageString = 'https://test.com/folders/doc';
    const pagePath = '/page/test';
    const siteUrl = 'https://test.com/';

    const links = await extractInternalLinks(pageString, pagePath, siteUrl);

    expect(links).toStrictEqual(['/folders/doc']);
  });

  it('extracts permalink', async () => {
    const pageString = 'https://test.com/6a4b6790f4032d50076f8eba';
    const pagePath = '/page/test';
    const siteUrl = 'https://test.com';

    const links = await extractInternalLinks(pageString, pagePath, siteUrl);

    expect(links).toStrictEqual(['/6a4b6790f4032d50076f8eba']);
  });

  it('extracts and decodes a non-ASCII path', async () => {
    const pageString = '[x](/親ページ/子)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/親ページ/子']);
  });

  it('does not extract external link', async () => {
    const pageString = 'https://other.com/folders/doc';
    const pagePath = '/page/test';
    const siteUrl = 'https://test.com/';

    const links = await extractInternalLinks(pageString, pagePath, siteUrl);

    expect(links).toStrictEqual([]);
  });

  it('does not extract an absolute URL when siteUrl is unset', async () => {
    const pageString = 'https://test.com/folders/doc';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual([]);
  });

  it('does not extract anchor link', async () => {
    const pageString = '[jump to 5](#section-5)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual([]);
  });

  it('does not extract link to self', async () => {
    const pageString = '[self](/page/test)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual([]);
  });

  it('does not extract link to non-creatable page', async () => {
    const pageString = '<a href="/trash/old-page">here</a>';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual([]);
  });

  it('skips a malformed link without dropping valid ones', async () => {
    const pageString = '[good](/docs/v2) [bad](http://)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/docs/v2']);
  });

  it('skips a link with invalid percent-encoding without dropping valid ones', async () => {
    const pageString = '[bad](/deals/50%off) [good](/docs/v2)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/docs/v2']);
  });

  it('strips hash and query from internal link', async () => {
    const pageString = '[a](/docs/v2#section?x=1)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/docs/v2']);
  });

  it('normalized and deduplicates trailing-slash variants', async () => {
    const pageString = '[a](/docs/v2) [a](/docs/v2/)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/docs/v2']);
  });

  it('deduplicates links pointing to the same site', async () => {
    const pageString = '[one](/docs/v2) [two](/docs/v2)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/docs/v2']);
  });

  it('extracts multiple distinct links', async () => {
    const pageString = '[one](/docs/v1) [two](/docs/v2)';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual(['/docs/v1', '/docs/v2']);
  });

  it('keeps internal links while dropping external and self in one body', async () => {
    const pageString =
      '[keep](/docs/v2) [ext](https://other.com/x) [self](/page/test)';
    const pagePath = '/page/test';
    const siteUrl = 'https://test.com';

    const links = await extractInternalLinks(pageString, pagePath, siteUrl);

    expect(links).toStrictEqual(['/docs/v2']);
  });

  it('returns empty array on empty body', async () => {
    const pageString = '';
    const pagePath = '/page/test';

    const links = await extractInternalLinks(pageString, pagePath);

    expect(links).toStrictEqual([]);
  });
});
