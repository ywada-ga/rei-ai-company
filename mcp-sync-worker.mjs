import { parentPort, workerData } from 'node:worker_threads';
import { syncMcp, probeMcp } from './mcp-sync.mjs';

try {
  if(workerData.action==='probe')parentPort.postMessage({ probe: probeMcp(workerData.name) });
  else if(workerData.action==='sync')parentPort.postMessage({ statuses: syncMcp(workerData.configPath,workerData.integrations) });
  else throw new Error('MCP確認の種類が正しくありません');
} catch(error) {
  parentPort.postMessage({ error: error.message });
}
