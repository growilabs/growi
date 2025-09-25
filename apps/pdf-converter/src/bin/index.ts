import { CliCore } from '@tsed/cli-core';
import { GenerateSwaggerCmd } from '@tsed/cli-generate-swagger';

import Server from '../server.js';

CliCore.bootstrap({
  server: Server,
  commands: [GenerateSwaggerCmd],
});
