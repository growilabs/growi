import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { Provider } from 'jotai';

import { scheduleToPut } from '~/client/services/user-ui-settings';

import {
  CHAT_SIDEBAR_WIDTH_DEFAULT,
  CHAT_SIDEBAR_WIDTH_MAX,
  CHAT_SIDEBAR_WIDTH_MIN,
  clampChatSidebarWidth,
  getChatSidebarMaxWidth,
  useChatSidebarWidth,
} from './chat-sidebar-width';

vi.mock('~/client/services/user-ui-settings', () => ({
  scheduleToPut: vi.fn(),
}));

describe('getChatSidebarMaxWidth', () => {
  it('caps at the absolute maximum on a wide viewport', () => {
    expect(getChatSidebarMaxWidth(1920)).toBe(CHAT_SIDEBAR_WIDTH_MAX);
  });

  it('leaves 320px of the page visible on a medium viewport', () => {
    expect(getChatSidebarMaxWidth(1024)).toBe(1024 - 320);
  });

  it('never goes below the minimum width on a narrow viewport', () => {
    expect(getChatSidebarMaxWidth(600)).toBe(CHAT_SIDEBAR_WIDTH_MIN);
  });
});

describe('clampChatSidebarWidth', () => {
  it('falls back to the default when no width is saved', () => {
    expect(clampChatSidebarWidth(undefined)).toBe(CHAT_SIDEBAR_WIDTH_DEFAULT);
  });

  it('falls back to the default for a non-finite value', () => {
    expect(clampChatSidebarWidth(Number.NaN)).toBe(CHAT_SIDEBAR_WIDTH_DEFAULT);
  });

  it('keeps a value inside the fixed range', () => {
    expect(clampChatSidebarWidth(640)).toBe(640);
  });

  it('rounds a value below the minimum up to the minimum', () => {
    expect(clampChatSidebarWidth(10)).toBe(CHAT_SIDEBAR_WIDTH_MIN);
  });

  it('rounds a value above the maximum down to the maximum', () => {
    expect(clampChatSidebarWidth(5000)).toBe(CHAT_SIDEBAR_WIDTH_MAX);
  });
});

describe('useChatSidebarWidth', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider>{children}</Provider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts at the default width', () => {
    const { result } = renderHook(() => useChatSidebarWidth(), { wrapper });

    expect(result.current[0]).toBe(CHAT_SIDEBAR_WIDTH_DEFAULT);
  });

  it('updates the width and schedules it for persistence', () => {
    const { result } = renderHook(() => useChatSidebarWidth(), { wrapper });

    act(() => {
      result.current[1](640);
    });

    expect(result.current[0]).toBe(640);
    expect(scheduleToPut).toHaveBeenCalledTimes(1);
    expect(scheduleToPut).toHaveBeenCalledWith({ aiChatSidebarWidth: 640 });
  });

  it('rounds a fractional width to an integer before persisting it', () => {
    const { result } = renderHook(() => useChatSidebarWidth(), { wrapper });

    act(() => {
      result.current[1](500.6);
    });

    expect(result.current[0]).toBe(501);
    expect(scheduleToPut).toHaveBeenCalledWith({ aiChatSidebarWidth: 501 });
  });
});
