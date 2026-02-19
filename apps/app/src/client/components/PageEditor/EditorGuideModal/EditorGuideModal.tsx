import {
  useState, useEffect, useLayoutEffect, type JSX, type RefObject, useMemo,
} from 'react';


import { useEditorGuideModalStatus, useEditorGuideModalActions } from '@growi/editor/dist/states/modal/editor-guide';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { CustomNavTab } from '../../CustomNavigation/CustomNav';
import CustomTabContent from '../../CustomNavigation/CustomTabContent';

import { DecorationTab } from './contents/DecorationTab';
import { LayoutTab } from './contents/LayoutTab';
import { TextStyleTab } from './contents/TextStyleTab';

const TAB_TYPES = ['textstyle', 'layout', 'decoration'] as const;
type TabType = (typeof TAB_TYPES)[number];
type Props = {
  containerRef: RefObject<HTMLDivElement | null>,
};
const isTabType = (key: string): key is TabType => {
  return (TAB_TYPES as readonly string[]).includes(key);
};

/**
 * EditorGuideModal
 *
 * This modal overlays only the preview area (specified by containerRef),
 * not the entire screen. Uses createPortal to render into document.body.
 */
export const EditorGuideModal = ({ containerRef }: Props): JSX.Element => {
  const { t } = useTranslation();
  const { isOpened } = useEditorGuideModalStatus();
  const { close } = useEditorGuideModalActions();
  const [isShown, setIsShown] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const [activeTab, setActiveTab] = useState<TabType>('textstyle');
  const navTabMapping = useMemo((): Record<TabType, { i18n: string, Content: () => JSX.Element }> => {
    return {
      textstyle: {
        i18n: t('editor_guide.tabs.textstyle'),
        Content: () => <TextStyleTab />,
      },
      layout: {
        i18n: t('editor_guide.tabs.layout'),
        Content: () => <LayoutTab />,
      },
      decoration: {
        i18n: t('editor_guide.tabs.decoration'),
        Content: () => <DecorationTab />,
      },
    };
  }, [t]);

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
            <div className="mt-2 px-3">
              <CustomNavTab
                activeTab={activeTab}
                navTabMapping={navTabMapping}
                onNavSelected={(tabKey) => {
                  if (isTabType(tabKey)) {
                    setActiveTab(tabKey);
                  }
                }}
                hideBorderBottom
              />
            </div>
            <div className="card-body overflow-auto">
              <CustomTabContent
                activeTab={activeTab}
                navTabMapping={navTabMapping}
              />
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};
