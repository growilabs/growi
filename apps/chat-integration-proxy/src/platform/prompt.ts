// design.md's File Structure Plan for this file: 「modal の開閉」. Only the
// opening half is implemented here.
//
// The SDK does have a way to close a modal -- but only as the *response* to a
// submission, not as a proactive, arbitrary-later-time operation. A
// `ModalSubmitHandler` may return a `ModalCloseResponse` (`{ action: 'close' }`)
// or `ModalClearResponse` (`{ action: 'clear' }`) from `chat`'s own types
// (`ModalSubmitHandler`, `chat/dist/types-*.d.ts`), and `@chat-adapter/slack`
// separately exposes `updateModal(viewId, modal)` for replacing a modal's
// content while it is open. Neither of those is reachable from this file:
// this module only ever *opens* a modal (`openModal` below), and has no
// involvement in the `modal-submit` response path where a close/clear would
// be returned. design.md's own note on `openModal` says 「modal を開くだけ。
// 送信は後から `modal-submit` として届く」 -- whichever task registers
// `onModalSubmit` / handles the `modal-submit` event (task 3.8 or later) is
// the one that would return a `ModalCloseResponse` / `ModalClearResponse` if
// closing a modal from its submission handler is ever needed. This file has
// no "close" operation and does not need one.
//
// --------------------------------------------------------------------------
// Why a modal is opened through the event, not through the adapter
// --------------------------------------------------------------------------
//
// design.md warned that 「『有効な手がかりがある』を `interaction != null` と
// 実装してはならない」 but still declared `openModal(trigger: InteractionRef, …)`
// with a platform trigger id behind it. Reading the installed SDK settles how
// the two fit together, and rules the adapter call out twice over:
//
//  1. **Teams has no `adapter.openModal` at all.** Of the four installed
//     adapters only `@chat-adapter/slack` implements that optional method.
//     Teams answers a modal inside the HTTP invoke response instead, through
//     `WebhookOptions.onOpenModal` -- a function that only exists for the
//     duration of the webhook call the SDK is currently serving.
//  2. **The SDK stores the modal's context before it opens anything.**
//     `SlashCommandEvent.openModal` / `ActionEvent.openModal` are closures the
//     SDK builds per event (`chat/dist/index.js`): each one mints a
//     `contextId`, saves the originating thread / channel under it, and only
//     then calls `onOpenModal` or `adapter.openModal`. The submission comes
//     back with that `contextId`, and the SDK resolves `relatedThread` /
//     `relatedChannel` from it. Calling `adapter.openModal` ourselves would
//     skip that save -- and `event-mapping.fromModalSubmit` (task 3.3) returns
//     `null` when a submission has neither, so **every submitted modal would
//     be silently dropped**.
//
// So the only correct mechanism is: hand the form back to the very event that
// produced the interaction. What `InteractionRef` carries is therefore a handle
// to that event's own `openModal` closure, not a platform trigger id -- which
// is exactly what makes Teams (`modal` = `full`, no trigger id) reachable.
//
// --------------------------------------------------------------------------
// Why the handle lives in memory and not in Postgres
// --------------------------------------------------------------------------
//
// A closure cannot be written to a table, but that is not the reason -- the
// reason is that it never needs to be. `openModal` is called while the event
// that produced it is still being processed, on the instance processing it,
// inside the trigger's own lifetime (Slack's `trigger_id` lasts about three
// seconds; the Teams adapter gives a handler 5 seconds by default to answer a
// task/fetch). Nothing about it survives the request, so a short-lived
// in-process map with a time limit is the right shape and durable storage
// would be wrong. The *collection* the modal belongs to is the part that must
// survive, and that already lives in `pending_collection` keyed by the
// correlation id this module writes into the modal's `privateMetadata`.
import { Modal, type ModalElement, TextInput } from 'chat';

import type { FieldSpec, InteractionRef, ModalForm } from '../types/index.js';

/**
 * What the Chat SDK's own event exposes for opening a modal. `undefined` comes
 * back when the service supports no modal or the platform refused the trigger.
 *
 * This is the one place a Chat SDK type is unavoidable, and it stays inside
 * `platform/`: `PlatformFacade.openModal` takes an `InteractionRef`, so nothing
 * outside this layer ever names it. `platform/index.ts` (task 3.8) must not
 * re-export it.
 */
export type ModalOpener = (
  modal: ModalElement,
) => Promise<{ readonly viewId: string } | undefined>;

/**
 * The static name `chat.onModalSubmit(callbackIds, handler)` filters handlers
 * by. It is deliberately one constant for every modal this proxy opens: what
 * tells one submission from another is the correlation id on
 * `privateMetadata`, which `event-mapping.fromModalSubmit` reads back
 * (Implementation Note 3.3).
 */
export const MODAL_CALLBACK_ID = 'growi-modal';

/** How long a minted trigger is kept before it is forgotten. */
const DEFAULT_TTL_MS = 60_000;

/**
 * Holds each in-flight event's own way of opening a modal, and hands out the
 * `InteractionRef` that names it.
 *
 * The time limit here bounds memory, not validity: whether a trigger still
 * works is judged by the platform when the attempt is made, which is what
 * `InteractionRef`'s own comment says. A handle that lapses before it is used
 * simply reports the same "could not open" as a platform refusal, and the
 * caller falls back to asking in the channel either way.
 */
