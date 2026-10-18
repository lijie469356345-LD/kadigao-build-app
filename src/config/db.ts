import sql from 'mssql';
import fs from 'fs';
import path from 'path';

// 同步写日志，防止缓冲丢失
function log(msg: string) { process.stdout.write(msg + '\n'); }

function findConfig(): any {
  const cands: string[] = [];
  if (process.env.CARDIGAO_BASE_DIR) cands.push(path.join(process.env.CARDIGAO_BASE_DIR, 'config.json'));
  cands.push(path.join(process.cwd(), 'config.json'), path.join(__dirname, '../../config.json'));
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf-8').replace(/^\uFEFF/, ''));
        log('[DB] 配置: ' + p + ' → ' + (cfg.database?.server || '未设置'));
        return cfg;
      }
    } catch {}
  }
  log('[DB] 无 config.json，用兜底');
  return null;
}

const fileConfig = findConfig();
const dbSection = fileConfig?.database || {};
const FALLBACK = { server: '172.21.0.5', port: 1433, database: '伯俊库', user: 'sa', password: 'Ld940821' };

export let dbConfig: any = {
  server: dbSection.server || FALLBACK.server,
  port: dbSection.port || FALLBACK.port,
  database: dbSection.database || FALLBACK.database,
  user: dbSection.user || FALLBACK.user,
  password: dbSection.password || FALLBACK.password,
  connectionTimeout: 15000, requestTimeout: 300000,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, useUTC: false,
    connectionPool: { max: 20, min: 2, idleTimeoutMillis: 120000 } },
};

let pool: sql.ConnectionPool | null = null;
export const refreshConnectionPool = () => { if (pool) { pool.close().catch(() => {}); pool = null; } };
export const setDbConfig = (c: typeof dbConfig) => { dbConfig = c; refreshConnectionPool(); };

export const saveDbConfig = (c: typeof dbConfig): boolean => {
  try {
    const p = (process.env.CARDIGAO_BASE_DIR || process.cwd()) + '/config.json';
    const ex = (() => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; } })();
    ex.database = { server: c.server, port: c.port, database: c.database, user: c.user, password: c.password };
    ex.server = ex.server || { port: 3000 };
    fs.writeFileSync(p, JSON.stringify(ex, null, 2), 'utf-8');
    return true;
  } catch { return false; }
};

export const connectDB = async () => {
  if (pool) { try { await pool.close(); } catch {} pool = null; }

  const servers = [dbConfig, FALLBACK];
  const tried = new Set<string>();
  for (const cfg of servers) {
    const key = cfg.server + ':' + cfg.port;
    if (tried.has(key)) continue;
    tried.add(key);

    log('[DB] 尝试: ' + cfg.server + ':' + cfg.port);

    // 步骤1: 加载 net 模块
    log('[DB] 步骤1...');
    try {
      const net = require('net');
      log('[DB] 步骤1-OK');

      // 步骤2: TCP 直连（对外部用户不可达的内网地址快速失败，避免拖慢启动）
      log('[DB] 步骤2-TCP...');
      await new Promise<void>((resolve, reject) => {
        const s = new net.Socket();
        s.setTimeout(4000);
        s.on('connect', () => { s.destroy(); log('[DB] 步骤2-TCP-OK'); resolve(); });
        s.on('timeout', () => { s.destroy(); reject(new Error('超时')); });
        s.on('error', (e: any) => { s.destroy(); reject(e); });
        s.connect(cfg.port, cfg.server);
      });
    } catch (e: any) {
      log('[DB] 步骤-失败: ' + e.message);
      continue;
    }

    // 步骤3: SQL 握手
    log('[DB] 步骤3-SQL...');
    try {
      const c = { ...dbConfig, server: cfg.server, port: cfg.port, database: cfg.database, user: cfg.user, password: cfg.password };
      pool = await sql.connect(c);
      await pool.request().query('SELECT 1');
      log('[DB] ✓ 成功: ' + cfg.server);
      return;
    } catch (e: any) {
      log('[DB] SQL失败: ' + e.message);
      pool = null;
    }
  }
  throw new Error('全部失败');
};

export const getPool = async (): Promise<sql.ConnectionPool> => {
  if (!pool || pool.connected !== true) await connectDB();
  try { await pool!.request().query('SELECT 1'); } catch { pool = null; await connectDB(); }
  return pool!;
};

export const testConnection = async (config: typeof dbConfig) => {
  try { const tp = await sql.connect(config); await tp.close(); return { success: true, message: 'OK' }; }
  catch (e: any) { return { success: false, message: e.message }; }
};
