import https from 'https';
import type { ClientRequest, IncomingMessage } from 'http';

// ============================================================
// 版本策略服务：从公网拉取「最低可用版本」策略并缓存。
//
// 背景：客户端登录接口运行在每台电脑本机（31688），服务端代码随包
// 分发，无法通过"服务端升级"强制老版本下线。因此最低版本策略必须
// 从公网下发——发布新版本时同步更新公网 version-policy.json，
// 客户端（桌面端）登录时携带自身版本号，低于 minVersion 一律拒绝。
//
// 策略文件位置：https://xdxt.henankadigao.cn/updates/win/version-policy.json
//   { "minVersion": "1.1.4", "latestVersion": "1.1.4", "updatedAt": "..." }
//
// 网页版（浏览器直接访问公网）登录不携带 version 字段 → 不拦截。
// ============================================================

export interface VersionPolicy {
  minVersion: string;
  latestVersion?: string;
  updatedAt?: string;
}

const POLICY_URL = 'https://xdxt.henankadigao.cn/updates/win/version-policy.json';
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 每 30 分钟重拉一次

let cache: VersionPolicy | null = null;

function fetchPolicy(): Promise<VersionPolicy | null> {
  return new Promise((resolve) => {
    let req: ClientRequest;
    req = https.get(POLICY_URL, {
      headers: { 'User-Agent': 'cardigao-client', Accept: 'application/json' },
      timeout: 8000,
    }, (res: IncomingMessage) => {
      if (!res.statusCode) {
        res.resume();
        return resolve(null);
      }
      // 跟随重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchPolicy().then(resolve);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 65536) req.destroy();
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed.minVersion === 'string' && parsed.minVersion.trim()) {
            resolve(parsed as VersionPolicy);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** 拉取一次策略并更新缓存；失败时保留旧缓存不回退（避免策略抖动）。返回是否成功。 */
export async function refreshVersionPolicy(): Promise<boolean> {
  const policy = await fetchPolicy();
  if (policy) {
    cache = policy;
    console.log('[version-policy] 已刷新:', JSON.stringify(policy));
    return true;
  } else {
    console.warn('[version-policy] 拉取失败，沿用上一份策略:', cache ? JSON.stringify(cache) : '(无)');
    return false;
  }
}

export function getVersionPolicy(): VersionPolicy | null {
  return cache;
}

/**
 * 桌面客户端版本是否允许登录：
 *  - 未携带版本号（网页版/未知调用方）→ 放行
 *  - 策略未加载（公网不可达）→ 放行（避免误伤，登录本身还依赖公网数据库）
 *  - 版本号低于 minVersion → 拒绝
 */
export function isVersionAllowed(clientVersion?: string): boolean {
  if (!clientVersion) return true;
  if (!cache || !cache.minVersion) return true;
  return compareVersions(clientVersion, cache.minVersion) >= 0;
}

/** 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// 启动时立即刷新一次，此后每 30 分钟重拉（策略变更及时生效）。
// 注意：本模块可能在 HTTPS 443 监听完成前被加载（自拉公证策略会失败），
// 若拉取失败则每 15 秒重试，直至成功，避免「重启即放行所有版本」的空缓存窗口。
refreshVersionPolicy().then((ok) => {
  if (!ok) {
    const retryTimer = setInterval(async () => {
      const done = await refreshVersionPolicy();
      if (done) clearInterval(retryTimer);
    }, 15 * 1000);
  }
});
setInterval(refreshVersionPolicy, REFRESH_INTERVAL_MS);