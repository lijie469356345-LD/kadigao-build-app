import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Clock, Store, Loader2, AlertCircle, Edit3, Save } from 'lucide-react';
import Layout from '../components/Layout';
import axios from '../../api/axios';

interface HourRow {
  hour: string;
  hourNum: number;
  amount: number;
}

interface ShopRow {
  shopName: string;
  amount: number;
}

interface PerformanceData {
  ok: boolean;
  byHour: HourRow[];
  byShop: ShopRow[];
  totalAmount: number;
  queryTime: string;
  shopCount: number;
  todayTarget: number;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

function shortShop(name: string): string {
  return name.replace(/_ZY$/, '');
}

export default function HourlyPerformancePage() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [targetEditing, setTargetEditing] = useState(false);
  const [targetSaving, setTargetSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get<PerformanceData>('/hourly-performance/data');
      setData(res.data);
    } catch (e: any) {
      console.error('查询失败:', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (data?.todayTarget != null) {
      setTargetInput(String(data.todayTarget || ''));
    }
  }, [data?.todayTarget]);

  const handleSaveTarget = async () => {
    const amount = Number(targetInput);
    if (!amount || amount <= 0 || isNaN(amount)) {
      alert('请输入有效的目标金额');
      return;
    }
    setTargetSaving(true);
    try {
      const res = await axios.put('/hourly-performance/target', { targetAmount: amount });
      if (res.data.ok) {
        setTargetEditing(false);
        setData(prev => prev ? { ...prev, todayTarget: amount } : prev);
      } else {
        alert(res.data.error || '保存失败');
      }
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || '保存失败');
    }
    setTargetSaving(false);
  };

  return (
    <Layout title="陪跑跟进 - 时段业绩播报" subtitle="按小时与店铺聚合的业绩数据展示">
      <div className="p-4 max-w-3xl mx-auto">
        {/* 操作栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition text-sm font-medium"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {loading ? '查询中...' : '刷新数据'}
          </button>
        </div>

        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
            <span className="text-gray-500">正在查询业绩数据...</span>
          </div>
        )}

        {data && data.byHour.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Clock size={40} className="mb-3" />
            <span>暂无业绩数据</span>
          </div>
        )}

        {data && data.byHour.length > 0 && (
          <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
            {/* 标题区 */}
            <div className="px-5 py-3 bg-blue-50 border-b border-blue-100">
              <div className="text-base font-bold text-blue-700 mb-1">
                【陪跑跟进-时段业绩播报】
              </div>
              <div className="text-sm text-gray-600">
                查询时间：{data.queryTime}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">今日业绩目标：</span>
                {targetEditing ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={targetInput}
                      onChange={e => setTargetInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveTarget(); if (e.key === 'Escape') { setTargetEditing(false); setTargetInput(String(data.todayTarget || '')); } }}
                      autoFocus
                      className="w-28 px-2 py-1 text-sm border border-blue-400 rounded text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="输入目标"
                    />
                    <button onClick={handleSaveTarget} disabled={targetSaving} className="p-1 text-green-600 hover:bg-green-50 rounded" title="保存">
                      {targetSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    </button>
                    <button onClick={() => { setTargetEditing(false); setTargetInput(String(data.todayTarget || '')); }} className="p-1 text-gray-400 hover:bg-gray-50 rounded" title="取消">
                      <AlertCircle size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-blue-600">
                      {data.todayTarget > 0 ? fmtMoney(data.todayTarget) : '未设置'}
                    </span>
                    <button onClick={() => setTargetEditing(true)} className="p-1 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50" title="编辑目标">
                      <Edit3 size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 第一区：陪跑店铺时段业绩汇总 */}
            <div className="px-5 pt-4 pb-2">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={15} className="text-blue-500" />
                <h3 className="text-sm font-semibold text-gray-700">陪跑店铺时段业绩汇总</h3>
              </div>
              <div className="space-y-1">
                {data.byHour.map((row) => (
                  <div key={row.hourNum} className="flex items-center text-sm py-0.5">
                    <span className="text-gray-600 w-16">{row.hour}</span>
                    <span className="font-mono text-gray-800">
                      {row.amount > 0 ? fmtMoney(row.amount) + '元' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 分隔线 */}
            <div className="px-5 py-3">
              <div className="border-t border-dashed border-gray-300"></div>
            </div>

            {/* 第二区：店铺业绩明细 */}
            <div className="px-5 pt-1 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Store size={15} className="text-purple-500" />
                <h3 className="text-sm font-semibold text-gray-700">店铺业绩明细</h3>
              </div>
              <div className="space-y-1">
                {data.byShop.map((row) => (
                  <div key={row.shopName} className="flex items-center justify-between text-sm py-0.5">
                    <span className="text-gray-600">{shortShop(row.shopName)}</span>
                    <span className="font-mono text-gray-800">{fmtMoney(row.amount)}元</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 合计 */}
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
              <div className="text-sm font-semibold text-gray-700">
                合计：{fmtMoney(data.totalAmount)}元（{data.shopCount}家店）
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
