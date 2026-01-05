import { body } from 'express-validator';
import type { EventEmitter } from 'events';
import type { NonBlankString } from '@growi/core';
import {
  ConfigSource,
  toNonBlankStringOrUndefined,
} from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';

import { SupportedAction } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import { configManager } from '~/server/service/config-manager';
import { getTranslation } from '~/server/service/i18next';
import loggerFactory from '~/utils/logger';
import type Crowi from '~/server/crowi';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:security-setting:saml');

// Type definitions
interface SamlRequestBody {
  entryPoint?: string | null;
  issuer?: string | null;
  cert?: string | null;
  attrMapId?: string | null;
  attrMapUsername?: string | null;
  attrMapMail?: string | null;
  attrMapFirstName?: string | null;
  attrMapLastName?: string | null;
  isSameUsernameTreatedAsIdenticalUser?: boolean;
  isSameEmailTreatedAsIdenticalUser?: boolean;
  ABLCRule?: string | null;
}

interface SamlSecuritySettingParams {
  missingMandatoryConfigKeys: string[];
  samlEntryPoint: NonBlankString | undefined;
  samlIssuer: NonBlankString | undefined;
  samlCert: NonBlankString | undefined;
  samlAttrMapId: NonBlankString | undefined;
  samlAttrMapUsername: NonBlankString | undefined;
  samlAttrMapMail: NonBlankString | undefined;
  samlAttrMapFirstName: NonBlankString | undefined;
  samlAttrMapLastName: NonBlankString | undefined;
  isSameUsernameTreatedAsIdenticalUser: boolean;
  isSameEmailTreatedAsIdenticalUser: boolean;
  samlABLCRule: NonBlankString | undefined;
}

type UpdateAndReloadStrategySettings = (
  authId: string,
  params: Record<string, unknown>,
  opts?: { removeIfUndefined?: boolean }
) => Promise<void>;

// Validator
export const samlAuthValidator = [
  body('entryPoint')
    .if((value: unknown) => value != null)
    .isString(),
  body('issuer')
    .if((value: unknown) => value != null)
    .isString(),
  body('cert')
    .if((value: unknown) => value != null)
    .isString(),
  body('attrMapId')
    .if((value: unknown) => value != null)
    .isString(),
  body('attrMapUsername')
    .if((value: unknown) => value != null)
    .isString(),
  body('attrMapMail')
    .if((value: unknown) => value != null)
    .isString(),
  body('attrMapFirstName')
    .if((value: unknown) => value != null)
    .isString(),
  body('attrMapLastName')
    .if((value: unknown) => value != null)
    .isString(),
  body('isSameUsernameTreatedAsIdenticalUser')
    .if((value: unknown) => value != null)
    .isBoolean(),
  body('isSameEmailTreatedAsIdenticalUser')
    .if((value: unknown) => value != null)
    .isBoolean(),
  body('ABLCRule')
    .if((value: unknown) => value != null)
    .isString(),
];

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     SamlAuthSetting:
 *       type: object
 *       properties:
 *         missingMandatoryConfigKeys:
 *           type: array
 *           description: array of missing mandatory config keys
 *           items:
 *             type: string
 *             description: missing mandatory config key
 *         useOnlyEnvVarsForSomeOptions:
 *           type: boolean
 *           description: use only env vars for some options
 *         samlEntryPoint:
 *           type: string
 *           description: entry point for saml
 *         samlIssuer:
 *           type: string
 *           description: issuer for saml
 *         samlEnvVarIssuer:
 *           type: string
 *           description: issuer for saml
 *         samlCert:
 *           type: string
 *           description: certificate for saml
 *         samlEnvVarCert:
 *           type: string
 *           description: certificate for saml
 *         samlAttrMapId:
 *           type: string
 *           description: attribute mapping id for saml
 *         samlAttrMapUserName:
 *           type: string
 *           description: attribute mapping user name for saml
 *         samlAttrMapMail:
 *           type: string
 *           description: attribute mapping mail for saml
 *         samlEnvVarAttrMapId:
 *           type: string
 *           description: attribute mapping id for saml
 *         samlEnvVarAttrMapUserName:
 *           type: string
 *           description: attribute mapping user name for saml
 *         samlEnvVarAttrMapMail:
 *           type: string
 *           description: attribute mapping mail for saml
 *         samlAttrMapFirstName:
 *           type: string
 *           description: attribute mapping first name for saml
 *         samlAttrMapLastName:
 *           type: string
 *           description: attribute mapping last name for saml
 *         samlEnvVarAttrMapFirstName:
 *           type: string
 *           description: attribute mapping first name for saml
 *         samlEnvVarAttrMapLastName:
 *           type: string
 *           description: attribute mapping last name for saml
 *         isSameUsernameTreatedAsIdenticalUser:
 *           type: boolean
 *           description: local account automatically linked the user name matched
 *         isSameEmailTreatedAsIdenticalUser:
 *           type: boolean
 *           description: local account automatically linked the email matched
 *         samlABLCRule:
 *           type: string
 *           description: ABLCRule for saml
 *         samlEnvVarABLCRule:
 *           type: string
 *           description: ABLCRule for saml
 */

/**
 * SAML authentication route handler
 */
