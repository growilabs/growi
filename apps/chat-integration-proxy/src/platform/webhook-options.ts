// What a webhook call is given besides the request, for a service that dials
// this proxy rather than the other way round (Teams).
//
// Separate from `index.ts` because its one value names a Chat SDK type
// (`ModalElement`), and `index.ts` is this layer's barrel: nothing exported
// from there may name an SDK type. Keeping it here is also what makes it
// testable, since the table below is the whole of Teams' modal wiring.

import type { PlatformName } from '@growi/chat';
import type { ModalElement, WebhookOptions } from 'chat';

/**
 * Whether a service opens a modal by returning it **inside the webhook
 * response**, rather than through the platform's own "open a view" API.
 *
 * Only Teams does. It has no `Adapter.openModal` at all -- of the four
 * adapters only Slack implements one -- and the SDK refuses to even attempt a
 * modal unless the webhook call supplies `onOpenModal` (`Chat`'s slash-command
 * and action dispatchers both guard on `event.triggerId || options.onOpenModal`
 * and warn otherwise). A table rather than a service-name check, so a service
 * added later declares its own answer (`.claude/rules/coding-style.md`).
 */
export const OPENS_MODAL_IN_WEBHOOK_RESPONSE: Readonly<
  Record<PlatformName, boolean>
> = {
  slack: false,
  discord: false,
  teams: true,
  mattermost: false,
};

/**
 * The inline opener handed to such a service's webhook call.
 *
 * **It answers "not opened", and that is the honest answer.** Measured in
 * `@chat-adapter/teams`: the one Teams activity that can carry a dialog back
 * is the `task/fetch` invoke (`handleDialogOpen`, which a button rendered with
 * `actionType: 'modal'` produces), and it supplies its own `onOpenModal`,
 * overriding this one -- so that path still opens a real dialog. Every other
 * Teams activity (a mention, an `Action.Submit` card press) is answered with a
 * plain acknowledgement whose shape carries no dialog, so a modal reaching
 * here has nowhere to go.
 *
 * Saying so truthfully is what keeps the fallback correct:
 * `PlatformFacade.openModal` then answers `false` and the caller asks its
 * questions in the channel instead (design.md: 「手がかりが切れているなら、
 * 聞き返しの経路へ落とす」). A fabricated `viewId` would claim a modal the
 * user never saw and leave the command waiting for a submission that cannot
 * arrive.
 */
const openModalInResponse = async (
  _modal: ModalElement,
  _contextId: string,
): Promise<{ viewId: string } | undefined> => undefined;

/**
 * `undefined` for a service that needs nothing -- the SDK's own defaults then
 * apply.
 *
 * **`waitUntil` is never supplied.** It is the SDK's hook for finishing the
 * work after the response has gone out, and deferring is exactly what closes a
 * Teams dialog before it can open (Implementation Note 3.5): the modal path
 * has to complete inside the response cycle.
 */
export const webhookOptionsFor = (
  platform: PlatformName,
): WebhookOptions | undefined =>
  OPENS_MODAL_IN_WEBHOOK_RESPONSE[platform]
    ? { onOpenModal: openModalInResponse }
    : undefined;
