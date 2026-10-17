import { Router } from 'express';

const router = Router();

export let isMaintenanceMode = false;

router.get('/status', (req, res) => {
  res.json({
    isMaintenance: isMaintenanceMode,
    message: isMaintenanceMode ? '系统正在维护，请稍后登录' : '系统正常运行',
    estimatedTime: '30分钟',
  });
});

router.post('/toggle', (req, res) => {
  isMaintenanceMode = !isMaintenanceMode;
  res.json({
    isMaintenance: isMaintenanceMode,
    message: isMaintenanceMode ? '系统已进入维护模式' : '系统已退出维护模式',
  });
});

export default router;
