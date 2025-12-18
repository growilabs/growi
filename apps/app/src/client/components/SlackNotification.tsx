/* eslint-disable react/prop-types */
import type { FC } from 'react';
import { useTranslation } from 'next-i18next';
import {
  FormGroup,
  Input,
  InputGroup,
  InputGroupText,
  PopoverBody,
  PopoverHeader,
  UncontrolledPopover,
} from 'reactstrap';

import styles from './SlackNotification.module.scss';

type SlackNotificationProps = {
  id: string;
  isSlackEnabled: boolean;
  slackChannels: string;
  onEnabledFlagChange?: (isSlackEnabled: boolean) => void;
  onChannelChange?: (value: string) => void;
};

export const SlackNotification: FC<SlackNotificationProps> = ({
  id,
  isSlackEnabled,
  slackChannels,
  onEnabledFlagChange,
  onChannelChange,
}) => {
  const { t } = useTranslation();
  const idForSlackPopover = `${id}ForSlackPopover`;

  const updateCheckboxHandler = (event: { target: { checked: boolean } }) => {
    const value = event.target.checked;
    if (onEnabledFlagChange != null) {
      onEnabledFlagChange(value);
    }
  };

  const updateSlackChannelsHandler = (event: { target: { value: string } }) => {
    const value = event.target.value;
    if (onChannelChange != null) {
      onChannelChange(value);
    }
  };

  return (
    <InputGroup
      className={`d-flex align-items-center ${styles['grw-slack-switch']}`}
    >
      <InputGroupText className="rounded-pill rounded-end border-end-0 p-0 pe-1 grw-slack-switch">
        <FormGroup switch className="position-relative pe-4 py-3 m-0 me-2">
          <Input
            className="position-absolute bottom-0 start-0 p-0 m-0 w-100 h-100 border-0"
            type="switch"
            role="switch"
            id={id}
            checked={isSlackEnabled}
            onChange={updateCheckboxHandler}
          />
        </FormGroup>
      </InputGroupText>
      <Input
        className="rounded-pill rounded-start border-start-0 py-1"
        id={idForSlackPopover}
        type="text"
        value={slackChannels}
        placeholder={`${t('slack_notification.input_channels')}`}
        onChange={updateSlackChannelsHandler}
      />
      <UncontrolledPopover
        trigger="focus"
        placement="top"
        target={idForSlackPopover}
      >
        <PopoverHeader>{t('slack_notification.popover_title')}</PopoverHeader>
        <PopoverBody>{t('slack_notification.popover_desc')}</PopoverBody>
      </UncontrolledPopover>
    </InputGroup>
  );
};
