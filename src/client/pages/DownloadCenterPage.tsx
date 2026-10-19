import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Monitor, Smartphone, Apple } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface DownloadFile {
  name: string;
  platform: 'windows' | 'macos' | 'android';
  sizeBytes: number;
  sizeMB: string;
  mtime: string;
  url: string;
}

interface DownloadCenterData {
  ok: boolean;
  total: number;
  files: DownloadFile[];
  platforms: {
    windows: DownloadFile[];
    macos: DownloadFile[];
    android: DownloadFile[];
  };
}

const PLATFORM_META = [
  { key: 'windows', label: 'Windows 桌面端', desc: 'Windows 7 及以上，Setup 安装包', icon: Monitor },
  { key: 'macos', label: 'macOS 桌面端', desc: 'Intel 与 Apple Silicon 两种架构', icon: Apple },
  { key: 'android', label: 'Android 手机端', desc: '安卓手机安装，APK 安装包', icon: Smartphone },
] as const;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DownloadCenterPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DownloadCenterData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/download-center/list');
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '加载失败，请稍后重试');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center p-4 py-10">
      <div className="w-full max-w-3xl">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Download className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center justify-center gap-2">
              <img src="/logo.jpg" alt="logo" className="h-8 w-8 object-contain" />
              下载中心
            </h1>
            <p className="text-gray-500 mt-2">选择对应平台，下载最新版客户端安装包</p>
          </div>

          {loading && (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span className="text-sm text-gray-500">加载安装包列表...</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm mb-4">{error}</div>
          )}

          {!loading && !error && data && data.total === 0 && (
            <div className="text-center py-12">
              <div className="text-gray-400 text-5xl mb-4">📦</div>
              <p className="text-gray-500">暂无可下载的安装包</p>
              <p className="text-gray-400 text-sm mt-1">请管理员将安装包放入服务器 downloads 目录后刷新重试</p>
            </div>
          )}

          {!loading && !error && data && data.total > 0 && (
            <div className="space-y-6">
              {PLATFORM_META.map(({ key, label, desc, icon: Icon }) => {
                const files = data.platforms[key];
                if (!files || files.length === 0) return null;
                return (
                  <div key={key} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <Icon className="w-5 h-5 text-primary" />
                      <div>
                        <div className="font-medium text-gray-800">{label}</div>
                        <div className="text-xs text-gray-500">{desc}</div>
                      </div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {files.map(f => (
                        <div key={f.name} className="flex items-center justify-between gap-4 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-800 break-words whitespace-normal">{f.name}</div>
                            <div className="text-xs text-gray-500 mt-0.5 break-words whitespace-normal">
                              {f.sizeMB} MB · 更新于 {formatTime(f.mtime)}
                            </div>
                          </div>
                          <a
                            href={f.url}
                            download
                            className="shrink-0 inline-flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                          >
                            <Download size={15} />
                            下载
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-8 text-center">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 w-full justify-center py-2.5 border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 rounded-lg text-sm font-medium transition-colors"
            >
              <ArrowLeft size={16} />
              返回登录
            </button>
          </div>
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-500">© 2026 卡迪高运营管理系统</p>
          </div>
        </div>
      </div>
    </div>
  );
}