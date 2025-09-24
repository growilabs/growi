#!/usr/bin/env node
/**
 * Node.js Memory Consumption checker
 *
 * Retrieves heap memory information from a running Node.js server
 * started with --inspect flag via Chrome DevTools Protocol
 *
 * Usage:
 *   node --experimental-strip-types --experimental-transform-types \
 *        --experimental-detect-module --no-warnings=ExperimentalWarning \
 *        print-memory-consumption.ts [--port=9229] [--host=localhost] [--json]
 */

import { get } from 'http';

import WebSocket from 'ws';

interface MemoryInfo {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
  heapLimit?: number;
  heapLimitSource: 'explicit' | 'estimated';
  architecture: string;
  platform: string;
  nodeVersion: string;
  pid: number;
  uptime: number;
  memoryFlags: string[];
  timestamp: number;
}

interface DebugTarget {
  webSocketDebuggerUrl: string;
  title: string;
  id: string;
}

class NodeMemoryConsumptionChecker {
  private host: string;
  private port: number;
  private outputJson: boolean;

  constructor(host = 'localhost', port = 9229, outputJson = false) {
    this.host = host;
    this.port = port;
    this.outputJson = outputJson;
  }

  // Helper method to convert bytes to MB
  private toMB(bytes: number): number {
    return bytes / 1024 / 1024;
  }

  // Helper method to get pressure status and icon
  private getPressureInfo(percentage: number): {
    status: string;
    icon: string;
  } {
    if (percentage > 90) return { status: 'HIGH PRESSURE', icon: '🔴' };
    if (percentage > 70) return { status: 'MODERATE PRESSURE', icon: '🟡' };
    return { status: 'LOW PRESSURE', icon: '🟢' };
  }

  // Helper method to create standard error
  private createError(message: string): Error {
    return new Error(message);
  }

