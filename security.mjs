import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { one } from './storage.mjs';
const scrypt=promisify(crypto.scrypt);
export const random=()=>crypto.randomBytes(32).toString('base64url');
export const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
export async function encodePassword(value,salt=crypto.randomBytes(16).toString('hex')) { return {salt,digest:(await scrypt(value,salt,64)).toString('hex')}; }
export async function checkPassword(value,salt,digest) { const next=await encodePassword(value,salt); return crypto.timingSafeEqual(Buffer.from(next.digest,'hex'),Buffer.from(digest,'hex')); }
export function cookies(req) { return Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x[0])); }
export function sessionUser(db,req) { const raw=cookies(req).rei_session; return raw?one(db,'SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>? AND u.disabled=0',hash(raw),Date.now()):null; }
export function connectorDevice(db,req) { const raw=String(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1]; return raw?one(db,'SELECT id,label,planner,capabilities,version FROM devices WHERE token_hash=? AND revoked=0',hash(raw)):null; }
export function setCookie(res,value,maxAge,secure) { res.setHeader('Set-Cookie',`rei_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`); }
export function sameOrigin(req) { if(!req.headers.origin) return true; try {return new URL(req.headers.origin).host===req.headers.host;} catch{return false;} }
