import loggerFactory from '~/utils/logger';

import { configManager } from './config-manager';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = loggerFactory('growi:service:AclService');

export interface AclService {
  get labels(): { [key: string]: string };
  isAclEnabled(): boolean;
  isWikiModeForced(): boolean;
  isGuestAllowedToRead(): boolean;
  getGuestModeValue(): string;
}

/**
 * the service class of AclService
 */
class AclServiceImpl implements AclService {
  get labels() {
    return {
      SECURITY_RESTRICT_GUEST_MODE_DENY: 'Deny',
      SECURITY_RESTRICT_GUEST_MODE_READONLY: 'Readonly',
      SECURITY_REGISTRATION_MODE_OPEN: 'Open',
      SECURITY_REGISTRATION_MODE_RESTRICTED: 'Restricted',
      SECURITY_REGISTRATION_MODE_CLOSED: 'Closed',
    };
  }

  /**
   * @returns Whether Access Control is enabled or not
   */
  isAclEnabled() {
    const wikiMode = configManager.getConfig('security:wikiMode');
    return wikiMode !== 'public';
  }

  /**
   * @returns Whether wiki mode is set
   */
  isWikiModeForced() {
    const wikiMode = configManager.getConfig('security:wikiMode');
    const isPrivateOrPublic = wikiMode === 'private' || wikiMode === 'public';

    return isPrivateOrPublic;
  }

  /**
   * @returns Whether guest users are allowed to read public pages
   */
  isGuestAllowedToRead() {
    const wikiMode = configManager.getConfig('security:wikiMode');

    // return false if private wiki mode
    if (wikiMode === 'private') {
      return false;
    }
    // return true if public wiki mode
    if (wikiMode === 'public') {
      return true;
    }

    const guestMode = configManager.getConfig('security:restrictGuestMode');

    // 'Readonly' => returns true (allow access to guests)
    // 'Deny', null, undefined, '', ... everything else => returns false (requires login)
    return guestMode === this.labels.SECURITY_RESTRICT_GUEST_MODE_READONLY;
  }

  getGuestModeValue() {
    return this.isGuestAllowedToRead()
      ? this.labels.SECURITY_RESTRICT_GUEST_MODE_READONLY
      : this.labels.SECURITY_RESTRICT_GUEST_MODE_DENY;
  }
}

export const aclService = new AclServiceImpl();
