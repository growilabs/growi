import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tinykeys } from 'tinykeys';

import CreatePage from './Subscribers/CreatePage';
import EditPage from './Subscribers/EditPage';
import FocusToGlobalSearch from './Subscribers/FocusToGlobalSearch';
import ShowShortcutsModal from './Subscribers/ShowShortcutsModal';
import ShowStaffCredit from './Subscribers/ShowStaffCredit';
import SwitchToMirrorMode from './Subscribers/SwitchToMirrorMode';

type SubscriberComponent = React.ComponentType<{ onDeleteRender: () => void }>;

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
    const singleKeyHandler =
      (Component: SubscriberComponent) => (event: KeyboardEvent) => {
        if (isEditableTarget(event)) return;
        event.preventDefault();
        addView(Component);
      };

    const modifierKeyHandler =
      (Component: SubscriberComponent) => (event: KeyboardEvent) => {
        event.preventDefault();
        addView(Component);
      };

    const unsubscribe = tinykeys(window, {
      e: singleKeyHandler(EditPage),
      c: singleKeyHandler(CreatePage),
      '/': singleKeyHandler(FocusToGlobalSearch),
      'Control+/': modifierKeyHandler(ShowShortcutsModal),
      'Meta+/': modifierKeyHandler(ShowShortcutsModal),
      'ArrowUp ArrowUp ArrowDown ArrowDown ArrowLeft ArrowRight ArrowLeft ArrowRight b a':
        modifierKeyHandler(ShowStaffCredit),
      'x x b b a y a y ArrowDown ArrowLeft':
        modifierKeyHandler(SwitchToMirrorMode),
    });

    return unsubscribe;
  }, [addView]);

  return <>{views}</>;
};

export default HotkeysManager;
