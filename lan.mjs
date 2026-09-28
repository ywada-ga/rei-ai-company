import { createHash, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

const connectorRoutes=new Set(['connector/pair/check','connector/pair','connector/status','connector/heartbeat','connector/mcp-check-result','connector/claim','connector/renew','connector/result']);
const fingerprint=raw=>createHash('sha256').update(raw).digest('hex');
const validPort=value=>Number.isSafeInteger(value)&&value>0&&value<=65535;
const privateIp=value=>{
  const parts=value.split('.').map(Number);
  if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  return parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168);
};
export function lanAddresses(interfaces=os.networkInterfaces(),testHost=process.env.REI_LAN_TEST_HOST) {
  if(testHost==='127.0.0.1')return [testHost];
  return [...new Set(Object.values(interfaces).flat().filter(item=>item?.family==='IPv4'&&!item.internal&&privateIp(item.address)).map(item=>item.address))].sort();
}
function identity(dataDir) {
  const folder=path.join(dataDir,'lan-identity');
  mkdirSync(folder,{recursive:true,mode:0o700});
  if(!lstatSync(folder).isDirectory())throw new Error('LAN接続の保存先が通常のフォルダではありません');
  const key=path.join(folder,'key.pem'),cert=path.join(folder,'cert.pem');
  if(existsSync(key)!==existsSync(cert))throw new Error('LAN接続の証明書が不完全です。保存済みファイルを確認してください');
  if(!existsSync(key)) {
    const tempKey=path.join(folder,`key.${process.pid}.tmp`),tempCert=path.join(folder,`cert.${process.pid}.tmp`);
    try {
      const result=spawnSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:3072','-nodes','-batch','-days','3650','-subj','/CN=REI LAN','-addext','basicConstraints=critical,CA:FALSE','-addext','subjectAltName=DNS:rei.local','-keyout',tempKey,'-out',tempCert],{encoding:'utf8',timeout:30000});
      if(result.status!==0)throw new Error(`LAN用証明書を作れません: ${result.error?.message||result.stderr?.slice(-300)||'OpenSSLエラー'}`);
      chmodSync(tempKey,0o600);chmodSync(tempCert,0o600);
      renameSync(tempKey,key);renameSync(tempCert,cert);
    } finally {rmSync(tempKey,{force:true});rmSync(tempCert,{force:true});}
  }
  if(!lstatSync(key).isFile()||!lstatSync(cert).isFile())throw new Error('LAN接続の証明書ファイルを確認してください');
  chmodSync(key,0o600);chmodSync(cert,0o600);
  const keyPem=readFileSync(key),certPem=readFileSync(cert),pin=fingerprint(new X509Certificate(certPem).raw);
  return {keyPem,certPem,pin};
}
function allowed(req) {
  if(!['GET','POST'].includes(req.method))return false;
  let url;
  try {url=new URL(req.url,'http://localhost');} catch {return false;}
  if(url.pathname!=='/api'||url.searchParams.size!==1)return false;
  const route=url.searchParams.get('route');
  return (route==='setup/status'&&req.method==='GET')||connectorRoutes.has(route);
}
export async function startLanGateway({dataDir,hubPort,port=4180,addresses=lanAddresses()}) {
  if(!validPort(port)||!validPort(hubPort))throw new Error('LAN接続のポート番号が正しくありません');
  if(!addresses.length)throw new Error('同じネットワークのMacから使えるプライベートIPアドレスが見つかりません');
  const {keyPem,certPem,pin}=identity(dataDir),servers=[];
  try {
    for(const address of addresses) {
      if(!privateIp(address)&&address!=='127.0.0.1')throw new Error('LAN接続はプライベートIPアドレスだけで待ち受けます');
      const server=https.createServer({key:keyPem,cert:certPem},(req,res)=>{
        if(!allowed(req)){res.writeHead(404,{'content-type':'application/json'});res.end('{"error":"この接続先では端末用APIだけ使えます"}');return;}
        const headers={};
        if(req.headers.authorization)headers.authorization=req.headers.authorization;
        if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];
        const upstream=http.request({hostname:'127.0.0.1',port:hubPort,path:req.url,method:req.method,headers},reply=>{
          res.writeHead(reply.statusCode||502,{'content-type':reply.headers['content-type']||'application/json','cache-control':'no-store'});
          reply.pipe(res);
        });
        upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502);res.end();}else res.destroy();});
        req.pipe(upstream);
      });
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,address,resolve);});
      servers.push(server);
    }
  } catch(error) {for(const server of servers)server.close();throw error;}
  return {state:'connected',urls:addresses.map(address=>`https://${address}:${port}/#rei-pin=${pin}`),pin,close:()=>Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))))};
}
export function parseLanInvite(value) {
  let url;
  try {url=new URL(value);} catch {return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||!validPort(Number(url.port)))return null;
  if(!privateIp(url.hostname)&&url.hostname!=='127.0.0.1')return null;
  const match=/^#rei-pin=([a-f0-9]{64})$/i.exec(url.hash);
  if(!match)return null;
  return {hub:url.origin,pin:match[1].toLowerCase()};
}
export async function certificateForInvite(invite) {
  const url=new URL(invite.hub);
  return new Promise((resolve,reject)=>{
    const socket=tls.connect({host:url.hostname,port:Number(url.port),rejectUnauthorized:false,timeout:15000},()=>{
      const raw=socket.getPeerCertificate(true)?.raw;
      if(!raw||fingerprint(raw)!==invite.pin){socket.destroy();reject(new Error('接続先の証明書が接続コードと一致しません'));return;}
      const base64=raw.toString('base64').match(/.{1,64}/g).join('\n');
      socket.end();resolve(`-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`);
    });
    socket.once('error',reject);
    socket.once('timeout',()=>socket.destroy(new Error('中心PCへの接続が時間切れです')));
  });
}
export async function pinnedFetch(url,options={},connection) {
  if(connection?.pin||connection?.cert) {
    if(!/^[a-f0-9]{64}$/.test(connection.pin||'')||typeof connection.cert!=='string'||!connection.cert.includes('BEGIN CERTIFICATE'))throw new Error('LAN接続の証明書設定が不完全です');
  } else return fetch(url,options);
  return new Promise((resolve,reject)=>{
    const request=https.request(url,{method:options.method||'GET',headers:options.headers||{},ca:connection.cert,agent:false,signal:options.signal,checkServerIdentity(_hostname,peer){return peer.raw&&fingerprint(peer.raw)===connection.pin?undefined:new Error('接続先の証明書が変わりました');}},response=>{
      const chunks=[];let bytes=0;
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>8_500_000){request.destroy(new Error('中心PCの応答が長すぎます'));return;}chunks.push(chunk);});
      response.on('end',()=>resolve(new Response(response.statusCode===204||response.statusCode===304?null:Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
      response.on('error',reject);
    });
    request.on('error',reject);
    request.end(options.body);
  });
}
