import { parentPort, workerData } from 'node:worker_threads';
import { syncMcp } from './mcp-sync.mjs';

try {
  parentPort.postMessage({ statuses: syncMcp(workerData.configPath,workerData.integrations) });
} catch(error) {
  parentPort.postMessage({ error: error.message });
}
