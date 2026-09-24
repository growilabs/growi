// Where the Chat SDK's handlers are registered and what they do with an event:
// mint a modal handle where one is available, convert with `event-mapping.ts`,
// and hand the result to the sink.
//
// Split out of `platform/index.ts` because it answers a different question --
// index.ts assembles the layer (adapters, state, connections, outbound calls),
// this file only wires incoming events. Both the app-wide bot and each
// per-installation bot need the same wiring, so it is a function taking its
// host rather than something index.ts spells out twice.
import type {
  ActionEvent,
  Message,
  ModalSubmitEvent,
  SlashCommandEvent,
  Thread,
} from 'chat';

import type { PlatformEvent, PlatformEventSink } from '../types/index.js';
import {
  fromAction,
  fromMessage,
  fromModalSubmit,
  fromSlashCommand,
} from './event-mapping.js';
import { MODAL_CALLBACK_ID, type ModalTriggerRegistry } from './prompt.js';

/**
 * The part of a Chat SDK instance this file uses. Declared structurally rather
 * than as `Chat` so that registration can be exercised without constructing
 * one, and so this file names none of the SDK's generic parameters -- a real
 * `Chat` satisfies it.
 */
export interface HandlerHost {
  onNewMention(
    handler: (thread: Thread, message: Message) => Promise<void>,
  ): void;
  onNewMessage(
    pattern: RegExp,
    handler: (thread: Thread, message: Message) => Promise<void>,
  ): void;
  onAction(handler: (event: ActionEvent) => Promise<void>): void;
  onModalSubmit(
    callbackId: string,
    handler: (event: ModalSubmitEvent) => Promise<void>,
  ): void;
  onSlashCommand(handler: (event: SlashCommandEvent) => Promise<void>): void;
}

export interface EventHandlerDeps {
  readonly sink: PlatformEventSink;
  /** Holds each in-flight event's own way of opening a modal (`prompt.ts`). */
  readonly modals: ModalTriggerRegistry;
}

/**
 * What makes an unaddressed message worth looking at at all. Only Slack fills
 * `Message.links` in, so this is in practice the Slack link-preview path
 * (Requirement 6.1) -- but the pattern, not the service name, is what decides,
 * for the same reason `event-mapping.ts` does not consult the capability table
 * here.
 */
const LINK_PATTERN = /https?:\/\//;

const dispatch = async (
  deps: EventHandlerDeps,
  event: PlatformEvent | null,
): Promise<void> => {
  // `null` is `event-mapping.ts` refusing to invent an event it cannot build
  // -- an unaddressed message with no links, a button this proxy did not
  // render, a submission with no conversation behind it.
  if (event == null) return;
  await deps.sink.handle(event);
};

/**
 * **The bot's own posts are dropped here, before any mapping.** A link
 * preview this bot posted itself carries a URL, so without this it would come
 * back as `link-posted` and the bot would preview its own preview, without
 * end. `event-mapping.ts` cannot do it: it is pure, and "who am I" is not
 * something it is told.
 */
const handleMessage = async (
  deps: EventHandlerDeps,
  thread: Thread,
  message: Message,
): Promise<void> => {
  if (message.author.isMe) return;
  await dispatch(deps, fromMessage(thread, message));
};

export const registerEventHandlers = (
  host: HandlerHost,
  deps: EventHandlerDeps,
): void => {
  host.onNewMention((thread, message) => handleMessage(deps, thread, message));

  host.onNewMessage(LINK_PATTERN, async (thread, message) => {
    // The SDK routes an addressed message to the mention handler and stops, so
    // this normally sees only unaddressed ones. Guarded anyway: were both to
    // run, the same command would be answered twice.
    if (message.isMention === true) return;
    await handleMessage(deps, thread, message);
  });

  // The handle is minted from the event itself rather than derived from a
  // trigger id: `prompt.ts` explains why only the event's own `openModal()`
  // works on both services whose `modal` capability is `full`. It is wrapped
  // rather than passed by reference so the call keeps its event as `this`
  // whatever the SDK's own shape is.
  host.onSlashCommand((event) =>
    dispatch(
      deps,
      fromSlashCommand(
        event,
        deps.modals.register((modal) => event.openModal(modal)),
      ),
    ),
  );

  host.onAction((event) =>
    dispatch(
      deps,
      fromAction(
        event,
        deps.modals.register((modal) => event.openModal(modal)),
      ),
    ),
  );

  // One callback id for every modal this proxy opens: what tells one
  // submission from another is the correlation id on `privateMetadata`, which
  // `fromModalSubmit` reads back (`prompt.ts`, `event-mapping.ts`).
  host.onModalSubmit(MODAL_CALLBACK_ID, (event) =>
    dispatch(deps, fromModalSubmit(event)),
  );
};
