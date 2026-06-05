import { fireEvent, render, screen } from '@testing-library/react';

const openChatMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../status/chat-sidebar', () => ({
  useChatSidebarActions: () => ({
    openChat: openChatMock,
    close: vi.fn(),
  }),
  useChatSidebarStatus: () => ({ isOpened: false }),
}));

vi.mock('../../stores/thread', () => ({
  useSWRINFxRecentThreads: () => ({ data: undefined, mutate: vi.fn() }),
}));

// ThreadList is rendered as a child; stub it so the panel structure can be
// asserted in isolation.
vi.mock('./ThreadList', () => ({
  ThreadList: () => <div data-testid="thread-list" />,
}));

describe('AiAssistantContent (Left AI Panel)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a New chat button and the ThreadList', async () => {
    const { AiAssistantContent } = await import('./AiAssistantSubstance');
    render(<AiAssistantContent />);

    expect(
      screen.getByText('ai_assistant_substance.new_chat'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('thread-list')).toBeInTheDocument();
  });

  it('opens a fresh chat via openChat() with no args when New chat is clicked', async () => {
    const { AiAssistantContent } = await import('./AiAssistantSubstance');
    render(<AiAssistantContent />);

    fireEvent.click(screen.getByText('ai_assistant_substance.new_chat'));

    expect(openChatMock).toHaveBeenCalledTimes(1);
    expect(openChatMock).toHaveBeenCalledWith();
  });
});
