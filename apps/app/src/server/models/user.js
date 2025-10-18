/* eslint-disable no-use-before-define */
import { omitInsecureAttributes } from '@growi/core/dist/models/serializers';
import { pagePathUtils } from '@growi/core/dist/utils';

import { i18n } from '^/config/next-i18next.config';

import { generateGravatarSrc } from '~/utils/gravatar';
import loggerFactory from '~/utils/logger';

import { aclService } from '../service/acl';
import { configManager } from '../service/config-manager';
import { getModelSafely } from '../util/mongoose-utils';
import { Attachment } from './attachment';

const crypto = require('crypto');

const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');
const uniqueValidator = require('mongoose-unique-validator');

const logger = loggerFactory('growi:models:user');

/** @param {import('~/server/crowi').default | null} crowi Crowi instance */
const factory = (crowi) => {
  const userModelExists = getModelSafely('User');
  if (userModelExists != null) {
    return userModelExists;
  }

  const STATUS_REGISTERED = 1;
  const STATUS_ACTIVE = 2;
  const STATUS_SUSPENDED = 3;
  const STATUS_DELETED = 4;
  const STATUS_INVITED = 5;
  const USER_FIELDS_EXCEPT_CONFIDENTIAL =
    '_id image isEmailPublished isGravatarEnabled googleId name username email introduction' +
    ' status lang createdAt lastLoginAt admin imageUrlCached';

  const PAGE_ITEMS = 50;

  let userEvent;

  // init event
  if (crowi != null) {
    userEvent = crowi.event('user');
    userEvent.on('activated', userEvent.onActivated);
  }

  const userSchema = new mongoose.Schema(
    {
      userId: String,
      image: String,
      imageAttachment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Attachment',
      },
      imageUrlCached: String,
      isGravatarEnabled: { type: Boolean, default: false },
      isEmailPublished: { type: Boolean, default: true },
      googleId: String,
      name: { type: String, index: true },
      username: { type: String, required: true, unique: true },
      email: { type: String, unique: true, sparse: true },
      slackMemberId: { type: String, unique: true, sparse: true },
      // === Crowi settings
      // username: { type: String, index: true },
      // email: { type: String, required: true, index: true },
      // === crowi-plus (>= 2.1.0, <2.3.0) settings
      // email: { type: String, required: true, unique: true },
      introduction: String,
      password: String,
      apiToken: { type: String, index: true },
      lang: {
        type: String,
        enum: i18n.locales,
        default: 'en_US',
      },
      status: {
        type: Number,
        required: true,
        default: STATUS_ACTIVE,
        index: true,
      },
      lastLoginAt: { type: Date, index: true },
      admin: { type: Boolean, default: 0, index: true },
      readOnly: { type: Boolean, default: 0 },
      isInvitationEmailSended: { type: Boolean, default: false },
    },
    {
      timestamps: true,
      toObject: {
        transform: (doc, ret, opt) => {
          return omitInsecureAttributes(ret);
        },
      },
    },
  );
  userSchema.plugin(mongoosePaginate);
  userSchema.plugin(uniqueValidator);

  function validateCrowi() {
    if (crowi == null) {
      throw new Error(
        '"crowi" is null. Init User model with "crowi" argument first.',
      );
    }
  }

  function decideUserStatusOnRegistration() {
    validateCrowi();

    const isInstalled = configManager.getConfig('app:installed');
    if (!isInstalled) {
      return STATUS_ACTIVE; // is this ok?
    }

    // status decided depends on registrationMode
    const registrationMode = configManager.getConfig(
      'security:registrationMode',
    );
    switch (registrationMode) {
      case aclService.labels.SECURITY_REGISTRATION_MODE_OPEN:
        return STATUS_ACTIVE;
      case aclService.labels.SECURITY_REGISTRATION_MODE_RESTRICTED:
      case aclService.labels.SECURITY_REGISTRATION_MODE_CLOSED: // 一応
        return STATUS_REGISTERED;
      default:
        return STATUS_ACTIVE; // どっちにすんのがいいんだろうな
    }
  }

  function generateRandomTempPassword() {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!=-_';
    let password = '';
    const len = 12;

    for (let i = 0; i < len; i++) {
      const randomPoz = Math.floor(Math.random() * chars.length);
      password += chars.substring(randomPoz, randomPoz + 1);
    }

    return password;
  }

  function generateRandomEmail() {
    const randomstr = generateRandomTempPassword();
    return `change-it-${randomstr}@example.com`;
  }

  function generatePassword(password) {
    validateCrowi();

    const hasher = crypto.createHash('sha256');
    hasher.update(crowi.env.PASSWORD_SEED + password);

    return hasher.digest('hex');
  }

  function generateApiToken(user) {
    const hasher = crypto.createHash('sha256');
    hasher.update(new Date().getTime() + user._id);

    return hasher.digest('base64');
  }

  userSchema.methods.isUniqueEmail = async function () {
    const query = this.model('User').find();

    const count = await query.count({
      username: { $ne: this.username },
      email: this.email,
    });

    if (count > 0) {
      return false;
    }
    return true;
  };

  userSchema.methods.isPasswordSet = function () {
    if (this.password) {
      return true;
    }
    return false;
  };

  userSchema.methods.isPasswordValid = function (password) {
    return this.password === generatePassword(password);
  };

  userSchema.methods.setPassword = function (password) {
    this.password = generatePassword(password);
    return this;
  };

  userSchema.methods.isEmailSet = function () {
    if (this.email) {
      return true;
    }
    return false;
  };

  userSchema.methods.updateLastLoginAt = function (lastLoginAt, callback) {
    this.lastLoginAt = lastLoginAt;
    this.save((err, userData) => {
      return callback(err, userData);
    });
  };

  userSchema.methods.updateIsGravatarEnabled = async function (
    isGravatarEnabled,
  ) {
    this.isGravatarEnabled = isGravatarEnabled;
    await this.updateImageUrlCached();
    const userData = await this.save();
    return userData;
  };

  userSchema.methods.updatePassword = async function (password) {
    this.setPassword(password);
    const userData = await this.save();
    return userData;
  };

  userSchema.methods.updateApiToken = async function () {
    this.apiToken = generateApiToken(this);
    const userData = await this.save();
    return userData;
  };

  // TODO: create UserService and transplant this method because image uploading depends on AttachmentService
  userSchema.methods.updateImage = async function (attachment) {
    this.imageAttachment = attachment;
    await this.updateImageUrlCached();
    return this.save();
  };

  // TODO: create UserService and transplant this method because image deletion depends on AttachmentService
  userSchema.methods.deleteImage = async function () {
    validateCrowi();

    // the 'image' field became DEPRECATED in v3.3.8
    this.image = undefined;

    if (this.imageAttachment != null) {
      const { attachmentService } = crowi;
      attachmentService.removeAttachment(this.imageAttachment._id);
    }

    this.imageAttachment = undefined;
    this.updateImageUrlCached();
    return this.save();
  };

  userSchema.methods.updateImageUrlCached = async function () {
    this.imageUrlCached = await this.generateImageUrlCached();
  };

  userSchema.methods.generateImageUrlCached = async function () {
    if (this.isGravatarEnabled) {
      return generateGravatarSrc(this.email);
    }
    if (this.image != null) {
      return this.image;
    }
    if (this.imageAttachment != null && this.imageAttachment._id != null) {
      const imageAttachment = await Attachment.findById(this.imageAttachment);
      return imageAttachment.filePathProxied;
    }
    return '/images/icons/user.svg';
  };

  userSchema.methods.updateGoogleId = function (googleId, callback) {
    this.googleId = googleId;
    this.save((err, userData) => {
      return callback(err, userData);
    });
  };

  userSchema.methods.deleteGoogleId = function (callback) {
    return this.updateGoogleId(null, callback);
  };

  userSchema.methods.activateInvitedUser = async function (
    username,
    name,
    password,
  ) {
    this.setPassword(password);
    this.name = name;
    this.username = username;
    this.status = STATUS_ACTIVE;
    this.isEmailPublished = configManager.getConfig(
      'customize:isEmailPublishedForNewUser',
    );

    this.save((err, userData) => {
      userEvent.emit('activated', userData);
      if (err) {
        throw new Error(err);
      }
      return userData;
    });
  };

  userSchema.methods.grantAdmin = async function () {
    logger.debug('Grant Admin', this);
    this.admin = 1;
    return this.save();
  };

  userSchema.methods.revokeAdmin = async function () {
    logger.debug('Revove admin', this);
    this.admin = 0;
    return this.save();
  };

  userSchema.methods.grantReadOnly = async function () {
    logger.debug('Grant read only access', this);
    this.readOnly = 1;
    return this.save();
  };

  userSchema.methods.revokeReadOnly = async function () {
    logger.debug('Revoke read only access', this);
    this.readOnly = 0;
    return this.save();
  };

  userSchema.methods.asyncGrantAdmin = async function (callback) {
    this.admin = 1;
    return this.save();
  };

  userSchema.methods.statusActivate = async function () {
    logger.debug('Activate User', this);
    this.status = STATUS_ACTIVE;
    const userData = await this.save();
    return userEvent.emit('activated', userData);
  };

  userSchema.methods.statusSuspend = async function () {
    logger.debug('Suspend User', this);
    this.status = STATUS_SUSPENDED;
    if (this.email === undefined || this.email === null) {
      // migrate old data
      this.email = '-';
    }
    if (this.name === undefined || this.name === null) {
      // migrate old data
      this.name = `-${Date.now()}`;
    }
    if (this.username === undefined || this.usename === null) {
      // migrate old data
      this.username = '-';
    }
    return this.save();
  };

  userSchema.methods.statusDelete = async function () {
    logger.debug('Delete User', this);

    const now = new Date();
    const deletedLabel = `deleted_at_${now.getTime()}`;

    this.status = STATUS_DELETED;
    this.username = deletedLabel;
    this.password = '';
    this.name = '';
    this.email = `${deletedLabel}@deleted`;
    this.googleId = null;
    this.isGravatarEnabled = false;
    this.image = null;
    return this.save();
  };

  userSchema.statics.getUserStatusLabels = () => {
    const userStatus = {};
    userStatus[STATUS_REGISTERED] = 'Approval Pending';
    userStatus[STATUS_ACTIVE] = 'Active';
    userStatus[STATUS_SUSPENDED] = 'Suspended';
    userStatus[STATUS_DELETED] = 'Deleted';
    userStatus[STATUS_INVITED] = 'Invited';

    return userStatus;
  };

  userSchema.statics.isEmailValid = (email, callback) => {
    validateCrowi();

    const whitelist = configManager.getConfig('security:registrationWhitelist');

    if (Array.isArray(whitelist) && whitelist.length > 0) {
      return whitelist.some((allowedEmail) => {
        const re = new RegExp(`${allowedEmail}$`);
        return re.test(email);
      });
    }

    return true;
  };

  userSchema.statics.findUsers = function (options, callback) {
    const sort = options.sort || { status: 1, createdAt: 1 };

    this.find()
      .sort(sort)
      .skip(options.skip || 0)
      .limit(options.limit || 21)
      .exec((err, userData) => {
        callback(err, userData);
      });
  };

  userSchema.statics.findAllUsers = function (option) {
    // eslint-disable-next-line no-param-reassign
    option = option || {};

    const sort = option.sort || { createdAt: -1 };
    const fields = option.fields || {};

    let status = option.status || [STATUS_ACTIVE, STATUS_SUSPENDED];
    if (!Array.isArray(status)) {
      status = [status];
    }

    return this.find()
      .or(
        status.map((s) => {
          return { status: s };
        }),
      )
      .select(fields)
      .sort(sort);
  };

  userSchema.statics.findUsersByIds = function (ids, option) {
    // eslint-disable-next-line no-param-reassign
    option = option || {};

    const sort = option.sort || { createdAt: -1 };
    const status = option.status || STATUS_ACTIVE;
    const fields = option.fields || {};

    return this.find({ _id: { $in: ids }, status })
      .select(fields)
      .sort(sort);
  };

  userSchema.statics.findAdmins = async function (option) {
    const sort = option?.sort ?? { createdAt: -1 };

    let status = option?.status ?? [STATUS_ACTIVE];
    if (!Array.isArray(status)) {
      status = [status];
    }

    return this.find({ admin: true, status: { $in: status } }).sort(sort);
  };

  userSchema.statics.findUserByUsername = function (username) {
    if (username == null) {
      return Promise.resolve(null);
    }
    return this.findOne({ username });
  };

  userSchema.statics.findUserByApiToken = function (apiToken) {
    if (apiToken == null) {
      return Promise.resolve(null);
    }
    return this.findOne({ apiToken }).lean();
  };

  userSchema.statics.findUserByGoogleId = function (googleId, callback) {
    if (googleId == null) {
      callback(null, null);
    }
    this.findOne({ googleId }, (err, userData) => {
      callback(err, userData);
    });
  };

  userSchema.statics.findUserByUsernameOrEmail = function (
    usernameOrEmail,
    password,
    callback,
  ) {
    this.findOne()
      .or([{ username: usernameOrEmail }, { email: usernameOrEmail }])
      .exec((err, userData) => {
        callback(err, userData);
      });
  };

  userSchema.statics.findUserByEmailAndPassword = function (
    email,
    password,
    callback,
  ) {
    const hashedPassword = generatePassword(password);
    this.findOne({ email, password: hashedPassword }, (err, userData) => {
      callback(err, userData);
    });
  };

  userSchema.statics.isUserCountExceedsUpperLimit = async function () {
    const userUpperLimit = configManager.getConfig('security:userUpperLimit');

    const activeUsers = await this.countActiveUsers();
    if (userUpperLimit <= activeUsers) {
      return true;
    }

    return false;
  };

  userSchema.statics.countActiveUsers = async function () {
    return this.countListByStatus(STATUS_ACTIVE);
  };

  userSchema.statics.countListByStatus = async function (status) {
    const conditions = { status };

    // TODO count は非推奨。mongoose のバージョンアップ後に countDocuments に変更する。
    return this.count(conditions);
  };

  userSchema.statics.isRegisterableUsername = async function (username) {
    let usernameUsable = true;

    const userData = await this.findOne({ username });
    if (userData) {
      usernameUsable = false;
    }
    return usernameUsable;
  };

  userSchema.statics.isRegisterableEmail = async function (email) {
    let isEmailUsable = true;

    const userData = await this.findOne({ email });
    if (userData) {
      isEmailUsable = false;
    }
    return isEmailUsable;
  };

  userSchema.statics.isRegisterable = function (email, username, callback) {
    let emailUsable = true;
    let usernameUsable = true;

    // username check
    this.findOne({ username }, (err, userData) => {
      if (userData) {
        usernameUsable = false;
      }

      // email check
      this.findOne({ email }, (err, userData) => {
        if (userData) {
          emailUsable = false;
        }

        if (!emailUsable || !usernameUsable) {
          return callback(false, {
            email: emailUsable,
            username: usernameUsable,
          });
        }

        return callback(true, {});
      });
    });
  };

  userSchema.statics.resetPasswordByRandomString = async function (id) {
    const user = await this.findById(id);

    if (!user) {
      throw new Error('User not found');
    }

    const newPassword = generateRandomTempPassword();
    user.setPassword(newPassword);
    await user.save();

    return newPassword;
  };

  userSchema.statics.createUserByEmail = async function (email) {
    const newUser = new this();

    /* eslint-disable newline-per-chained-call */
    const tmpUsername = `temp_${Math.random().toString(36).slice(-16)}`;
    const password = Math.random().toString(36).slice(-16);
    /* eslint-enable newline-per-chained-call */

    newUser.username = tmpUsername;
    newUser.email = email;
    newUser.setPassword(password);
    newUser.status = STATUS_INVITED;

    const globalLang = configManager.getConfig('app:globalLang');
    if (globalLang != null) {
      newUser.lang = globalLang;
    }

    try {
      const newUserData = await newUser.save();
      return {
        email,
        password,
        user: newUserData,
      };
    } catch (err) {
      return {
        email,
      };
    }
  };

  userSchema.statics.createUsersByEmailList = async function (emailList) {
    // check exists and get list of try to create
    const existingUserList = await this.find({
      email: { $in: emailList },
      userStatus: { $ne: STATUS_DELETED },
    });
    const existingEmailList = existingUserList.map((user) => {
      return user.email;
    });
    const creationEmailList = emailList.filter((email) => {
      return existingEmailList.indexOf(email) === -1;
    });

    const createdUserList = [];
    const failedToCreateUserEmailList = [];

    for (const email of creationEmailList) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const createdUser = await this.createUserByEmail(email);
        createdUserList.push(createdUser);
      } catch (err) {
        logger.error(err);
        failedToCreateUserEmailList.push({
          email,
          reason: err.message,
        });
      }
    }

    return { createdUserList, existingEmailList, failedToCreateUserEmailList };
  };

  userSchema.statics.createUserByEmailAndPasswordAndStatus = async function (
    name,
    username,
    email,
    password,
    lang,
    status,
    callback,
  ) {
    const newUser = new this();

    // check user upper limit
    const isUserCountExceedsUpperLimit =
      await this.isUserCountExceedsUpperLimit();
    if (isUserCountExceedsUpperLimit) {
      const err = new UserUpperLimitException();
      return callback(err);
    }

    // check email duplication because email must be unique
    const count = await this.count({ email });
    if (count > 0) {
      // eslint-disable-next-line no-param-reassign
      email = generateRandomEmail();
    }

    newUser.name = name;
    newUser.username = username;
    newUser.email = email;
    if (password != null) {
      newUser.setPassword(password);
    }

    // Default email show/hide is up to the administrator
    newUser.isEmailPublished = configManager.getConfig(
      'customize:isEmailPublishedForNewUser',
    );

    const globalLang = configManager.getConfig('app:globalLang');
    if (globalLang != null) {
      newUser.lang = globalLang;
    }

    if (lang != null) {
      newUser.lang = lang;
    }
    newUser.status = status || decideUserStatusOnRegistration();

    newUser.save((err, userData) => {
      if (err) {
        logger.error('createUserByEmailAndPasswordAndStatus failed: ', err);
        return callback(err);
      }

      if (userData.status === STATUS_ACTIVE) {
        userEvent.emit('activated', userData);
      }
      return callback(err, userData);
    });
  };

  /**
   * A wrapper function of createUserByEmailAndPasswordAndStatus with callback
   *
   */
  userSchema.statics.createUserByEmailAndPassword = function (
    name,
    username,
    email,
    password,
    lang,
    callback,
  ) {
    this.createUserByEmailAndPasswordAndStatus(
      name,
      username,
      email,
      password,
      lang,
      undefined,
      callback,
    );
  };

  /**
   * A wrapper function of createUserByEmailAndPasswordAndStatus
   *
   * @return {Promise<User>}
   */
  userSchema.statics.createUser = function (
    name,
    username,
    email,
    password,
    lang,
    status,
  ) {
    return new Promise((resolve, reject) => {
      this.createUserByEmailAndPasswordAndStatus(
        name,
        username,
        email,
        password,
        lang,
        status,
        (err, userData) => {
          if (err) {
            return reject(err);
          }
          return resolve(userData);
        },
      );
    });
  };

  userSchema.statics.isExistUserByUserPagePath = async function (path) {
    const username = pagePathUtils.getUsernameByPath(path);

    if (username == null) {
      return false;
    }

    const user = await this.exists({ username });
    return user != null;
  };

  userSchema.statics.updateIsInvitationEmailSended = async function (id) {
    const user = await this.findById(id);

    if (user == null) {
      throw new Error('User not found');
    }

    if (user.status !== 5) {
      throw new Error('The status of the user is not "invited"');
    }

    user.isInvitationEmailSended = true;
    user.save();
  };

  userSchema.statics.findUserBySlackMemberId = async function (slackMemberId) {
    const user = this.findOne({ slackMemberId });
    if (user == null) {
      throw new Error('User not found');
    }
    return user;
  };

  userSchema.statics.findUsersBySlackMemberIds = async function (
    slackMemberIds,
  ) {
    const users = this.find({ slackMemberId: { $in: slackMemberIds } });
    if (users.length === 0) {
      throw new Error('No user found');
    }
    return users;
  };

  userSchema.statics.findUserByUsernameRegexWithTotalCount = async function (
    username,
    status,
    option,
  ) {
    const opt = option || {};
    const sortOpt = opt.sortOpt || { username: 1 };
    const offset = opt.offset || 0;
    const limit = opt.limit || 10;

    const conditions = {
      username: { $regex: username, $options: 'i' },
      status: { $in: status },
    };

    const users = await this.find(conditions)
      .sort(sortOpt)
      .skip(offset)
      .limit(limit);

    const totalCount = (await this.find(conditions).distinct('username'))
      .length;

    return { users, totalCount };
  };

  class UserUpperLimitException {
    constructor() {
      this.name = this.constructor.name;
    }
  }

  userSchema.statics.STATUS_REGISTERED = STATUS_REGISTERED;
  userSchema.statics.STATUS_ACTIVE = STATUS_ACTIVE;
  userSchema.statics.STATUS_SUSPENDED = STATUS_SUSPENDED;
  userSchema.statics.STATUS_DELETED = STATUS_DELETED;
  userSchema.statics.STATUS_INVITED = STATUS_INVITED;
  userSchema.statics.USER_FIELDS_EXCEPT_CONFIDENTIAL =
    USER_FIELDS_EXCEPT_CONFIDENTIAL;
  userSchema.statics.PAGE_ITEMS = PAGE_ITEMS;

  return mongoose.model('User', userSchema);
};

export default factory;
