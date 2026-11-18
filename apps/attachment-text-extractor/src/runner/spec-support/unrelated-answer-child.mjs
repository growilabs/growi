// Answers every file with a well-formed success whose text has nothing to do
// with the file: a child that "converts" without its components working.
import { readInputFile, sendSuccess } from './child-frames.mjs';

readInputFile();
sendSuccess('text that is not in the file');
process.exit(0);