  // Helper method to handle promise-based HTTP request
  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      }).on('error', (err) =>
        reject(this.createError(`Cannot connect to ${url}: ${err.message}`)),
      );
    });
  }

  // Generate JavaScript expression for memory collection
  private getMemoryCollectionScript(): string {
    return `JSON.stringify((() => {
      const mem = process.memoryUsage();
      const result = { ...mem, architecture: process.arch, platform: process.platform,
        nodeVersion: process.version, pid: process.pid, uptime: process.uptime(),
        timestamp: Date.now(), execArgv: process.execArgv };

      const memFlags = process.execArgv.filter(arg =>
        arg.includes('max-old-space-size') || arg.includes('max-heap-size'));
      result.memoryFlags = memFlags;

      const maxOldSpaceArg = memFlags.find(flag => flag.includes('max-old-space-size'));
      if (maxOldSpaceArg) {
        const match = maxOldSpaceArg.match(/max-old-space-size=(\\\\d+)/);
        if (match) result.explicitHeapLimit = parseInt(match[1]) * 1024 * 1024;
      }

      if (!result.explicitHeapLimit) {
        const is64bit = result.architecture === 'x64' || result.architecture === 'arm64';
        const nodeVersion = parseInt(result.nodeVersion.split('.')[0].slice(1));
        result.estimatedHeapLimit = is64bit
          ? (nodeVersion >= 14 ? 4 * 1024 * 1024 * 1024 : 1.7 * 1024 * 1024 * 1024)
          : 512 * 1024 * 1024;
      }

      return result;
    })())`;
  }

  async checkMemory(): Promise<MemoryInfo | null> {
    try {
      // Get debug targets
      const targets = await this.getDebugTargets();
      if (targets.length === 0) {
        throw new Error(
          'No debug targets found. Is the Node.js server running with --inspect?',
        );
      }

      // Get memory information via WebSocket
      const memoryInfo = await this.getMemoryInfoViaWebSocket(targets[0]);
      return memoryInfo;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (!this.outputJson) {
        console.error('❌ Error:', errorMessage);
      }
      return null;
    }
  }

  private async getDebugTargets(): Promise<DebugTarget[]> {
    const url = `http://${this.host}:${this.port}/json/list`;
    try {
      const data = await this.httpGet(url);
      return JSON.parse(data);
    } catch (e) {
      throw this.createError(`Failed to parse debug targets: ${e}`);
    }
  }

  private async getMemoryInfoViaWebSocket(
    target: DebugTarget,
  ): Promise<MemoryInfo> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(target.webSocketDebuggerUrl);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 10000);

      ws.on('open', () => {
        // Send Chrome DevTools Protocol message
        const message = JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: this.getMemoryCollectionScript() },
        });
        ws.send(message);
      });

      ws.on('message', (data: Buffer | string) => {
        clearTimeout(timeout);

        try {
          const response = JSON.parse(data.toString());

          if (response.result?.result?.value) {
            const rawData = JSON.parse(response.result.result.value);

            const memoryInfo: MemoryInfo = {
              heapUsed: rawData.heapUsed,
              heapTotal: rawData.heapTotal,
              rss: rawData.rss,
              external: rawData.external,
              arrayBuffers: rawData.arrayBuffers,
              heapLimit:
                rawData.explicitHeapLimit || rawData.estimatedHeapLimit,
              heapLimitSource: rawData.explicitHeapLimit
                ? 'explicit'
                : 'estimated',
              architecture: rawData.architecture,
              platform: rawData.platform,
              nodeVersion: rawData.nodeVersion,
              pid: rawData.pid,
              uptime: rawData.uptime,
              memoryFlags: rawData.memoryFlags || [],
              timestamp: rawData.timestamp,
            };

            resolve(memoryInfo);
          } else {
            reject(
              new Error(
                'Invalid response format from Chrome DevTools Protocol',
              ),
            );
          }
        } catch (error) {
          reject(new Error(`Failed to parse WebSocket response: ${error}`));
        } finally {
          ws.close();
        }
      });

      ws.on('error', (error: Error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${error.message}`));
      });
    });
  }

  displayResults(info: MemoryInfo): void {
    if (this.outputJson) {
      console.log(JSON.stringify(info, null, 2));
      return;
    }

    const [
      heapUsedMB,
      heapTotalMB,
      heapLimitMB,
      rssMB,
      externalMB,
      arrayBuffersMB,
    ] = [
      this.toMB(info.heapUsed),
      this.toMB(info.heapTotal),
      this.toMB(info.heapLimit || 0),
      this.toMB(info.rss),
      this.toMB(info.external),
      this.toMB(info.arrayBuffers),
    ];

    console.log('\n📊 Node.js Memory Information');
    console.log(''.padEnd(50, '='));

    // Current Memory Usage
    console.log('\n🔸 Current Memory Usage:');
    console.log(`  Heap Used:      ${heapUsedMB.toFixed(2)} MB`);
    console.log(`  Heap Total:     ${heapTotalMB.toFixed(2)} MB`);
    console.log(`  RSS:            ${rssMB.toFixed(2)} MB`);
    console.log(`  External:       ${externalMB.toFixed(2)} MB`);
    console.log(`  Array Buffers:  ${arrayBuffersMB.toFixed(2)} MB`);

    // Heap Limits
    console.log('\n🔸 Heap Limits:');
    if (info.heapLimit) {
      const limitType =
        info.heapLimitSource === 'explicit'
          ? 'Explicit Limit'
          : 'Default Limit';
      const limitSource =
        info.heapLimitSource === 'explicit'
          ? '(from --max-old-space-size)'
          : '(system default)';
      console.log(
        `  ${limitType}: ${heapLimitMB.toFixed(2)} MB ${limitSource}`,
      );
      console.log(
        `  Global Usage:   ${((heapUsedMB / heapLimitMB) * 100).toFixed(2)}% of maximum`,
      );
    }

    // Heap Pressure Analysis
    const heapPressure = (info.heapUsed / info.heapTotal) * 100;
    const { status: pressureStatus, icon: pressureIcon } =
      this.getPressureInfo(heapPressure);
    console.log('\n� Memory Pressure Analysis:');
    console.log(
      `  Current Pool:   ${pressureIcon} ${pressureStatus} (${heapPressure.toFixed(1)}% of allocated heap)`,
    );

    if (heapPressure > 90) {
      console.log(
        '  📝 Note: High pressure is normal - Node.js will allocate more heap as needed',
      );
    }

    // System Information
    console.log('\n🔸 System Information:');
    console.log(`  Architecture:   ${info.architecture}`);
    console.log(`  Platform:       ${info.platform}`);
    console.log(`  Node.js:        ${info.nodeVersion}`);
    console.log(`  Process ID:     ${info.pid}`);
    console.log(`  Uptime:         ${(info.uptime / 60).toFixed(1)} minutes`);

    // Memory Flags
    if (info.memoryFlags.length > 0) {
      console.log('\n🔸 Memory Flags:');
      info.memoryFlags.forEach((flag) => console.log(`  ${flag}`));
    }

    // Summary
    console.log('\n📋 Summary:');
    if (info.heapLimit) {
      const heapUsagePercent = (heapUsedMB / heapLimitMB) * 100;
      console.log(
        `Heap Memory: ${heapUsedMB.toFixed(2)} MB / ${heapLimitMB.toFixed(2)} MB (${heapUsagePercent.toFixed(2)}%)`,
      );
      console.log(
        heapUsagePercent > 80
          ? '⚠️  Consider increasing heap limit with --max-old-space-size if needed'
          : '✅ Memory usage is within healthy limits',
      );
    }

    console.log(''.padEnd(50, '='));
    console.log(`Retrieved at: ${new Date(info.timestamp).toLocaleString()}`);
  }
}

// Command line interface
function parseArgs(): {
  host: string;
  port: number;
  json: boolean;
  help: boolean;
} {
  const args = process.argv.slice(2);
  let host = 'localhost';
  let port = 9229;
  let json = false;
  let help = false;

  for (const arg of args) {
    if (arg.startsWith('--host=')) {
      host = arg.split('=')[1];
    } else if (arg.startsWith('--port=')) {
      port = parseInt(arg.split('=')[1]);
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    }
  }

  return {
    host,
    port,
    json,
    help,
  };
}

function showHelp(): void {
  console.log(`
Node.js Memory Checker

Retrieves heap memory information from a running Node.js server via Chrome DevTools Protocol.

Usage:
  node --experimental-strip-types --experimental-transform-types \\
       --experimental-detect-module --no-warnings=ExperimentalWarning \\
       print-memory-consumption.ts [OPTIONS]

Options:
  --host=HOST    Debug host (default: localhost)
  --port=PORT    Debug port (default: 9229)
  --json         Output in JSON format
  --help, -h     Show this help message

Prerequisites:
  - Target Node.js server must be started with --inspect flag
  - WebSocket package: npm install ws @types/ws

Example:
  # Check memory of server running on default debug port
  node --experimental-strip-types --experimental-transform-types \\
       --experimental-detect-module --no-warnings=ExperimentalWarning \\
       print-memory-consumption.ts

  # Check with custom port and JSON output
  node --experimental-strip-types --experimental-transform-types \\
       --experimental-detect-module --no-warnings=ExperimentalWarning \\
       print-memory-consumption.ts --port=9230 --json
`);
}

// Main execution
async function main(): Promise<void> {
  const { host, port, json, help } = parseArgs();

  if (help) {
    showHelp();
    process.exit(0);
  }

  const checker = new NodeMemoryConsumptionChecker(host, port, json);
  const memoryInfo = await checker.checkMemory();

  if (memoryInfo) {
    checker.displayResults(memoryInfo);
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
