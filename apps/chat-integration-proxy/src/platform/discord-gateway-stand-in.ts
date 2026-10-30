// Test-only (excluded from the build): replaces the Discord Gateway dial so a
// real facade can hold `app:discord` without logging in to Discord. Lives in
// `platform/` because only this layer may name the Chat SDK.
import { DiscordAdapter } from '@chat-adapter/discord';
import { vi } from 'vitest';

export interface DiscordGatewayStandIn {
  /** How many Gateway windows were opened since the last `reset`. */
  opened(): number;
  /** How many of those are still open (their signal not yet aborted). */
  open(): number;
  reset(): void;
}

/** Each window stays open until its abort signal fires. */
export const standInForDiscordGateway = (): DiscordGatewayStandIn => {
  const signals: AbortSignal[] = [];
  vi.spyOn(DiscordAdapter.prototype, 'startGatewayListener').mockImplementation(
    (options, _durationMs, abortSignal) => {
      if (abortSignal == null) {
        throw new Error('a Gateway window was opened with no way to stop it');
      }
      signals.push(abortSignal);
      options.waitUntil?.(
        new Promise<void>((resolve) => {
          abortSignal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        }),
      );
      return Promise.resolve(new Response('{}', { status: 200 }));
    },
  );
  return {
    opened: () => signals.length,
    open: () => signals.filter((signal) => !signal.aborted).length,
    reset: () => {
      signals.length = 0;
    },
  };
};
