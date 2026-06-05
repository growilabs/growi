import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { Provider } from 'jotai';

import { useChatSidebarActions, useChatSidebarStatus } from './chat-sidebar';

/**
 * Render both hooks together under a fresh Jotai Provider so each test gets an
 * isolated store (no state leakage between tests). The two hooks share the same
 * store, allowing actions to be observed via the status hook.
 */
const renderChatSidebar = () => {
  return renderHook(
    () => ({
      status: useChatSidebarStatus(),
      actions: useChatSidebarActions(),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider>{children}</Provider>
      ),
    },
  );
};

describe('chat-sidebar state', () => {
  it('is closed initially', () => {
    const { result } = renderChatSidebar();

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
