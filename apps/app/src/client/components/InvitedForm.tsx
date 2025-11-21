import React, { useCallback, useState, type JSX } from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';

import { apiv3Post } from '~/client/util/apiv3-client';
import { useCurrentUser } from '~/states/global';


type InvitedFormProps = {
  invitedFormUsername: string,
  invitedFormName: string,
}

export const InvitedForm = (props: InvitedFormProps): JSX.Element => {

  const { t } = useTranslation();
  const router = useRouter();
  const user = useCurrentUser();
  const [loginErrors, setLoginErrors] = useState<Error[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const { invitedFormUsername, invitedFormName } = props;

  const submitHandler = useCallback(async(e) => {
    e.preventDefault();
    setIsLoading(true);

    const formData = e.target.elements;

    const {
      'invitedForm[name]': { value: name },
      'invitedForm[password]': { value: password },
      'invitedForm[username]': { value: username },
    } = formData;

    const invitedForm = {
      name,
      password,
      username,
    };

    try {
      const res = await apiv3Post('/invited', { invitedForm });
      const { redirectTo } = res.data;
      router.push(redirectTo ?? '/');
    }
    catch (err) {
      setLoginErrors(err);
      setIsLoading(false);
    }
  }, [router]);

  const formNotification = useCallback(() => {

    return (
      <>
        { loginErrors != null && loginErrors.length > 0 ? (
          <p className="alert alert-danger">
            { loginErrors.map((err) => {
              return <span>{ t(err.message) }<br /></span>;
            }) }
          </p>
        ) : (
          <p className="alert alert-success">
            <strong>{ t('invited.discription_heading') }</strong><br></br>
            <small>{ t('invited.discription') }</small>
          </p>
        ) }
      </>
    );
  }, [loginErrors, t]);

  if (user == null) {
    return <></>;
  }

  return (
    <div className="nologin-dialog px-3 pb-3 mx-auto" id="nologin-dialog">
      { formNotification() }
      <form role="form" onSubmit={submitHandler} id="invited-form">
        {/* Email Form */}
        <div className="input-group">
          <span className="input-group-text">
            <span className="material-symbols-outlined">mail</span>
          </span>
          <input
            type="text"
            className="form-control"
            disabled
            placeholder={t('Email')}
            name="invitedForm[email]"
            defaultValue={user.email}
            required
          />
        </div>
        {/* UserID Form */}
        <div className="input-group" id="input-group-username">
          <span className="input-group-text">
            <span className="material-symbols-outlined">person</span>
          </span>
          <input
            type="text"
            className="form-control"
            placeholder={t('User ID')}
            name="invitedForm[username]"
            defaultValue={invitedFormUsername}
            required
          />
        </div>
        {/* Name Form */}
        <div className="input-group">
          <span className="input-group-text">
            <span className="material-symbols-outlined">sell</span>
          </span>
          <input
            type="text"
            className="form-control"
            placeholder={t('Name')}
            name="invitedForm[name]"
            defaultValue={invitedFormName}
            required
          />
        </div>
        {/* Password Form */}
        <div className="input-group">
          <span className="input-group-text">
            <span className="material-symbols-outlined">lock</span>
          </span>
          <input
            type="password"
            className="form-control"
            placeholder={t('Password')}
            name="invitedForm[password]"
            required
            minLength={6}
          />
        </div>
        {/* Create Button */}
        <div className="input-group justify-content-center d-flex mt-4">
          <button type="submit" className="btn btn-fill" id="register" disabled={isLoading}>
            <span className="btn-label">
              {isLoading ? (
                <LoadingSpinner />
              ) : (
                <span className="material-symbols-outlined">person_add</span>
              )}
            </span>
            <span className="btn-label-text">{t('Create')}</span>
          </button>
        </div>
      </form>
      <div className="input-group mt-4 d-flex justify-content-center">
        <a href="https://growi.org" className="link-growi-org">
          <span className="growi">GROWI</span><span className="org">.ORG</span>
        </a>
      </div>
    </div>
  );
};
