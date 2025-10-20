import {
  convertToNewAffiliationPath,
  getUsernameByPath,
  isCreatablePage,
  isMovablePage,
  isTopPage,
  isUsersProtectedPages,
  omitDuplicateAreaPathFromPaths,
} from './index';

describe.concurrent('isMovablePage test', () => {
  test('should decide movable or not', () => {
    expect(isMovablePage('/')).toBeFalsy();
    expect(isMovablePage('/hoge')).toBeTruthy();
    expect(isMovablePage('/user')).toBeFalsy();
    expect(isMovablePage('/user/xxx')).toBeFalsy();
    expect(isMovablePage('/user/xxx123')).toBeFalsy();
    expect(isMovablePage('/user/xxx/hoge')).toBeTruthy();
  });
});

describe.concurrent('isTopPage test', () => {
  test('should decide deletable or not', () => {
    expect(isTopPage('/')).toBeTruthy();
    expect(isTopPage('/hoge')).toBeFalsy();
    expect(isTopPage('/user/xxx/hoge')).toBeFalsy();
  });
});

describe.concurrent('isUsersProtectedPages test', () => {
  test('Should decide users protected pages or not', () => {
    expect(isUsersProtectedPages('/hoge')).toBeFalsy();
    expect(isUsersProtectedPages('/user')).toBeTruthy();
    expect(isUsersProtectedPages('/user/xxx')).toBeTruthy();
    expect(isUsersProtectedPages('/user/xxx123')).toBeTruthy();
    expect(isUsersProtectedPages('/user/xxx/hoge')).toBeFalsy();
  });
});

describe.concurrent('convertToNewAffiliationPath test', () => {
  test.concurrent('Child path is not converted normally', () => {
    const result = convertToNewAffiliationPath(
      'parent/',
      'parent2/',
      'parent/child',
    );
    expect(result).toBe('parent2/child');
  });

  test.concurrent('Parent path is not converted normally', () => {
    const result = convertToNewAffiliationPath(
      'parent/',
      'parent3/',
      'parent/child',
    );
    expect(result === 'parent/child').toBe(false);
  });

  test.concurrent(
    'Parent and Child path names are switched unexpectedly',
    () => {
      const result = convertToNewAffiliationPath(
        'parent/',
        'parent4/',
        'parent/child',
      );
      expect(result === 'child/parent4').toBe(false);
    },
  );
});

describe.concurrent('isCreatablePage test', () => {
  test('should decide creatable or not', () => {
    expect(isCreatablePage('/hoge')).toBeTruthy();

    // starts with multiple slash
    expect(isCreatablePage('//multiple-slash')).toBeFalsy();

    // edge cases
    expect(isCreatablePage('/me')).toBeFalsy();
    expect(isCreatablePage('/me/')).toBeFalsy();
    expect(isCreatablePage('/me/x')).toBeFalsy();
    expect(isCreatablePage('/meeting')).toBeTruthy();
    expect(isCreatablePage('/meeting/x')).toBeTruthy();

    // end with "edit"
    expect(isCreatablePage('/meeting/edit')).toBeFalsy();

    // under score
    expect(isCreatablePage('/_')).toBeTruthy();
    expect(isCreatablePage('/_template')).toBeTruthy();
    expect(isCreatablePage('/__template')).toBeTruthy();
    expect(isCreatablePage('/_r/x')).toBeFalsy();
    expect(isCreatablePage('/_api')).toBeFalsy();
    expect(isCreatablePage('/_apix')).toBeFalsy();
    expect(isCreatablePage('/_api/x')).toBeFalsy();

    expect(isCreatablePage('/hoge/xx.md')).toBeFalsy();

    // relative path
    expect(isCreatablePage('/..')).toBeFalsy();
    expect(isCreatablePage('/../page')).toBeFalsy();
    expect(isCreatablePage('/page/..')).toBeFalsy();
    expect(isCreatablePage('/page/../page')).toBeFalsy();

    // start with https?
    expect(isCreatablePage('/http://demo.growi.org/hoge')).toBeFalsy();
    expect(isCreatablePage('/https://demo.growi.org/hoge')).toBeFalsy();
    expect(isCreatablePage('http://demo.growi.org/hoge')).toBeFalsy();
    expect(isCreatablePage('https://demo.growi.org/hoge')).toBeFalsy();

    // include backslash
    expect(isCreatablePage('/foo\\/bar')).toBeFalsy();
    expect(isCreatablePage('/foo\\\\bar')).toBeFalsy();

    expect(isCreatablePage('/_search')).toBeFalsy();
    expect(isCreatablePage('/_search/foo')).toBeFalsy();
    expect(isCreatablePage('/_private-legacy-pages')).toBeFalsy();
    expect(isCreatablePage('/_private-legacy-pages/foo')).toBeFalsy();

    expect(isCreatablePage('/ the / path / with / space')).toBeFalsy();

    const forbidden = [
      'installer',
      'register',
      'login',
      'logout',
      'admin',
      'files',
      'trash',
      'paste',
      'comments',
    ];
    for (let i = 0; i < forbidden.length; i++) {
      const pn = forbidden[i];
      expect(isCreatablePage(`/${pn}`)).toBeFalsy();
      expect(isCreatablePage(`/${pn}/`)).toBeFalsy();
      expect(isCreatablePage(`/${pn}/abc`)).toBeFalsy();
    }
  });

  describe.concurrent('Test omitDuplicateAreaPathFromPaths', () => {
    test.concurrent('Should not omit when all paths are at unique area', () => {
      const paths = ['/A', '/B/A', '/C/B/A', '/D'];
      const expectedPaths = paths;

      expect(omitDuplicateAreaPathFromPaths(paths)).toStrictEqual(
        expectedPaths,
      );
    });

    test.concurrent(
      'Should omit when some paths are at duplicated area',
      () => {
        const paths = ['/A', '/A/A', '/A/B/A', '/B', '/B/A', '/AA'];
        const expectedPaths = ['/A', '/B', '/AA'];

        expect(omitDuplicateAreaPathFromPaths(paths)).toStrictEqual(
          expectedPaths,
        );
      },
    );

    test.concurrent(
      'Should omit when some long paths are at duplicated area',
      () => {
        const paths = ['/A/B/C', '/A/B/C/D', '/A/B/C/D/E'];
        const expectedPaths = ['/A/B/C'];

        expect(omitDuplicateAreaPathFromPaths(paths)).toStrictEqual(
          expectedPaths,
        );
      },
    );

    test.concurrent(
      'Should omit when some long paths are at duplicated area [case insensitivity]',
      () => {
        const paths = ['/a/B/C', '/A/b/C/D', '/A/B/c/D/E'];
        const expectedPaths = ['/a/B/C'];

        expect(omitDuplicateAreaPathFromPaths(paths)).toStrictEqual(
          expectedPaths,
        );
      },
    );
  });

  describe.concurrent('Test getUsernameByPath', () => {
    test.concurrent('found', () => {
      const username = getUsernameByPath('/user/username');
      expect(username).toBe('username');
    });

    test.concurrent('found with slash', () => {
      const username = getUsernameByPath('/user/some.user.name12/');
      expect(username).toBe('some.user.name12');
    });

    test.concurrent('not found', () => {
      const username = getUsernameByPath(
        '/the/page/is/not/related/to/user/page',
      );
      expect(username).toBeNull();
    });
  });
});
