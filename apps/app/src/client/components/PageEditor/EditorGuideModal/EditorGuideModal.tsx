import {
  useState, useEffect, useLayoutEffect, type JSX, type RefObject,
} from 'react';

import { useEditorGuideModalStatus, useEditorGuideModalActions } from '@growi/editor/dist/states/modal/editor-guide';
import { createPortal } from 'react-dom';

import { DecorationTab } from './contents/DecorationTab';
import { LayoutTab } from './contents/LayoutTab';
import { TextStyleTab } from './contents/TextStyleTab';

type TabType = 'textstyle' | 'layout' | 'decoration';
type Props = {
  containerRef: RefObject<HTMLDivElement | null>,
};

/**
 * EditorGuideModal
 *
 * This modal overlays only the preview area (specified by containerRef),
 * not the entire screen. Uses createPortal to render into document.body.
 */
export const EditorGuideModal = ({ containerRef }: Props): JSX.Element => {
  const { isOpened } = useEditorGuideModalStatus();
  const { close } = useEditorGuideModalActions();
  const [isShown, setIsShown] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const [activeTab, setActiveTab] = useState<TabType>('textstyle');

  // Get rect on open and on resize
  useLayoutEffect(() => {
    if (!isOpened || containerRef.current == null) return;

    const updateRect = () => setRect(containerRef.current?.getBoundingClientRect() ?? null);
    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [isOpened, containerRef]);

  // Trigger fade-in after mount
  useEffect(() => {
    if (!isOpened) {
      setIsShown(false);
      return;
    }
    const id = requestAnimationFrame(() => setIsShown(true));
    return () => cancelAnimationFrame(id);
  }, [isOpened]);

  if (!isOpened || rect == null) return <></>;

  const style = {
    position: 'fixed' as const, top: rect.top, left: rect.left, width: rect.width, height: rect.height,
  };

  return createPortal(
    <>
      <div className={`modal-backdrop fade z-2 ${isShown ? 'show' : ''}`} style={style} onClick={close} aria-hidden="true" />
      <div className={`d-flex align-items-center justify-content-center z-3 pe-none fade ${isShown ? 'show' : ''}`} style={style}>
        <div className="px-3 pe-auto">
          <div className="card shadow-lg">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Editor Guide</h5>
              <button type="button" className="btn-close" onClick={close} aria-label="Close" />
            </div>
            <ul className="nav nav-tabs nav-fill border-bottom-0 mt-2">
              {(['textstyle', 'layout', 'decoration'] as TabType[]).map(tab => (
                <li key={tab} className="nav-item">
                  <button
                    type="button"
                    className={`nav-link border-0 border-bottom border-3 py-2 ${
                      activeTab === tab ? 'active border-primary fw-bold' : 'border-transparent text-secondary'}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'textstyle' && 'テキストスタイル'}
                    {tab === 'layout' && 'レイアウト'}
                    {tab === 'decoration' && '装飾'}
                  </button>
                </li>
              ))}
            </ul>
            <div className="card-body overflow-auto">
              {activeTab === 'textstyle' && <TextStyleTab />}
              {activeTab === 'layout' && <LayoutTab />}
              {activeTab === 'decoration' && <DecorationTab />}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};
