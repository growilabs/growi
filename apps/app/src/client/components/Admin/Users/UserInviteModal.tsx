import {
  type ChangeEvent,
  type JSX,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';
import { toastError, toastSuccess, toastWarning } from '~/client/util/toastr';
import {
  isMailerSetupAtom,
  registrationWhitelistAtom,
} from '~/states/server-configurations';
import { isEmailMatchedByEntry } from '~/utils/email-whitelist';

import { withUnstatedContainers } from '../../UnstatedUtils';

type CreatedUser = {
  email: string;
  password: string;
};

type FailedEmail = {
  email: string;
  reason: string;
};

type InvitedEmailList = {
  createdUserList: CreatedUser[];
  existingEmailList: string[];
  failedEmailList: FailedEmail[];
};

type Props = {
  adminUsersContainer: InstanceType<typeof AdminUsersContainer>;
};

const UserInviteModal = ({ adminUsersContainer }: Props): JSX.Element => {
  const { t } = useTranslation();
  const isMailerSetup = useAtomValue(isMailerSetupAtom) ?? false;
  const registrationWhitelist = useAtomValue(registrationWhitelistAtom) ?? [];

  const [emailInputValue, setEmailInputValue] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [invitedEmailList, setInvitedEmailList] =
    useState<InvitedEmailList | null>(null);
  const [isCreateUserButtonPushed, setIsCreateUserButtonPushed] =
    useState(false);

  const onToggleModal = useCallback(() => {
    adminUsersContainer.toggleUserInviteModal();
    setInvitedEmailList(null);
  }, [adminUsersContainer]);

  const showToaster = useCallback(() => {
    toastSuccess('Copied Mail and Password');
  }, []);

  const showToasterByEmailList = useCallback(
    (emailList: string[], toast: 'success' | 'warning' | 'error') => {
      let msg = '';
      emailList.forEach((email) => {
        msg += `・${email}<br>`;
      });
      switch (toast) {
        case 'success':
          msg = `User has been created<br>${msg}`;
          toastSuccess(msg);
          break;
        case 'warning':
          msg = `Existing email<br>${msg}`;
          toastWarning(msg);
          break;
        case 'error':
          toastError(msg);
          break;
      }
    },
    [],
  );

  const isValidEmail = useMemo(
    () => /.+@.+\..+/.test(emailInputValue),
    [emailInputValue],
  );

  const whitelistViolations = useMemo<string[]>(() => {
    if (registrationWhitelist.length === 0) {
      return [];
    }
    return emailInputValue
      .split('\n')
      .map((e) => e.trim())
      .filter((e) => /.+@.+\..+/.test(e))
      .filter(
        (email) =>
          !registrationWhitelist.some((entry) =>
            isEmailMatchedByEntry(email, entry),
          ),
      );
  }, [emailInputValue, registrationWhitelist]);

  const handleSubmit = useCallback(async () => {
    setIsCreateUserButtonPushed(true);

    const array = emailInputValue.split('\n');
    const emailList = array.filter((element) => {
      return element.match(/.+@.+\..+/);
    });
    const shapedEmailList = emailList.map((email) => {
      return email.trim();
    });

    try {
      const result: InvitedEmailList =
        await adminUsersContainer.createUserInvited(shapedEmailList, sendEmail);
      setEmailInputValue('');
      setInvitedEmailList(result);

      if (result.createdUserList.length > 0) {
        const createdEmailList = result.createdUserList.map(
          (user: CreatedUser) => user.email,
        );
        showToasterByEmailList(createdEmailList, 'success');
      }
      if (result.existingEmailList.length > 0) {
        showToasterByEmailList(result.existingEmailList, 'warning');
      }
      if (result.failedEmailList.length > 0) {
        const failedMessages = result.failedEmailList.map(
          (failed: FailedEmail, index: number) => {
            const reason =
              failed.reason === 'email_not_in_whitelist'
                ? t(
                    'admin:user_management.invite_modal.reason_email_not_in_whitelist',
                  )
                : failed.reason;
            let message = `email: ${failed.email}<br>・reason: ${reason}`;
            if (index !== result.failedEmailList.length - 1) {
              message += '<br>';
            }
            return message;
          },
        );
        showToasterByEmailList(failedMessages, 'error');
      }
    } catch (err) {
      toastError(err instanceof Error ? err : String(err));
    } finally {
      setIsCreateUserButtonPushed(false);
    }
  }, [
    adminUsersContainer,
    emailInputValue,
    sendEmail,
    showToasterByEmailList,
    t,
  ]);

  const handleInput = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setEmailInputValue(event.target.value);
  }, []);

  const handleCheckBox = useCallback(() => {
    setSendEmail((prev) => !prev);
  }, []);

  const renderCreatedEmail = (userList: CreatedUser[]) => {
    return (
      <ul>
        {userList.map((user) => {
          const copyText = `Email:${user.email} Password:${user.password}`;
          return (
            <div className="my-1" key={user.email}>
              <CopyToClipboard text={copyText} onCopy={showToaster}>
                <li className="btn btn-outline-secondary">
                  Email: <strong className="me-3">{user.email}</strong>{' '}
                  Password: <strong>{user.password}</strong>
                </li>
              </CopyToClipboard>
            </div>
          );
        })}
      </ul>
    );
  };

  const renderExistingEmail = (emailList: string[]) => {
    return (
      <>
        <p className="text-warning">
          {t('admin:user_management.invite_modal.existing_email')}
        </p>
        <ul>
          {emailList.map((user) => {
            return (
              <li key={user}>
                <strong>{user}</strong>
              </li>
            );
          })}
        </ul>
      </>
    );
  };

  const renderModalBody = () => {
    return (
      <>
        <label className="form-label" htmlFor="admin-invite-emails">
          {t('admin:user_management.invite_modal.emails')}
        </label>
        <p>
          {t('admin:user_management.invite_modal.description1')}
          <br />
          {t('admin:user_management.invite_modal.description2')}
        </p>
        <textarea
          className="form-control"
          id="admin-invite-emails"
          placeholder="e.g.&#13;&#10;user1@growi.org&#13;&#10;user2@growi.org"
          style={{ height: '200px' }}
          value={emailInputValue}
          onChange={handleInput}
        />
        {!isValidEmail && (
          <p className="m-2 text-danger">
            {t('admin:user_management.invite_modal.valid_email')}
          </p>
        )}
        {whitelistViolations.length > 0 && (
          <div className="m-2 text-danger">
            <p className="mb-1">
              {t('admin:user_management.invite_modal.whitelist_violation')}
            </p>
            <ul className="mb-0">
              {whitelistViolations.map((email) => (
                <li key={email}>{email}</li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  };

  const renderCreatedModalBody = () => {
    if (invitedEmailList == null) return null;
    return (
      <>
        <p>{t('admin:user_management.invite_modal.temporary_password')}</p>
        <p>{t('admin:user_management.invite_modal.send_new_password')}</p>
        {invitedEmailList.createdUserList.length > 0 &&
          renderCreatedEmail(invitedEmailList.createdUserList)}
        {invitedEmailList.existingEmailList.length > 0 &&
          renderExistingEmail(invitedEmailList.existingEmailList)}
      </>
    );
  };

  const renderModalFooter = () => {
    return (
      <>
        <div className="col text-start form-check form-check-info">
          <input
            type="checkbox"
            id="sendEmail"
            className="form-check-input"
            name="sendEmail"
            checked={sendEmail}
            onChange={handleCheckBox}
            disabled={!isMailerSetup}
          />
          <label className="form-label form-check-label" htmlFor="sendEmail">
            {t('admin:user_management.invite_modal.invite_thru_email')}
          </label>
          {isMailerSetup ? (
            <p
              className="form-text text-muted"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: includes markup from i18n strings
              dangerouslySetInnerHTML={{
                __html: t(
                  'admin:user_management.invite_modal.mail_setting_link',
                ),
              }}
            />
          ) : (
            <p
              className="form-text text-muted"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: includes markup from i18n strings
              dangerouslySetInnerHTML={{
                __html: t('admin:mailer_setup_required'),
              }}
            />
          )}
        </div>
        <div>
          <button
            type="button"
            className="btn btn-outline-secondary me-2"
            onClick={onToggleModal}
          >
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={
              !isValidEmail ||
              isCreateUserButtonPushed ||
              whitelistViolations.length > 0
            }
          >
            {t('admin:user_management.invite_modal.issue')}
          </button>
        </div>
      </>
    );
  };

  const renderCreatedModalFooter = () => {
    return (
      <>
        <div className="form-label me-3 text-start" style={{ flex: 1 }}>
          <span className="text-danger">
            {t('admin:user_management.invite_modal.send_temporary_password')}
          </span>
          <span>{t('admin:user_management.invite_modal.send_email')}</span>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onToggleModal}
        >
          {t('Close')}
        </button>
      </>
    );
  };

  return (
    <Modal isOpen={adminUsersContainer.state.isUserInviteModalShown}>
      <ModalHeader tag="h4" toggle={onToggleModal} className="text-info">
        {t('admin:user_management.invite_users')}
      </ModalHeader>
      <ModalBody>
        {invitedEmailList == null
          ? renderModalBody()
          : renderCreatedModalBody()}
      </ModalBody>
      <ModalFooter className="d-flex">
        {invitedEmailList == null
          ? renderModalFooter()
          : renderCreatedModalFooter()}
      </ModalFooter>
    </Modal>
  );
};

/**
 * Wrapper component for using unstated
 */
const UserInviteModalWrapper = withUnstatedContainers(UserInviteModal, [
  AdminUsersContainer,
]);

export default UserInviteModalWrapper;
