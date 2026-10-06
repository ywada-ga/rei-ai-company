import { parentPort, workerData } from 'node:worker_threads';
import { syncMcp, probeMcp } from './mcp-sync.mjs';
import { syncSynapseAgentAccess } from './agent-mcp-access.mjs';

try {
  if(workerData.action==='probe')parentPort.postMessage({ probe: probeMcp(workerData.name) });
  else if(workerData.action==='sync') {
    const statuses=syncMcp(workerData.configPath,workerData.integrations);
    if(workerData.agent)syncSynapseAgentAccess(workerData.configPath,workerData.agent,workerData.integrations.filter(item=>statuses.find(status=>status.name===item.name)?.status==='configured'));
    parentPort.postMessage({statuses});
  }
  else throw new Error('MCP確認の種類が正しくありません');
} catch(error) {
  parentPort.postMessage({ error: error.message });
}
