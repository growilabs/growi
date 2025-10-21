import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  onClick: (presetPrompt: string) => void;
};

const presetMenus = ['summarize', 'correct'];

export const QuickMenuList: React.FC<Props> = ({ onClick }: Props) => {
  const { t } = useTranslation();

  const clickQuickMenuHandler = useCallback(
    (quickMenu: string) => {
      onClick(t(`sidebar_ai_assistant.preset_menu.${quickMenu}.prompt`));
    },
    [onClick, t],
  );

  return (
    <div className="container">
      <div className="d-flex flex-column gap-3">
        {presetMenus.map((presetMenu) => (
          <button
            type="button"
            key={presetMenu}
            onClick={() => clickQuickMenuHandler(presetMenu)}
            className="btn text-body-secondary p-3 rounded-3 border border-1"
          >
            <div className="d-flex align-items-center">
              <span className="material-symbols-outlined fs-5 me-3">
                lightbulb
              </span>
              <span className="fs-6">
                {t(`sidebar_ai_assistant.preset_menu.${presetMenu}.title`)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
