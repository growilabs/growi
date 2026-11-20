import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
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

  // Let a failure propagate: the caller is a shell script whose only signal is
  // this process's exit code, and swallowing it here made the script report
  // success while publishing a spec with no operationId (#11634).
  const jsonStrings = await generateOperationIds(inputFile, {
    overwriteExisting,
  });
  writeFileSync(outputFile ?? inputFile, jsonStrings);
};

// `pathToFileURL` rather than string-concatenating `file://`: argv[1] is a
// plain path while import.meta.url is percent-encoded, so a checkout path
// containing a space or `#` would make the two differ and silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    // biome-ignore lint/suspicious/noConsole: this is a CLI entry point
    console.error(err);
    process.exitCode = 1;
  });
}
