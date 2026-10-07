/**
 * @param {Effects} effects
 * @param {State} ok
 */
export function factoryAttributesDevider(
  effects: Effects,
  ok: State,
): (
  code: import('micromark-util-types').Code,
) => undefined | import('micromark-util-types').State;
export type Effects = import('micromark-util-types').Effects;
export type State = import('micromark-util-types').State;
