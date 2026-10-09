// Task 3.5: 「入力欄の開閉」 -- the `openModal` half.
//
// The contract asserted here has two halves:
//
//  1. **A modal is opened by handing the form back to the very SDK event that
//     produced the trigger.** That is not an implementation detail: it is the
//     only mechanism that works on both services whose `modal` capability is
//     `full` (see this file's own header for the evidence), and it is what makes
//     the later `modal-submit` resolvable at all.
//  2. **One `FieldSpec` becomes exactly one input named after it**, because the
//     same `FieldSpec` list has to collect the same `Record<string, string>`
//     through the ask-back path as well (design.md 1067行目).
import type { ModalElement, TextInputElement } from 'chat';

import type { ModalForm } from '../types/index.js';
import {
  createModalTriggerRegistry,
  MODAL_CALLBACK_ID,
  type ModalOpener,
  openModal,
} from './prompt.js';

const FORM: ModalForm = {
  title: '会話をページにする',
  fields: [
    {
      name: 'range',
      label: '取り込む範囲',
      required: true,
      kind: 'time-range',
    },
    { name: 'path', label: '保存先', required: true, kind: 'path' },
    {
      name: 'note',
      label: 'メモ',
      required: false,
      kind: 'multiline',
      maxLength: 300,
    },
  ],
};

/**
 * The inputs of an opened modal. `ModalElement.children` is a union that also
 * admits static text, so the narrowing is what lets a test read `id` / `label`
 * at all -- and asserting that every child *is* an input is part of the
 * contract with `ArgumentCollector`.
 */
const inputsOf = (modal: ModalElement): ReadonlyArray<TextInputElement> =>
  modal.children.filter(
    (child): child is TextInputElement => child.type === 'text_input',
  );

/** Records what the SDK event was asked to open. */
const openerSpy = () => {
  const opened: ModalElement[] = [];
  const opener: ModalOpener = (modal) => {
    opened.push(modal);
    return Promise.resolve({ viewId: 'V1' });
  };
  return { opener, opened };
};

describe('createModalTriggerRegistry', () => {
  it('mints a trigger for an event that carries no platform trigger id at all', async () => {
    // Teams' `modal` capability is `full`, yet its events never carry a
    // trigger id -- the SDK opens the modal from the event itself. A registry
    // keyed on the event's own opener is what makes that service reachable; a
    // trigger minted from `triggerId` would be `null` here and the caller
    // would wrongly fall back to asking questions in the channel.
    const registry = createModalTriggerRegistry();
    const { opener, opened } = openerSpy();

    const trigger = registry.register(opener);
    const didOpen = await openModal(registry, trigger, FORM, 'corr-1');

    expect(trigger.token).not.toBe('');
    expect(didOpen).toBe(true);
    expect(opened).toHaveLength(1);
  });

  it('gives every registration its own trigger', () => {
    const registry = createModalTriggerRegistry();

    const first = registry.register(openerSpy().opener);
    const second = registry.register(openerSpy().opener);

    expect(first.token).not.toBe(second.token);
  });
});