export const handleSamlUpdate = (
  crowi: Crowi,
  activityEvent: EventEmitter,
  updateAndReloadStrategySettings: UpdateAndReloadStrategySettings,
) => {
  return async (req: CrowiRequest, res: ApiV3Response) => {
    const { t } = await getTranslation({
      lang: req.user?.lang,
      ns: ['translation', 'admin'],
    });

    const reqBody = req.body as SamlRequestBody;

    //  For the value of each mandatory items,
    //  check whether it from the environment variables is empty and form value to update it is empty
    //  validate the syntax of a attribute - based login control rule
    const invalidValues: string[] = [];
    for (const configKey of crowi.passportService
      .mandatoryConfigKeysForSaml) {
        const key = configKey.replace('security:passport-saml:', '');
        const formValue = reqBody[key as keyof SamlRequestBody];
        if (
          configManager.getConfig(configKey, ConfigSource.env) == null &&
          formValue == null
        ) {
          const formItemName = t(`security_settings.form_item_name.${key}`);
          invalidValues.push(
            t('input_validation.message.required', { param: formItemName }),
          );
        }
      }
      if (invalidValues.length !== 0) {
        return res.apiv3Err(
          t('input_validation.message.error_message'),
          400,
          invalidValues,
        );
      }

      const rule = reqBody.ABLCRule;
      // Empty string disables attribute-based login control.
      // So, when rule is empty string, validation is passed.
      if (rule != null) {
        try {
          crowi.passportService.parseABLCRule(rule);
        } catch (err) {
          return res.apiv3Err(
            t('input_validation.message.invalid_syntax', {
              syntax: t('security_settings.form_item_name.ABLCRule'),
            }),
            400,
          );
        }
      }

      const requestParams: Record<string, unknown> = {
        'security:passport-saml:entryPoint': toNonBlankStringOrUndefined(reqBody.entryPoint),
        'security:passport-saml:issuer': toNonBlankStringOrUndefined(reqBody.issuer),
        'security:passport-saml:cert': toNonBlankStringOrUndefined(reqBody.cert),
        'security:passport-saml:attrMapId': toNonBlankStringOrUndefined(reqBody.attrMapId),
        'security:passport-saml:attrMapUsername': toNonBlankStringOrUndefined(reqBody.attrMapUsername),
        'security:passport-saml:attrMapMail': toNonBlankStringOrUndefined(reqBody.attrMapMail),
        'security:passport-saml:attrMapFirstName': toNonBlankStringOrUndefined(reqBody.attrMapFirstName),
        'security:passport-saml:attrMapLastName': toNonBlankStringOrUndefined(reqBody.attrMapLastName),
        'security:passport-saml:isSameUsernameTreatedAsIdenticalUser':
          reqBody.isSameUsernameTreatedAsIdenticalUser,
        'security:passport-saml:isSameEmailTreatedAsIdenticalUser':
          reqBody.isSameEmailTreatedAsIdenticalUser,
        'security:passport-saml:ABLCRule': toNonBlankStringOrUndefined(reqBody.ABLCRule),
      };

      try {
        await updateAndReloadStrategySettings('saml', requestParams, { removeIfUndefined: true });

        const securitySettingParams: SamlSecuritySettingParams = {
          missingMandatoryConfigKeys:
            await crowi.passportService.getSamlMissingMandatoryConfigKeys(),
          samlEntryPoint: await configManager.getConfig(
            'security:passport-saml:entryPoint',
            ConfigSource.db,
          ),
          samlIssuer: await configManager.getConfig(
            'security:passport-saml:issuer',
            ConfigSource.db,
          ),
          samlCert: await configManager.getConfig(
            'security:passport-saml:cert',
            ConfigSource.db,
          ),
          samlAttrMapId: await configManager.getConfig(
            'security:passport-saml:attrMapId',
            ConfigSource.db,
          ),
          samlAttrMapUsername: await configManager.getConfig(
            'security:passport-saml:attrMapUsername',
            ConfigSource.db,
          ),
          samlAttrMapMail: await configManager.getConfig(
            'security:passport-saml:attrMapMail',
            ConfigSource.db,
          ),
          samlAttrMapFirstName: await configManager.getConfig(
            'security:passport-saml:attrMapFirstName',
            ConfigSource.db,
          ),
          samlAttrMapLastName: await configManager.getConfig(
            'security:passport-saml:attrMapLastName',
            ConfigSource.db,
          ),
          isSameUsernameTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-saml:isSameUsernameTreatedAsIdenticalUser',
          ),
          isSameEmailTreatedAsIdenticalUser: await configManager.getConfig(
            'security:passport-saml:isSameEmailTreatedAsIdenticalUser',
          ),
          samlABLCRule: await configManager.getConfig(
            'security:passport-saml:ABLCRule',
          ),
        };
        const parameters = {
          action: SupportedAction.ACTION_ADMIN_AUTH_SAML_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);
        return res.apiv3({ securitySettingParams });
      } catch (err) {
      const msg = 'Error occurred in updating SAML setting';
      logger.error('Error', err);
      return res.apiv3Err(new ErrorV3(msg, 'update-SAML-failed'));
    }
  };
};
