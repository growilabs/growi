import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tinykeys } from 'tinykeys';

import * as createPage from './Subscribers/CreatePage';
import * as editPage from './Subscribers/EditPage';
import * as focusToGlobalSearch from './Subscribers/FocusToGlobalSearch';
import * as showShortcutsModal from './Subscribers/ShowShortcutsModal';
import * as showStaffCredit from './Subscribers/ShowStaffCredit';
import * as switchToMirrorMode from './Subscribers/SwitchToMirrorMode';

export type HotkeyCategory = 'single' | 'modifier';

export type HotkeyBindingDef = {
  keys: string | string[];
  category: HotkeyCategory;
};

type SubscriberComponent = React.ComponentType<{ onDeleteRender: () => void }>;

type HotkeySubscriber = {
  component: SubscriberComponent;
  bindings: HotkeyBindingDef;
};

const subscribers: HotkeySubscriber[] = [
  { component: editPage.EditPage, bindings: editPage.hotkeyBindings },
  { component: createPage.CreatePage, bindings: createPage.hotkeyBindings },
  {
    component: focusToGlobalSearch.FocusToGlobalSearch,
    bindings: focusToGlobalSearch.hotkeyBindings,
  },
  {
    component: showShortcutsModal.ShowShortcutsModal,
    bindings: showShortcutsModal.hotkeyBindings,
  },
  {
    component: showStaffCredit.ShowStaffCredit,
    bindings: showStaffCredit.hotkeyBindings,
  },
  {
    component: switchToMirrorMode.SwitchToMirrorMode,
    bindings: switchToMirrorMode.hotkeyBindings,
  },
];

const isEditableTarget = (event: KeyboardEvent): boolean => {
  const target = event.target as HTMLElement | null;
  if (target == null) return false;
  const { tagName } = target;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }
  return target.isContentEditable;
};

const HotkeysManager = (): JSX.Element => {
  const [views, setViews] = useState<JSX.Element[]>([]);
  const nextKeyRef = useRef(0);

  const addView = useCallback((Component: SubscriberComponent) => {
    const viewKey = String(nextKeyRef.current++);
    const deleteRender = () => {
      setViews((prev) => prev.filter((v) => v.key !== viewKey));
    };
    setViews((prev) => [
      ...prev,
      <Component key={viewKey} onDeleteRender={deleteRender} />,
    ]);
  }, []);

  useEffect(() => {
    const createHandler =
      (component: SubscriberComponent, category: HotkeyCategory) =>
      (event: KeyboardEvent) => {
        if (category === 'single' && isEditableTarget(event)) return;
        event.preventDefault();
        addView(component);
      };

    const bindingMap: Record<string, (event: KeyboardEvent) => void> = {};
    for (const { component, bindings } of subscribers) {
      const handler = createHandler(component, bindings.category);
      const keys = Array.isArray(bindings.keys)
        ? bindings.keys
        : [bindings.keys];
      for (const key of keys) {
        bindingMap[key] = handler;
      }
    }

    const unsubscribe = tinykeys(window, bindingMap);
    return unsubscribe;
  }, [addView]);

  return <>{views}</>;
};

export default HotkeysManager;
