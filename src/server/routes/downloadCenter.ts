import { Router } from 'express';
import path from 'path';
import fs from 'fs';

const router = Router();

// ============================================================
// 下载中心：/downloads 目录对外提供各平台安装包下载
// 用户将安装包放入 {CARDIGAO_BASE_DIR|cwd}/downloads 后，
// 即可在系统「下载中心」列出并下载，无需重启服务。
// 支持安装包类型：Windows .exe / macOS .dmg / Android .apk
// ============================================================
function resolveDownloadsDir(): string {
  const base = process.env.CARDIGAO_BASE_DIR || process.cwd();
  return path.join(base, 'downloads');
}

const INSTALLER_EXTS = ['.exe', '.dmg', '.apk'];

function detectPlatform(filename: string): 'windows' | 'macos' | 'android' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.apk')) return 'android';
  if (lower.endsWith('.dmg')) return 'macos';
  return 'windows';
}

// 安装包列表接口：按平台分组返回，含文件名/大小/修改时间/下载地址
router.get('/list', (_req, res) => {
  try {
    const dir = resolveDownloadsDir();
    if (!fs.existsSync(dir)) {
      return res.json({ ok: true, files: [], platforms: { windows: [], macos: [], android: [] } });
    }
    const files = fs.readdirSync(dir)
      .filter(f => INSTALLER_EXTS.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const abs = path.join(dir, f);
        const stat = fs.statSync(abs);
        const platform = detectPlatform(f);
        return {
          name: f,
          platform,
          sizeBytes: stat.size,
          sizeMB: (stat.size / 1024 / 1024).toFixed(1),
          mtime: stat.mtime.toISOString(),
          url: `/downloads/${encodeURIComponent(f)}`,
        };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime)); // 新版本在前
    const platforms = {
      windows: files.filter(f => f.platform === 'windows'),
      macos: files.filter(f => f.platform === 'macos'),
      android: files.filter(f => f.platform === 'android'),
    };
    res.json({ ok: true, total: files.length, files, platforms });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;