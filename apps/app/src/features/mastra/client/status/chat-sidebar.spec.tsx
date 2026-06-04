import { act, renderHook } from '@testing-library/react';

import { useChatSidebarActions, useChatSidebarStatus } from './chat-sidebar';

/**
 * Render both hooks together so they share the same default Jotai store,
 * allowing actions to be observed via the status hook.
 */
const renderChatSidebar = () => {
  return renderHook(() => ({
    status: useChatSidebarStatus(),
    actions: useChatSidebarActions(),
  }));
};

describe('chat-sidebar state', () => {
  it('is closed initially', () => {
    const { result } = renderChatSidebar();

    // reset to a known state in case a previous test mutated the shared store
    act(() => {
      result.current.actions.close();
    });

    expect(result.current.status.isOpened).toBe(false);
    expect(result.current.status.threadId).toBeUndefined();
  });

  it('openChat() with no args opens the sidebar without any assistant data', () => {
    const { result } = renderChatSidebar();

    act(() => {
      result.current.actions.openChat();
    });

    expect(result.current.status.isOpened).toBe(true);
    expect(result.current.status.threadId).toBeUndefined();
    // assistant-related fields must not exist on the state shape anymore
    expect(result.current.status).not.toHaveProperty('aiAssistantData');
    expect(result.current.status).not.toHaveProperty('isEditorAssistant');
  });

  it('openChat(threadId) opens the sidebar and sets the threadId', () => {
    const { result } = renderChatSidebar();

    act(() => {
      result.current.actions.openChat('thread-123');
    });

    expect(result.current.status.isOpened).toBe(true);
    expect(result.current.status.threadId).toBe('thread-123');
  });

  it('close() resets the sidebar state', () => {
    const { result } = renderChatSidebar();

    act(() => {
      result.current.actions.openChat('thread-123');
    });
    act(() => {
      result.current.actions.close();
    });

    expect(result.current.status.isOpened).toBe(false);
    expect(result.current.status.threadId).toBeUndefined();
  });

  it('does not expose an openEditor action', () => {
    const { result } = renderChatSidebar();

    expect(result.current.actions).not.toHaveProperty('openEditor');
  });
});
