import {
  type JSX,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import {
  useEditorGuideModalActions,
  useEditorGuideModalStatus,
} from '@growi/editor/dist/states/modal/editor-guide';
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
  containerRef: RefObject<HTMLDivElement | null>;
};
const isTabType = (key: string): key is TabType => {
  return (TAB_TYPES as readonly string[]).includes(key);
};

const TextStyleTabPane = (): React.JSX.Element => <TextStyleTab />;
const LayoutTabPane = (): React.JSX.Element => <LayoutTab />;
const DecorationTabPane = (): React.JSX.Element => <DecorationTab />;

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
  const navTabMapping = useMemo(() => {
    return {
      textstyle: {
        i18n: t('editor_guide.tabs.textstyle'),
        Content: TextStyleTabPane,
      },
      layout: {
        i18n: t('editor_guide.tabs.layout'),
        Content: LayoutTabPane,
      },
      decoration: {
        i18n: t('editor_guide.tabs.decoration'),
        Content: DecorationTabPane,
      },
    };
  }, [t]);

  // Get rect on open and on resize
  useLayoutEffect(() => {
    if (!isOpened || containerRef.current == null) return;

    const updateRect = () =>
      setRect(containerRef.current?.getBoundingClientRect() ?? null);
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
    position: 'fixed' as const,
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };

  return createPortal(
    <>
      <div
        className={`modal-backdrop fade z-2 ${isShown ? 'show' : ''}`}
        style={style}
        onClick={close}
        aria-hidden="true"
      />
      <div
        className={`d-flex align-items-center justify-content-center z-3 pe-none fade ${isShown ? 'show' : ''}`}
        style={style}
      >
        <div className="px-3 pe-auto w-100" style={{ maxWidth: '800px' }}>
          <div
            className="card shadow-lg border-0"
            style={{
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
            }}
          >
            <div className="card-header d-flex justify-content-between align-items-center bg-white border-bottom-0 pt-3">
              <h5 className="mb-0">{t('editor_guide.title')}</h5>
              <button
                type="button"
                className="btn-close"
                onClick={close}
                aria-label="Close"
              />
            </div>
            <div className="mt-2 px-3 editor-guide-tabs-container">
              <style>{`
                .editor-guide-tabs-container .nav-tabs,
                .editor-guide-tabs-container ul {
                  display: flex !important;
                  width: 100% !important;
                  justify-content: space-between !important; /* 子要素の間の隙間を均等にする */
                  flex-wrap: nowrap !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  list-style: none !important;
                }
                .editor-guide-tabs-container .nav-item,
                .editor-guide-tabs-container li {
                  flex: 1 1 0 !important; /* すべてのタブが同じ幅を奪い合う */
                  text-align: center !important;
                   min-width: 100px;
                }
                .editor-guide-tabs-container .nav-link,
                .editor-guide-tabs-container button,
                .editor-guide-tabs-container a {
                  display: block !important;
                  width: 100% !important;
                  white-space: nowrap;
                }
              `}</style>
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
            <div
              className="card-body overflow-auto pt-0"
              style={{ flex: '1 1 auto' }}
            >
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
