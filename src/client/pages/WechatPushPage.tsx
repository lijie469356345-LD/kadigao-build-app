import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Users, BarChart3, Play, Loader2, CheckCircle2,
  XCircle, BellRing, AlertTriangle, RefreshCw, Settings,
} from 'lucide-react';
import PageHeader from './_WechatPageHeader';
import WechatPushSidebar from './_WechatPushSidebar';
import {
  PushModule, getModules, getPushStats, getSettings,
} from '../../api/wechatPushV2';
import { initWechatPush } from '../../api/wechatPush';

const PAGE_KEY = 'wechatPushPageV2';

export default function WechatPushPage() {
  const navigate = useNavigate();
  const [modules, setModules] = useState<PushModule[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [mods, s, st] = await Promise.all([
        getModules(),
        getSettings(),
        getPushStats(),
      ]);
      setModules(mods);
      setSettings(s);
      setStats(st);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleInit = async () => {
    setInitLoading(true);
    try {
      await initWechatPush();
      alert('初始化完成（旧表+V2表均已创建，字段已同步）');
      refresh();
    } catch (err: any) {
      alert('初始化失败：' + (err?.response?.data?.error || err.message));
    } finally {
      setInitLoading(false);
    }
  };

  const summary = stats?.summary || {};
  const byModule = stats?.byModule || [];

  return (
    <div className="min-h-screen bg-gray-100">
      <PageHeader title="企微推送管理" subtitle="多门户多模块推送总览" />
      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-4">
        <WechatPushSidebar />
        <div className="flex-1 min-w-0 space-y-6">

        {/* 状态卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatusCard title="推送开关" value={settings?.settings?.enabled ? '已启用' : '已关闭'}
            icon={BellRing} tone={settings?.settings?.enabled ? 'success' : 'warning'} />
          <StatusCard title="接口配置" value={settings?.apiConfigured ? '已配置' : '未配置'}
            icon={CheckCircle2} tone={settings?.apiConfigured ? 'success' : 'danger'} />
          <StatusCard title="今日推送" value={`${summary?.successToday || 0} / ${summary?.totalToday || 0}`}
            icon={Play} tone="info" />
          <StatusCard title="今日失败" value={String(summary?.failedToday || 0)}
            icon={XCircle} tone={(summary?.failedToday || 0) > 0 ? 'danger' : 'muted'} />
          <StatusCard title="已注册模块" value={`${modules.length} 个`}
            icon={Loader2} tone="info" />
        </div>

        {/* 快捷操作 */}
        <div className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-gray-800">快捷操作</h2>
            <p className="text-sm text-gray-500 mt-1">管理推送模板、接收人、日志和系统配置</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleInit} disabled={initLoading}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm">
              {initLoading ? '初始化中...' : '一键初始化表+同步字段'}
            </button>
            <button onClick={refresh} disabled={loading}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm flex items-center gap-1">
              <RefreshCw size={14} /> 刷新
            </button>
          </div>
        </div>

        {/* 子菜单 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SubMenuCard icon={FileText} label="消息模板生成器" desc="按模块选择字段，自动生成推送模板"
            onClick={() => navigate('/wechat-push/template')} />
          <SubMenuCard icon={Users} label="接收人管理" desc="查看和管理企微推送接收人"
            onClick={() => navigate('/wechat-push/recipients')} />
          <SubMenuCard icon={BarChart3} label="推送总列表" desc="多模块推送记录、筛选、重新推送"
            onClick={() => navigate('/wechat-push/logs')} />
          <SubMenuCard icon={Settings} label="系统开关与配置" desc="启停推送、配置API参数、代理出口"
            onClick={() => navigate('/wechat-push/settings')} />
        </div>

        {/* 各模块推送状态 */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h2 className="font-semibold text-gray-800">各模块推送状态（今日）</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="text-left px-4 py-2">模块名称</th>
                  <th className="text-left px-4 py-2">所属门户</th>
                  <th className="text-left px-4 py-2">源数据表</th>
                  <th className="text-center px-4 py-2">启用</th>
                  <th className="text-center px-4 py-2">今日成功</th>
                  <th className="text-center px-4 py-2">今日失败</th>
                </tr>
              </thead>
              <tbody>
                {modules.map(m => {
                  const modStat = byModule.find((s: any) => s.moduleCode === m.moduleCode);
                  return (
                    <tr key={m.moduleCode} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-800 font-medium">{m.moduleName}</td>
                      <td className="px-4 py-2 text-gray-500">{m.portalName}</td>
                      <td className="px-4 py-2 text-gray-500 font-mono text-xs">{m.sourceTable}</td>
                      <td className="px-4 py-2 text-center">
                        {m.isActive ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" /> : <XCircle className="w-4 h-4 text-gray-400 inline" />}
                      </td>
                      <td className="px-4 py-2 text-center text-green-600 font-mono">{modStat?.ok || 0}</td>
                      <td className="px-4 py-2 text-center text-red-600 font-mono">{modStat?.fail || 0}</td>
                    </tr>
                  );
                })}
                {modules.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-6 text-gray-400">加载中...</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

function StatusCard({ title, value, icon: Icon, tone }: {
  title: string; value: string; icon: any;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'muted';
}) {
  const colors: Record<string, string> = {
    success: 'text-green-600 bg-green-50',
    warning: 'text-amber-600 bg-amber-50',
    danger: 'text-red-600 bg-red-50',
    info: 'text-blue-600 bg-blue-50',
    muted: 'text-gray-600 bg-gray-100',
  };
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between">
      <div>
        <div className="text-xs text-gray-500 mb-1">{title}</div>
        <div className="text-lg font-semibold text-gray-800">{value}</div>
      </div>
      <div className={`p-3 rounded-xl ${colors[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
  );
}

function SubMenuCard({ icon: Icon, label, desc, onClick }: {
  icon: any; label: string; desc: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-start p-5 bg-white rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all text-left">
      <div className="p-3 rounded-xl bg-blue-50 mb-3">
        <Icon className="w-6 h-6 text-blue-600" />
      </div>
      <span className="font-semibold text-gray-800">{label}</span>
      <span className="text-xs text-gray-500 mt-1">{desc}</span>
    </button>
  );
}
