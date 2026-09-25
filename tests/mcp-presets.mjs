import assert from 'node:assert/strict';
import { MCP_PRESETS } from '../public/mcp-presets.js';
assert.equal(new Set(MCP_PRESETS.map(item=>item.id)).size,MCP_PRESETS.length);
for(const preset of MCP_PRESETS) {
  assert.ok(preset.title&&preset.note);
  if(preset.id==='custom')continue;
  assert.equal(new URL(preset.url).protocol,'https:');
  assert.equal(new URL(preset.docs).protocol,'https:');
  assert.equal(preset.auth,'oauth');
}
assert.ok(MCP_PRESETS.some(item=>item.id==='notion'));
assert.ok(MCP_PRESETS.some(item=>item.id==='drive'));
console.log('PASS MCP preset catalog');
