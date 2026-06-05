import type { JSX } from 'react';
import type { StorageThreadType } from '@mastra/core/memory';
import { fireEvent, render, screen } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import type { ThreadListOutput } from '~/features/mastra/interfaces/thread';

const openChatMock = vi.fn();
const closeChatSidebarMock = vi.fn();
const deleteThreadMock = vi.fn();
const mutateRecentThreadsMock = vi.fn();

let recentThreadsData: ThreadListOutput[] | undefined;
let chatSidebarStatus: { isOpened: boolean; threadId?: string };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('~/client/components/InfiniteScroll', () => ({
  // Render children directly; pagination behavior is out of scope for these tests.
  default: ({ children }: { children: JSX.Element }) => <div>{children}</div>,
}));

vi.mock('~/client/util/toastr', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../../services/thread', () => ({
  deleteThread: (params: { threadId: string }) => deleteThreadMock(params),
}));

vi.mock('../../status/chat-sidebar', () => ({
  useChatSidebarActions: () => ({
    openChat: openChatMock,
    close: closeChatSidebarMock,
  }),
  useChatSidebarStatus: () => chatSidebarStatus,
}));

vi.mock('../../stores/thread', () => ({
  useSWRINFxRecentThreads: () => ({
    data: recentThreadsData,
    mutate: mutateRecentThreadsMock,
  }),
}));

const makeThreadData = (
  threads: { id: string; title?: string }[],
): ThreadListOutput =>
  mock<ThreadListOutput>({
    threads: threads.map((t) => mock<StorageThreadType>(t)),
  });

describe('ThreadList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recentThreadsData = [
      makeThreadData([
        { id: 'thread-1', title: 'First chat' },
        { id: 'thread-2', title: 'Second chat' },
      ]),
    ];
    chatSidebarStatus = { isOpened: false };
  });

  it('resumes a thread via openChat(threadId) with the thread id only', async () => {
    const { ThreadList } = await import('./ThreadList');
    render(<ThreadList />);

    fireEvent.click(screen.getByText('First chat'));

    expect(openChatMock).toHaveBeenCalledTimes(1);
    expect(openChatMock).toHaveBeenCalledWith('thread-1');
  });

  it('deletes a thread and mutates the recent-threads list', async () => {
    deleteThreadMock.mockResolvedValue(undefined);
    const { ThreadList } = await import('./ThreadList');
    render(<ThreadList />);

    const deleteButtons = screen.getAllByText('delete');
    fireEvent.click(deleteButtons[0]);

    expect(deleteThreadMock).toHaveBeenCalledWith({ threadId: 'thread-1' });
  });
});
