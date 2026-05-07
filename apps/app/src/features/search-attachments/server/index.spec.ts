import { initAttachmentFullTextSearch } from './index';

describe('initAttachmentFullTextSearch', () => {
  it('is a function that accepts crowi and returns void', () => {
    expect(typeof initAttachmentFullTextSearch).toBe('function');
    expect(initAttachmentFullTextSearch({})).toBeUndefined();
  });
});