describe('openModal', () => {
  it('opens a modal titled by the form and tagged with the correlation id', async () => {
    const registry = createModalTriggerRegistry();
    const { opener, opened } = openerSpy();

    await openModal(registry, registry.register(opener), FORM, 'corr-1');

    const modal = opened[0];
    if (modal == null) throw new Error('nothing was opened');
    expect(modal.title).toBe('会話をページにする');
    // The correlation id rides `privateMetadata`, which is what
    // `event-mapping.fromModalSubmit` reads back; `callbackId` is the static
    // key `onModalSubmit` filters handlers by.
    expect(modal.privateMetadata).toBe('corr-1');
    expect(modal.callbackId).toBe(MODAL_CALLBACK_ID);
  });

  it('turns each declared field into exactly one input named after the field', async () => {
    const registry = createModalTriggerRegistry();
    const { opener, opened } = openerSpy();

    await openModal(registry, registry.register(opener), FORM, 'corr-1');

    const modal = opened[0];
    if (modal == null) throw new Error('nothing was opened');
    expect(inputsOf(modal).map((child) => child.id)).toEqual([
      'range',
      'path',
      'note',
    ]);
  });

  it('labels every input and marks the optional ones optional', async () => {
    const registry = createModalTriggerRegistry();
    const { opener, opened } = openerSpy();

    await openModal(registry, registry.register(opener), FORM, 'corr-1');

    const modal = opened[0];
    if (modal == null) throw new Error('nothing was opened');
    expect(inputsOf(modal)).toHaveLength(modal.children.length);
    expect(inputsOf(modal).map((child) => child.label)).toEqual([
      '取り込む範囲',
      '保存先',
      'メモ',
    ]);
    expect(inputsOf(modal).map((child) => child.optional)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('renders a multiline field as a multiline input and carries its length limit', async () => {
    const registry = createModalTriggerRegistry();
    const { opener, opened } = openerSpy();

    await openModal(registry, registry.register(opener), FORM, 'corr-1');

    const modal = opened[0];
    if (modal == null) throw new Error('nothing was opened');
    const note = inputsOf(modal).find((child) => child.id === 'note');
    const path = inputsOf(modal).find((child) => child.id === 'path');
    expect(note?.multiline).toBe(true);
    expect(note?.maxLength).toBe(300);
    expect(path?.multiline).toBe(false);
  });

  it('shows the reader how to write a range, since one field collects one string', async () => {
    const registry = createModalTriggerRegistry();
    const { opener, opened } = openerSpy();

    await openModal(registry, registry.register(opener), FORM, 'corr-1');

    const modal = opened[0];
    if (modal == null) throw new Error('nothing was opened');
    const range = inputsOf(modal).find((child) => child.id === 'range');
    expect(range?.placeholder).not.toBe('');
    expect(range?.placeholder).toBeDefined();
  });

  it('refuses to reuse a trigger, because the platform hands each one out once', async () => {
    const registry = createModalTriggerRegistry();
    const { opener, opened } = openerSpy();
    const trigger = registry.register(opener);

    const first = await openModal(registry, trigger, FORM, 'corr-1');
    const second = await openModal(registry, trigger, FORM, 'corr-2');

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(opened).toHaveLength(1);
  });

  it('reports a trigger it no longer holds, so the caller can ask in the channel instead', async () => {
    const registry = createModalTriggerRegistry();

    const didOpen = await openModal(
      registry,
      { token: 'never-registered' },
      FORM,
      'corr-1',
    );

    expect(didOpen).toBe(false);
  });

  it('lets a trigger lapse once it is older than the registry keeps them', async () => {
    let clock = 1_000;
    const registry = createModalTriggerRegistry({
      ttlMs: 60_000,
      now: () => clock,
    });
    const { opener, opened } = openerSpy();
    const trigger = registry.register(opener);

    clock += 60_001;
    const didOpen = await openModal(registry, trigger, FORM, 'corr-1');

    expect(didOpen).toBe(false);
    expect(opened).toHaveLength(0);
  });

  it('reports a modal the platform declined to open', async () => {
    const registry = createModalTriggerRegistry();
    // The SDK answers `undefined` when the service supports no modal or the
    // trigger has already expired on the platform's side.
    const declining: ModalOpener = () => Promise.resolve(undefined);

    const didOpen = await openModal(
      registry,
      registry.register(declining),
      FORM,
      'corr-1',
    );

    expect(didOpen).toBe(false);
  });

  it('reports a failure instead of throwing, so a dead trigger cannot break the whole invocation', async () => {
    const registry = createModalTriggerRegistry();
    const failing: ModalOpener = () =>
      Promise.reject(new Error('trigger_id expired'));

    const didOpen = await openModal(
      registry,
      registry.register(failing),
      FORM,
      'corr-1',
    );

    expect(didOpen).toBe(false);
  });

  it('forgets triggers that lapsed, so a long-running process does not accumulate them', () => {
    let clock = 1_000;
    const registry = createModalTriggerRegistry({
      ttlMs: 60_000,
      now: () => clock,
    });
    registry.register(openerSpy().opener);
    registry.register(openerSpy().opener);
    expect(registry.size()).toBe(2);

    clock += 60_001;
    registry.register(openerSpy().opener);

    expect(registry.size()).toBe(1);
  });
});
