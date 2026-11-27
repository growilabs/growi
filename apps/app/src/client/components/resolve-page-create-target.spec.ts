import { resolvePageCreateTarget } from './resolve-page-create-target';

describe('resolvePageCreateTarget', () => {
  describe('creates an untitled page under the parent when the input is empty or ends with "/"', () => {
    it.each`
      input            | expectedParentPath
      ${''}            | ${'/'}
      ${'   '}         | ${'/'}
      ${'/'}           | ${'/'}
      ${'Sandbox/'}    | ${'/Sandbox'}
      ${'/Sandbox/'}   | ${'/Sandbox'}
      ${'/Sandbox/a/'} | ${'/Sandbox/a'}
    `(
      '"$input" -> parentPath "$expectedParentPath" without path',
      ({ input, expectedParentPath }) => {
        expect(resolvePageCreateTarget(input)).toStrictEqual({
          parentPath: expectedParentPath,
        });
      },
    );
  });

  describe('creates the page at the given path otherwise', () => {
    it.each`
      input                 | expectedPath        | expectedParentPath
      ${'Sandbox'}          | ${'/Sandbox'}       | ${'/'}
      ${'/Sandbox/child'}   | ${'/Sandbox/child'} | ${'/Sandbox'}
      ${' /Sandbox/child '} | ${'/Sandbox/child'} | ${'/Sandbox'}
    `(
      '"$input" -> path "$expectedPath"',
      ({ input, expectedPath, expectedParentPath }) => {
        expect(resolvePageCreateTarget(input)).toStrictEqual({
          path: expectedPath,
          parentPath: expectedParentPath,
        });
      },
    );
  });
});
