import type { IUserHasId } from '@growi/core/dist/interfaces';
import expressSession from 'express-session';
import type { IncomingMessage } from 'http';
import passport from 'passport';
import type { Namespace } from 'socket.io';
import { Server } from 'socket.io';

import { SocketEventName } from '~/interfaces/websocket';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { configManager } from '../config-manager';
import { getRoomNameWithId, RoomPrefix } from './helper';

const logger = loggerFactory('growi:service:socket-io');

type RequestWithUser = IncomingMessage & { user: IUserHasId };

/**
 * Serve socket.io for server-to-client messaging
 */
export class SocketIoService {
  crowi: Crowi;

  guestClients: Set<string>;

  io: Server;

  adminNamespace: Namespace;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.guestClients = new Set();
  }

  get isInitialized(): boolean {
    return this.io != null;
  }

  // Since the Order is important, attachServer() should be async
  async attachServer(server) {
    this.io = new Server(server, {
      serveClient: false,
    });

    // create namespace for admin
    this.adminNamespace = this.io.of('/admin');

    // setup middlewares
    // !!CAUTION!! -- ORDER IS IMPORTANT
    await this.setupSessionMiddleware();
    await this.setupLoginRequiredMiddleware();
    await this.setupAdminRequiredMiddleware();
    await this.setupCheckConnectionLimitsMiddleware();

    await this.setupStoreGuestIdEventHandler();

    await this.setupLoginedUserRoomsJoinOnConnection();
    await this.setupDefaultSocketJoinRoomsEventHandler();
    await this.setupDefaultSocketLeaveRoomsEventHandler();
  }

  getDefaultSocket() {
    if (this.io == null) {
      throw new Error('Http server has not attached yet.');
    }
    return this.io.sockets;
  }

  getAdminSocket() {
    if (this.io == null) {
      throw new Error('Http server has not attached yet.');
    }

    return this.adminNamespace;
  }

  /**
   * use passport session
   * @see https://socket.io/docs/v4/middlewares/#compatibility-with-express-middleware
   */
  setupSessionMiddleware(): void {
    this.io.engine.use(expressSession(this.crowi.sessionConfig));
    this.io.engine.use(passport.initialize());
    this.io.engine.use(passport.session());
  }

  /**
   * use loginRequired middleware
   */
  setupLoginRequiredMiddleware() {
    const loginRequired = require('../../middlewares/login-required')(
      this.crowi,
      true,
      (req, res, next) => {
        next(new Error('Login is required to connect.'));
      },
    );

    // convert Connect/Express middleware to Socket.io middleware
    this.io.use((socket, next) => {
      loginRequired(socket.request, {}, next);
    });
  }

  /**
   * use adminRequired middleware
   */
  setupAdminRequiredMiddleware() {
    const adminRequired = require('../../middlewares/admin-required')(
      this.crowi,
      (req, res, next) => {
        next(new Error('Admin priviledge is required to connect.'));
      },
    );

    // convert Connect/Express middleware to Socket.io middleware
    this.getAdminSocket().use((socket, next) => {
      adminRequired(socket.request, {}, next);
    });
  }

  /**
   * use checkConnectionLimits middleware
   */
  setupCheckConnectionLimitsMiddleware() {
    this.getAdminSocket().use(this.checkConnectionLimitsForAdmin.bind(this));
    this.getDefaultSocket().use(this.checkConnectionLimitsForGuest.bind(this));
    this.getDefaultSocket().use(this.checkConnectionLimits.bind(this));
  }

  setupStoreGuestIdEventHandler() {
    this.io.on('connection', (socket) => {
      if ((socket.request as RequestWithUser).user == null) {
        this.guestClients.add(socket.id);

        socket.on('disconnect', () => {
          this.guestClients.delete(socket.id);
        });
      }
    });
  }

  setupLoginedUserRoomsJoinOnConnection() {
    this.io.on('connection', (socket) => {
      const user = (socket.request as RequestWithUser).user;
      if (user == null) {
        logger.debug('Socket io: An anonymous user has connected');
        return;
      }
      socket.join(getRoomNameWithId(RoomPrefix.USER, user._id));
    });
  }

  setupDefaultSocketJoinRoomsEventHandler() {
    this.io.on('connection', (socket) => {
      // set event handlers for joining rooms
      socket.on(SocketEventName.JoinPage, ({ pageId }) => {
        socket.join(getRoomNameWithId(RoomPrefix.PAGE, pageId));
      });
    });
  }

  setupDefaultSocketLeaveRoomsEventHandler() {
    this.io.on('connection', (socket) => {
      socket.on(SocketEventName.LeavePage, ({ pageId }) => {
        socket.leave(getRoomNameWithId(RoomPrefix.PAGE, pageId));
      });
    });
  }

  async checkConnectionLimitsForAdmin(socket, next) {
    const namespaceName = socket.nsp.name;

    if (namespaceName === '/admin') {
      const clients = await this.getAdminSocket().fetchSockets();
      const clientsCount = clients.length;

      logger.debug("Current count of clients for '/admin':", clientsCount);

      const limit = configManager.getConfig(
        's2cMessagingPubsub:connectionsLimitForAdmin',
      );
      if (limit <= clientsCount) {
        const msg = `The connection was refused because the current count of clients for '/admin' is ${clientsCount} and exceeds the limit`;
        logger.warn(msg);
        next(new Error(msg));
        return;
      }
    }

    next();
  }

  async checkConnectionLimitsForGuest(socket, next) {
    if (socket.request.user == null) {
      const clientsCount = this.guestClients.size;

      logger.debug('Current count of clients for guests:', clientsCount);

      const limit = configManager.getConfig(
        's2cMessagingPubsub:connectionsLimitForGuest',
      );
      if (limit <= clientsCount) {
        const msg = `The connection was refused because the current count of clients for guests is ${clientsCount} and exceeds the limit`;
        logger.warn(msg);
        next(new Error(msg));
        return;
      }
    }

    next();
  }

  /**
   * @see https://socket.io/docs/server-api/#socket-client
   */
  async checkConnectionLimits(socket, next) {
    // exclude admin
    const namespaceName = socket.nsp.name;
    if (namespaceName === '/admin') {
      next();
    }

    const clients = await this.getDefaultSocket().fetchSockets();
    const clientsCount = clients.length;

    logger.debug("Current count of clients for '/':", clientsCount);

    const limit = configManager.getConfig(
      's2cMessagingPubsub:connectionsLimit',
    );
    if (limit <= clientsCount) {
      const msg = `The connection was refused because the current count of clients for '/' is ${clientsCount} and exceeds the limit`;
      logger.warn(msg);
      next(new Error(msg));
      return;
    }

    next();
  }
}
