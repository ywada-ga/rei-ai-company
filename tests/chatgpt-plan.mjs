import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdtempSync,rmSync,statSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ChatGPTPlan,validateIdToken,readResponseStream} from '../chatgpt-plan.mjs';
const directory=mkdtempSync(path.join(os.tmpdir(),'rei-chatgpt-'));
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}),kid:'fixture',use:'sig'};
const jwt=claims=>{const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url'),body=Buffer.from(JSON.stringify(claims)).toString('base64url');return header+'.'+body+'.'+crypto.sign('RSA-SHA256',Buffer.from(header+'.'+body),privateKey).toString('base64url');};
const claims={iss:'https://auth.openai.com',aud:'oaiapp_fixture',sub:'user1',exp:Math.floor(Date.now()/1000)+3600,nonce:'nonce'};
assert.equal(validateIdToken(jwt(claims),[key],{clientId:claims.aud,nonce:'nonce'}).sub,'user1');
for(const altered of [{...claims,nonce:'wrong'},{...claims,iss:'https://attacker.example'},{...claims,exp:0},{...claims,aud:'another'}])assert.throws(()=>validateIdToken(jwt(altered),[key],{clientId:claims.aud,nonce:'nonce'}));
assert.throws(()=>validateIdToken(jwt(claims).slice(0,-8)+'AAAAAAAA',[key],{clientId:claims.aud,nonce:'nonce'}));
let authorization,exchanges=0,inference=0,refreshes=0,requestBody;
const mock=async(url,options={})=>{
  if(String(url).endsWith('/oauth/token')){
    if(options.body.get('grant_type')==='refresh_token'){refreshes++;await new Promise(r=>setTimeout(r,5));return Response.json({access_token:'refreshed',refresh_token:'rotated',expires_in:3600});}
    exchanges++;assert.equal(options.body.get('client_id'),'oaiapp_fixture');assert.equal(options.body.get('redirect_uri'),authorization.searchParams.get('redirect_uri'));assert.equal(crypto.createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'),authorization.searchParams.get('code_challenge'));
    return Response.json({id_token:jwt({...claims,nonce:authorization.searchParams.get('nonce')}),scope:'resource.invoke chatgpt.tokens.use.direct',access_token:'private-fixture',refresh_token:'private-refresh',expires_in:3600});
  }
  if(String(url).endsWith('/jwks.json'))return Response.json({keys:[key]});
  if(String(url).endsWith('/models'))return Response.json({models:[{slug:'available-model',display_name:'Account model',visibility:'list'},{slug:'hidden',visibility:'hide'}]});
  if(String(url).endsWith('/responses')){inference++;requestBody=JSON.parse(options.body);return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'{"action":"answer","text":"こんにちは"}'})+'\n\ndata: '+JSON.stringify({type:'response.completed'})+'\n\n');}
  if(String(url).endsWith('/openid-configuration'))return Response.json({revocation_endpoint:'https://auth.openai.com/api/accounts/oauth/revoke'});
  if(String(url).endsWith('/oauth/revoke'))return new Response('',{status:200});
  throw Error('Unexpected endpoint');
};
const account=new ChatGPTPlan(directory,{fetcher:mock});
try{
  const first=await account.begin();authorization=new URL(first.url);assert.equal(authorization.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(authorization.searchParams.get('agent_name_hint'),'REI');
  const callback=new URL(authorization.searchParams.get('redirect_uri'));callback.searchParams.set('code','code');callback.searchParams.set('client_id','oaiapp_fixture');callback.searchParams.set('state','wrong');assert.equal((await fetch(callback)).status,400);assert.equal(exchanges,0);
  callback.searchParams.set('state',authorization.searchParams.get('state'));assert.equal((await fetch(callback)).status,200);assert.equal(exchanges,1);assert.equal(account.status().model,'available-model');assert.equal(inference,0);
  assert.ok(!JSON.stringify(account.status()).includes('private-'));if(process.platform!=='win32'){assert.equal(statSync(path.join(directory,'account.json')).mode&0o777,0o600);assert.equal(statSync(directory).mode&0o777,0o700);}
  assert.throws(()=>account.select({model:'hidden'}));
  const result=await account.generate([{role:'system',content:'rules'},{role:'user',content:'hi'}]);assert.match(result.text,/こんにちは/);assert.equal(requestBody.store,false);assert.equal(requestBody.stream,true);assert.deepEqual(requestBody.reasoning,{effort:'low'});assert.equal(requestBody.instructions,'rules');assert.deepEqual(requestBody.input,[{role:'user',content:'hi'}]);assert.equal(inference,1);account.account().model='gpt-6-sol';await account.generate([{role:'user',content:'hello'}]);assert.deepEqual(requestBody.reasoning,{effort:'none'});await account.generate([{role:'user',content:'compare'}],{effort:'low'});assert.deepEqual(requestBody.reasoning,{effort:'low'});account.account().model='available-model';
  account.account().expiresAt=0;await Promise.all([account.token(),account.token()]);assert.equal(refreshes,1);assert.equal(account.account().refreshToken,'rotated');
  const returning=new URL((await account.begin({accountId:'oaiapp_fixture'})).url);assert.equal(returning.searchParams.get('client_id'),'oaiapp_fixture');assert.equal(returning.searchParams.get('agent_name_hint'),null);assert.equal(returning.searchParams.get('ext_agent_host_id'),authorization.searchParams.get('ext_agent_host_id'));assert.ok(returning.searchParams.get('id_token_hint'));account.stop();
  await assert.rejects(readResponseStream(new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')),/途中/);
  await assert.rejects(readResponseStream(new Response('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n')),/利用枠/);
  assert.deepEqual(await account.disconnect(),{ok:true,revoked:true});assert.equal(account.status().configured,false);assert.ok(!readFileSync(path.join(directory,'account.json'),'utf8').includes('rotated'));
  console.log('ChatGPT plan: PKCE, state, signed identity, private credentials, account models, refresh serialization, stream completion, disconnect passed (no external AI calls)');
}finally{account.stop();rmSync(directory,{recursive:true,force:true});}
