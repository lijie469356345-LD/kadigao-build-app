import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { warehouseScan, getWarehouseRecords, deleteWarehouseRecord, clearTodayWarehouseRecords, exportWarehouseToday, WarehouseScanRecord, SIZE_LIST } from '../../api/warehouse';
import { RefreshCw, ScanSearch, Package, XCircle, Database, Trash2, Eye, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

// 尺码列是数字键，需转字符串按 Record 取值
function getSize(r: WarehouseScanRecord, sz: number): number | null {
  const v = (r as unknown as Record<string, number | null>)[String(sz)];
  return v == null ? null : v;
}

// 报错提示音（响铃，连响两遍）
function playErrorBeep() {
  try {
    const ACtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!ACtx) return;
    const ctx = new ACtx();
    const bell = (t0: number) => {
      // 一次铃响：基音 + 高八度泛音，带衰减，更响亮
      [987, 1975].forEach(f => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
        o.connect(g).connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + 0.62);
      });
    };
    // 响铃两遍，每遍两次短促铃响
    bell(0.0);
    bell(0.35);
    bell(0.95);
    bell(1.3);
    setTimeout(() => ctx.close().catch(() => {}), 2200);
  } catch {}
}

function WarehouseScanPage() {
  const PAGE_SIZE = 30;
  const [uuid, setUuid] = useState('');
  const [auth, setAuth] = useState('');
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<WarehouseScanRecord | null>(null);
  const [error, setError] = useState('');
  const [records, setRecords] = useState<WarehouseScanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterGoods, setFilterGoods] = useState('');
  const [page, setPage] = useState(1);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await getWarehouseRecords();
      setRecords(Array.isArray(data) ? data : []);
    } catch { setRecords([]); } finally { setLoading(false); }
  };

  useEffect(() => { loadRecords(); }, []);

  const handleScan = async () => {
    if (!uuid.trim()) { alert('请先扫码或输入 uuid'); return; }
    setScanning(true);
    setResult(null);
    setError('');
    try {
      const res = await warehouseScan(uuid.trim(), auth.trim() || undefined);
      if (res.record) {
        setResult(res.record);
        setUuid(''); // 已入库成功，清空输入框，准备扫下一个
      } else {
        setError('未获取到入库记录');
      }
      loadRecords();
    } catch (e: any) {
      const msg = e?.response?.data?.error || '查询失败';
      setError(msg);
      playErrorBeep(); // 报错提示音
      alert(`扫码失败：${msg}`); // 弹窗提示失败原因
    } finally {
      setScanning(false);
    }
  };

  const showDetail = (r: WarehouseScanRecord) => {
    setResult(r);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (r: WarehouseScanRecord) => {
    if (!window.confirm(`确定删除入库记录「${r.入库单号 || r.货号 || r.id}」吗？`)) return;
    try {
      await deleteWarehouseRecord(r.id);
      if (result?.id === r.id) setResult(null);
      loadRecords();
    } catch (e: any) {
      alert(e?.response?.data?.error || '删除失败');
    }
  };

  const handleClearToday = async () => {
    if (!window.confirm('确定清空今天（入库日期=今天）的所有入库记录吗？此操作不可恢复！')) return;
    try {
      const res = await clearTodayWarehouseRecords();
      setResult(null);
      setPage(1);
      loadRecords();
      alert(`今日已清空，共删除 ${res.deleted} 条记录`);
    } catch (e: any) {
      alert(e?.response?.data?.error || '清空失败');
    }
  };

  const handleExport = async () => {
    try {
      const res = await exportWarehouseToday();
      if (!res.rows || res.rows.length === 0) { alert('今天还没有入库数据，无法导出'); return; }
      const header = ['单据编号', '单据日期', '采购店仓', '供应商', '备注', '品牌', '条码或国标码', '采购价', '数量', '入库日期'];
      const data = [header, ...res.rows.map(r => [
        r.单据编号, r.单据日期, r.采购店仓, r.供应商, r.备注, r.品牌, r.条码或国标码, r.采购价, r.数量, r.入库日期,
      ])];
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '导出数据');
      XLSX.writeFile(wb, `入库导出_${res.date}.xlsx`);
    } catch (e: any) {
      alert(e?.response?.data?.error || '导出失败');
    }
  };

  // 表头顺序：客户名称 货号 商品名称 颜色编号 颜色名称 供应商编号 单据编号 单据日期 + 31~45 + 数量
  const mainFields: Array<[string, string | number | null | undefined]> = result
    ? [
        ['入库日期', result.入库日期],
        ['入库时间', result.入库时间],
        ['入库单号', result.入库单号],
        ['仓库名称', result.仓库名称],
        ['仓库代码', result.仓库代码],
        ['客户名称', result.客户名称],
        ['货号', result.货号],
        ['商品名称', result.商品名称],
        ['颜色编号', result.颜色编号],
        ['颜色名称', result.颜色名称],
        ['供应商编号', result.供应商编号],
        ['单据编号', result.单据编号],
        ['单据日期', result.单据日期],
        ['件数', result.件数],
        ['数量', result.数量],
        ['uuid', result.uuid],
      ]
    : [];

  const sizeRows: Array<[number, number | null]> = result
    ? SIZE_LIST.map(sz => [sz, getSize(result, sz)])
    : [];

  // 按 日期/供应商编号/商品名称 筛选
  const filteredRecords = records.filter(r => {
    if (filterDate && r.入库日期 !== filterDate) return false;
    if (filterSupplier && !(r.供应商编号 || '').includes(filterSupplier.trim())) return false;
    if (filterGoods && !(r.商品名称 || '').includes(filterGoods.trim())) return false;
    return true;
  });

  const totalPkg = filteredRecords.reduce((a, r) => a + (r.件数 || 0), 0);
  const totalQty = filteredRecords.reduce((a, r) => a + (r.数量 || 0), 0);
  const hasFilter = !!(filterDate || filterSupplier || filterGoods);

  // 分页：超过 PAGE_SIZE(80) 条才分页，每页 80 条
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRecords = filteredRecords.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const th = 'px-4 py-3 text-left text-sm font-medium text-gray-600 whitespace-nowrap';
  const td = 'px-4 py-3 text-sm text-gray-800';

  return (
    <Layout title="仓库扫码入库" subtitle="扫码查询订单并入库">
      <div className="p-4">
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <ScanSearch className="text-blue-500" />
            <div className="relative flex-1 min-w-[280px]">
              <span className="inline-block mr-2 font-extrabold text-black">扫描区</span>
              <input
                value={uuid}
                onChange={e => setUuid(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } }}
                placeholder="输入或扫描得到包装 uuid，回车直接入库"
                className="border-2 border-black font-bold rounded-lg pl-3 pr-3 py-2 text-sm w-full bg-blue-100"
              />
            </div>
            <div className="relative flex-1 min-w-[240px]">
              <label className="text-xs text-gray-400 block mb-0.5">Authorization（可选）</label>
              <input
                value={auth}
                onChange={e => setAuth(e.target.value)}
                placeholder="接口鉴权 Token"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full"
              />
            </div>
            <button onClick={handleScan} disabled={scanning}
              className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <ScanSearch size={16} /> {scanning ? '查询中...' : '确认'}
            </button>
            <button onClick={loadRecords} className="flex items-center gap-1 px-3 py-2 border text-sm rounded-lg hover:bg-gray-50">
              <RefreshCw size={15} /> 刷新记录
            </button>
          </div>
          {error && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
              <XCircle className="inline w-4 h-4 mr-1" /> {error}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-4 mb-4">
          <div className="bg-white rounded-xl shadow-sm overflow-hidden min-w-0 md:order-2">
            <div className="px-4 py-3 border-b bg-gray-50 font-semibold text-gray-700 flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-500" /> 当前入库结果（数据库记录）
            </div>
            <div className="p-4">
              {scanning ? (
                <p className="text-gray-400 text-sm">正在查询并写入数据库...</p>
              ) : result ? (
                <>
                  <div className="flex items-center gap-2 text-green-600 mb-3">
                    <Package className="w-4 h-4" /> 入库成功（单号 {result.货号 || result.单据编号 || '-'}）
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                    {mainFields.map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-gray-50 pb-1">
                        <dt className="text-gray-400 text-sm">{k}</dt>
                        <dd className="text-gray-800 text-sm font-medium max-w-[60%] text-right">{v || '-'}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 border-t pt-3">
                    <div className="text-xs text-gray-400 mb-1">尺码明细（31~45）</div>
                    <div className="flex flex-wrap gap-1">
                      {sizeRows.map(([sz, n]) => (
                        <span key={sz}
                          className={`px-2 py-0.5 text-xs rounded border ${n ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-100 text-gray-300'}`}>
                          {sz}码×{n ?? 0}
                        </span>
                      ))}
                      <span className="px-2 py-0.5 text-xs rounded border bg-blue-600 text-white">合计 {result.数量 ?? 0}件 · 件数{result.件数 ?? 0}</span>
                    </div>
                  </div>
                  <details className="mt-3 border-t pt-3">
                    <summary className="text-xs text-gray-400 cursor-pointer">完整数据（数据库字段 View）</summary>
                    <pre className="bg-gray-50 border rounded-lg p-3 text-xs font-mono mt-2 max-h-72 overflow-auto whitespace-pre-wrap">
                      {JSON.stringify({
                        id: result.id,
                        uuid: result.uuid,
                        入库单号: result.入库单号,
                        入库日期: result.入库日期,
                        入库时间: result.入库时间,
                        仓库名称: result.仓库名称,
                        仓库代码: result.仓库代码,
                        客户名称: result.客户名称,
                        货号: result.货号,
                        商品名称: result.商品名称,
                        颜色编号: result.颜色编号,
                        颜色名称: result.颜色名称,
                        供应商编号: result.供应商编号,
                        单据编号: result.单据编号,
                        单据日期: result.单据日期,
                        ...Object.fromEntries(SIZE_LIST.map(sz => [sz, getSize(result, sz)])),
                        件数: result.件数,
                        数量: result.数量,
                        完整数据: result.完整数据,
                        原始返回: result.原始返回,
                        createdAt: result.createdAt,
                      }, null, 2)}
                    </pre>
                  </details>
                </>
              ) : error ? (
                <div className="text-gray-400 flex items-center gap-1"><XCircle className="w-4 h-4 text-red-400" /> 查询失败，请检查 uuid 或鉴权</div>
              ) : (
                <p className="text-gray-400">未扫码，请输入 uuid 后点击"扫码入库"。</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm overflow-hidden min-w-0 md:order-1">
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 font-semibold text-gray-700">
              <span>历史入库记录</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{filteredRecords.length} 条{hasFilter ? `（筛选后）` : ''}</span>
                <button
                  onClick={handleExport}
                  className="flex items-center gap-1 px-2 py-1 text-xs border border-green-200 text-green-600 rounded hover:bg-green-50">
                  <Download size={13} /> 导出数据
                </button>
                <button
                  onClick={handleClearToday}
                  className="px-2 py-1 text-xs border border-red-200 text-red-500 rounded hover:bg-red-50">
                  今日清空
                </button>
              </div>
            </div>
            <div className="px-4 py-2 border-b bg-blue-50/40 flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-xs"
                title="按入库日期筛选"
              />
              <input
                value={filterSupplier}
                onChange={e => setFilterSupplier(e.target.value)}
                placeholder="供应商编号"
                className="border border-gray-300 rounded px-2 py-1 text-xs w-28"
              />
              <input
                value={filterGoods}
                onChange={e => setFilterGoods(e.target.value)}
                placeholder="商品名称"
                className="border border-gray-300 rounded px-2 py-1 text-xs w-28"
              />
              {hasFilter && (
                <button
                  onClick={() => { setFilterDate(''); setFilterSupplier(''); setFilterGoods(''); }}
                  className="px-2 py-1 text-xs border rounded text-gray-500 hover:bg-gray-100">
                  清除筛选
                </button>
              )}
            </div>
            <div className="px-4 py-2 border-b bg-gray-50 flex items-center gap-4 text-sm">
              <span className="text-gray-500">总合计</span>
              <span>记录数：<b className="text-gray-800">{filteredRecords.length} 条</b></span>
              <span>件数合计：<b className="text-blue-700">{totalPkg} 件</b></span>
              <span>数量合计：<b className="text-blue-700">{totalQty} 件</b></span>
            </div>
            <div className="overflow-auto" style={{ maxHeight: '68vh' }}>
              <table className="w-full text-sm">
                <thead className="text-gray-500 text-xs sticky top-0 z-10 bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2">序号</th>
                    <th className="text-left px-3 py-2">入库日期</th>
                    <th className="text-left px-3 py-2">入库时间</th>
                    <th className="text-left px-3 py-2">入库单号</th>
                    <th className="text-left px-3 py-2">仓库名称</th>
                    <th className="text-left px-3 py-2">仓库代码</th>
                    <th className="text-left px-3 py-2">客户</th>
                    <th className="text-left px-3 py-2">商品名称</th>
                    <th className="text-left px-3 py-2">货号</th>
                    <th className="text-left px-3 py-2">颜色编号</th>
                    <th className="text-left px-3 py-2">颜色名称</th>
                    <th className="text-left px-3 py-2">供应商编号</th>
                    <th className="text-left px-3 py-2">件数</th>
                    <th className="text-left px-3 py-2">数量</th>
                    <th className="text-left px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={15} className="text-center py-6 text-gray-400">加载中...</td></tr>
                  ) : filteredRecords.length === 0 ? (
                    <tr><td colSpan={15} className="text-center py-6 text-gray-400">暂无记录{hasFilter ? '（可清除筛选）' : ''}</td></tr>
                  ) : pagedRecords.map((r, idx) => (
                    <tr key={r.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => showDetail(r)}>
                      <td className="px-3 py-2 text-xs text-gray-400">{(safePage - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{r.入库日期 || '-'}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{r.入库时间 || '-'}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-blue-600">{r.入库单号 || '-'}</td>
                      <td className="px-3 py-2 text-xs">{r.仓库名称 || '-'}</td>
                      <td className="px-3 py-2 text-xs font-mono">{r.仓库代码 || '-'}</td>
                      <td className="px-3 py-2 text-xs">{r.客户名称 || '-'}</td>
                      <td className="px-3 py-2 text-xs">{r.商品名称 || '-'}</td>
                      <td className="px-3 py-2 text-xs">{r.货号 || '-'}</td>
                      <td className="px-3 py-2 text-xs">{r.颜色编号 || '-'}</td>
                      <td className="px-3 py-2 text-xs">{r.颜色名称 || '-'}</td>
                      <td className="px-3 py-2 text-xs">{r.供应商编号 || '-'}</td>
                      <td className="px-3 py-2 text-xs">{r.件数 ?? '-'}</td>
                      <td className="px-3 py-2 text-xs">{r.数量 ?? '-'}</td>
                      <td className="px-3 py-2 text-xs">
                        <button
                          onClick={e => { e.stopPropagation(); showDetail(r); }}
                          title="查看明细"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border text-blue-600 hover:bg-blue-50 mr-1">
                          <Eye size={13} /> 明细
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(r); }}
                          title="删除"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50">
                          <Trash2 size={13} /> 删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 px-4 py-2 border-t bg-gray-50 text-sm">
                <button
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                  className="px-2 py-1 border rounded text-xs disabled:opacity-40 hover:bg-gray-100">
                  上一页
                </button>
                <span className="text-xs text-gray-500">第 {safePage} / {totalPages} 页（共 {filteredRecords.length} 条）</span>
                <button
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                  className="px-2 py-1 border rounded text-xs disabled:opacity-40 hover:bg-gray-100">
                  下一页
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default WarehouseScanPage;