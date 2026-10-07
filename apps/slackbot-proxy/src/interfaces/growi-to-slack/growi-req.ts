import type { RequestFromGrowi } from '@growi/slack';
import type { Req } from '@tsed/common';

export type GrowiReq = Req & RequestFromGrowi;
