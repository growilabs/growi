import React, { type JSX } from 'react';

import { SlackbotType } from '@growi/slack';
import { useTranslation } from 'next-i18next';
import Image from 'next/image';

const botDetails = {
  officialBot: {
    botType: SlackbotType.OFFICIAL,
    botTypeCategory: 'official_bot',
    setUp: 'easy',
    multiWSIntegration: 'possible',
    securityControl: 'impossible',
  },
  customBotWithoutProxy: {
    botType: SlackbotType.CUSTOM_WITHOUT_PROXY,
    botTypeCategory: 'custom_bot',
    supplementaryBotName: 'without_proxy',
    setUp: 'normal',
    multiWSIntegration: 'impossible',
    securityControl: 'possible',
  },
  customBotWithProxy: {
    botType: SlackbotType.CUSTOM_WITH_PROXY,
    botTypeCategory: 'custom_bot',
    supplementaryBotName: 'with_proxy',
    setUp: 'hard',
    multiWSIntegration: 'possible',
    securityControl: 'possible',
  },
};

type BotTypeCardProps = {
  isActive: boolean,
  botType: string,
  onBotTypeSelectHandler: (botType: SlackbotType) => void,
};

export const BotTypeCard = (props: BotTypeCardProps): JSX.Element => {
  const { t } = useTranslation();

  const { isActive, botType, onBotTypeSelectHandler } = props;

  const isBotTypeOfficial = botType === SlackbotType.OFFICIAL;

  return (
    <div
      className={`card admin-bot-card rounded border-radius-sm shadow ${isActive ? 'border-primary' : ''}`}
      onClick={() => onBotTypeSelectHandler(botDetails[botType].botType)}
      role="button"
      key={botType}
    >
      <div>
        <h3 className={`card-header mb-0 py-3
              ${isBotTypeOfficial ? 'd-flex align-items-center justify-content-center' : 'text-center'}
              ${isActive ? 'bg-primary grw-botcard-title-active' : ''}`}
        >
          <span className="me-2">
            {t(`admin:slack_integration.selecting_bot_types.${botDetails[botType].botTypeCategory}`)}
          </span>

          {/*  A recommended badge is shown on official bot card, supplementary names are shown on Custom bot cards   */}
          { isBotTypeOfficial
            ? (
              <span className="badge bg-info me-2">
                {t('admin:slack_integration.selecting_bot_types.recommended')}
              </span>
            ) : (
              <span className="supplementary-bot-name me-2">
                {t(`admin:slack_integration.selecting_bot_types.${botDetails[botType].supplementaryBotName}`)}
              </span>
            )}

          <i className={isActive ? 'grw-botcard-title-active' : ''} aria-hidden="true"></i>
        </h3>
      </div>
      <div className="card-body p-4">
        <div className="card-text">
          <div className="my-2">
            <Image
              className="bot-difficulty-icon d-block mx-auto mb-4"
              src={`/images/slack-integration/slackbot-difficulty-level-${botDetails[botType].setUp}.svg`}
              alt=""
              width={60}
              height={60}
            />
            <div className="d-flex justify-content-between mb-3 align-items-center">
              <span>{t('admin:slack_integration.selecting_bot_types.multiple_workspaces_integration')}</span>
              <Image
                className="bot-type-disc"
                src={`/images/slack-integration/${botDetails[botType].multiWSIntegration}.png`}
                alt=""
                width={20}
                height={20}
              />
            </div>
            <div className="d-flex justify-content-between align-items-center">
              <span>{t('admin:slack_integration.selecting_bot_types.security_control')}</span>
              <Image
                className="bot-type-disc"
                src={`/images/slack-integration/${botDetails[botType].securityControl}.png`}
                alt=""
                width={20}
                height={20}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

BotTypeCard.displayName = 'BotTypeCard';
