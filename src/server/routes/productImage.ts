import { Router } from 'express';

const router = Router();

// 图片服务器：HTTP 静态文件服务（D:\img\M_PRODUCT 通过 /img/M_PRODUCT 暴露）
const IMAGE_BASE_URL = 'http://120.48.2.81:90/img/M_PRODUCT';
// 命名规则：商品代码.jpg（优先），兼容 jpeg/png/webp
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const FETCH_TIMEOUT_MS = 8000;

router.post('/reload-images', (_req, res) => {
  res.json({ success: true });
});

router.get('/:code', async (req, res) => {
  const code = String(req.params.code || '').replace(/[\\/:*?"<>|]/g, '');
  if (!code) return res.status(400).end();

  for (const ext of IMAGE_EXTS) {
    const url = `${IMAGE_BASE_URL}/${encodeURIComponent(code)}${ext}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        const ct = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        res.set('Content-Type', ct);
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(buf);
      }
    } catch {
      // 该扩展名不存在或请求超时，尝试下一个
    } finally {
      clearTimeout(timer);
    }
  }
  res.status(404).end();
});

export default router;
