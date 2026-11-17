import { GROWI_DECORATION_ATTR } from '@growi/core/dist/consts';
import { cleanup, render, screen } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import type { useSWRxAttachment } from '~/stores/attachment';

type AttachmentResponse = ReturnType<typeof useSWRxAttachment>;

const mockUseSWRxAttachment = vi.hoisted(() => vi.fn());

vi.mock('~/stores/attachment', () => ({
  useSWRxAttachment: mockUseSWRxAttachment,
}));
vi.mock('~/states/context', () => ({
  useIsGuestUser: () => false,
  useIsReadOnlyUser: () => false,
  useIsSharedUser: () => false,
}));
vi.mock('~/states/ui/modal/delete-attachment', () => ({
  useDeleteAttachmentModalActions: () => ({ open: vi.fn() }),
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@growi/ui/dist/components', () => ({
  // biome-ignore lint/performance/noImgElement: stands in for UserPicture, which renders a plain <img>
  UserPicture: () => <img src="/avatar.png" alt="Alice" />,
}));

const { RichAttachment } = await import('./RichAttachment');

afterEach(() => {
  cleanup();
});

describe('RichAttachment', () => {
  it('marks every image in the card as decoration, and the file name link as content', () => {
    mockUseSWRxAttachment.mockReturnValue(
      mock<AttachmentResponse>({
        data: {
          filePathProxied: '/attachment/a1',
          originalName: 'report.pdf',
          downloadPathProxied: '/download/a1',
          creator: { name: 'Alice' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
          fileSize: 1024,
        },
        remove: vi.fn(),
      }),
    );

    const { container } = render(
      <RichAttachment
        attachmentId="a1"
        url="/attachment/a1"
        attachmentName=""
      />,
    );

    const images = Array.from(container.querySelectorAll('img'));
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.closest(`[${GROWI_DECORATION_ATTR}]`)).not.toBeNull();
    }
    expect(
      screen
        .getByRole('link', { name: 'report.pdf' })
        .closest(`[${GROWI_DECORATION_ATTR}]`),
    ).toBeNull();
  });
});
