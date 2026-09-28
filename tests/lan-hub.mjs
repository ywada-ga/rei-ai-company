import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { certificateForInvite, parseLanInvite, pinnedFetch } from '../lan.mjs';

if(process.platform==='win32')console.log('SKIP LAN Hub test: macOS/Linux only');
else {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const data=mkdtempSync(path.join(os.tmpdir(),'rei-lan-hub-'));
  async function freePort() {const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
  const port=await freePort(),lanPort=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['hub.mjs'],{cwd:root,env:{...process.env,REI_DATA_DIR:data,REI_PORT:String(port),REI_LAN_PORT:String(lanPort),REI_LAN_TEST_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>output+=part);
  try {
    for(let n=0;n<100&&!output.includes('REI Hub:');n++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.match(output,/REI Hub:/);
    const setup=output.match(/\?setup=([^\s]+)/)?.[1];assert.ok(setup);
    let cookie='';
    async function api(route,body) {const response=await fetch(`${base}/api?route=${encodeURIComponent(route)}`,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.ok(response.ok,`${route}: ${JSON.stringify(result)}`);if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return result;}
    await api('setup/complete',{token:setup,username:'owner',password:'test-password-long-123'});
    await api('auth/login',{username:'owner',password:'test-password-long-123'});
    const status=await api('network/lan/enable',{});
    assert.equal(status.state,'connected');assert.equal(status.urls.length,1);
    const invite=parseLanInvite(status.urls[0]);assert.ok(invite);
    const connection={pin:invite.pin,cert:await certificateForInvite(invite)};
    assert.equal(statSync(path.join(data,'lan-identity','key.pem')).mode&0o777,0o600);
    const pairing=await api('devices/pairing',{label:'LAN参加Mac'});
    const checked=await pinnedFetch(`${invite.hub}/api?route=connector%2Fpair%2Fcheck`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.code})},connection);
    assert.equal(checked.status,200);
    const paired=await pinnedFetch(`${invite.hub}/api?route=connector%2Fpair`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.code})},connection);
    assert.equal(paired.status,201);
    const token=(await paired.json()).token;assert.ok(token);
    const heartbeat=await pinnedFetch(`${invite.hub}/api?route=connector%2Fheartbeat`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({agentName:'rei',capabilities:['openclaw','planning','execution']})},connection);
    assert.equal(heartbeat.status,200);
    assert.equal((await api('devices')).devices[0].online,true);
    const blocked=await pinnedFetch(`${invite.hub}/api?route=auth%2Flogin`,{},connection);assert.equal(blocked.status,404);
    await api('network/lan/disable',{});
    await assert.rejects(certificateForInvite(invite));
    assert.equal(readFileSync(path.join(data,'lan-identity','cert.pem'),'utf8'),connection.cert);
    console.log('PASS isolated Hub pairs a LAN connector through pinned HTTPS');
  } finally {child.kill();await new Promise(resolve=>child.once('exit',resolve));}
}
