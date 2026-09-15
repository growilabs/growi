// `OutboundMessage` / `HistoryOutcome` / `HistoryMessage` are three of the
// `PlatformFacade`'s seven boundary types (design.md's Invariants for
// `PlatformFacade`): "platform 層の出入口に Chat SDK の型を含めない" --
// carrying zero Chat SDK types here is what lets the task-1.7 lint rule
// (forbid `chat` / `@chat-adapter/*` imports outside `platform/**`) hold
// without an exception.
//
// `OutboundMessage` is deliberately proxy-owned vocabulary, not a Chat SDK
// Card: "Card への変換は platform/outbound.ts の中だけで行う。ここに SDK
// の型が入ると、組み立てる orchestration/ が SDK を import することになり、
// 決定 2 の lint に例外が要る" (design.md, PlatformFacade section). The three
// variants below are exactly design.md's declared shape.
import type { ChatAccountRef } from '@growi/chat';

export type OutboundMessage =
  | { readonly kind: 'markdown'; readonly markdown: string }
  | {
      readonly kind: 'list';
      readonly title: string;
      readonly rows: ReadonlyArray<{
        readonly markdown: string;
        readonly sourceLabel: string;
      }>;
      readonly footer?: string;
    }
  | {
      readonly kind: 'choice';
      readonly prompt: string;
      /**
       * What `ArgumentCollector.resume` looks the in-flight collection up by.
       * It is carried on the message rather than passed to `post()` because
       * `PlatformFacade.post(target, message)` takes nothing else, and a
       * rendered choice is un-resumable without it: `platform/outbound.ts`
       * feeds it to `encodeActionId()` so a button press comes back as an
       * `action` event naming this collection (Implementation Note 3.3).
       */
      readonly correlationId: string;
      readonly options: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
      }>;
    };

/**
 * What every outbound operation on `PlatformFacade` answers with. design.md's
 * postcondition for this layer is that `post` never throws and always returns
 * one of these (Requirement 1.4 / 2.4), so the two failure arms are not
 * decoration: `bot-not-in-channel` is the one a user can act on, and it
 * carries the `remedy` to show them.
 *
 * `messageId` is the platform's own id for the posted message, not a
 * `MessageRef` -- the caller builds a `MessageRef` from it (its own
 * `ChannelRef` plus this id) when it later wants to `replace()` that message.
 */
export type PostOutcome =
  | { readonly ok: true; readonly messageId: string }
  | {
      readonly ok: false;
      readonly reason: 'bot-not-in-channel';
      readonly remedy: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'platform-error';
      readonly detail: string;
    };

/**
 * `PlatformFacade.fetchHistory()`'s result. `not-in-channel` / `not-permitted`
 * / `unsupported` cover Requirement 5.4 (bot cannot read this channel's
 * history) and 5.6 (this chat service does not support history at all).
 */
export type HistoryOutcome =
  | { readonly ok: true; readonly messages: ReadonlyArray<HistoryMessage> }
  | {
      readonly ok: false;
      readonly reason: 'not-in-channel' | 'not-permitted' | 'unsupported';
      readonly remedy: string;
    };

/**
 * One message `fetchHistory` returns. Converted into a `KeepMessage`
 * (`@growi/chat`'s contract) before being sent to GROWI -- see design.md's
 * comment on this exact interface.
 */
export interface HistoryMessage {
  readonly postedAt: string;
  readonly author: ChatAccountRef;
  readonly text: string;
}
