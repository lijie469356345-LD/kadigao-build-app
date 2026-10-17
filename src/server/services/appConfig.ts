import fs from 'fs';
import path from 'path';

// ============================================================
// 应用配置读取（config.json）
// 注意：此处只读取配置项，不写入任何密钥类内容（JWT_SECRET 走环境变量）
// ============================================================

export interface AuthConfig {
  // 是否强制鉴权：true=未登录一律 401（除白名单）；false=解析到 token 即强制覆盖身份参数，未登录放行（平滑过渡）
  enforce?: boolean;
  // 默认密码（原硬编码 8888 提升为配置项，仅对数据库中密码为空的用户生效）
  defaultPassword?: string;
  // JWT 有效期，缺省 12h
  jwtExpiresIn?: string;
  // 可选：若用户显式在 config.json 配置了密钥（不推荐，建议环境变量）
  jwtSecret?: string;
}

let cache: AuthConfig | null = null;

export function readAuthConfig(): AuthConfig {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf-8');
    const cfg = JSON.parse(raw);
    cache = (cfg && cfg.auth) || {};
  } catch {
    cache = {};
  }
  return cache ?? {};
}

/** 供测试/热更新场景重置缓存 */
export function resetAuthConfigCache() {
  cache = null;
}