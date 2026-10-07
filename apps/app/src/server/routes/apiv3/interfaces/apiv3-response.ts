import type { Response } from 'express';

export interface ApiV3Response extends Response {
  apiv3(obj?: any, status?: number): any;
  apiv3Err(_err: any, status?: number, info?: any): any;
}
