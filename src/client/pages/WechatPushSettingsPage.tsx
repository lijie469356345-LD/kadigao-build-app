import { useEffect, useState } from 'react';
import PageHeader from './_WechatPageHeader';
import WechatPushSidebar from './_WechatPushSidebar';
import { getSettings, updateSettings, testConnection, getPublicIp } from '../../api/wechatPushV2';
import { CheckCircle2, XCircle, Loader2, RefreshCw, Copy, Wifi } from 'lucide-react';

export default function WechatPushSettingsPage() {
  const [data, setData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [publicIp, setPublicIp] = useState('');
  const [ipLoading, setIpLoading] = useState(false);

  // 测试连接
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const load = async () => {
    const r = await getSettings();
    const d = {
      ...r.settings,
      wechatSecret: r.settings.wechatSecret === '' ? '' : '******',
    };
    setData(d);
    // 同时获取IP
    detectIp();
  };

  const detectIp = async () => {
    setIpLoading(true);
    try {
      const r = await getPublicIp();
      setPublicIp(r.ip || r.error || '检测失败');
    } catch {
      setPublicIp('检测失败');
    } finally {
      setIpLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!data) return;
    setSaving(true); setError('');
    try {
      await updateSettings(data);
      alert('已保存。');
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || '保存失败');
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null); setError('');
    try {
      const r = await testConnection();
      setTestResult(r);
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.response?.data?.error || err.message });
    } finally { setTesting(false); }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <PageHeader title="系统开关与企业微信配置" subtitle="配置全局推送开关与企业微信 API 参数" />
      <div className="max-w-6xl mx-auto px-4 py-6 flex gap-4">
        <WechatPushSidebar />
        <div className="flex-1 min-w-0">
        {!data && <div className="text-gray-500">加载中...</div>}
        {data && (
          <div className="space-y-5">
            {/* 全局配置 */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <FieldGroup title="全局配置">
                <Row>
                  <label className="w-40 text-gray-700 text-sm">自动推送开关</label>
                  <input type="checkbox" className="w-5 h-5" checked={!!data.enabled}
                    onChange={(e) => setData({ ...data, enabled: e.target.checked })} />
                </Row>
                <Row>
                  <label className="w-40 text-gray-700 text-sm">轮询兜底开关</label>
                  <input type="checkbox" className="w-5 h-5" checked={!!data.pollingEnabled}
                    onChange={(e) => setData({ ...data, pollingEnabled: e.target.checked })} />
                </Row>
                <Row>
                  <label className="w-40 text-gray-700 text-sm">轮询间隔（秒）</label>
                  <input type="number" className="border rounded-lg px-3 py-2 w-48"
                    value={data.pollingInterval || 30}
                    onChange={(e) => setData({ ...data, pollingInterval: Number(e.target.value) })} />
                </Row>
              </FieldGroup>
            </div>

            {/* API 配置 */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <FieldGroup title="企业微信应用消息 API">
                <Row>
                  <label className="w-40 text-gray-700 text-sm">CorpID</label>
                  <input type="text" className="border rounded-lg px-3 py-2 flex-1"
                    value={data.wechatCorpId || ''}
                    onChange={(e) => setData({ ...data, wechatCorpId: e.target.value })} />
                </Row>
                <Row>
                  <label className="w-40 text-gray-700 text-sm">应用 Secret</label>
                  <input type="text" className="border rounded-lg px-3 py-2 flex-1"
                    value={data.wechatSecret || ''}
                    onChange={(e) => setData({ ...data, wechatSecret: e.target.value })}
                    placeholder="显示 ****** 表示不修改；直接输入新值覆盖" />
                </Row>
                <Row>
                  <label className="w-40 text-gray-700 text-sm">应用 AgentId</label>
                  <input type="text" className="border rounded-lg px-3 py-2 flex-1"
                    value={data.wechatAgentId || ''}
                    onChange={(e) => setData({ ...data, wechatAgentId: e.target.value })} />
                </Row>
              </FieldGroup>
            </div>

            {/* 网络出口 */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <FieldGroup title="网络出口与可信IP">
                <Row>
                  <label className="w-40 text-gray-700 text-sm">本机出网 IP</label>
                  <div className="flex items-center gap-2 flex-1">
                    {ipLoading ? (
                      <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" />检测中...</div>
                    ) : publicIp && /^\d{1,3}(\.\d{1,3}){3}$/.test(publicIp) ? (
                      <>
                        <div className="font-mono text-blue-700 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200 select-all text-sm">{publicIp}</div>
                        <button onClick={() => { navigator.clipboard.writeText(publicIp); alert('已复制'); }}
                          className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded border"><Copy size={12} /> 复制</button>
                      </>
                    ) : (
                      <div className="text-orange-600 text-sm">{publicIp || '未检测'}</div>
                    )}
                    <button onClick={detectIp} disabled={ipLoading}
                      className="px-3 py-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 rounded border border-blue-200 flex items-center gap-1">
                      <RefreshCw size={12} /> 重新检测
                    </button>
                  </div>
                </Row>
                <Row>
                  <label className="w-40 text-gray-700 text-sm">代理出口 URL</label>
                  <input type="text" className="border rounded-lg px-3 py-2 flex-1 font-mono text-sm"
                    value={data.proxyUrl || ''}
                    onChange={(e) => setData({ ...data, proxyUrl: e.target.value })}
                    placeholder="http://ip:port（固定IP代理出口，留空直连）" />
                </Row>
                <div className="text-xs text-gray-500 space-y-1 mt-2 pl-43">
                  <div>1. 将上面的IP添加到企业微信后台 → 应用管理 → 可信IP</div>
                  <div>2. IP如果是动态的，用代理出口URL让推送走固定IP</div>
                </div>
              </FieldGroup>
            </div>

            {/* 测试连接 */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <FieldGroup title="测试企微连接">
                <p className="text-xs text-gray-500 mb-3">保存配置后，点此测试是否能成功连接企业微信API</p>
                <div className="flex items-center gap-3 mb-3">
                  <button onClick={handleTest} disabled={testing}
                    className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
                    <Wifi size={16} /> {testing ? '测试中...' : '测试企微连接'}
                  </button>
                  <span className="text-xs text-gray-400">（先保存配置，再测试）</span>
                </div>
                {testResult && (
                  <div className={`rounded-lg p-4 text-sm ${testResult.ok ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    <div className="flex items-center gap-2 mb-2 font-semibold">
                      {testResult.ok ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-red-600" />}
                      {testResult.ok ? '连接成功！企业微信API可正常访问' : '连接失败'}
                    </div>
                    {testResult.ok ? (
                      <div className="space-y-1 text-gray-700 text-xs">
                        <div>Access Token: 获取成功（有效期 {testResult.expiresIn} 秒）</div>
                        <div>Agent ID: {testResult.agentId}</div>
                        <div>部门数: {testResult.departmentCount} 个</div>
                        {testResult.publicIp && <div>出网IP: {testResult.publicIp}</div>}
                        <div>耗时: {testResult.elapsed}ms {testResult.proxyUsed ? '(通过代理)' : '(直连)'}</div>
                      </div>
                    ) : (
                      <div className="space-y-1 text-red-700 text-xs">
                        {testResult.step && <div>失败步骤: {testResult.step}</div>}
                        <div className="whitespace-pre-wrap">{testResult.error}</div>
                        {testResult.tokenOk && <div className="text-green-600">Access Token 获取正常，请检查 AgentId 和应用权限</div>}
                      </div>
                    )}
                  </div>
                )}
              </FieldGroup>
            </div>

            {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>}

            <div className="flex justify-end">
              <button onClick={save} disabled={saving}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
                {saving ? '保存中...' : '保存配置'}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: any }) {
  return (
    <div>
      <h2 className="font-semibold text-gray-800 mb-3 border-l-4 border-blue-600 pl-2">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ children }: { children: any }) {
  return <div className="flex items-center gap-3">{children}</div>;
}
