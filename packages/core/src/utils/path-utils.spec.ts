import * as pathUtils from './path-utils';

describe('page-utils', () => {
  describe('.normalizePath', () => {
    test.concurrent.each`
      path                      | expected
      ${'/'}                    | ${'/'}
      ${''}                     | ${'/'}
      ${'path'}                 | ${'/path'}
      ${'/path'}                | ${'/path'}
      ${'path/'}                | ${'/path'}
      ${'/path/'}               | ${'/path'}
      ${'path1/path2'}          | ${'/path1/path2'}
      ${'/path1/path2'}         | ${'/path1/path2'}
      ${'path1/path2/'}         | ${'/path1/path2'}
      ${'/path1/path2/'}        | ${'/path1/path2'}
      ${'//path1/path2//'}      | ${'/path1/path2'}
      ${'https://example.com'}  | ${'/https://example.com'}
      ${'https://example.com/'} | ${'/https://example.com'}
    `("should normalize '$path' to '$expected'", ({ path, expected }) => {
      expect(pathUtils.normalizePath(path)).toBe(expected);
    });
  });

  describe('.hasHeadingSlash', () => {
    test.concurrent.each`
      path                      | expected
      ${'/'}                    | ${true}
      ${''}                     | ${false}
      ${'path'}                 | ${false}
      ${'/path'}                | ${true}
      ${'path/'}                | ${false}
      ${'/path/'}               | ${true}
      ${'path1/path2'}          | ${false}
      ${'/path1/path2'}         | ${true}
      ${'path1/path2/'}         | ${false}
      ${'/path1/path2/'}        | ${true}
      ${'//path1/path2//'}      | ${true}
      ${'https://example.com'}  | ${false}
      ${'https://example.com/'} | ${false}
    `(
      "should return $expected when checking heading slash for '$path'",
      ({ path, expected }) => {
        expect(pathUtils.hasHeadingSlash(path)).toBe(expected);
      },
    );
  });

  describe('.hasTrailingSlash', () => {
    test.concurrent.each`
      path                      | expected
      ${'/'}                    | ${true}
      ${''}                     | ${false}
      ${'path'}                 | ${false}
      ${'/path'}                | ${false}
      ${'path/'}                | ${true}
      ${'/path/'}               | ${true}
      ${'path1/path2'}          | ${false}
      ${'/path1/path2'}         | ${false}
      ${'path1/path2/'}         | ${true}
      ${'/path1/path2/'}        | ${true}
      ${'//path1/path2//'}      | ${true}
      ${'https://example.com'}  | ${false}
      ${'https://example.com/'} | ${true}
    `(
      "should return $expected when checking trailing slash for '$path'",
      ({ path, expected }) => {
        expect(pathUtils.hasTrailingSlash(path)).toBe(expected);
      },
    );
  });

  describe('.addHeadingSlash', () => {
    test.concurrent.each`
      path                      | expected
      ${'/'}                    | ${'/'}
      ${''}                     | ${'/'}
      ${'path'}                 | ${'/path'}
      ${'/path'}                | ${'/path'}
      ${'path/'}                | ${'/path/'}
      ${'/path/'}               | ${'/path/'}
      ${'path1/path2'}          | ${'/path1/path2'}
      ${'/path1/path2'}         | ${'/path1/path2'}
      ${'path1/path2/'}         | ${'/path1/path2/'}
      ${'/path1/path2/'}        | ${'/path1/path2/'}
      ${'//path1/path2//'}      | ${'//path1/path2//'}
      ${'https://example.com'}  | ${'/https://example.com'}
      ${'https://example.com/'} | ${'/https://example.com/'}
    `(
      "should add heading slash to '$path' resulting in '$expected'",
      ({ path, expected }) => {
        expect(pathUtils.addHeadingSlash(path)).toBe(expected);
      },
    );
  });

  describe('.addTrailingSlash', () => {
    test.concurrent.each`
      path                      | expected
      ${'/'}                    | ${'/'}
      ${''}                     | ${'/'}
      ${'path'}                 | ${'path/'}
      ${'/path'}                | ${'/path/'}
      ${'path/'}                | ${'path/'}
      ${'/path/'}               | ${'/path/'}
      ${'path1/path2'}          | ${'path1/path2/'}
      ${'/path1/path2'}         | ${'/path1/path2/'}
      ${'path1/path2/'}         | ${'path1/path2/'}
      ${'/path1/path2/'}        | ${'/path1/path2/'}
      ${'//path1/path2//'}      | ${'//path1/path2//'}
      ${'https://example.com'}  | ${'https://example.com/'}
      ${'https://example.com/'} | ${'https://example.com/'}
    `(
      "should add trailing slash to '$path' resulting in '$expected'",
      ({ path, expected }) => {
        expect(pathUtils.addTrailingSlash(path)).toBe(expected);
      },
    );
  });

  describe('.removeHeadingSlash', () => {
    test.concurrent.each`
      path                      | expected
      ${'/'}                    | ${'/'}
      ${''}                     | ${''}
      ${'path'}                 | ${'path'}
      ${'/path'}                | ${'path'}
      ${'path/'}                | ${'path/'}
      ${'/path/'}               | ${'path/'}
      ${'path1/path2'}          | ${'path1/path2'}
      ${'/path1/path2'}         | ${'path1/path2'}
      ${'path1/path2/'}         | ${'path1/path2/'}
      ${'/path1/path2/'}        | ${'path1/path2/'}
      ${'//path1/path2//'}      | ${'path1/path2//'}
      ${'https://example.com'}  | ${'https://example.com'}
      ${'https://example.com/'} | ${'https://example.com/'}
      ${'//'}                   | ${'/'}
    `(
      "should remove heading slash from '$path' resulting in '$expected'",
      ({ path, expected }) => {
        expect(pathUtils.removeHeadingSlash(path)).toBe(expected);
      },
    );
  });

  describe('.removeTrailingSlash', () => {
    test.concurrent.each`
      path                      | expected
      ${'/'}                    | ${'/'}
      ${''}                     | ${''}
      ${'path'}                 | ${'path'}
      ${'/path'}                | ${'/path'}
      ${'path/'}                | ${'path'}
      ${'/path/'}               | ${'/path'}
      ${'path1/path2'}          | ${'path1/path2'}
      ${'/path1/path2'}         | ${'/path1/path2'}
      ${'path1/path2/'}         | ${'path1/path2'}
      ${'/path1/path2/'}        | ${'/path1/path2'}
      ${'//path1/path2//'}      | ${'//path1/path2'}
      ${'https://example.com'}  | ${'https://example.com'}
      ${'https://example.com/'} | ${'https://example.com'}
    `(
      "should remove trailing slash from '$path' resulting in '$expected'",
      ({ path, expected }) => {
        expect(pathUtils.removeTrailingSlash(path)).toBe(expected);
      },
    );
  });

  describe('.getParentPath', () => {
    test.concurrent.each`
      path                      | expected
      ${'/'}                    | ${'/'}
      ${''}                     | ${'/'}
      ${'path'}                 | ${'/'}
      ${'/path'}                | ${'/'}
      ${'path/'}                | ${'/path'}
      ${'/path/'}               | ${'/path'}
      ${'path1/path2'}          | ${'/path1'}
      ${'/path1/path2'}         | ${'/path1'}
      ${'path1/path2/'}         | ${'/path1/path2'}
      ${'/path1/path2/'}        | ${'/path1/path2'}
      ${'//path1/path2//'}      | ${'/path1/path2'}
      ${'https://example.com'}  | ${'/https:'}
      ${'https://example.com/'} | ${'/https://example.com'}
      ${'/page'}                | ${'/'}
    `(
      "should get parent path of '$path' as '$expected'",
      ({ path, expected }) => {
        expect(pathUtils.getParentPath(path)).toBe(expected);
      },
    );
  });
});
