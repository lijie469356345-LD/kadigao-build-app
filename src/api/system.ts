import axios from './axios';

export interface VersionPolicyResult {
  ok: boolean
  available: boolean
  minVersion?: string
  latestVersion?: string
  updatedAt?: string | null
  message?: string
}

/**
 * 获取服务端下发的版本策略（最低可用版本）。
 * 登录页在桌面端加载时调用，用于"发布新版本后旧版本禁止登录"的强制更新检查。
 */
export const getVersionPolicy = async (): Promise<VersionPolicyResult> => {
  const response = await axios.get('/system/version-policy');
  return response.data as VersionPolicyResult;
};

/** 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}