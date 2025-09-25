import { writeFileSync } from 'node:fs';
import { Command } from 'commander';

import { generateOperationIds } from './generate-operation-ids';

export const main = async (): Promise<void> => {
  // parse command line arguments
  const program = new Command();
  program
    .name('generate-operation-ids')
    .description('Generate operationId for OpenAPI specification')
    .argument('<input-file>', 'OpenAPI specification file')
    .option('-o, --out <output-file>', 'Output file (defaults to input file)')
    .option('--overwrite-existing', 'Overwrite existing operationId values')
    .parse();
  const { out: outputFile, overwriteExisting } = program.opts();
  const [inputFile] = program.args;

  // eslint-disable-next-line no-console
  const jsonStrings = await generateOperationIds(inputFile, {
    overwriteExisting,
  }).catch(console.error);
  if (jsonStrings != null) {
    writeFileSync(outputFile ?? inputFile, jsonStrings);
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
