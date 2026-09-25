import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

export function openStorage(root) {
  const dir=process.env.REI_DATA_DIR||path.join(root,'data');
  mkdirSync(dir,{recursive:true,mode:0o700});
  try { chmodSync(dir,0o700); } catch {}
  const db=new DatabaseSync(path.join(dir,'rei.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, digest TEXT NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY, role TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, planner INTEGER NOT NULL DEFAULT 0, capabilities TEXT NOT NULL DEFAULT '[]', last_seen INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pairings(hash TEXT PRIMARY KEY, label TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS mcp_integrations(name TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL, auth TEXT NOT NULL, device_id TEXT NOT NULL REFERENCES devices(id), created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS device_mcp_status(device_id TEXT NOT NULL REFERENCES devices(id), name TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(device_id,name));
    CREATE TABLE IF NOT EXISTS mcp_checks(name TEXT PRIMARY KEY REFERENCES mcp_integrations(name) ON DELETE CASCADE, request_id TEXT NOT NULL, requested_at INTEGER NOT NULL, checked_at INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', tool_count INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, parent_id TEXT REFERENCES tasks(id), kind TEXT NOT NULL, text TEXT NOT NULL, department TEXT NOT NULL DEFAULT 'operations', status TEXT NOT NULL, device_id TEXT REFERENCES devices(id), result TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', lease_id TEXT, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, created_by TEXT REFERENCES users(id), created_at INTEGER NOT NULL, started_at INTEGER NOT NULL DEFAULT 0, finished_at INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS tasks_queue ON tasks(status,kind,created_at);
    CREATE INDEX IF NOT EXISTS tasks_parent ON tasks(parent_id);
    CREATE INDEX IF NOT EXISTS tasks_history ON tasks(kind,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), actor TEXT NOT NULL, type TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS external_messages(id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), direction TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
  if(!all(db,'PRAGMA table_info(tasks)').some(column=>column.name==='project_id'))db.exec('ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id)');
  if(!all(db,'PRAGMA table_info(devices)').some(column=>column.name==='agent_name'))db.exec("ALTER TABLE devices ADD COLUMN agent_name TEXT NOT NULL DEFAULT ''");
  if(!all(db,'PRAGMA table_info(devices)').some(column=>column.name==='pending_results'))db.exec('ALTER TABLE devices ADD COLUMN pending_results INTEGER NOT NULL DEFAULT 0');
  if(!all(db,'PRAGMA table_info(devices)').some(column=>column.name==='version'))db.exec("ALTER TABLE devices ADD COLUMN version TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id,kind,created_at)');
  try { chmodSync(path.join(dir,'rei.sqlite'),0o600); } catch {}
  return db;
}

export const one=(db,query,...args)=>db.prepare(query).get(...args);
export const all=(db,query,...args)=>db.prepare(query).all(...args);
export const run=(db,query,...args)=>db.prepare(query).run(...args);
export function transaction(db,fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=fn(); db.exec('COMMIT'); return result; }
  catch(error) { db.exec('ROLLBACK'); throw error; }
}
