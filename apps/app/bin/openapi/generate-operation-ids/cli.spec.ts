import { writeFileSync } from 'fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateOperationIds } from './generate-operation-ids';

// Mock the modules
vi.mock('fs');
vi.mock('./generate-operation-ids');

const originalArgv = process.argv;

describe('cli', () => {
  const mockJsonStrings = '{"test": "data"}';

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.argv = [...originalArgv]; // Reset process.argv
    // Mock console.error to avoid actual console output during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('processes input file and writes output to specified file', async () => {
    // Mock generateOperationIds to return success
    vi.mocked(generateOperationIds).mockResolvedValue(mockJsonStrings);

    // Mock process.argv
    process.argv = ['node', 'cli.js', 'input.json', '-o', 'output.json'];

    // Import the module that contains the main function
    const cliModule = await import('./cli');
    await cliModule.main();

    // Verify generateOperationIds was called with correct arguments
    expect(generateOperationIds).toHaveBeenCalledWith('input.json', {
      overwriteExisting: undefined,
    });

    // Verify writeFileSync was called with correct arguments
    expect(writeFileSync).toHaveBeenCalledWith('output.json', mockJsonStrings);
  });

  it('uses input file as output when no output file is specified', async () => {
    // Mock generateOperationIds to return success
    vi.mocked(generateOperationIds).mockResolvedValue(mockJsonStrings);

    // Mock process.argv
    process.argv = ['node', 'cli.js', 'input.json'];

    // Import the module that contains the main function
    const cliModule = await import('./cli');
    await cliModule.main();

    // Verify generateOperationIds was called with correct arguments
    expect(generateOperationIds).toHaveBeenCalledWith('input.json', {
      overwriteExisting: undefined,
    });

    // Verify writeFileSync was called with input file as output
    expect(writeFileSync).toHaveBeenCalledWith('input.json', mockJsonStrings);
  });

  it('handles overwrite-existing option correctly', async () => {
    // Mock generateOperationIds to return success
    vi.mocked(generateOperationIds).mockResolvedValue(mockJsonStrings);

    // Mock process.argv
    process.argv = ['node', 'cli.js', 'input.json', '--overwrite-existing'];

    // Import the module that contains the main function
    const cliModule = await import('./cli');
    await cliModule.main();

    // Verify generateOperationIds was called with overwriteExisting option
    expect(generateOperationIds).toHaveBeenCalledWith('input.json', {
      overwriteExisting: true,
    });
  });

  it('handles generateOperationIds error correctly', async () => {
    // Mock generateOperationIds to throw error
    const error = new Error('Test error');
    vi.mocked(generateOperationIds).mockRejectedValue(error);

    // Mock process.argv
    process.argv = ['node', 'cli.js', 'input.json'];

    // Import the module that contains the main function
    const cliModule = await import('./cli');
    await cliModule.main();

    // Verify error was logged
    // eslint-disable-next-line no-console
    expect(console.error).toHaveBeenCalledWith(error);

    // Verify writeFileSync was not called
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
