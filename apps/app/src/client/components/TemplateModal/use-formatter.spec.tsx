import { renderHook } from '@testing-library/react';

import { useFormatter } from './use-formatter';


const mocks = vi.hoisted(() => {
  return {
    useCurrentPagePathMock: vi.fn<() => string | undefined>(() => undefined),
  };
});

vi.mock('~/states/page', () => {
  return { useCurrentPagePath: mocks.useCurrentPagePathMock };
});


describe('useFormatter', () => {

  describe('format()', () => {

    it('returns an empty string when the argument is undefined', () => {
      // setup
      const mastacheMock = {
        render: vi.fn(),
      };
      vi.doMock('mustache', () => mastacheMock);

      // when
      const { result } = renderHook(() => useFormatter());
      const { format } = result.current;
      // call with undefined
      const markdown = format(undefined);

      // then
      expect(markdown).toBe('');
      expect(mastacheMock.render).not.toHaveBeenCalled();
    });

  });

  it('returns markdown as-is when mustache.render throws an error', () => {
    // setup
    const mastacheMock = {
      render: vi.fn(() => { throw new Error() }),
    };
    vi.doMock('mustache', () => mastacheMock);

    // when
    const { result } = renderHook(() => useFormatter());
    const { format } = result.current;
    const markdown = 'markdown body';
    const formatted = format(markdown);

    // then
    expect(formatted).toBe('markdown body');
  });

  it('returns markdown formatted when currentPagePath is undefined', () => {
    // when
    const { result } = renderHook(() => useFormatter());
    const { format } = result.current;
    const markdown = `
title: {{{title}}}{{^title}}(empty){{/title}}
path: {{{path}}}
`;
    const formatted = format(markdown);

    // then
    expect(formatted).toBe(`
title: (empty)
path: /
`);
  });

  it('returns markdown formatted', () => {
    // setup
    mocks.useCurrentPagePathMock.mockReturnValue('/Sandbox');
    // 2023/5/31 15:01:xx
    vi.setSystemTime(new Date(2023, 4, 31, 15, 1));

    // when
    const { result } = renderHook(() => useFormatter());
    const { format } = result.current;
    const markdown = `
title: {{{title}}}
path: {{{path}}}
date: {{yyyy}}/{{MM}}/{{dd}} {{HH}}:{{mm}}
`;
    const formatted = format(markdown);

    // then
    expect(formatted).toBe(`
title: Sandbox
path: /Sandbox
date: 2023/05/31 15:01
`);
  });

});
