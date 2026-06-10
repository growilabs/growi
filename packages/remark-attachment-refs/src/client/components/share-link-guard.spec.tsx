import { render, screen } from '@testing-library/react';

import { useSWRxRef, useSWRxRefs } from '../stores/refs';
import { Gallery } from './Gallery';
import { Ref } from './Ref';
import { RefImg } from './RefImg';
import { Refs } from './Refs';
import { RefsImg } from './RefsImg';

// The contract under test is "no request is issued on a share link page".
// Mock the data-fetching hooks so we can assert they are never called,
// and stub AttachmentList so the test does not pull in @growi/ui.
vi.mock('../stores/refs', () => ({
  useSWRxRef: vi.fn(() => ({
    data: undefined,
    error: undefined,
    isLoading: false,
  })),
  useSWRxRefs: vi.fn(() => ({ data: [], error: undefined, isLoading: false })),
}));

vi.mock('./AttachmentList', () => ({
  AttachmentList: () => <div data-testid="attachment-list" />,
}));

const DISABLED_MESSAGE = /not available on the share link page/i;

describe('attachment-refs directives on a share link page', () => {
  describe('when isSharedPage is true', () => {
    it.each`
      label        | mount
      ${'ref'}     | ${() => render(<Ref pagePath="/foo" fileNameOrId="a.png" isSharedPage />)}
      ${'refimg'}  | ${() => render(<RefImg pagePath="/foo" fileNameOrId="a.png" isSharedPage />)}
      ${'refs'}    | ${() => render(<Refs pagePath="/foo" isSharedPage />)}
      ${'refsimg'} | ${() => render(<RefsImg pagePath="/foo" isSharedPage />)}
      ${'gallery'} | ${() => render(<Gallery pagePath="/foo" isSharedPage />)}
    `(
      'shows the disabled message and issues no request for $label',
      ({ mount }: { mount: () => void }) => {
        mount();

        expect(screen.queryByText(DISABLED_MESSAGE)).not.toBeNull();
        expect(screen.queryByTestId('attachment-list')).toBeNull();
        expect(useSWRxRef).not.toHaveBeenCalled();
        expect(useSWRxRefs).not.toHaveBeenCalled();
      },
    );
  });

  describe('when isSharedPage is not set', () => {
    it.each`
      label        | mount                                                            | hook
      ${'ref'}     | ${() => render(<Ref pagePath="/foo" fileNameOrId="a.png" />)}    | ${useSWRxRef}
      ${'refimg'}  | ${() => render(<RefImg pagePath="/foo" fileNameOrId="a.png" />)} | ${useSWRxRef}
      ${'refs'}    | ${() => render(<Refs pagePath="/foo" />)}                        | ${useSWRxRefs}
      ${'refsimg'} | ${() => render(<RefsImg pagePath="/foo" />)}                     | ${useSWRxRefs}
      ${'gallery'} | ${() => render(<Gallery pagePath="/foo" />)}                     | ${useSWRxRefs}
    `(
      'renders attachments and requests data for $label',
      ({ mount, hook }: { mount: () => void; hook: () => unknown }) => {
        mount();

        expect(screen.queryByText(DISABLED_MESSAGE)).toBeNull();
        expect(screen.queryByTestId('attachment-list')).not.toBeNull();
        expect(hook).toHaveBeenCalled();
      },
    );
  });
});
