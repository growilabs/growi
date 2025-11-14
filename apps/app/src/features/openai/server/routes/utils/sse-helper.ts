import type { Response } from 'express';

import type { StreamErrorCode } from '../../../interfaces/message-error';

/**
 * Interface to simplify SSE communication
 */
export interface ISseHelper {
  /**
   * Send data in SSE format
   */
  writeData<T extends object>(data: T): void;

  /**
   * Send error in SSE format
   */
  writeError(message: string, code?: StreamErrorCode): void;

  /**
   * End the response
   */
  end(): void;
}

/**
 * SSE Helper Class
 * Provides functionality to write data to response object in SSE format
 */
export class SseHelper implements ISseHelper {
  constructor(private res: Response) {
    this.res = res;
  }

  /**
   * Send data in SSE format
   */
  writeData<T extends object>(data: T): void {
    this.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /**
   * Send error in SSE format
   */
  writeError(message: string, code?: StreamErrorCode): void {
    this.res.write(`error: ${JSON.stringify({ code, message })}\n\n`);
  }

  /**
   * End the response
   */
  end(): void {
    this.res.end();
  }
}