export interface ModalTriggerRegistry {
  /** Names this event's opener, so `openModal` can find it again later. */
  register(open: ModalOpener): InteractionRef;
  /**
   * Takes a handle out, or `null` when it was never held, has already been
   * used, or has lapsed. Consuming rather than reading is deliberate: a
   * platform hands each trigger out once, so a second attempt with the same
   * one could not succeed anyway.
   *
   * Only `openModal` below calls this. It names an SDK closure, so task 3.8
   * must keep the whole registry out of `platform/index.ts`.
   */
  take(trigger: InteractionRef): ModalOpener | null;
  /** How many handles are currently held. Exists so the eviction is observable. */
  size(): number;
}

interface RegistryOptions {
  readonly ttlMs?: number;
  /** Injected so the time limit is testable without waiting for it. */
  readonly now?: () => number;
}

interface Held {
  readonly open: ModalOpener;
  readonly expiresAt: number;
}

export const createModalTriggerRegistry = (
  options: RegistryOptions = {},
): ModalTriggerRegistry => {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const held = new Map<string, Held>();

  const evictLapsed = (at: number) => {
    for (const [token, entry] of held) {
      if (entry.expiresAt <= at) held.delete(token);
    }
  };

  const registry: ModalTriggerRegistry = {
    register(open) {
      const at = now();
      // Sweeping on registration keeps the map bounded by traffic without a
      // timer to own and shut down: an event that mints a handle is also the
      // only thing that can grow the map.
      evictLapsed(at);
      const token = crypto.randomUUID();
      held.set(token, { open, expiresAt: at + ttlMs });
      return { token };
    },

    take(trigger) {
      const entry = held.get(trigger.token);
      if (entry == null) return null;
      // Taken out either way: a platform hands each trigger out once, so a
      // second attempt with the same one could not succeed.
      held.delete(trigger.token);
      return entry.expiresAt <= now() ? null : entry.open;
    },

    size() {
      return held.size;
    },
  };

  return registry;
};

/**
 * How each kind of collected value is presented in a modal.
 *
 * Every kind becomes exactly **one** input, named after the `FieldSpec` -- the
 * Slack adapter keys `ModalSubmitEvent.values` by the input's id, and design.md
 * requires the same `FieldSpec` list to collect the same
 * `Record<string, string>` through the ask-back path as well (「同じ
 * `FieldSpec` から Slack（modal）と Discord（聞き返し）の両方で値が集まること」).
 * The ask-back path can only ever produce one string per question, so a
 * `time-range` rendered as two date pickers would give the two paths different
 * shapes and force `ArgumentCollector` to know which one it is talking to.
 * Instead the range is one string and one parser serves both.
 *
 * Declared as a table rather than a `switch` so that adding a kind is an entry
 * here and nothing else (`.claude/rules/coding-style.md`).
 */
const FIELD_PRESENTATION: Readonly<
  Record<
    FieldSpec['kind'],
    { readonly multiline: boolean; readonly placeholder: string }
  >
> = {
  text: { multiline: false, placeholder: '' },
  multiline: { multiline: true, placeholder: '' },
  path: { multiline: false, placeholder: '/例/保存先のページ' },
  'time-range': {
    multiline: false,
    placeholder: '2026-09-01 〜 2026-09-02',
  },
};

const toInput = (field: FieldSpec) => {
  const presentation = FIELD_PRESENTATION[field.kind];
  return TextInput({
    id: field.name,
    label: field.label,
    optional: !field.required,
    multiline: presentation.multiline,
    ...(presentation.placeholder === ''
      ? {}
      : { placeholder: presentation.placeholder }),
    ...(field.maxLength == null ? {} : { maxLength: field.maxLength }),
  });
};

/**
 * The form as the SDK's own modal. Kept separate from `openModal` so the
 * conversion has no dependency on how the modal is delivered.
 */
const toModal = (form: ModalForm, correlationId: string): ModalElement =>
  Modal({
    callbackId: MODAL_CALLBACK_ID,
    title: form.title,
    // Where the collection's correlation id travels. `callbackId` cannot carry
    // it: it is the static key handlers are registered against.
    privateMetadata: correlationId,
    children: form.fields.map(toInput),
  });

/**
 * Opens `form` as a modal, in answer to the interaction `trigger` names.
 *
 * **Returns whether it opened.** design.md's `Promise<void>` left the caller no
 * way to act on the case design.md itself describes -- 「手がかりが切れている
 * なら、聞き返しの経路へ落とす」 -- and the SDK already answers the same
 * question by resolving `undefined`. There is exactly one thing a caller does
 * about any failure here (ask its questions in the channel instead), so one
 * boolean says everything the caller can use.
 *
 * Never throws, for the same reason `outbound.ts` never throws: a dead trigger
 * is an ordinary outcome of a three-second window, not a fault that should
 * abandon the whole command.
 */
export const openModal = async (
  registry: ModalTriggerRegistry,
  trigger: InteractionRef,
  form: ModalForm,
  correlationId: string,
): Promise<boolean> => {
  const open = registry.take(trigger);
  if (open == null) return false;

  try {
    const opened = await open(toModal(form, correlationId));
    return opened != null;
  } catch {
    return false;
  }
};
