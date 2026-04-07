import {
  type JSX,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import {
  useEditorGuideModalActions,
  useEditorGuideModalStatus,
} from '@growi/editor/dist/states/modal/editor-guide';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader, Modal } from 'reactstrap';

import { CustomNavTab } from '../../CustomNavigation/CustomNav';
import CustomTabContent from '../../CustomNavigation/CustomTabContent';
import { DecorationTab } from './contents/DecorationTab';
import { LayoutTab } from './contents/LayoutTab';
import { TextStyleTab } from './contents/TextStyleTab';

import styles from './EditorGuideModal.module.scss';

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

export const EditorGuideModal = ({
  containerRef,
}: Props): JSX.Element | null => {
  const { t } = useTranslation();
  const { isOpened } = useEditorGuideModalStatus();
  const { close } = useEditorGuideModalActions();
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

  useLayoutEffect(() => {
    if (!isOpened || containerRef.current == null) return;

    const updateRect = () => {
      const r = containerRef.current?.getBoundingClientRect() ?? null;
      setRect(r);
      if (r != null) {
        document.body.style.setProperty('--egm-top', `${r.top}px`);
        document.body.style.setProperty('--egm-left', `${r.left}px`);
        document.body.style.setProperty('--egm-width', `${r.width}px`);
        document.body.style.setProperty('--egm-height', `${r.height}px`);
      }
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('resize', updateRect);
      document.body.style.removeProperty('--egm-top');
      document.body.style.removeProperty('--egm-left');
      document.body.style.removeProperty('--egm-width');
      document.body.style.removeProperty('--egm-height');
    };
  }, [isOpened, containerRef]);

  if (!isOpened || rect == null) return null;

  return (
    <Modal
      isOpen={isOpened}
      toggle={close}
      keyboard
      modalClassName={styles['editor-guide-modal']}
      backdropClassName={styles['editor-guide-backdrop']}
      contentClassName="bg-transparent border-0 shadow-none"
      style={{ margin: 0, maxWidth: '700px', width: 'calc(100% - 32px)' }}
    >
      <Card
        className="shadow-lg border-0"
        style={{ maxHeight: rect.height - 32 }}
      >
        <CardHeader className="d-flex justify-content-between align-items-center bg-transparent border-bottom-0 pt-3">
          <h5 className="mb-0 text-body">{t('editor_guide.title')}</h5>
          <button
            type="button"
            className="btn-close"
            onClick={close}
            aria-label="Close"
          />
        </CardHeader>
        <div className={`mt-2 px-3 ${styles['editor-guide-tabs-container']}`}>
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
        <CardBody
          className={`pt-0 flex-fill ${styles['card-body-scrollable']}`}
        >
          <CustomTabContent
            activeTab={activeTab}
            navTabMapping={navTabMapping}
          />
        </CardBody>
      </Card>
    </Modal>
  );
};
