import { generatePathsToMatch } from './generate-paths-to-match';

describe('generatePathsToMatch', () => {
  it('expands a deep path into itself plus each ancestor as a wildcard, most specific first', () => {
    // This is the exact behavior GlobalNotificationSetting.findSettingByPathAndEvent
    // relied on before the extraction (chat-integration-app design.md "パス条件の
    // 突き合わせを二重に書かない"). Any change here would silently change which
    // path-scoped notification settings match a saved page for BOTH Gen 1 and
    // Gen 2, so this is pinned as a regression guard.
    expect(generatePathsToMatch('/a/b/c')).toEqual([
      '/a/b/c',
      '/a/b/*',
      '/a/*',
      '/*',
    ]);
  });

  it('treats the root path as its own match with no wildcard suffix', () => {
    expect(generatePathsToMatch('/')).toEqual(['/']);
  });

  it('expands a one-level path into itself plus the root wildcard', () => {
    expect(generatePathsToMatch('/a')).toEqual(['/a', '/*']);
  });
});
