import assert from 'node:assert/strict';
import { networkStatus, enableServe, tailscaleExecutable } from '../network.mjs';

assert.equal(tailscaleExecutable('darwin',candidate=>candidate==='/Applications/Tailscale.app/Contents/MacOS/Tailscale'),'/Applications/Tailscale.app/Contents/MacOS/Tailscale');
assert.equal(networkStatus(()=>({error:{code:'ENOENT'},status:null})).state,'missing');
const calls=[];
let served=false;
const command=args=>{
  calls.push(args.join(' '));
  if(args[0]==='status')return {status:0,stdout:JSON.stringify({BackendState:'Running',Self:{DNSName:'hub.example.ts.net.'}})};
  if(args[0]==='serve'&&args[1]==='status')return {status:0,stdout:served?'{"Web":{"/":{"Proxy":"http://127.0.0.1:4178"}}}':'{}'};
  if(args[0]==='serve'&&args[1]==='--bg'){served=true;return {status:0,stdout:''};}
  throw new Error('Unexpected command');
};
assert.equal(networkStatus(command).state,'ready');
assert.deepEqual(enableServe(command),{state:'connected',url:'https://hub.example.ts.net'});
assert.ok(calls.includes('serve --bg 4178'));
assert.equal(networkStatus(command).state,'connected');
console.log('PASS Tailscale detection and private Serve setup');
