import { NextFunction, Request, Response } from 'express';
import { JwtUserPayload, verifyToken } from '../services/jwt';
import { isPrivilegedUser } from '../services/permissionService';
import { readAuthConfig } from '../services/appConfig';

// Express Request 扩展：req.user 携带 JWT 解析出的身份
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtUserPayload | null;
    }
  }
}

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (auth.trim()) return auth.trim();
  return null;
}

// 身份敏感参数清单：query/body 中同名参数一律以 token 内身份为准（防改参数越权）
const IDENTITY_KEYS = ['groupName', 'isAdmin'] as const;

/** 强制覆盖：删除请求中所有身份参数，写入 token 内身份 */
export function overrideIdentityParams(req: Request, user: JwtUserPayload) {
  const value = {
    groupName: user.groupName || '',
    isAdmin: user.isAdmin || '否',
  };
  if (req.query) {
    for (const k of IDENTITY_KEYS) delete (req.query as Record<string, unknown>)[k];
    (req.query as Record<string, unknown>).groupName = value.groupName;
    (req.query as Record<string, unknown>).isAdmin = value.isAdmin;
  }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    for (const k of IDENTITY_KEYS) delete (req.body as Record<string, unknown>)[k];
    (req.body as Record<string, unknown>).groupName = value.groupName;
    (req.body as Record<string, unknown>).isAdmin = value.isAdmin;
  }
}

/** 强制鉴权：无有效 token 一律 401（白名单路径由网关自行放行） */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  const user = token ? verifyToken(token) : null;
  if (!user) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: '未登录或登录已过期' });
  }
  req.user = user;
  overrideIdentityParams(req, user);
  next();
}

/** 软鉴权：解析到有效 token 则设置身份并强制覆盖；否则放行（req.user=null） */
export function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  const user = token ? verifyToken(token) : null;
  req.user = user;
  if (user) overrideIdentityParams(req, user);
  next();
}

// ============================================================
// 平滑过渡权限闸门（供高危路由显式挂载）
//  - config.json auth.enforce=true 时才强制执行鉴权/权限校验
//  - enforce=false（前端未适配 JWT 期间）一律放行，避免打挂现有页面
//  - 前端适配 JWT 并将 enforce 置为 true 后，这些写/管理操作自动收紧
// ============================================================

/** 高危写操作闸门：enforce=true 时，未登录或非特权用户一律 403 */
export function guardHighRiskWrite(req: Request, res: Response, next: NextFunction) {
  const enforce = readAuthConfig().enforce === true;
  if (!enforce) return next();
  if (!req.user || !isPrivilegedUser(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '无权限执行该操作' });
  }
  next();
}

/** 管理操作闸门：enforce=true 时，未登录一律 401 */
export function guardLogin(req: Request, res: Response, next: NextFunction) {
  const enforce = readAuthConfig().enforce === true;
  if (!enforce) return next();
  if (!req.user) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: '未登录或登录已过期' });
  }
  next();
}