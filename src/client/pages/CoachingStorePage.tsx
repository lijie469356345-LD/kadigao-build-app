import { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { getCoachingStores, addCoachingStore, batchImportCoachingStores, deleteCoachingStore, clearCoachingStores, CoachingStore } from '../../api/coachingStores';
import { getShops } from '../../api/shops';
import { useAuthStore } from '../../store/authStore';
import { Plus, Trash2, Upload, RefreshCw, Download } from 'lucide-react';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import * as XLSX from 'xlsx';

function CoachingStorePage() {
  const { user } = useAuthStore();
  const now = new Date();
  const [monthYear, setMonthYear] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [stores, setStores] = useState<CoachingStore[]>([]);
  const [shopList, setShopList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedShop, setSelectedShop] = useState('');
  const isAdmin = user?.isAdmin === '是' || (user?.groupName || '').includes('管理');

  const loadStores = async () => {
    setLoading(true);
    try {
      const data = await getCoachingStores(monthYear, user?.groupName);
      setStores(data);
    } catch { }
    setLoading(false);
  };

  const loadShops = async () => {
    try {
      const shops = await getShops(user?.groupName);
      setShopList(Array.isArray(shops) ? shops : []);
    } catch { }
  };

  useEffect(() => { loadStores(); loadShops(); }, [monthYear]);

  // 筛选器
  const filter = useAreaSupervisorShopFilter<CoachingStore>(stores, {
    getArea: (r) => r.area || '',
    getSupervisor: (r) => r.supervisor || '',
    getShopName: (r) => r.shopName,
    getWarehouseType: (r) => r.warehouseType || '',
    onChange: () => {},
  });
  const filteredStores = filter.filteredData;

  const handleAdd = async () => {
    if (!selectedShop) { alert('请选择店铺'); return; }
    try {
      await addCoachingStore({ shopName: selectedShop, monthYear });
      setSelectedShop('');
      setShowAdd(false);
      loadStores();
    } catch (e: any) { alert('新增失败: ' + (e?.response?.data?.error || e.message)); }
  };

  const handleBatchImport = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.txt';
    input.onchange = async (e: any) => {
      try {
        const file = e.target.files[0]; if (!file) return;
        const storeNames: string[] = [];
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'xlsx' || ext === 'xls') {
          const data = new Uint8Array(await file.arrayBuffer());
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
          for (let i = 1; i < rows.length; i++) {
            const shopName = String(rows[i][0] || '').trim();
            if (shopName) storeNames.push(shopName);
          }
        } else {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let text = new TextDecoder('utf-8').decode(bytes);
          if (text.indexOf('\uFFFD') !== -1) {
            try { text = new TextDecoder('gbk').decode(bytes); } catch {}
          }
          text = text.replace(/^\uFEFF/, '');
          const lines = text.split(/\r?\n/).filter((l: string) => l.trim());
          for (let i = 1; i < lines.length; i++) {
            const shopName = (lines[i].split(/[,\t]/)[0] || '').trim();
            if (shopName) storeNames.push(shopName);
          }
        }
        if (storeNames.length === 0) { alert('未识别到店铺名称'); return; }
        const res = await batchImportCoachingStores(storeNames, monthYear);
        let msg = `成功导入 ${res.count} 个店铺`;
        if (res.errors && res.errors.length > 0) msg += `\n失败 ${res.errors.length} 个:\n${res.errors.slice(0, 5).join('\n')}`;
        alert(msg); loadStores();
      } catch (e: any) { alert('导入失败: ' + (e?.response?.data?.error || e.message)); }
    };
    input.click();
  };

  const handleDownloadTemplate = () => {
    const rows = [['店铺名称']];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '陪跑店铺导入模板');
    XLSX.writeFile(wb, `陪跑店铺导入模板.xlsx`);
  };

  const handleClearMonth = async () => {
    if (!confirm(`确定清空 ${monthYear} 所有陪跑店铺？此操作不可恢复！`)) return;
    try { await clearCoachingStores(monthYear); loadStores(); alert('已清空'); }
    catch (e: any) { alert('清空失败'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定移出该陪跑店铺？')) return;
    try { await deleteCoachingStore(id); loadStores(); } catch { }
  };

  const th = 'border border-gray-400 px-2 py-1.5 text-xs font-bold text-gray-700 text-center bg-gray-100';
  const td = 'border border-gray-400 px-2 py-1.5 text-xs text-center';

  return (
    <Layout title="陪跑店铺管理" subtitle="管理陪跑跟进店铺清单">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <input type="month" value={monthYear} onChange={e => setMonthYear(e.target.value)} className="px-2 py-1 border rounded text-sm w-36" />
          <button onClick={loadStores} disabled={loading} className="px-3 py-1 bg-gray-100 rounded text-sm"><RefreshCw size={14} /> 刷新</button>
          <span className="text-gray-300">|</span>
          <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1 bg-green-500 text-white rounded text-sm"><Plus size={14} className="inline" /> 新增店铺</button>
          <button onClick={handleBatchImport} className="px-3 py-1 bg-blue-500 text-white rounded text-sm"><Upload size={14} className="inline" /> 批量导入</button>
          <button onClick={handleDownloadTemplate} className="px-3 py-1 bg-purple-500 text-white rounded text-sm"><Download size={14} className="inline" /> 下载模板</button>
          {isAdmin && <button onClick={handleClearMonth} className="px-3 py-1 bg-red-500 text-white rounded text-sm"><Trash2 size={14} className="inline" /> 清空本月</button>}
          <span className="text-gray-300">|</span>
          <AreaSupervisorShopFilter filter={filter as any} />
        </div>

        {showAdd && (
          <div className="mb-3 p-3 bg-green-50 border border-green-300 rounded flex items-center gap-2">
            <span className="text-sm font-bold">选择店铺：</span>
            <select className="px-2 py-1 border rounded text-sm w-64" value={selectedShop} onChange={e => setSelectedShop(e.target.value)}>
              <option value="">-- 请选择 --</option>
              {shopList.filter((s: any) => !stores.find(st => st.shopName === (s.shopName || s['店铺名称']))).map((s: any) => (
                <option key={s.shopName || s['店铺名称']} value={s.shopName || s['店铺名称']}>{s.shopName || s['店铺名称']} ({s.supervisor || s['督导']})</option>
              ))}
            </select>
            <button onClick={handleAdd} className="px-3 py-1 bg-green-600 text-white rounded text-xs">确认添加</button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1 bg-gray-300 rounded text-xs">取消</button>
          </div>
        )}

        {loading ? <p className="text-gray-400 py-8 text-center">加载中...</p> : filteredStores.length === 0 ? (
          <p className="text-gray-400 py-8 text-center">{monthYear} 本月无陪跑店铺</p>
        ) : (
          <div className="bg-white border border-gray-400 rounded overflow-x-auto">
            <table className="border-collapse text-xs w-full">
              <thead>
                <tr className="bg-gray-100">
                  <th className={th}>店铺名称</th><th className={th}>仓库类别</th><th className={th}>区域</th>
                  <th className={th}>区经</th><th className={th}>督导</th><th className={th}>联系人</th>
                  <th className={th}>手机</th><th className={th}>商品</th>
                  <th className={th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredStores.map((s, i) => (
                  <tr key={i} className={i%2===0?'bg-white':'bg-gray-50'}>
                    <td className={td}>{s.shopName}</td>
                    <td className={td}>{s.warehouseType || '-'}</td>
                    <td className={td}>{s.area || '-'}</td>
                    <td className={td}>{s.districtManager || '-'}</td>
                    <td className={td}>{s.supervisor || '-'}</td>
                    <td className={td}>{s.contactPerson || '-'}</td>
                    <td className={td}>{s.phone || '-'}</td>
                    <td className={td}>{s.product || '-'}</td>
                    <td className={td}>
                      <button onClick={() => s.id && handleDelete(s.id)} className="px-2 py-0.5 bg-red-500 text-white rounded text-xs"><Trash2 size={12} className="inline" /> 移出</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default CoachingStorePage;
