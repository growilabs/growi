import type { IncomingMessage } from 'node:http';

/**
 * Interface for anonymization modules
 */
export interface AnonymizationModule {
  /**
   * Check if this module can handle the given URL
   * @param url - The request URL
   * @returns true if this module should process the request
   */
  canHandle(url: string): boolean;

  /**
   * Process anonymization for the request
   * @param request - The HTTP request
   * @param url - The request URL
   * @returns Attributes to be set on the span, or null if no anonymization needed
   */
  handle(request: IncomingMessage, url: string): Record<string, string> | null;
}
