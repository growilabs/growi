// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { format } from 'date-fns/format';
import { describe, expect, it, vi } from 'vitest';

import { AuthorInfo } from './AuthorInfo';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('next/link', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <a href="#user">{children}</a>
  ),
}));
vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: () => <span data-testid="user-picture" />,
}));

const date = new Date('2026-01-02T03:04:05Z');
const formatted = format(date, 'yyyy/MM/dd HH:mm');
const mark = <span data-testid="proposal-mark">mark</span>;

describe('AuthorInfo', () => {
  describe.each(['footer', 'pageSide'] as const)('locate=%s', (locate) => {
    it('renders the given mark next to the author', () => {
      const { getByTestId } = render(
        <AuthorInfo
          date={date}
          mode="update"
          locate={locate}
          proposalMark={mark}
        />,
      );
      expect(getByTestId('proposal-mark').textContent).toBe('mark');
    });

    it('renders the mark after the author label', () => {
      const { container } = render(
        <AuthorInfo
          date={date}
          mode="update"
          locate={locate}
          proposalMark={mark}
        />,
      );
      expect(
        container.querySelector('[data-testid="proposal-mark"]')
          ?.previousElementSibling?.tagName,
      ).toBe('I');
    });
  });

  it('renders the pre-change footer DOM when no mark is given', () => {
    const { container } = render(
      <AuthorInfo date={date} mode="update" locate="footer" />,
    );
    expect(container.innerHTML).toBe(
      `<p class="d-flex flex-wrap align-items-center gap-1 mb-1"><span>author_info.last_revision_posted_at ${formatted}</span><span class="d-inline-flex align-items-center gap-1">by<span class="d-inline-flex lh-1"><span data-testid="user-picture"></span></span><i>Unknown</i></span></p>`,
    );
  });

  it('renders the pre-change pageSide DOM when no mark is given', () => {
    const { container } = render(
      <AuthorInfo date={date} mode="update" locate="pageSide" />,
    );
    expect(container.innerHTML).toMatch(
      /<div class="text-secondary mb-1">author_info.updated_by <br class="d-lg-none"><i>Unknown<\/i><\/div><div class="text-secondary text-date" data-vrt-blackout-datetime="true">\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}<\/div>/,
    );
  });

  it('renders the pre-change invalid-date footer DOM when no mark is given', () => {
    const { container } = render(
      <AuthorInfo date={new Date('invalid')} mode="update" locate="footer" />,
    );
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<p class="d-flex flex-wrap align-items-center gap-1 mb-1"><span>Updated by</span><span class="d-inline-flex align-items-center gap-1">by<span class="d-inline-flex lh-1"><span data-testid="user-picture"></span></span><i>Unknown</i></span></p>"`,
    );
  });

  it('keeps the mark when the footer falls back to the invalid-date display', () => {
    const { getByTestId } = render(
      <AuthorInfo
        date={new Date('invalid')}
        mode="update"
        locate="footer"
        proposalMark={mark}
      />,
    );
    expect(getByTestId('proposal-mark')).not.toBeNull();
  });
});
