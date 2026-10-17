import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { readAuthConfig } from './appConfig';

// ============================================================
// JWT 工具：登录签发 / 请求解析
// 密钥来源优先级：环境变量 JWT_SECRET > config.json auth.jwtSecret > 运行时随机（重启后失效）
// 建议通过系统环境变量 JWT_SECRET 配置固定密钥，勿将密钥写入仓库或交付文件
// ============================================================

export interface JwtUserPayload {
  userId: string;
  userCode: string;
  userName: string;
  phone: string;
  isAdmin: string;      // '是' | '否'
  groupName: string;    // 兼容历史字段：用户组列已删除，登录后恒为 ''，旧组名逻辑失效
  // 标准权限身份（未配置时缺省）
  roleId?: number;
  roleCode?: string;
  roleName?: string;
  // v3 一人多角色：全量并集（主角色 = 权限最高者，roleCode 为主角色）
  roleIds?: number[];
  roleCodes?: string[];
  roleNames?: string[];
  orgId?: number;
  orgName?: string;
  // v3 一人多组织：用户全部已绑定组织的 id（去重；orgId 为首个非空绑定，可能只代表其一）
  orgIds?: number[];
  dataScope?: number | null;       // 1仅本人/2本组织/3本组织及下级/4指定组织/5全局
  dataScopeOrgIds?: string | null; // dataScope=4 时指定组织 id 列表
  tokenType: 'access';
}

let cachedSecret: string | null = null;

export function getJwtSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) {
    cachedSecret = fromEnv;
    return fromEnv;
  }
  const cfg = readAuthConfig();
  if (cfg.jwtSecret && typeof cfg.jwtSecret === 'string' && cfg.jwtSecret.length >= 16) {
    cachedSecret = cfg.jwtSecret;
    return cachedSecret;
  }
  cachedSecret = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[JWT] 未检测到环境变量 JWT_SECRET，已使用运行时随机密钥（服务重启后所有已登录会话失效）。' +
    '建议设置环境变量 JWT_SECRET 固定密钥。'
  );
  return cachedSecret;
}

export function signToken(payload: JwtUserPayload): string {
  const cfg = readAuthConfig();
  const expiresIn = (cfg.jwtExpiresIn as jwt.SignOptions['expiresIn']) || '12h';
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

export function verifyToken(token: string): JwtUserPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (typeof decoded === 'string') return null;
    if ((decoded as JwtUserPayload).tokenType !== 'access') return null;
    return decoded as JwtUserPayload;
  } catch {
    return null;
  }
}