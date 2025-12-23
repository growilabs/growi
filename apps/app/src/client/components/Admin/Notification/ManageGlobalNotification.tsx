import React, {
  useCallback, useMemo, useEffect, useState, type JSX,
} from 'react';

import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useRouter } from 'next/router';

import { NotifyType, TriggerEventType } from '~/client/interfaces/global-notification';
import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';
import { isMailerSetupAtom } from '~/states/server-configurations';
import { useSWRxGlobalNotification } from '~/stores/global-notification';
import loggerFactory from '~/utils/logger';


import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

import TriggerEventCheckBox from './TriggerEventCheckBox';


const logger = loggerFactory('growi:manageGlobalNotification');


type Props = {
  globalNotificationId?: string,
}

const ManageGlobalNotification = (props: Props): JSX.Element => {

  const [triggerPath, setTriggerPath] = useState('');
  const [notifyType, setNotifyType] = useState<NotifyType>(NotifyType.Email);
  const [emailToSend, setEmailToSend] = useState('');
  const [slackChannelToSend, setSlackChannelToSend] = useState('');
  const [triggerEvents, setTriggerEvents] = useState(new Set());
  const { data: globalNotificationData, update: updateGlobalNotification } = useSWRxGlobalNotification(props.globalNotificationId || '');
  const globalNotification = useMemo(() => globalNotificationData?.globalNotification, [globalNotificationData?.globalNotification]);

  const router = useRouter();


  useEffect(() => {
    if (globalNotification != null) {
      const notifyType = globalNotification.__t;
      setNotifyType(notifyType);

      setTriggerPath(globalNotification.triggerPath);
      setTriggerEvents(new Set(globalNotification.triggerEvents));

      if (notifyType === NotifyType.Email) {
        setEmailToSend(globalNotification.toEmail);
      }
      else {
        setSlackChannelToSend(globalNotification.slackChannels);
      }
    }
  }, [globalNotification]);

  const isLoading = globalNotificationData === undefined;
  const notExistsGlobalNotification = !isLoading && globalNotificationData == null;

  useEffect(() => {
    if (notExistsGlobalNotification) {
      router.push('/admin/notification');
    }
  }, [notExistsGlobalNotification, router]);


  const onChangeTriggerEvents = useCallback((triggerEvent) => {
    let newTriggerEvents;

    if (triggerEvents.has(triggerEvent)) {
      newTriggerEvents = ([...triggerEvents].filter(item => item !== triggerEvent));
      setTriggerEvents(new Set(newTriggerEvents));
    }
    else {
      newTriggerEvents = [...triggerEvents, triggerEvent];
      setTriggerEvents(new Set(newTriggerEvents));
    }
  }, [triggerEvents]);


  const updateButtonClickedHandler = useCallback(async() => {
    const requestParams = {
      triggerPath,
      notifyType,
      toEmail: emailToSend,
      slackChannels: slackChannelToSend,
      triggerEvents: [...triggerEvents],
    };

    try {
      if (props.globalNotificationId != null) {
        await updateGlobalNotification(requestParams);
        router.push('/admin/notification');
      }
      else {
        await apiv3Post('/notification-setting/global-notification', requestParams);
        router.push('/admin/notification');
      }
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  }, [emailToSend, notifyType, props.globalNotificationId, router, slackChannelToSend, triggerEvents, triggerPath, updateGlobalNotification]);


  // Mailer setup status (unused yet but kept for potential conditional logic)
  const isMailerSetup = useAtomValue(isMailerSetupAtom);
  const { t } = useTranslation('admin');

  return (
    <>
      <div className="my-3">
        <Link href="/admin/notification" className="btn btn-outline-secondary">
          <span className="material-symbols-outlined" aria-hidden="true">arrow_left_alt</span>
          {t('notification_settings.back_to_list')}
        </Link>
      </div>


      <div className="row">
        <div className="form-box col-md-12">
          <h2 className="border-bottom mb-5">{t('notification_settings.notification_detail')}</h2>
        </div>

        <div className="col-sm-4">
          <h3>
            <label htmlFor="triggerPath" className="form-label">{t('notification_settings.trigger_path')}
              {/* eslint-disable-next-line react/no-danger */}
              <small dangerouslySetInnerHTML={{ __html: t('notification_settings.trigger_path_help', '<code>*</code>') }} />
            </label>
          </h3>
          <div>
            <input
              className="form-control"
              type="text"
              name="triggerPath"
              value={triggerPath}
              onChange={(e) => { setTriggerPath(e.target.value) }}
              required
            />
          </div>

          <h3>{t('notification_settings.notify_to')}</h3>
          <div>
            <div className="form-check">
              <input
                className="form-check-input"
                type="radio"
                id="mail"
                name="notifyType"
                value="mail"
                checked={notifyType === NotifyType.Email}
                onChange={() => { setNotifyType(NotifyType.Email) }}
              />
              <label className="form-label form-check-label" htmlFor="mail">
                <p className="fw-bold">Email</p>
              </label>
            </div>
            <div className="form-check ms-2">
              <input
                className="form-check-input"
                type="radio"
                id="slack"
                name="notifyType"
                value="slack"
                checked={notifyType === NotifyType.SLACK}
                onChange={() => { setNotifyType(NotifyType.SLACK) }}
              />
              <label className="form-label form-check-label" htmlFor="slack">
                <p className="fw-bold">Slack</p>
              </label>
            </div>
          </div>

          {notifyType === NotifyType.Email
            ? (
              <>
                <div className="input-group notify-to-option" id="mail-input">
                  <div>
                    <span className="input-group-text" id="mail-addon"></span><span className="material-symbols-outlined">mail</span>
                  </div>
                  <input
                    className="form-control"
                    type="text"
                    aria-describedby="mail-addon"
                    name="toEmail"
                    placeholder="Email"
                    value={emailToSend}
                    onChange={(e) => { setEmailToSend(e.target.value) }}
                  />

                </div>

                <p className="p-2">
                  {/* eslint-disable-next-line react/no-danger */}
                  {!isMailerSetup && <span className="form-text text-muted" dangerouslySetInnerHTML={{ __html: t('admin:mailer_setup_required') }} />}
                  <b>Hint: </b>
                  <a href="https://ifttt.com/create" target="blank">{t('notification_settings.email.ifttt_link')}
                    <span className="material-symbols-outlined">share</span>
                  </a>
                </p>
              </>
            )
            : (
              <>
                <div className="input-group notify-to-option" id="slack-input">
                  <div>
                    <span className="input-group-text" id="slack-channel-addon"></span><span className="material-symbols-outlined">tag</span>
                  </div>
                  <input
                    className="form-control"
                    type="text"
                    aria-describedby="slack-channel-addon"
                    name="notificationGlobal[slackChannels]"
                    placeholder="Slack Channel"
                    value={slackChannelToSend}
                    onChange={(e) => { setSlackChannelToSend(e.target.value) }}
                  />
                </div>
                <p className="p-2">
                  {/* eslint-disable-next-line react/no-danger */}
                  <span dangerouslySetInnerHTML={{ __html: t('notification_settings.channel_desc') }} />
                </p>
              </>
            )}
        </div>

        <div className="offset-1 col-sm-5">
          <div>
            <h3>{t('notification_settings.trigger_events')}</h3>
            <div className="my-1">
              <TriggerEventCheckBox
                checkbox="success"
                event={TriggerEventType.CREATE}
                checked={triggerEvents.has(TriggerEventType.CREATE)}
                onChange={() => onChangeTriggerEvents(TriggerEventType.CREATE)}
              >
                <span className="badge rounded-pill bg-success">
                  <span className="material-symbols-outlined">edit_note</span> CREATE
                </span>
              </TriggerEventCheckBox>
            </div>
            <div className="my-1">
              <TriggerEventCheckBox
                checkbox="warning"
                event={TriggerEventType.EDIT}
                checked={triggerEvents.has(TriggerEventType.EDIT)}
                onChange={() => onChangeTriggerEvents(TriggerEventType.EDIT)}
              >
                <span className="badge rounded-pill bg-warning text-dark">
                  <span className="imaterial-symbols-outlined">edit</span> EDIT
                </span>
              </TriggerEventCheckBox>
            </div>
            <div className="my-1">
              <TriggerEventCheckBox
                checkbox="pink"
                event={TriggerEventType.MOVE}
                checked={triggerEvents.has(TriggerEventType.MOVE)}
                onChange={() => onChangeTriggerEvents(TriggerEventType.MOVE)}
              >
                <span className="badge rounded-pill bg-pink">
                  <span className="material-symbols-outlined">redo</span>MOVE
                </span>
              </TriggerEventCheckBox>
            </div>
            <div className="my-1">
              <TriggerEventCheckBox
                checkbox="danger"
                event="pageDelete"
                checked={triggerEvents.has(TriggerEventType.DELETE)}
                onChange={() => onChangeTriggerEvents(TriggerEventType.DELETE)}
              >
                <span className="badge rounded-pill bg-danger">
                  <span className="material-symbols-outlined">delete_forever</span>DELETE
                </span>
              </TriggerEventCheckBox>
            </div>
            <div className="my-1">
              <TriggerEventCheckBox
                checkbox="info"
                event={TriggerEventType.LIKE}
                checked={triggerEvents.has(TriggerEventType.LIKE)}
                onChange={() => onChangeTriggerEvents(TriggerEventType.LIKE)}
              >
                <span className="badge rounded-pill bg-info">
                  <span className="material-symbols-outlined">favorite</span>LIKE
                </span>
              </TriggerEventCheckBox>
            </div>
            <div className="my-1">
              <TriggerEventCheckBox
                checkbox="secondary"
                event={TriggerEventType.POST}
                checked={triggerEvents.has(TriggerEventType.POST)}
                onChange={() => onChangeTriggerEvents(TriggerEventType.POST)}
              >
                <span className="badge rounded-pill bg-primary">
                  <span className="material-symbols-outlined">language</span>POST
                </span>
              </TriggerEventCheckBox>
            </div>

          </div>
        </div>
      </div>

      <AdminUpdateButtonRow
        onClick={updateButtonClickedHandler}
        disabled={false}
      />
    </>
  );
};

export default ManageGlobalNotification;
