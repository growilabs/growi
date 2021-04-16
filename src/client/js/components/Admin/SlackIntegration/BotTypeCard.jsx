import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';


const botDetails = {
  officialBot: {
    botType: 'officialBot',
    botTypeCategory: 'official_bot',
    setUp: 'easy',
    multiWSIntegration: 'possible',
    securityControl: 'impossible',
  },
  customBotWithoutProxy: {
    botType: 'customBotWithoutProxy',
    botTypeCategory: 'custom_bot',
    supplementaryBotName: 'without_proxy',
    setUp: 'normal',
    multiWSIntegration: 'impossible',
    securityControl: 'possible',
  },
  customBotWithProxy: {
    botType: 'customBotWithProxy',
    botTypeCategory: 'custom_bot',
    supplementaryBotName: 'with_proxy',
    setUp: 'hard',
    multiWSIntegration: 'possible',
    securityControl: 'possible',
  },
};

const BotTypeCard = (props) => {
  const { t } = useTranslation('admin');

  return (
    <div
      className={`card admin-bot-card rounded border-radius-sm shadow ${props.isActive ? 'border-primary' : ''}`}
      onClick={() => props.handleBotTypeSelect(botDetails[props.botType].botType)}
      role="button"
      key={props.botType}
    >
      <div>
        <h3 className={`card-header mb-0 py-3
              ${props.botType === 'officialBot' ? 'd-flex align-items-center justify-content-center' : 'text-center'}
              ${props.isActive ? 'bg-primary text-light' : ''}`}
        >
          <span className="mr-2">
            {t(`admin:slack_integration.selecting_bot_types.${botDetails[props.botType].botTypeCategory}`)}
          </span>

          {/*  A recommended badge is shown on official bot card, supplementary names are shown on Custom bot cards   */}
          {props.botType === 'officialBot'
          ? (
            <span className="badge badge-info mr-2">
              {t('admin:slack_integration.selecting_bot_types.recommended')}
            </span>
          ) : (
            <span className="supplementary-bot-name mr-2">
              {t(`admin:slack_integration.selecting_bot_types.${botDetails[props.botType].supplementaryBotName}`)}
            </span>
          )}

          {/* TODO: add an appropriate links by GW-5614 */}
          <i className={`fa fa-external-link btn-link ${props.isActive ? 'bg-primary text-light' : ''}`} aria-hidden="true"></i>
        </h3>
      </div>
      <div className="card-body p-4">
        <div className="card-text">
          <div className="my-2">
            <div className="d-flex justify-content-between mb-3">
              {/* TODO add image of difficulties by GW-5638
               <span>{t('admin:slack_integration.selecting_bot_types.set_up')}</span>
               <span className={`bot-type-disc-${value.setUp}`}>{t(`admin:slack_integration.selecting_bot_types.${value.setUp}`)}</span>  */}


            </div>
            <div className="d-flex justify-content-between mb-3">
              <span>{t('admin:slack_integration.selecting_bot_types.multiple_workspaces_integration')}</span>
              <img className="bot-type-disc" src={`/images/slack-integration/${botDetails[props.botType].multiWSIntegration}.png`} alt="" />
            </div>
            <div className="d-flex justify-content-between">
              <span>{t('admin:slack_integration.selecting_bot_types.security_control')}</span>
              <img className="bot-type-disc" src={`/images/slack-integration/${botDetails[props.botType].securityControl}.png`} alt="" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

};

BotTypeCard.propTypes = {
  isActive: PropTypes.bool.isRequired,
  botType: PropTypes.string.isRequired,
  handleBotTypeSelect: PropTypes.func.isRequired,
};

export default BotTypeCard;
