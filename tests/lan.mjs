import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { certificateForInvite, lanAddresses, parseLanInvite, pinnedFetch, startLanGateway } from '../lan.mjs';

if(process.platform==='win32')console.log('SKIP LAN certificate test: macOS/Linux only');
else {
assert.deepEqual(lanAddresses({lo:[{family:'IPv4',address:'127.0.0.1',internal:true}],en0:[{family:'IPv4',address:'192.168.1.20',internal:false}],vpn:[{family:'IPv4',address:'100.64.2.4',internal:false}]}),['192.168.1.20']);
assert.equal(parseLanInvite('https://example.com:4180/#rei-pin='+'a'.repeat(64)),null);
assert.equal(parseLanInvite('https://192.168.1.20:4180/?x=1#rei-pin='+'a'.repeat(64)),null);

const reserve=net.createServer();
await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const lanPort=reserve.address().port;
await new Promise(resolve=>reserve.close(resolve));
const hub=http.createServer((request,response)=>{
  response.writeHead(200,{'content-type':'application/json'});
  response.end(JSON.stringify({url:request.url,authorization:request.headers.authorization||null,origin:request.headers.origin||null}));
});
await new Promise(resolve=>hub.listen(0,'127.0.0.1',resolve));
const dataDir=mkdtempSync(path.join(os.tmpdir(),'rei-lan-test-'));
let gateway;
try {
  gateway=await startLanGateway({dataDir,hubPort:hub.address().port,port:lanPort,addresses:['127.0.0.1']});
  const invite=parseLanInvite(gateway.urls[0]);
  assert.ok(invite);
  const cert=await certificateForInvite(invite);
  const connection={pin:invite.pin,cert};
  const status=await pinnedFetch(new URL('/api?route=setup%2Fstatus',invite.hub),{},connection);
  assert.equal(status.status,200);
  assert.equal((await status.json()).url,'/api?route=setup%2Fstatus');
  const paired=await pinnedFetch(new URL('/api?route=connector%2Fpair',invite.hub),{method:'POST',headers:{authorization:'Bearer test',origin:'https://evil.example',cookie:'session=secret','content-type':'application/json'},body:'{}'},connection);
  assert.equal((await paired.json()).authorization,'Bearer test');
  const blocked=await pinnedFetch(new URL('/api?route=auth%2Flogin',invite.hub),{},connection);
  assert.equal(blocked.status,404);
  await assert.rejects(certificateForInvite({...invite,pin:'0'.repeat(64)}),/証明書/);
  await assert.rejects(pinnedFetch(new URL('/api?route=setup%2Fstatus',invite.hub),{}, {...connection,pin:'0'.repeat(64)}),/証明書/);
  await assert.rejects(pinnedFetch(new URL('/api?route=setup%2Fstatus',invite.hub),{}, {pin:invite.pin}),/不完全/);
  console.log('PASS pinned LAN gateway limits routes and checks the certificate');
} finally {
  if(gateway)await gateway.close();
  await new Promise(resolve=>hub.close(resolve));
}
}
