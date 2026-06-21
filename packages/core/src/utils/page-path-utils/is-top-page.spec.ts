import { isTopPage } from './is-top-page';

describe('TopPage Path test', () => {
  test.concurrent('Path is only "/"', () => {
    const result = isTopPage('/');
    expect(result).toBe(true);
  });
  test.concurrent('Path is not match string', () => {
    const result = isTopPage('/test');
    expect(result).toBe(false);
  });
});
