import { Router } from 'express';
import { getVersionPolicy } from '../services/versionPolicy';

const router = Router();

/**
 * 版本策略（登录前查询，公开接口）：
 * 桌面客户端在登录页先请求本接口获取「最低可用版本」，自身版本
 * 低于 minVersion 时阻断登录并引导前往下载中心升级。
 * 返回 available=false 表示策略暂不可用（公网拉取失败），客户端应放行。
 */
router.get('/version-policy', (_req, res) => {
  const policy = getVersionPolicy();
  if (!policy) {
    return res.json({ ok: true, available: false, message: '版本策略暂不可用' });
  }
  res.json({
    ok: true,
    available: true,
    minVersion: policy.minVersion,
    latestVersion: policy.latestVersion || policy.minVersion,
    updatedAt: policy.updatedAt || null,
  });
});

export default router;