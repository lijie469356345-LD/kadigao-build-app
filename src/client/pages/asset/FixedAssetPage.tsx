import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Layout from '../../components/Layout';
import { fixedAssetApi, inventoryApi, disposalApi, depreciationSchemeApi, assetOrgApi } from '../../../api/assetManagement';
import {
  Package, Plus, Edit, Trash2, Search, Download, CheckCircle2, XCircle,
  ClipboardCheck, ArrowLeftRight, FileText, X, Loader2, AlertCircle,
  TrendingDown, Eye, History, Boxes, BarChart3, MapPin, Calculator, Settings,
  Upload,
} from 'lucide-react';

// ============================================================
// 类型定义
// ============================================================
interface FixedAsset {
  id: number;
  assetNo: string;
  barcode: string;
  imagePath: string;
  assetName: string;
  category: string;
  assetOwnership: string;
  specModel: string;
  purchaseDate: string;
  purchasePrice: number;
  supplier: string;
  supplierPhone?: string;
  invoiceNo: string;
  status: string;
  depreciationMethod: string;
  schemeId?: number;
  totalQuantity?: number;
  distributedQuantity?: number;
  undistributedQuantity?: number;
  originalValue: number;
  accumulatedDepreciation: number;
  netValue: number;
  remark: string;
  [key: string]: any;
}

interface TransferLog {
  id: number;
  assetId: number;
  transferType: string;
  fromDept: string;
  toDept: string;
  fromUser: string;
  toUser: string;
  fromLocation: string;
  toLocation: string;
  reason: string;
  status: string;
  operateDate: string;
  createdByName: string;
  createdAt: string;
  [key: string]: any;
}

interface InventoryTask {
  id: number;
  taskName: string;
  taskScope: string;
  status: string;
  startDate: string;
  endDate: string;
  createdByName: string;
  createdAt: string;
  [key: string]: any;
}

interface InventoryDetail {
  id: number;
  inventoryId: number;
  assetId: number;
  assetNo: string;
  assetName: string;
  bookLocation: string;
  actualLocation: string;
  bookUser: string;
  actualUser: string;
  result: string;
  remark: string;
  checkedByName: string;
  checkedAt: string;
  [key: string]: any;
}

interface DisposalRecord {
  id: number;
  assetId: number;
  assetNo: string;
  assetName: string;
  specModel: string;
  disposalReason: string;
  disposalDate: string;
  residualValue: number;
  disposalMethod: string;
  status: string;
  approverName: string;
  approvalDate: string;
  approvalRemark: string;
  createdByName: string;
  createdAt: string;
  [key: string]: any;
}

// ============================================================
// 常量映射
// ============================================================
const STATUS_MAP: Record<string, { label: string; color: string }> = {
  inuse: { label: '在用', color: 'text-green-600 bg-green-50' },
  idle: { label: '闲置', color: 'text-gray-600 bg-gray-100' },
  repairing: { label: '维修', color: 'text-orange-600 bg-orange-50' },
  scrapped: { label: '报废', color: 'text-red-600 bg-red-50' },
};

const TRANSFER_TYPE_MAP: Record<string, string> = {
  transfer: '调拨',
  assign: '领用',
  return: '归还',
  repair: '维修',
  lend: '租借',
  stop: '停用',
  resume: '启用',
  companyToStore: '公司转店',
  storeToCompany: '店退公司',
};

const INVENTORY_RESULT_MAP: Record<string, { label: string; color: string }> = {
  normal: { label: '正常', color: 'text-green-600 bg-green-50' },
  surplus: { label: '盘盈', color: 'text-blue-600 bg-blue-50' },
  shortage: { label: '盘亏', color: 'text-red-600 bg-red-50' },
};

const DISPOSAL_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待审批', color: 'text-amber-600 bg-amber-50' },
  approved: { label: '已通过', color: 'text-green-600 bg-green-50' },
  rejected: { label: '已驳回', color: 'text-red-600 bg-red-50' },
};

const TABS = [
  { key: 'archive', label: '资产档案', icon: Package },
  { key: 'statistics', label: '统计概览', icon: BarChart3 },
  { key: 'distribution', label: '资产分布', icon: MapPin },
  { key: 'depreciation', label: '折旧方案', icon: Calculator },
  { key: 'transfer', label: '资产变动', icon: ArrowLeftRight },
  { key: 'inventory', label: '盘点管理', icon: ClipboardCheck },
  { key: 'disposal', label: '报废处置', icon: TrendingDown },
  { key: 'export', label: '台账导出', icon: Download },
];

// ============================================================
// 工具函数
// ============================================================
function formatDate(d: string | undefined | null): string {
  if (!d) return '-';
  return String(d).slice(0, 10);
}

function formatCurrency(n: number | undefined | null): string {
  const v = Number(n || 0);
  return '\u00a5' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

function formatDateTime(d: string | undefined | null): string {
  if (!d) return '-';
  return String(d).slice(0, 16).replace('T', ' ');
}

// ============================================================
// 空表单
// ============================================================
const ASSET_OWNERSHIP_OPTIONS = ['自有', '租赁', '借入', '受赠', '代管'];

const EMPTY_ASSET_FORM = {
  assetNo: '',
  barcode: '',
  imagePath: '',
  assetName: '',
  category: '',
  assetOwnership: '',
  specModel: '',
  purchaseDate: new Date().toISOString().slice(0, 10),
  purchasePrice: '',
  supplier: '',
  supplierPhone: '',
  invoiceNo: '',
  status: 'inuse',
  schemeId: '',
  totalQuantity: 1,
  remark: '',
};

const EMPTY_TRANSFER_FORM = {
  transferType: 'transfer',
  fromDept: '',
  toDept: '',
  fromUser: '',
  toUser: '',
  toUserName: '',
  fromLocation: '',
  toLocation: '',
  reason: '',
  operateDate: new Date().toISOString().slice(0, 10),
};

const EMPTY_DISPOSAL_FORM = {
  assetId: '',
  disposalReason: '',
  disposalDate: new Date().toISOString().slice(0, 10),
  residualValue: '',
  disposalMethod: '报废',
  scrapQuantity: 1,
  distLocation: '',
};

const EMPTY_INVENTORY_FORM = {
  taskName: '',
  taskScope: '',
};

// ============================================================
// 主组件
// ============================================================
function FixedAssetPage() {
  const [activeTab, setActiveTab] = useState('archive');

  return (
    <Layout title="固定资产管理" subtitle="固定资产全生命周期管控">
      <div className="p-2 sm:p-4 lg:p-6">
        {/* 标签栏 */}
        <div className="bg-white rounded-lg shadow-sm p-2 mb-4">
          <div className="flex flex-wrap gap-1">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === 'archive' && <AssetArchiveTab />}
        {activeTab === 'statistics' && <StatisticsTab />}
        {activeTab === 'distribution' && <DistributionTab />}
        {activeTab === 'depreciation' && <DepreciationTab />}
        {activeTab === 'transfer' && <AssetTransferTab />}
        {activeTab === 'inventory' && <InventoryTab />}
        {activeTab === 'disposal' && <DisposalTab />}
        {activeTab === 'export' && <ExportTab />}
      </div>
    </Layout>
  );
}

// ============================================================
// 可排序表头组件
// ============================================================
function SortableTh({ label, field, sortField, sortOrder, onSort, className }: {
  label: string;
  field: string;
  sortField: string;
  sortOrder: 'asc' | 'desc';
  onSort: (field: string) => void;
  className?: string;
}) {
  const isActive = sortField === field;
  return (
    <th
      className={`px-3 py-3 cursor-pointer select-none hover:bg-gray-100 ${className || ''}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs ${isActive ? 'text-blue-600' : 'text-gray-300'}`}>
          {isActive ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </span>
    </th>
  );
}

// ============================================================
// Tab1: 资产档案
// ============================================================
function AssetArchiveTab() {
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ status: '', category: '', keyword: '' });
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_ASSET_FORM });
  const [saving, setSaving] = useState(false);
  const [transferHistory, setTransferHistory] = useState<{ asset: FixedAsset; records: TransferLog[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [schemes, setSchemes] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [sortField, setSortField] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const assetImageInputRef = useRef<HTMLInputElement>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const loadSchemes = useCallback(async () => {
    try {
      const res = await depreciationSchemeApi.list();
      if (res.data.ok) setSchemes(res.data.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadSchemes(); }, [loadSchemes]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fixedAssetApi.getCategories();
      if (res.data.ok) setCategories(res.data.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedAssets = useMemo(() => {
    if (!sortField) return assets;
    const sorted = [...assets];
    sorted.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortOrder === 'asc' ? av - bv : bv - av;
      }
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (as < bs) return sortOrder === 'asc' ? -1 : 1;
      if (as > bs) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [assets, sortField, sortOrder]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filters.status) params.status = filters.status;
      if (filters.category) params.category = filters.category;
      if (filters.keyword) params.keyword = filters.keyword;
      const res = await fixedAssetApi.list(params);
      if (res.data.ok) {
        setAssets(res.data.data || []);
      } else {
        alert(res.data.error || '获取资产列表失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误，获取数据失败');
    }
    setLoading(false);
  }, [filters]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearch = () => { loadData(); };

  const handleReset = () => {
    setFilters({ status: '', category: '', keyword: '' });
  };

  const handleAdd = () => {
    setEditingId(null);
    setFormData({ ...EMPTY_ASSET_FORM });
    setShowModal(true);
  };

  const handleEdit = (asset: FixedAsset) => {
    setEditingId(asset.id);
    setFormData({
      assetNo: asset.assetNo || '',
      barcode: asset.barcode || '',
      imagePath: asset.imagePath || '',
      assetName: asset.assetName || '',
      category: asset.category || '',
      assetOwnership: asset.assetOwnership || '',
      specModel: asset.specModel || '',
      purchaseDate: asset.purchaseDate ? formatDate(asset.purchaseDate) : '',
      purchasePrice: asset.purchasePrice != null ? String(asset.purchasePrice) : '',
      supplier: asset.supplier || '',
      supplierPhone: asset.supplierPhone || '',
      invoiceNo: asset.invoiceNo || '',
      status: asset.status || 'inuse',
      schemeId: asset.schemeId != null ? String(asset.schemeId) : '',
      totalQuantity: asset.totalQuantity != null ? asset.totalQuantity : 1,
      remark: asset.remark || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (asset: FixedAsset) => {
    if (!confirm(`确定要删除资产「${asset.assetName}」（编号：${asset.assetNo}）吗？此操作不可撤销。`)) return;
    try {
      const res = await fixedAssetApi.remove(asset.id);
      if (res.data.ok) {
        alert('删除成功');
        loadData();
      } else {
        alert(res.data.error || '删除失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误，删除失败');
    }
  };

  const handleViewTransfers = async (asset: FixedAsset) => {
    setHistoryLoading(true);
    try {
      const res = await fixedAssetApi.getTransfers(asset.id);
      if (res.data.ok) {
        setTransferHistory({ asset, records: res.data.data || [] });
      } else {
        alert(res.data.error || '获取变动记录失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误，获取变动记录失败');
    }
    setHistoryLoading(false);
  };

  const handleSave = async () => {
    if (!formData.assetName.trim()) { alert('请输入资产名称'); return; }
    if (!formData.schemeId) { alert('请选择折旧方案'); return; }
    setSaving(true);
    try {
      const payload: any = {
        assetNo: formData.assetNo,
        barcode: formData.barcode,
        imagePath: formData.imagePath,
        assetName: formData.assetName,
        category: formData.category,
        assetOwnership: formData.assetOwnership,
        specModel: formData.specModel,
        purchaseDate: formData.purchaseDate,
        purchasePrice: formData.purchasePrice ? Number(formData.purchasePrice) : 0,
        supplier: formData.supplier,
        supplierPhone: formData.supplierPhone,
        invoiceNo: formData.invoiceNo,
        status: formData.status,
        schemeId: formData.schemeId ? Number(formData.schemeId) : null,
        totalQuantity: Number(formData.totalQuantity) || 1,
        remark: formData.remark,
      };
      let res;
      if (editingId) {
        res = await fixedAssetApi.update(editingId, payload);
      } else {
        res = await fixedAssetApi.create(payload);
      }
      if (res.data.ok) {
        alert(editingId ? '更新成功' : '新增成功');
        setShowModal(false);
        loadData();
      } else {
        alert(res.data.error || '保存失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误，保存失败');
    }
    setSaving(false);
  };

  const handleUploadImage = async (file: File) => {
    setImageUploading(true);
    try {
      const res = await fixedAssetApi.uploadImage(file);
      if (res.data.ok) {
        setFormData(prev => ({ ...prev, imagePath: res.data.url }));
      } else {
        alert(res.data.error || '上传失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '上传失败');
    }
    setImageUploading(false);
  };

  const handleRemoveImage = () => {
    setFormData(prev => ({ ...prev, imagePath: '' }));
  };

  const handleExport = async () => {
    try {
      const res = await fixedAssetApi.export();
      const blob = new Blob([res.data as unknown as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `固定资产台账_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '导出失败');
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const res = await fixedAssetApi.importAssets(file);
      if (res.data.ok) {
        const d = res.data.data || {};
        alert(`导入完成：新增 ${d.inserted ?? 0} 条，替换 ${d.updated ?? 0} 条${d.errors?.length ? `，跳过 ${d.errors.length} 行` : ''}`);
        loadData();
      } else {
        alert(res.data.error || '导入失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '导入失败');
    }
    setImporting(false);
  };

  const handleClearAll = async () => {
    if (!confirm('警告：此操作将清空全部固定资产档案及其关联的分布、变动、报废记录，且不可恢复！\n\n确认要清空吗？')) return;
    if (!confirm('再次确认：真的要清空全部资产数据吗？此操作不可撤销！')) return;
    setClearing(true);
    try {
      const res = await fixedAssetApi.clearAll();
      if (res.data.ok) {
        alert(`已清空 ${res.data.data?.deleted ?? 0} 条资产档案`);
        loadData();
      } else {
        alert(res.data.error || '清空失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '清空失败');
    }
    setClearing(false);
  };

  return (
    <div>
      {/* 筛选栏 */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">资产状态</label>
            <select
              value={filters.status}
              onChange={e => setFilters({ ...filters, status: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部</option>
              <option value="inuse">在用</option>
              <option value="idle">闲置</option>
              <option value="repairing">维修</option>
              <option value="scrapped">报废</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">资产类别</label>
            <select
              value={filters.category}
              onChange={e => setFilters({ ...filters, category: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">关键词</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={filters.keyword}
                onChange={e => setFilters({ ...filters, keyword: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                placeholder="资产编号/名称/规格型号"
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <button
            onClick={handleSearch}
            className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <Search className="w-4 h-4" />查询
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-sm"
          >
            重置
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
          >
            <Plus className="w-4 h-4" />新增资产
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm"
          >
            <Download className="w-4 h-4" />导出
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm disabled:opacity-50"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {importing ? '导入中...' : '导入'}
          </button>
          <button
            onClick={handleClearAll}
            disabled={clearing}
            className="flex items-center gap-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50"
          >
            {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {clearing ? '清空中...' : '清空'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }}
          />
        </div>
      </div>

      {/* 资产表格 */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="ml-2 text-gray-500">加载中...</span>
          </div>
        ) : assets.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>暂无资产记录</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-3 text-center">图片</th>
                  <SortableTh label="资产编号" field="assetNo" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="条码" field="barcode" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="资产名称" field="assetName" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="资产类别" field="category" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="资产所属" field="assetOwnership" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="规格型号" field="specModel" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="购置日期" field="purchaseDate" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="购置价格" field="purchasePrice" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-right" />
                  <SortableTh label="供应商" field="supplier" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="供应商电话" field="supplierPhone" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="发票号" field="invoiceNo" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="状态" field="status" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="折旧方案" field="depreciationMethod" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <SortableTh label="总数量" field="totalQuantity" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-center" />
                  <SortableTh label="已分布" field="distributedQuantity" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-center" />
                  <SortableTh label="未分布" field="undistributedQuantity" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-center" />
                  <SortableTh label="原值" field="originalValue" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-right" />
                  <SortableTh label="累计折旧" field="accumulatedDepreciation" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-right" />
                  <SortableTh label="净值" field="netValue" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-right" />
                  <SortableTh label="备注" field="remark" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="text-left" />
                  <th className="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedAssets.map(a => {
                  const st = STATUS_MAP[a.status] || STATUS_MAP.inuse;
                  const totalQty = a.totalQuantity ?? 1;
                  const distQty = a.distributedQuantity ?? 0;
                  const undistQty = a.undistributedQuantity ?? totalQty;
                  return (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 text-center">
                        {a.imagePath ? (
                          <img
                            src={a.imagePath}
                            alt={a.assetName || '资产图片'}
                            className="w-12 h-12 object-cover rounded cursor-pointer hover:opacity-80 hover:ring-2 hover:ring-blue-400"
                            onClick={() => setPreviewImage(a.imagePath)}
                          />
                        ) : (
                          <span className="inline-flex items-center justify-center w-12 h-12 text-gray-300">
                            <Package className="w-5 h-5" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-gray-600">{a.assetNo || '-'}</td>
                      <td className="px-3 py-3 font-mono text-xs text-gray-600">{a.barcode || '-'}</td>
                      <td className="px-3 py-3 font-medium text-gray-800">{a.assetName || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{a.category || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{a.assetOwnership || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{a.specModel || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{formatDate(a.purchaseDate)}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{formatCurrency(a.purchasePrice)}</td>
                      <td className="px-3 py-3 text-gray-600">{a.supplier || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{a.supplierPhone || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{a.invoiceNo || '-'}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-3 py-3 text-gray-600 text-xs">{a.schemeId ? (schemes.find(s => s.id === a.schemeId)?.schemeName || '-') : (a.depreciationMethod || '-')}</td>
                      <td className="px-3 py-3 text-center font-medium text-gray-700">{totalQty}</td>
                      <td className="px-3 py-3 text-center text-blue-600">{distQty}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={undistQty === 0 ? 'text-gray-400' : 'text-green-600 font-medium'}>{undistQty}</span>
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600">{formatCurrency(a.originalValue)}</td>
                      <td className="px-3 py-3 text-right text-gray-500">{formatCurrency(a.accumulatedDepreciation)}</td>
                      <td className="px-3 py-3 text-right font-medium text-blue-600">{formatCurrency(a.netValue)}</td>
                      <td className="px-3 py-3 text-gray-500 text-xs max-w-[120px] truncate" title={a.remark || ''}>{a.remark || '-'}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleViewTransfers(a)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50"
                            title="查看变动记录"
                          >
                            <History className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleEdit(a)}
                            className="p-1.5 text-gray-400 hover:text-green-600 rounded hover:bg-green-50"
                            title="编辑"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(a)}
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-red-50"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新增/编辑弹窗 */}
      {showModal && (
        <Modal title={editingId ? '编辑资产' : '新增资产'} onClose={() => setShowModal(false)}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="资产编号">
              <input
                type="text"
                value={formData.assetNo}
                onChange={e => setFormData({ ...formData, assetNo: e.target.value })}
                placeholder="留空则自动生成"
                className="form-input"
              />
            </Field>
            <Field label="条码">
              <input
                type="text"
                value={formData.barcode}
                onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                placeholder="可留空"
                className="form-input"
              />
            </Field>
            <Field label="资产名称" required>
              <input
                type="text"
                value={formData.assetName}
                onChange={e => setFormData({ ...formData, assetName: e.target.value })}
                className="form-input"
              />
            </Field>
            <Field label="资产类别">
              <input
                type="text"
                value={formData.category}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="form-input"
              />
            </Field>
            <Field label="资产所属">
              <select
                value={formData.assetOwnership}
                onChange={e => setFormData({ ...formData, assetOwnership: e.target.value })}
                className="form-input"
              >
                <option value="">请选择</option>
                {ASSET_OWNERSHIP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="规格型号">
              <input
                type="text"
                value={formData.specModel}
                onChange={e => setFormData({ ...formData, specModel: e.target.value })}
                className="form-input"
              />
            </Field>
            <Field label="购置日期">
              <input
                type="date"
                value={formData.purchaseDate}
                onChange={e => setFormData({ ...formData, purchaseDate: e.target.value })}
                className="form-input"
              />
            </Field>
            <Field label="购置价格">
              <input
                type="number"
                step="0.01"
                value={formData.purchasePrice}
                onChange={e => setFormData({ ...formData, purchasePrice: e.target.value })}
                className="form-input"
              />
            </Field>
            <Field label="供应商">
              <input
                type="text"
                value={formData.supplier}
                onChange={e => setFormData({ ...formData, supplier: e.target.value })}
                className="form-input"
              />
            </Field>
            <Field label="供应商电话">
              <input
                type="text"
                value={formData.supplierPhone}
                onChange={e => setFormData({ ...formData, supplierPhone: e.target.value })}
                placeholder="联系电话"
                className="form-input"
              />
            </Field>
            <Field label="发票号">
              <input
                type="text"
                value={formData.invoiceNo}
                onChange={e => setFormData({ ...formData, invoiceNo: e.target.value })}
                className="form-input"
              />
            </Field>
            <Field label="状态">
              <select
                value={formData.status}
                onChange={e => setFormData({ ...formData, status: e.target.value })}
                className="form-input"
              >
                <option value="inuse">在用</option>
                <option value="idle">闲置</option>
                <option value="repairing">维修</option>
                <option value="scrapped">报废</option>
              </select>
            </Field>
            <Field label="折旧方案" required>
              <select
                value={formData.schemeId}
                onChange={e => setFormData({ ...formData, schemeId: e.target.value })}
                className="form-input"
              >
                <option value="">请选择</option>
                {schemes.map(s => (
                  <option key={s.id} value={s.id}>{s.schemeName}</option>
                ))}
              </select>
            </Field>
            <Field label="总数量">
              <input
                type="number"
                min="1"
                value={formData.totalQuantity}
                onChange={e => setFormData({ ...formData, totalQuantity: Number(e.target.value) || 1 })}
                className="form-input"
              />
            </Field>
            <Field label="已分布（自动）">
              <div className="form-input bg-gray-50 text-gray-500 cursor-not-allowed">
                {editingId ? (() => { const ca = assets.find(a => a.id === editingId); return ca?.distributedQuantity ?? 0; })() : 0}
              </div>
            </Field>
            <Field label="未分布（自动）">
              <div className="form-input bg-gray-50 text-gray-500 cursor-not-allowed">
                {editingId ? (() => { const ca = assets.find(a => a.id === editingId); return ca?.undistributedQuantity ?? (formData.totalQuantity || 1); })() : (formData.totalQuantity || 1)}
              </div>
            </Field>
            <Field label="原值（自动计算）">
              <div className="form-input bg-gray-50 text-gray-500 cursor-not-allowed">
                {editingId ? (() => { const ca = assets.find(a => a.id === editingId); return formatCurrency(ca?.originalValue); })() : '保存后自动计算'}
              </div>
            </Field>
            <Field label="累计折旧（自动计算）">
              <div className="form-input bg-gray-50 text-gray-500 cursor-not-allowed">
                {editingId ? (() => { const ca = assets.find(a => a.id === editingId); return formatCurrency(ca?.accumulatedDepreciation); })() : '保存后自动计算'}
              </div>
            </Field>
            <Field label="净值（自动计算）">
              <div className="form-input bg-gray-50 text-gray-500 cursor-not-allowed">
                {editingId ? (() => { const ca = assets.find(a => a.id === editingId); return formatCurrency(ca?.netValue); })() : '保存后自动计算'}
              </div>
            </Field>
            <div className="col-span-2">
              <Field label="备注">
                <textarea
                  value={formData.remark}
                  onChange={e => setFormData({ ...formData, remark: e.target.value })}
                  rows={2}
                  className="form-input"
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="资产图片">
                {formData.imagePath ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={formData.imagePath}
                      alt="资产图片"
                      className="w-28 h-28 object-cover rounded-lg border border-gray-200 cursor-pointer hover:opacity-80"
                      onClick={() => setPreviewImage(formData.imagePath)}
                    />
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
                    >
                      <X className="w-4 h-4" />移除图片
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => !imageUploading && assetImageInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30"
                  >
                    {imageUploading ? (
                      <div className="flex items-center justify-center gap-2 text-sm text-blue-600">
                        <Loader2 className="w-4 h-4 animate-spin" />上传中...
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400">
                        <Upload className="w-8 h-8 mx-auto mb-2" />
                        点击上传资产图片（JPG/PNG等）
                      </div>
                    )}
                  </div>
                )}
                <input
                  ref={assetImageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadImage(f); e.target.value = ''; }}
                />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {/* 图片放大预览 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <img src={previewImage} alt="资产图片预览" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
          <button className="absolute top-4 right-4 text-white p-2 rounded-full hover:bg-white/10" onClick={() => setPreviewImage(null)}>
            <X className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* 变动记录弹窗 */}
      {transferHistory && (
        <Modal title={`变动记录 - ${transferHistory.asset.assetName}（${transferHistory.asset.assetNo}）`} onClose={() => setTransferHistory(null)} wide>
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          ) : transferHistory.records.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <History className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              <p>该资产暂无变动记录</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-3 text-left">变动类型</th>
                    <th className="px-3 py-3 text-left">原部门</th>
                    <th className="px-3 py-3 text-left">新部门</th>
                    <th className="px-3 py-3 text-left">原使用人</th>
                    <th className="px-3 py-3 text-left">新使用人</th>
                    <th className="px-3 py-3 text-left">原存放地</th>
                    <th className="px-3 py-3 text-left">新存放地</th>
                    <th className="px-3 py-3 text-left">变动原因</th>
                    <th className="px-3 py-3 text-left">操作日期</th>
                    <th className="px-3 py-3 text-left">操作人</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transferHistory.records.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                          {TRANSFER_TYPE_MAP[r.transferType] || r.transferType}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{r.fromDept || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{r.toDept || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{r.fromUser || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{r.toUser || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{r.fromLocation || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{r.toLocation || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{r.reason || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{formatDate(r.operateDate)}</td>
                      <td className="px-3 py-3 text-gray-600">{r.createdByName || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ============================================================
// Tab2: 资产变动
// ============================================================
function AssetTransferTab() {
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [transfers, setTransfers] = useState<TransferLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_TRANSFER_FORM });
  const [saving, setSaving] = useState(false);
  const [distInfo, setDistInfo] = useState<{ location: string; user: string; storageAddress: string } | null>(null);
  const [modalAssetId, setModalAssetId] = useState<number | ''>('');
  const [modalDistInfo, setModalDistInfo] = useState<{ location: string; user: string; storageAddress: string } | null>(null);
  const [orgOptions, setOrgOptions] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<string[]>([]);

  const loadAssets = useCallback(async () => {
    try {
      const res = await fixedAssetApi.list();
      if (res.data.ok) {
        setAssets(res.data.data || []);
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '获取资产列表失败');
    }
  }, []);

  const loadTransfers = useCallback(async () => {
    if (!selectedAssetId) { setTransfers([]); return; }
    setLoading(true);
    try {
      const res = await fixedAssetApi.getTransfers(Number(selectedAssetId));
      if (res.data.ok) {
        setTransfers(res.data.data || []);
        const loc = res.data.currentLocation || '';
        const usr = res.data.currentUser || '';
        const addr = res.data.currentStorageAddress || '';
        setDistInfo({ location: loc, user: usr, storageAddress: addr });
      } else {
        alert(res.data.error || '获取变动记录失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误');
    }
    setLoading(false);
  }, [selectedAssetId]);

  // 弹窗内选择资产后自动拉取分布信息，填充原部门/原使用人/原存放地
  const loadModalAssetInfo = async (assetId: number) => {
    if (!assetId) { setModalDistInfo(null); return; }
    try {
      const res = await fixedAssetApi.getTransfers(assetId);
      if (res.data.ok) {
        const loc = res.data.currentLocation || '';
        const usr = res.data.currentUser || '';
        const addr = res.data.currentStorageAddress || '';
        setModalDistInfo({ location: loc, user: usr, storageAddress: addr });
        setFormData(prev => ({
          ...prev,
          fromDept: loc,
          fromUser: usr,
          fromLocation: addr,
        }));
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { loadAssets(); }, [loadAssets]);
  useEffect(() => { loadTransfers(); }, [loadTransfers]);

  // 加载组织列表和使用人列表供弹窗搜索选择
  useEffect(() => {
    (async () => {
      try {
        const res = await assetOrgApi.getLevels();
        const data = res.data?.ok ? res.data.data : [];
        const names = Array.isArray(data) ? data.map((o: any) => o.name).filter(Boolean) : [];
        setOrgOptions(names);
      } catch { /* ignore */ }
      try {
        const res = await fixedAssetApi.getAllDistributions();
        const dists = res.data?.ok ? (res.data.data || []) : [];
        const users = [...new Set(dists.map((d: any) => d.createdByName).filter(Boolean))] as string[];
        setUserOptions(users);
      } catch { /* ignore */ }
    })();
  }, []);

  const selectedAsset = assets.find(a => String(a.id) === selectedAssetId);
  const modalAsset = assets.find(a => a.id === Number(modalAssetId));

  const handleCreateTransfer = async () => {
    if (!modalAssetId) { alert('请选择资产'); return; }
    if (!formData.transferType) { alert('请选择变动类型'); return; }
    setSaving(true);
    try {
      const res = await fixedAssetApi.createTransfer(Number(modalAssetId), formData);
      if (res.data.ok) {
        alert('变动记录创建成功，台账已自动更新');
        setShowModal(false);
        setFormData({ ...EMPTY_TRANSFER_FORM });
        setModalAssetId('');
        setModalDistInfo(null);
        loadTransfers();
        loadAssets();
      } else {
        alert(res.data.error || '创建失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误，创建失败');
    }
    setSaving(false);
  };

  return (
    <div>
      {/* 资产选择栏 */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[280px]">
            <label className="block text-xs text-gray-500 mb-1">选择资产查看变动记录</label>
            <AssetSearchSelect
              assets={assets}
              value={selectedAssetId ? Number(selectedAssetId) : ''}
              onChange={(id) => setSelectedAssetId(id === '' ? '' : String(id))}
            />
          </div>
          <button
            onClick={() => {
              setFormData({ ...EMPTY_TRANSFER_FORM });
              setModalAssetId('');
              setModalDistInfo(null);
              setShowModal(true);
            }}
            className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
          >
            <Plus className="w-4 h-4" />新增变动
          </button>
        </div>

        {/* 当前资产信息 */}
        {selectedAsset && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-gray-50 rounded-lg p-4">
            <div><span className="text-gray-500">资产编号：</span><span className="font-medium text-gray-800">{selectedAsset.assetNo}</span></div>
            <div><span className="text-gray-500">资产名称：</span><span className="font-medium text-gray-800">{selectedAsset.assetName}</span></div>
            <div><span className="text-gray-500">归属部门：</span><span className="font-medium text-gray-800">{distInfo?.location || '-'}</span></div>
            <div><span className="text-gray-500">使用人：</span><span className="font-medium text-gray-800">{distInfo?.user || '-'}</span></div>
            <div><span className="text-gray-500">存放地址：</span><span className="font-medium text-gray-800">{distInfo?.storageAddress || '-'}</span></div>
            <div><span className="text-gray-500">总数量：</span><span className="font-medium text-gray-800">{selectedAsset.totalQuantity ?? 1}</span></div>
            <div>
              <span className="text-gray-500">当前状态：</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${(STATUS_MAP[selectedAsset.status] || STATUS_MAP.inuse).color}`}>
                {(STATUS_MAP[selectedAsset.status] || STATUS_MAP.inuse).label}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 变动记录表 */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="ml-2 text-gray-500">加载中...</span>
          </div>
        ) : !selectedAssetId ? (
          <div className="py-16 text-center text-gray-400">
            <ArrowLeftRight className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>请先选择资产查看变动记录</p>
          </div>
        ) : transfers.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <History className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>该资产暂无变动记录</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-3 text-left">变动类型</th>
                  <th className="px-3 py-3 text-left">原部门</th>
                  <th className="px-3 py-3 text-left">新部门</th>
                  <th className="px-3 py-3 text-left">原使用人</th>
                  <th className="px-3 py-3 text-left">新使用人</th>
                  <th className="px-3 py-3 text-left">原存放地</th>
                  <th className="px-3 py-3 text-left">新存放地</th>
                  <th className="px-3 py-3 text-left">变动原因</th>
                  <th className="px-3 py-3 text-left">操作日期</th>
                  <th className="px-3 py-3 text-left">操作人</th>
                  <th className="px-3 py-3 text-left">创建时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transfers.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                        {TRANSFER_TYPE_MAP[r.transferType] || r.transferType}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-gray-600">{r.fromDept || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{r.toDept || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{r.fromUser || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{r.toUser || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{r.fromLocation || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{r.toLocation || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{r.reason || '-'}</td>
                    <td className="px-3 py-3 text-gray-600">{formatDate(r.operateDate)}</td>
                    <td className="px-3 py-3 text-gray-600">{r.createdByName || '-'}</td>
                    <td className="px-3 py-3 text-gray-500">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新增变动弹窗 */}
      {showModal && (
        <Modal title={modalAsset ? `新增变动 - ${modalAsset.assetName}` : '新增变动'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <Field label="选择资产" required>
              <AssetSearchSelect
                assets={assets}
                value={modalAssetId}
                onChange={(id) => { setModalAssetId(id); if (id) loadModalAssetInfo(id); }}
              />
            </Field>
            {modalDistInfo && (
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700 flex flex-wrap gap-4">
                <span>原部门：{modalDistInfo.location || '-'}</span>
                <span>原使用人：{modalDistInfo.user || '-'}</span>
                <span>原存放地：{modalDistInfo.storageAddress || '-'}</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Field label="变动类型" required>
              <select
                value={formData.transferType}
                onChange={e => setFormData({ ...formData, transferType: e.target.value })}
                className="form-input"
              >
                <option value="transfer">调拨</option>
                <option value="assign">领用</option>
                <option value="return">归还</option>
                <option value="repair">维修</option>
                <option value="lend">租借</option>
                <option value="stop">停用</option>
                <option value="resume">启用</option>
                <option value="companyToStore">公司转店</option>
                <option value="storeToCompany">店退公司</option>
              </select>
            </Field>
            <Field label="操作日期">
              <input
                type="date"
                value={formData.operateDate}
                onChange={e => setFormData({ ...formData, operateDate: e.target.value })}
                className="form-input"
              />
            </Field>
            <Field label="原部门">
              <SearchableSelect
                options={orgOptions}
                value={formData.fromDept}
                onChange={(v) => setFormData({ ...formData, fromDept: v })}
                placeholder="-- 搜索选择原部门 --"
              />
            </Field>
            <Field label="新部门">
              <SearchableSelect
                options={orgOptions}
                value={formData.toDept}
                onChange={(v) => setFormData({ ...formData, toDept: v })}
                placeholder="-- 搜索选择新部门 --"
              />
            </Field>
            <Field label="原使用人">
              <SearchableSelect
                options={userOptions}
                value={formData.fromUser}
                onChange={(v) => setFormData({ ...formData, fromUser: v })}
                placeholder="-- 搜索选择原使用人 --"
              />
            </Field>
            <Field label="新使用人">
              <SearchableSelect
                options={userOptions}
                value={formData.toUser}
                onChange={(v) => setFormData({ ...formData, toUser: v })}
                placeholder="-- 搜索选择新使用人 --"
              />
            </Field>
            <Field label="原存放地">
              <input
                type="text"
                value={formData.fromLocation}
                onChange={e => setFormData({ ...formData, fromLocation: e.target.value })}
                className="form-input"
              />
            </Field>
            <Field label="新存放地">
              <input
                type="text"
                value={formData.toLocation}
                onChange={e => setFormData({ ...formData, toLocation: e.target.value })}
                className="form-input"
              />
            </Field>
            <div className="col-span-2">
              <Field label="变动原因">
                <textarea
                  value={formData.reason}
                  onChange={e => setFormData({ ...formData, reason: e.target.value })}
                  rows={3}
                  className="form-input"
                  placeholder="请说明变动原因"
                />
              </Field>
            </div>
          </div>
          <div className="mt-2 p-3 bg-blue-50 rounded-lg text-xs text-blue-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>提交后系统将自动更新资产台账（状态/位置/部门/使用人）。</span>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
              取消
            </button>
            <button
              onClick={handleCreateTransfer}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? '提交中...' : '提交变动'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================
// Tab3: 盘点管理
// ============================================================
function InventoryTab() {
  const [tasks, setTasks] = useState<InventoryTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_INVENTORY_FORM });
  const [creating, setCreating] = useState(false);
  const [selectedTask, setSelectedTask] = useState<InventoryTask | null>(null);
  const [details, setDetails] = useState<InventoryDetail[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.list();
      if (res.data.ok) {
        setTasks(res.data.data || []);
      }
    } catch { /* 无盘点任务时静默 */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const handleCreate = async () => {
    if (!createForm.taskName.trim()) { alert('请输入任务名称'); return; }
    setCreating(true);
    try {
      const res = await inventoryApi.create(createForm);
      if (res.data.ok) {
        alert('盘点任务创建成功，已自动生成盘点明细');
        setShowCreateModal(false);
        setCreateForm({ ...EMPTY_INVENTORY_FORM });
        loadTasks();
      } else {
        alert(res.data.error || '创建失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误，创建失败');
    }
    setCreating(false);
  };

  const handleSelectTask = async (task: InventoryTask) => {
    setSelectedTask(task);
    setDetailsLoading(true);
    try {
      const res = await inventoryApi.getDetails(task.id);
      if (res.data.ok) {
        setDetails(res.data.data || []);
      } else {
        alert(res.data.error || '获取盘点明细失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误');
    }
    setDetailsLoading(false);
  };

  const handleDetailChange = (idx: number, field: string, value: string) => {
    setDetails(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleSubmitDetails = async () => {
    if (!selectedTask) return;
    if (details.length === 0) { alert('没有可提交的盘点明细'); return; }
    setSubmitting(true);
    try {
      const items = details.map(d => ({
        id: d.id,
        actualLocation: d.actualLocation || '',
        actualUser: d.actualUser || '',
        result: d.result || 'normal',
        remark: d.remark || '',
      }));
      const res = await inventoryApi.submitDetails(selectedTask.id, items);
      if (res.data.ok) {
        alert('盘点结果提交成功');
        handleSelectTask(selectedTask);
        loadTasks();
      } else {
        alert(res.data.error || '提交失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误，提交失败');
    }
    setSubmitting(false);
  };

  const taskStatusMap: Record<string, { label: string; color: string }> = {
    inprogress: { label: '进行中', color: 'text-amber-600 bg-amber-50' },
    completed: { label: '已完成', color: 'text-green-600 bg-green-50' },
  };

  if (selectedTask) {
    return (
      <div>
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedTask(null)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
            >
              <X className="w-4 h-4" />返回列表
            </button>
            <span className="font-medium text-gray-800">{selectedTask.taskName}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${(taskStatusMap[selectedTask.status] || taskStatusMap.inprogress).color}`}>
              {(taskStatusMap[selectedTask.status] || taskStatusMap.inprogress).label}
            </span>
          </div>
          <button
            onClick={handleSubmitDetails}
            disabled={submitting || selectedTask.status === 'completed'}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {submitting ? '提交中...' : '提交盘点'}
          </button>
        </div>

        {detailsLoading ? (
          <div className="flex items-center justify-center py-16 bg-white rounded-lg shadow-sm">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="ml-2 text-gray-500">加载中...</span>
          </div>
        ) : details.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm py-16 text-center text-gray-400">
            <ClipboardCheck className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>该任务暂无盘点明细</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-3 text-left">资产编号</th>
                    <th className="px-3 py-3 text-left">资产名称</th>
                    <th className="px-3 py-3 text-left">账面存放地</th>
                    <th className="px-3 py-3 text-left">实际存放地</th>
                    <th className="px-3 py-3 text-left">账面使用人</th>
                    <th className="px-3 py-3 text-left">实际使用人</th>
                    <th className="px-3 py-3 text-left">盘点结果</th>
                    <th className="px-3 py-3 text-left">备注</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {details.map((d, idx) => {
                    const rs = INVENTORY_RESULT_MAP[d.result] || INVENTORY_RESULT_MAP.normal;
                    return (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-3 py-3 font-mono text-xs text-gray-600">{d.assetNo || '-'}</td>
                        <td className="px-3 py-3 font-medium text-gray-800">{d.assetName || '-'}</td>
                        <td className="px-3 py-3 text-gray-600">{d.bookLocation || '-'}</td>
                        <td className="px-3 py-3">
                          <input
                            type="text"
                            value={d.actualLocation || ''}
                            onChange={e => handleDetailChange(idx, 'actualLocation', e.target.value)}
                            disabled={selectedTask.status === 'completed'}
                            className="w-32 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
                          />
                        </td>
                        <td className="px-3 py-3 text-gray-600">{d.bookUser || '-'}</td>
                        <td className="px-3 py-3">
                          <input
                            type="text"
                            value={d.actualUser || ''}
                            onChange={e => handleDetailChange(idx, 'actualUser', e.target.value)}
                            disabled={selectedTask.status === 'completed'}
                            className="w-28 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <select
                            value={d.result || 'normal'}
                            onChange={e => handleDetailChange(idx, 'result', e.target.value)}
                            disabled={selectedTask.status === 'completed'}
                            className={`px-2 py-1 rounded text-xs border-0 ${rs.color} disabled:opacity-70`}
                          >
                            <option value="normal">正常</option>
                            <option value="surplus">盘盈</option>
                            <option value="shortage">盘亏</option>
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="text"
                            value={d.remark || ''}
                            onChange={e => handleDetailChange(idx, 'remark', e.target.value)}
                            disabled={selectedTask.status === 'completed'}
                            className="w-32 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-800">盘点任务列表</h3>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
        >
          <Plus className="w-4 h-4" />创建盘点任务
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="ml-2 text-gray-500">加载中...</span>
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <ClipboardCheck className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>暂无盘点任务</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-3 text-left">任务名称</th>
                  <th className="px-3 py-3 text-left">盘点范围</th>
                  <th className="px-3 py-3 text-left">状态</th>
                  <th className="px-3 py-3 text-left">开始日期</th>
                  <th className="px-3 py-3 text-left">结束日期</th>
                  <th className="px-3 py-3 text-left">创建人</th>
                  <th className="px-3 py-3 text-left">创建时间</th>
                  <th className="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tasks.map(t => {
                  const st = taskStatusMap[t.status] || taskStatusMap.inprogress;
                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 font-medium text-gray-800">{t.taskName}</td>
                      <td className="px-3 py-3 text-gray-600">{t.taskScope || '全部在用资产'}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{formatDate(t.startDate)}</td>
                      <td className="px-3 py-3 text-gray-600">{formatDate(t.endDate)}</td>
                      <td className="px-3 py-3 text-gray-600">{t.createdByName || '-'}</td>
                      <td className="px-3 py-3 text-gray-500">{formatDateTime(t.createdAt)}</td>
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => handleSelectTask(t)}
                          className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 mx-auto"
                        >
                          <Eye className="w-3 h-3" />查看明细
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 创建盘点任务弹窗 */}
      {showCreateModal && (
        <Modal title="创建盘点任务" onClose={() => setShowCreateModal(false)}>
          <div className="space-y-4">
            <Field label="任务名称" required>
              <input
                type="text"
                value={createForm.taskName}
                onChange={e => setCreateForm({ ...createForm, taskName: e.target.value })}
                placeholder="如：2024年第三季度固定资产盘点"
                className="form-input"
              />
            </Field>
            <Field label="盘点范围">
              <textarea
                value={createForm.taskScope}
                onChange={e => setCreateForm({ ...createForm, taskScope: e.target.value })}
                rows={2}
                className="form-input"
                placeholder="如：全部在用资产 / 某部门资产"
              />
            </Field>
          </div>
          <div className="mt-2 p-3 bg-blue-50 rounded-lg text-xs text-blue-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>创建后系统将自动拉取当前在用资产生成盘点明细行。</span>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
            <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {creating ? '创建中...' : '创建任务'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================
// Tab4: 报废处置
// ============================================================
function DisposalTab() {
  const [disposals, setDisposals] = useState<DisposalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [formData, setFormData] = useState({ ...EMPTY_DISPOSAL_FORM });
  const [saving, setSaving] = useState(false);
  const [approveTarget, setApproveTarget] = useState<DisposalRecord | null>(null);
  const [approveRemark, setApproveRemark] = useState('');
  const [approving, setApproving] = useState(false);
  const [assetLocs, setAssetLocs] = useState<any[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const [locInfo, setLocInfo] = useState<{ totalQuantity: number; scrappedQuantity: number; remaining: number } | null>(null);
  const [locFilter, setLocFilter] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await disposalApi.list();
      if (res.data.ok) {
        setDisposals(res.data.data || []);
      } else {
        alert(res.data.error || '获取报废列表失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const loadAssetsForSelect = async () => {
    try {
      const res = await fixedAssetApi.list();
      if (res.data.ok) {
        setAssets(res.data.data || []);
      }
    } catch { /* ignore */ }
  };

  // 选择资产后自动拉取该资产的分布地点列表和可报废数量
  const loadAssetLocations = async (assetId: number) => {
    if (!assetId) { setAssetLocs([]); setLocInfo(null); return; }
    setLocLoading(true);
    try {
      const res = await disposalApi.getAssetLocations(assetId);
      if (res.data.ok) {
        setAssetLocs(res.data.data?.locations || []);
        setLocInfo({
          totalQuantity: res.data.data?.totalQuantity ?? 1,
          scrappedQuantity: res.data.data?.scrappedQuantity ?? 0,
          remaining: res.data.data?.remaining ?? 1,
        });
      }
    } catch { /* ignore */ }
    setLocLoading(false);
  };

  const handleAdd = () => {
    setFormData({ ...EMPTY_DISPOSAL_FORM });
    setAssetLocs([]);
    setLocInfo(null);
    setLocFilter('');
    loadAssetsForSelect();
    setShowModal(true);
  };

  const handleAssetChange = (assetId: string) => {
    setFormData({ ...formData, assetId, distLocation: '' });
    if (assetId) {
      loadAssetLocations(parseInt(assetId));
    } else {
      setAssetLocs([]);
      setLocInfo(null);
    }
  };

  const filteredLocs = assetLocs.filter(l =>
    !locFilter || (l.location || '').toLowerCase().includes(locFilter.toLowerCase())
  );

  const handleSave = async () => {
    if (!formData.assetId) { alert('请选择资产'); return; }
    if (!formData.disposalReason.trim()) { alert('请填写报废原因'); return; }
    if (!formData.scrapQuantity || Number(formData.scrapQuantity) < 1) { alert('请填写报废数量'); return; }
    if (locInfo && Number(formData.scrapQuantity) > locInfo.remaining) {
      alert(`报废数量(${formData.scrapQuantity})超过可报废数量（剩余${locInfo.remaining}个）`);
      return;
    }
    setSaving(true);
    try {
      const res = await disposalApi.create({
        ...formData,
        assetId: Number(formData.assetId),
        residualValue: formData.residualValue ? Number(formData.residualValue) : 0,
        scrapQuantity: Number(formData.scrapQuantity),
        distLocation: formData.distLocation,
      });
      if (res.data.ok) {
        alert('报废申请提交成功');
        setShowModal(false);
        loadData();
      } else {
        alert(res.data.error || '提交失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误，提交失败');
    }
    setSaving(false);
  };

  const handleApprove = async (approved: boolean) => {
    if (!approveTarget) return;
    if (!approved && !approveRemark.trim()) { alert('驳回请填写审批意见'); return; }
    setApproving(true);
    try {
      const res = await disposalApi.approve(approveTarget.id, approved, approveRemark);
      if (res.data.ok) {
        alert(approved ? '审批通过，资产已标记为报废' : '已驳回报废申请');
        setApproveTarget(null);
        setApproveRemark('');
        loadData();
      } else {
        alert(res.data.error || '审批失败');
      }
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '网络错误');
    }
    setApproving(false);
  };

  return (
    <div>
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-800">报废处置申请列表</h3>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
        >
          <Plus className="w-4 h-4" />新增报废申请
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="ml-2 text-gray-500">加载中...</span>
          </div>
        ) : disposals.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <TrendingDown className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>暂无报废处置记录</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-3 text-left">资产编号</th>
                  <th className="px-3 py-3 text-left">资产名称</th>
                  <th className="px-3 py-3 text-left">规格型号</th>
                  <th className="px-3 py-3 text-center">报废数量</th>
                  <th className="px-3 py-3 text-left">分布地址</th>
                  <th className="px-3 py-3 text-left">报废原因</th>
                  <th className="px-3 py-3 text-left">报废日期</th>
                  <th className="px-3 py-3 text-right">残值</th>
                  <th className="px-3 py-3 text-left">处置方式</th>
                  <th className="px-3 py-3 text-left">状态</th>
                  <th className="px-3 py-3 text-left">申请人</th>
                  <th className="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {disposals.map(d => {
                  const st = DISPOSAL_STATUS_MAP[d.status] || DISPOSAL_STATUS_MAP.pending;
                  return (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 font-mono text-xs text-gray-600">{d.assetNo || '-'}</td>
                      <td className="px-3 py-3 font-medium text-gray-800">{d.assetName || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{d.specModel || '-'}</td>
                      <td className="px-3 py-3 text-center font-medium text-red-600">{d.scrapQuantity ?? 1}</td>
                      <td className="px-3 py-3 text-gray-600">{d.distLocation || '-'}</td>
                      <td className="px-3 py-3 text-gray-600 max-w-[200px] truncate" title={d.disposalReason}>{d.disposalReason || '-'}</td>
                      <td className="px-3 py-3 text-gray-600">{formatDate(d.disposalDate)}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{formatCurrency(d.residualValue)}</td>
                      <td className="px-3 py-3 text-gray-600">{d.disposalMethod || '-'}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{d.createdByName || '-'}</td>
                      <td className="px-3 py-3 text-center">
                        {d.status === 'pending' ? (
                          <button
                            onClick={() => { setApproveTarget(d); setApproveRemark(''); }}
                            className="flex items-center gap-1 px-3 py-1 text-xs bg-amber-50 text-amber-700 rounded hover:bg-amber-100 mx-auto"
                          >
                            <ClipboardCheck className="w-3 h-3" />审批
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">已处理</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新增报废申请弹窗 */}
      {showModal && (
        <Modal title="新增报废申请" onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <Field label="选择资产" required>
              <AssetSearchSelect
                assets={assets.filter(a => a.status !== 'scrapped')}
                value={formData.assetId ? Number(formData.assetId) : ''}
                onChange={(id) => handleAssetChange(id === '' ? '' : String(id))}
              />
            </Field>

            {/* 可报废数量提示 */}
            {locInfo && (
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700 flex flex-wrap gap-4">
                <span>资产总数量：{locInfo.totalQuantity}</span>
                <span>已申请报废：{locInfo.scrappedQuantity}</span>
                <span className="font-bold">可报废剩余：{locInfo.remaining}</span>
              </div>
            )}

            {/* 报废数量 */}
            <Field label="报废数量" required>
              <input
                type="number"
                min="1"
                max={locInfo?.remaining || 999}
                value={formData.scrapQuantity}
                onChange={e => setFormData({ ...formData, scrapQuantity: Number(e.target.value) || 1 })}
                className="form-input"
              />
            </Field>

            {/* 分布地址（可筛选选择） */}
            <Field label="分布地址（可筛选）">
              {locLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载分布地点...
                </div>
              ) : assetLocs.length === 0 ? (
                <div className="text-sm text-gray-400">该资产暂无分布记录，可不选</div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="输入关键词筛选分布地点..."
                    value={locFilter}
                    onChange={e => setLocFilter(e.target.value)}
                    className="form-input"
                  />
                  <select
                    value={formData.distLocation}
                    onChange={e => setFormData({ ...formData, distLocation: e.target.value })}
                    className="form-input"
                  >
                    <option value="">不指定（直接报废）</option>
                    {filteredLocs.map(l => (
                      <option key={l.id} value={l.location}>
                        {l.location}（可分布 {l.quantity} 个）{l.remark ? ` - ${l.remark}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </Field>

            <Field label="报废原因" required>
              <textarea
                value={formData.disposalReason}
                onChange={e => setFormData({ ...formData, disposalReason: e.target.value })}
                rows={3}
                className="form-input"
                placeholder="请详细说明报废原因"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="报废日期">
                <input
                  type="date"
                  value={formData.disposalDate}
                  onChange={e => setFormData({ ...formData, disposalDate: e.target.value })}
                  className="form-input"
                />
              </Field>
              <Field label="残值">
                <input
                  type="number"
                  step="0.01"
                  value={formData.residualValue}
                  onChange={e => setFormData({ ...formData, residualValue: e.target.value })}
                  className="form-input"
                />
              </Field>
            </div>
            <Field label="处置方式">
              <select
                value={formData.disposalMethod}
                onChange={e => setFormData({ ...formData, disposalMethod: e.target.value })}
                className="form-input"
              >
                <option value="报废">报废</option>
                <option value="出售">出售</option>
                <option value="捐赠">捐赠</option>
                <option value="拆解回收">拆解回收</option>
                <option value="其他">其他</option>
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? '提交中...' : '提交申请'}
            </button>
          </div>
        </Modal>
      )}

      {/* 审批弹窗 */}
      {approveTarget && (
        <Modal title="报废审批" onClose={() => setApproveTarget(null)}>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <div><span className="text-gray-500">资产编号：</span><span className="font-medium text-gray-800">{approveTarget.assetNo}</span></div>
              <div><span className="text-gray-500">资产名称：</span><span className="font-medium text-gray-800">{approveTarget.assetName}</span></div>
              <div><span className="text-gray-500">规格型号：</span><span className="text-gray-800">{approveTarget.specModel || '-'}</span></div>
              <div><span className="text-gray-500">报废数量：</span><span className="font-bold text-red-600">{approveTarget.scrapQuantity ?? 1}</span></div>
              <div><span className="text-gray-500">分布地址：</span><span className="text-gray-800">{approveTarget.distLocation || '-'}</span></div>
              <div><span className="text-gray-500">报废原因：</span><span className="text-gray-800">{approveTarget.disposalReason}</span></div>
              <div><span className="text-gray-500">残值：</span><span className="font-medium text-blue-600">{formatCurrency(approveTarget.residualValue)}</span></div>
              <div><span className="text-gray-500">处置方式：</span><span className="text-gray-800">{approveTarget.disposalMethod}</span></div>
              <div><span className="text-gray-500">申请人：</span><span className="text-gray-800">{approveTarget.createdByName}</span></div>
            </div>
            <Field label="审批意见">
              <textarea
                value={approveRemark}
                onChange={e => setApproveRemark(e.target.value)}
                rows={3}
                className="form-input"
                placeholder="审批意见（驳回时必填）"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
            <button
              onClick={() => handleApprove(false)}
              disabled={approving}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
            >
              {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              驳回
            </button>
            <button
              onClick={() => handleApprove(true)}
              disabled={approving}
              className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              通过
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================
// Tab5: 台账导出
// ============================================================
function ExportTab() {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fixedAssetApi.export();
      const blob = new Blob([res.data as unknown as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `固定资产台账_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (e: any) {
      alert(e.response?.data?.error || e.message || '导出失败');
    }
    setExporting(false);
  };

  return (
    <div>
      <div className="bg-white rounded-lg shadow-sm p-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-50 rounded-full mb-4">
            <Boxes className="w-10 h-10 text-blue-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-800 mb-2">固定资产台账导出</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            导出全部固定资产档案数据为 Excel 文件，包含资产编号、名称、规格、价值、折旧、状态等完整信息。
          </p>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-base font-medium disabled:opacity-50"
          >
            {exporting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>导出中...</span>
              </>
            ) : exported ? (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>导出成功</span>
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                <span>导出台账</span>
              </>
            )}
          </button>
        </div>

        {/* 导出字段说明 */}
        <div className="mt-8 border-t pt-6">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">导出字段说明</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs text-gray-600">
            {[
              '资产编号', '资产名称', '资产类别', '资产所属', '规格型号',
              '购置日期', '购置价格', '供应商', '发票号',
              '存放地点', '使用部门', '使用人', '状态',
              '折旧方法', '原值', '累计折旧', '净值',
              '备注', '创建时间', '更新时间',
            ].map(field => (
              <div key={field} className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                <span>{field}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 通用组件
// ============================================================
function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div
        className={`bg-white rounded-lg shadow-xl max-h-[90vh] overflow-y-auto ${wide ? 'max-w-5xl' : 'max-w-2xl'} w-full`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h3 className="text-lg font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

// ============================================================
// Tab2: 统计概览（各类资产总数量 + 按部门/用户筛选分配个数）
// ============================================================
function StatisticsTab() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [filterDept, setFilterDept] = useState('');
  const [filterUser, setFilterUser] = useState('');

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (filterDept) params.department = filterDept;
      if (filterUser) params.userName = filterUser;
      const res = await fixedAssetApi.getStatistics(params);
      if (res.data.ok) setStats(res.data.data);
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
    setLoading(false);
  }, [filterDept, filterUser]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const summary = stats?.summary || {};
  const byCategory = stats?.byCategory || [];
  const byDepartment = stats?.byDepartment || [];
  const byUser = stats?.byUser || [];

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">按存放地点筛选</label>
            <input className="form-input w-48" placeholder="输入存放地点" value={filterDept} onChange={e => setFilterDept(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">按操作人筛选</label>
            <input className="form-input w-48" placeholder="输入操作人姓名" value={filterUser} onChange={e => setFilterUser(e.target.value)} />
          </div>
          <button onClick={() => { setFilterDept(''); setFilterUser(''); }} className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">重置</button>
          <button onClick={loadStats} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1">
            <Search className="w-4 h-4" /> 查询
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
      ) : stats ? (
        <>
          {/* 总览卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="text-sm text-gray-500">资产总数</div>
              <div className="text-2xl font-bold text-blue-600 mt-1">{summary.totalAssets || 0}</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="text-sm text-gray-500">原值合计</div>
              <div className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(summary.totalValue)}</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="text-sm text-gray-500">净值合计</div>
              <div className="text-2xl font-bold text-purple-600 mt-1">{formatCurrency(summary.totalNet)}</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="text-sm text-gray-500">累计折旧</div>
              <div className="text-2xl font-bold text-orange-600 mt-1">{formatCurrency(summary.totalDep)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="text-sm text-gray-500">分类数</div>
              <div className="text-xl font-semibold text-gray-700 mt-1">{summary.categoryCount || 0}</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="text-sm text-gray-500">涉及存放地点</div>
              <div className="text-xl font-semibold text-gray-700 mt-1">{summary.deptCount || 0}</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="text-sm text-gray-500">涉及操作人</div>
              <div className="text-xl font-semibold text-gray-700 mt-1">{summary.userCount || 0}</div>
            </div>
          </div>

          {/* 按分类汇总 */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Boxes className="w-4 h-4 text-blue-500" /> 各类资产数量汇总
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="text-left py-2 px-3">分类</th>
                    <th className="text-right py-2 px-3">数量</th>
                    <th className="text-right py-2 px-3">原值合计</th>
                    <th className="text-right py-2 px-3">累计折旧</th>
                    <th className="text-right py-2 px-3">净值合计</th>
                  </tr>
                </thead>
                <tbody>
                  {byCategory.map((c: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 px-3 font-medium text-gray-700">{c.category}</td>
                      <td className="text-right py-2 px-3">{c.totalCount}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(c.totalOriginalValue)}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(c.totalAccumulatedDep)}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(c.totalNetValue)}</td>
                    </tr>
                  ))}
                  {byCategory.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-6 text-gray-400">暂无数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 按部门 + 按使用人 并排 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Package className="w-4 h-4 text-green-500" /> 按存放地点分配
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="text-left py-2 px-3">存放地点</th>
                    <th className="text-left py-2 px-3">资产名称</th>
                    <th className="text-left py-2 px-3">资产类别</th>
                    <th className="text-left py-2 px-3">资产所属</th>
                    <th className="text-right py-2 px-3">数量</th>
                    <th className="text-right py-2 px-3">原值合计</th>
                  </tr>
                </thead>
                <tbody>
                  {byDepartment.map((d: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 align-top">
                      <td className="py-2 px-3 text-gray-700">{d.department}</td>
                      <td className="py-2 px-3 text-gray-700">{d.assetName || '-'}</td>
                      <td className="py-2 px-3 text-gray-700">{d.category || '-'}</td>
                      <td className="py-2 px-3 text-gray-700">{d.assetOwnership || '-'}</td>
                      <td className="text-right py-2 px-3 font-medium">{d.count}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(d.totalValue)}</td>
                    </tr>
                  ))}
                  {byDepartment.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-6 text-gray-400">暂无数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Package className="w-4 h-4 text-purple-500" /> 按操作人分配
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="text-left py-2 px-3">操作人</th>
                    <th className="text-left py-2 px-3">资产名称</th>
                    <th className="text-left py-2 px-3">资产类别</th>
                    <th className="text-left py-2 px-3">资产所属</th>
                    <th className="text-right py-2 px-3">数量</th>
                    <th className="text-right py-2 px-3">原值合计</th>
                  </tr>
                </thead>
                <tbody>
                  {byUser.map((u: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 align-top">
                      <td className="py-2 px-3 text-gray-700">{u.userName}</td>
                      <td className="py-2 px-3 text-gray-700">{u.assetName || '-'}</td>
                      <td className="py-2 px-3 text-gray-700">{u.category || '-'}</td>
                      <td className="py-2 px-3 text-gray-700">{u.assetOwnership || '-'}</td>
                      <td className="text-right py-2 px-3 font-medium">{u.count}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(u.totalValue)}</td>
                    </tr>
                  ))}
                  {byUser.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-6 text-gray-400">暂无数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-12 text-gray-400">暂无数据</div>
      )}
    </div>
  );
}

// ============================================================
// 可搜索资产下拉选择组件
// ============================================================
function AssetSearchSelect({ assets, value, onChange }: {
  assets: FixedAsset[];
  value: number | '';
  onChange: (id: number | '') => void;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = assets.find(a => a.id === Number(value));
  const displayText = selected ? `${selected.assetNo} - ${selected.assetName} (${selected.category})` : '';
  const filtered = kw
    ? assets.filter(a =>
        a.assetNo?.toLowerCase().includes(kw.toLowerCase()) ||
        a.assetName?.toLowerCase().includes(kw.toLowerCase()) ||
        a.category?.toLowerCase().includes(kw.toLowerCase())
      )
    : assets;

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          className="form-input w-full pl-10 pr-3"
          placeholder="-- 搜索并选择资产 --"
          value={open ? kw : displayText}
          onChange={e => { setKw(e.target.value); setOpen(true); }}
          onClick={() => { setOpen(true); setKw(''); }}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto border border-gray-200 rounded-lg bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">无匹配资产</div>
          ) : filtered.map(a => (
            <div
              key={a.id}
              className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 ${a.id === Number(value) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
              onClick={() => { onChange(a.id); setOpen(false); setKw(''); }}
            >
              {a.assetNo} - {a.assetName} ({a.category})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 可搜索通用下拉选择组件（用于部门、使用人等文本选项）
// ============================================================
function SearchableSelect({ options, value, onChange, placeholder }: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayText = value || '';
  const filtered = kw
    ? options.filter(o => o.toLowerCase().includes(kw.toLowerCase()))
    : options;

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          className="form-input w-full pl-10 pr-3"
          placeholder={placeholder || '-- 搜索并选择 --'}
          value={open ? kw : displayText}
          onChange={e => { setKw(e.target.value); setOpen(true); }}
          onClick={() => { setOpen(true); setKw(''); }}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto border border-gray-200 rounded-lg bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">无匹配项</div>
          ) : filtered.map((o, i) => (
            <div
              key={i}
              className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 ${o === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
              onClick={() => { onChange(o); setOpen(false); setKw(''); }}
            >
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Tab3: 资产分布（同一资产多地点分布管理）
// ============================================================
function DistributionTab() {
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [allDistributions, setAllDistributions] = useState<any[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<number | ''>('');
  const [distributions, setDistributions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingDist, setEditingDist] = useState<any>({ assetId: '', location: '', storageAddress: '', createdByName: '', quantity: 1, remark: '' });
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterUserName, setFilterUserName] = useState('');
  const [orgList, setOrgList] = useState<any[]>([]);
  const [orgLevel1, setOrgLevel1] = useState<number | ''>('');
  const [orgLevel2, setOrgLevel2] = useState<number | ''>('');

  // Extract the data payload from the API response
  const unwrap = (res: any): any => {
    const body = res?.data ?? res;
    if (!body) throw new Error('响应为空');
    if (body.ok === false) throw new Error(body.error || '操作失败');
    return body.data;
  };

  const loadAssets = useCallback(async () => {
    try {
      const res = await fixedAssetApi.list({ status: 'inuse' });
      if (res.data.ok) setAssets(res.data.data || []);
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
  }, []);

  const loadAllDistributions = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filterKeyword) params.keyword = filterKeyword;
      if (filterLocation) params.location = filterLocation;
      if (filterUserName) params.userName = filterUserName;
      const res = await fixedAssetApi.getAllDistributions(params);
      if (res.data.ok) setAllDistributions(res.data.data || []);
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
    setLoading(false);
  }, [filterKeyword, filterLocation, filterUserName]);

  const loadDistributions = useCallback(async () => {
    if (!selectedAssetId) { setDistributions([]); return; }
    setLoading(true);
    try {
      const res = await fixedAssetApi.getDistributions(selectedAssetId as number);
      if (res.data.ok) setDistributions(res.data.data || []);
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
    setLoading(false);
  }, [selectedAssetId]);

  useEffect(() => { loadAssets(); }, [loadAssets]);
  useEffect(() => { loadAllDistributions(); }, [loadAllDistributions]);
  useEffect(() => { loadDistributions(); }, [loadDistributions]);

  // Load org levels for cascading dropdown
  useEffect(() => {
    (async () => {
      try {
        const data = unwrap(await assetOrgApi.getLevels());
        setOrgList(Array.isArray(data) ? data : []);
      } catch { /* silently ignore */ }
    })();
  }, []);

  const selectedAsset = assets.find(a => a.id === selectedAssetId);
  const assetTotalQty = selectedAsset?.totalQuantity ?? 1;
  const distQty = distributions.reduce((s, d) => s + (d.quantity || 0), 0);
  const undistQty = Math.max(0, assetTotalQty - distQty);

  const allDistTotal = allDistributions.reduce((s, d) => s + (d.quantity || 0), 0);

  const handleSave = async () => {
    const distAssetId = editingDist.assetId || selectedAssetId;
    if (!distAssetId) { alert('请选择资产'); return; }
    if (!editingDist.location?.trim()) { alert('请选择归属组织'); return; }
    const targetAsset = assets.find(a => a.id === Number(distAssetId));
    const targetTotalQty = targetAsset?.totalQuantity ?? 1;

    // 计算该资产现有分布总量
    let existingDistQty = 0;
    if (distAssetId === selectedAssetId) {
      existingDistQty = distQty;
    } else {
      try {
        const res = await fixedAssetApi.getDistributions(distAssetId as number);
        if (res.data.ok) {
          existingDistQty = (res.data.data || []).reduce((s: number, d: any) => s + (d.quantity || 0), 0);
        }
      } catch { /* ignore */ }
    }

    if (editingDist.id) {
      const oldItem = (distAssetId === selectedAssetId ? distributions : []).find(d => d.id === editingDist.id);
      const oldQty = oldItem?.quantity || 0;
      const newTotal = existingDistQty - oldQty + (editingDist.quantity || 0);
      if (newTotal > targetTotalQty) {
        alert(`分布总量(${newTotal})超过资产总数量(${targetTotalQty})，当前可分配剩余：${Math.max(0, targetTotalQty - existingDistQty) + oldQty}`);
        return;
      }
    } else {
      const newTotal = existingDistQty + (editingDist.quantity || 0);
      if (newTotal > targetTotalQty) {
        alert(`分布总量(${newTotal})超过资产总数量(${targetTotalQty})，当前可分配剩余：${Math.max(0, targetTotalQty - existingDistQty)}`);
        return;
      }
    }
    try {
      const items = [{ ...editingDist, id: editingDist.id || undefined, assetId: distAssetId }];
      await fixedAssetApi.saveDistributions(distAssetId as number, items);
      setShowModal(false);
      setEditingDist({ assetId: '', location: '', storageAddress: '', createdByName: '', quantity: 1, remark: '' });
      setOrgLevel1(''); setOrgLevel2('');
      loadDistributions();
      loadAssets();
      loadAllDistributions();
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
  };

  const handleDelete = async (distId: number) => {
    if (!confirm('确认删除该分布记录？')) return;
    try {
      await fixedAssetApi.removeDistribution(distId);
      loadDistributions();
      loadAssets();
      loadAllDistributions();
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
  };

  return (
    <div>
      {/* 统一分布管理面板 */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        {/* 顶部操作栏：选择资产 + 搜索 + 查询 + 新增分布（始终全部显示） */}
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">选择资产</label>
            <select
              className="form-input w-full"
              value={selectedAssetId}
              onChange={e => setSelectedAssetId(e.target.value ? parseInt(e.target.value) : '')}
            >
              <option value="">-- 全部资产分布 --</option>
              {assets.map(a => (
                <option key={a.id} value={a.id}>{a.assetNo} - {a.assetName} ({a.category})</option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px]">
            <label className="block text-xs text-gray-500 mb-1">资产关键词</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="资产编号/名称"
                value={filterKeyword}
                onChange={e => setFilterKeyword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadAllDistributions(); }}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">存放地点</label>
            <input
              type="text"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="地点"
              value={filterLocation}
              onChange={e => setFilterLocation(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') loadAllDistributions(); }}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">使用人</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                className="px-3 py-2 pl-10 border border-gray-300 rounded-lg text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="使用人姓名"
                value={filterUserName}
                onChange={e => setFilterUserName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadAllDistributions(); }}
              />
            </div>
          </div>
          <button onClick={loadAllDistributions} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1">
            <Search className="w-4 h-4" /> 查询
          </button>
          <button onClick={() => { setFilterKeyword(''); setFilterLocation(''); setFilterUserName(''); }} className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">重置</button>
          <button
            onClick={() => {
              setEditingDist({ assetId: selectedAssetId || '', location: '', storageAddress: '', createdByName: '', quantity: 1, remark: '' });
              setOrgLevel1(''); setOrgLevel2('');
              setShowModal(true);
            }}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> 新增分布
          </button>
          <button
            onClick={async () => {
              try {
                const res = await fixedAssetApi.exportDistributions();
                const url = URL.createObjectURL(res.data);
                const a = document.createElement('a');
                a.href = url;
                a.download = '资产分布台账.xlsx';
                a.click();
                URL.revokeObjectURL(url);
              } catch (e: any) { alert('导出失败: ' + (e.message || '')); }
            }}
            className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-1"
          >
            <Download className="w-4 h-4" /> 导出
          </button>
          <label className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-1 cursor-pointer">
            <Upload className="w-4 h-4" /> 导入
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const res = await fixedAssetApi.importDistributions(f);
                const d = res.data?.data || res.data;
                const inserted = d?.inserted ?? 0;
                const errs = d?.errors ?? [];
                alert(`导入完成：成功 ${inserted} 条${errs.length ? `\n\n失败 ${errs.length} 条：\n${errs.join('\n')}` : ''}`);
                loadDistributions();
                loadAssets();
                loadAllDistributions();
              } catch (e: any) { alert('导入失败: ' + (e.response?.data?.error || e.message || '')); }
              e.target.value = '';
            }} />
          </label>
        </div>

        {/* 资产信息条（选中资产时显示） */}
        {selectedAsset && (
          <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 flex flex-wrap gap-4">
            <span>资产编号：<span className="font-medium text-gray-800">{selectedAsset.assetNo}</span></span>
            <span>名称：<span className="font-medium text-gray-800">{selectedAsset.assetName}</span></span>
            <span>分类：{selectedAsset.category}</span>
            <span className="font-medium text-gray-700">资产总数量：{assetTotalQty}</span>
            <span className="font-medium text-blue-600">已分布：{distQty}</span>
            <span className="font-medium text-green-600">未分布：{undistQty}</span>
          </div>
        )}

        {/* 统一分布表格 */}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
        ) : selectedAssetId ? (
          /* 选中资产：显示该资产的分布明细，可编辑/删除 */
          <div className="overflow-x-auto">
            <div className="text-sm text-gray-500 mb-2">
              分布地点数：<span className="font-semibold text-blue-600">{distributions.length}</span> | 已分布总量：<span className="font-semibold text-blue-600">{distQty}</span> | 未分布：<span className="font-semibold text-green-600">{undistQty}</span> / {assetTotalQty}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="text-left py-2 px-3">序号</th>
                  <th className="text-left py-2 px-3">归属组织</th>
                  <th className="text-left py-2 px-3">存放地址</th>
                  <th className="text-left py-2 px-3">使用人</th>
                  <th className="text-right py-2 px-3">数量</th>
                  <th className="text-left py-2 px-3">备注</th>
                  <th className="text-left py-2 px-3">操作人</th>
                  <th className="text-left py-2 px-3">创建时间</th>
                  <th className="text-center py-2 px-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {distributions.map((d, i) => (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-3 text-gray-400">{i + 1}</td>
                    <td className="py-2 px-3 font-medium text-gray-700">{d.location || '-'}</td>
                    <td className="py-2 px-3 text-gray-600">{d.storageAddress || '-'}</td>
                    <td className="py-2 px-3 text-gray-600">{d.createdByName || '-'}</td>
                    <td className="text-right py-2 px-3">{d.quantity}</td>
                    <td className="py-2 px-3 text-gray-600">{d.remark || '-'}</td>
                    <td className="py-2 px-3 text-gray-600">{d.createdByName || '-'}</td>
                    <td className="py-2 px-3 text-gray-400">{formatDateTime(d.createdAt)}</td>
                    <td className="text-center py-2 px-3">
                      <button onClick={() => {
                        setEditingDist({ ...d, assetId: d.assetId || selectedAssetId || '', createdByName: d.createdByName || '', storageAddress: d.storageAddress || '' });
                        const org = orgList.find(o => o.name === d.location);
                        if (org) {
                          if (org.level === 2) { setOrgLevel1(org.parentId || ''); setOrgLevel2(org.id); }
                          else { setOrgLevel1(org.id); setOrgLevel2(''); }
                        } else { setOrgLevel1(''); setOrgLevel2(''); }
                        setShowModal(true);
                      }} className="text-blue-600 hover:text-blue-800 mr-2"><Edit className="w-4 h-4 inline" /></button>
                      <button onClick={() => handleDelete(d.id)} className="text-red-600 hover:text-red-800"><Trash2 className="w-4 h-4 inline" /></button>
                    </td>
                  </tr>
                ))}
                {distributions.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-6 text-gray-400">该资产暂无分布记录，点击"新增分布"添加</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* 未选资产：显示全部分布记录概览 */
          <div className="overflow-x-auto">
            <div className="text-sm text-gray-500 mb-2">
              分布记录数：<span className="font-semibold text-blue-600">{allDistributions.length}</span> | 分布总量：<span className="font-semibold text-green-600">{allDistTotal}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="text-left py-2 px-3">序号</th>
                  <th className="text-left py-2 px-3">资产编号</th>
                  <th className="text-left py-2 px-3">资产名称</th>
                  <th className="text-left py-2 px-3">资产类别</th>
                  <th className="text-left py-2 px-3">归属组织</th>
                  <th className="text-left py-2 px-3">存放地址</th>
                  <th className="text-left py-2 px-3">使用人</th>
                  <th className="text-right py-2 px-3">分布数量</th>
                  <th className="text-left py-2 px-3">备注</th>
                  <th className="text-left py-2 px-3">操作人</th>
                  <th className="text-left py-2 px-3">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {allDistributions.map((d, i) => (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-3 text-gray-400">{i + 1}</td>
                    <td className="py-2 px-3 font-mono text-xs text-gray-600">{d.assetNo || '-'}</td>
                    <td className="py-2 px-3 font-medium text-gray-700">{d.assetName || '-'}</td>
                    <td className="py-2 px-3 text-gray-600">{d.category || '-'}</td>
                    <td className="py-2 px-3 font-medium text-gray-700">{d.location || '-'}</td>
                    <td className="py-2 px-3 text-gray-600">{d.storageAddress || '-'}</td>
                    <td className="py-2 px-3 text-gray-600">{d.createdByName || '-'}</td>
                    <td className="text-right py-2 px-3 font-semibold text-blue-600">{d.quantity}</td>
                    <td className="py-2 px-3 text-gray-600">{d.remark || '-'}</td>
                    <td className="py-2 px-3 text-gray-600">{d.createdByName || '-'}</td>
                    <td className="py-2 px-3 text-gray-400">{formatDateTime(d.createdAt)}</td>
                  </tr>
                ))}
                {allDistributions.length === 0 && (
                  <tr><td colSpan={12} className="text-center py-6 text-gray-400">暂无分布记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新增/编辑弹窗 */}
      {showModal && (
        <Modal title={editingDist.id ? '编辑分布' : '新增分布'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <Field label="选择资产" required>
              <AssetSearchSelect
                assets={assets}
                value={editingDist.assetId || ''}
                onChange={(id) => setEditingDist({ ...editingDist, assetId: id })}
              />
            </Field>
            <Field label="归属组织（第一层）" required>
              <select
                className="form-input w-full"
                value={orgLevel1}
                onChange={e => {
                  setOrgLevel1(e.target.value ? parseInt(e.target.value) : '');
                  setOrgLevel2('');
                  const o = orgList.find(o => o.id === Number(e.target.value));
                  setEditingDist({ ...editingDist, location: o ? o.name : '' });
                }}
              >
                <option value="">请选择</option>
                {orgList.filter(o => o.level === 1).map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </Field>
            <Field label="归属组织（第二层）">
              <select
                className="form-input w-full"
                value={orgLevel2}
                onChange={e => {
                  setOrgLevel2(e.target.value ? parseInt(e.target.value) : '');
                  const o = orgList.find(o => o.id === Number(e.target.value));
                  setEditingDist({ ...editingDist, location: o ? o.name : (orgList.find(o => o.id === orgLevel1)?.name || '') });
                }}
                disabled={!orgLevel1}
              >
                <option value="">{orgLevel1 ? '请选择（可不选）' : '请先选择第一层'}</option>
                {orgList.filter(o => o.level === 2 && o.parentId === orgLevel1).map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </Field>
            <Field label="存放地址">
              <input
                className="form-input w-full"
                placeholder="如：3楼会议室、前台左侧"
                value={editingDist.storageAddress || ''}
                onChange={e => setEditingDist({ ...editingDist, storageAddress: e.target.value })}
              />
            </Field>
            <Field label="使用人" required>
              <input
                className="form-input w-full"
                placeholder="请输入使用人姓名"
                value={editingDist.createdByName || ''}
                onChange={e => setEditingDist({ ...editingDist, createdByName: e.target.value })}
              />
            </Field>
            <Field label="数量">
              <input type="number" min="1" className="form-input w-full" value={editingDist.quantity} onChange={e => setEditingDist({ ...editingDist, quantity: parseInt(e.target.value) || 1 })} />
            </Field>
            <Field label="备注">
              <input className="form-input w-full" value={editingDist.remark} onChange={e => setEditingDist({ ...editingDist, remark: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">取消</button>
              <button onClick={handleSave} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">保存</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================
// Tab4: 折旧方案（方案管理 + 资产选择方案后自动计算剩余价值）
// ============================================================
function DepreciationTab() {
  const [subTab, setSubTab] = useState<'schemes' | 'calculate'>('schemes');
  const [schemes, setSchemes] = useState<any[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [calcResults, setCalcResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingScheme, setEditingScheme] = useState<any>({ schemeName: '', method: 'straight_line', usefulLifeYears: 5, residualValueRate: 0.05, description: '', isDefault: false });
  const [selectedSchemeId, setSelectedSchemeId] = useState<number | ''>('');

  const loadSchemes = useCallback(async () => {
    try {
      const res = await depreciationSchemeApi.list();
      if (res.data.ok) {
        setSchemes(res.data.data || []);
        const def = res.data.data?.find((s: any) => s.isDefault);
        if (def && !selectedSchemeId) setSelectedSchemeId(def.id);
      }
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
  }, [selectedSchemeId]);

  const loadAssets = useCallback(async () => {
    try {
      const res = await fixedAssetApi.list({ status: 'inuse' });
      if (res.data.ok) setAssets(res.data.data || []);
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
  }, []);

  useEffect(() => { loadSchemes(); loadAssets(); }, [loadSchemes, loadAssets]);

  const handleSaveScheme = async () => {
    if (!editingScheme.schemeName?.trim()) { alert('请输入方案名称'); return; }
    try {
      if (editingScheme.id) {
        await depreciationSchemeApi.update(editingScheme.id, editingScheme);
      } else {
        await depreciationSchemeApi.create(editingScheme);
      }
      setShowModal(false);
      setEditingScheme({ schemeName: '', method: 'straight_line', usefulLifeYears: 5, residualValueRate: 0.05, description: '', isDefault: false });
      loadSchemes();
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
  };

  const handleDeleteScheme = async (id: number) => {
    if (!confirm('确认删除该折旧方案？')) return;
    try { await depreciationSchemeApi.remove(id); loadSchemes(); }
    catch (e: any) { alert(e.response?.data?.error || e.message); }
  };

  const handleCalculate = async () => {
    setLoading(true);
    try {
      const res = await fixedAssetApi.calculateDepreciation(undefined, selectedSchemeId ? selectedSchemeId as number : undefined);
      if (res.data.ok) setCalcResults(res.data.data.results || []);
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
    setLoading(false);
  };

  const handleApply = async () => {
    if (!confirm('确认将折旧计算结果应用到台账？这将更新所有在用/闲置资产的累计折旧和净值。')) return;
    setLoading(true);
    try {
      const res = await fixedAssetApi.applyDepreciation(selectedSchemeId ? selectedSchemeId as number : undefined);
      if (res.data.ok) {
        alert(`折旧已应用到 ${res.data.data.updated} 个资产（方案：${res.data.data.schemeName}）`);
        handleCalculate();
      }
    } catch (e: any) { alert(e.response?.data?.error || e.message); }
    setLoading(false);
  };

  const METHOD_MAP: Record<string, string> = {
    straight_line: '直线法',
    double_declining: '双倍余额递减法',
    sum_of_years: '年数总和法',
  };

  return (
    <div className="space-y-4">
      {/* 子标签 */}
      <div className="bg-white rounded-lg shadow-sm p-2">
        <div className="flex gap-1">
          <button onClick={() => setSubTab('schemes')} className={`px-4 py-2 rounded-lg text-sm font-medium ${subTab === 'schemes' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Settings className="w-4 h-4 inline mr-1" /> 方案管理
          </button>
          <button onClick={() => setSubTab('calculate')} className={`px-4 py-2 rounded-lg text-sm font-medium ${subTab === 'calculate' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Calculator className="w-4 h-4 inline mr-1" /> 折旧计算
          </button>
        </div>
      </div>

      {subTab === 'schemes' ? (
        <>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-semibold text-gray-700">折旧方案列表</h3>
              <button onClick={() => { setEditingScheme({ schemeName: '', method: 'straight_line', usefulLifeYears: 5, residualValueRate: 0.05, description: '', isDefault: false }); setShowModal(true); }} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1">
                <Plus className="w-4 h-4" /> 新增方案
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="text-left py-2 px-3">方案名称</th>
                    <th className="text-left py-2 px-3">折旧方式</th>
                    <th className="text-right py-2 px-3">使用年限</th>
                    <th className="text-right py-2 px-3">残值率</th>
                    <th className="text-left py-2 px-3">说明</th>
                    <th className="text-center py-2 px-3">默认</th>
                    <th className="text-center py-2 px-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {schemes.map(s => (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 px-3 font-medium text-gray-700">{s.schemeName}</td>
                      <td className="py-2 px-3">{METHOD_MAP[s.method] || s.method}</td>
                      <td className="text-right py-2 px-3">{s.usefulLifeYears}年</td>
                      <td className="text-right py-2 px-3">{(s.residualValueRate * 100).toFixed(1)}%</td>
                      <td className="py-2 px-3 text-gray-600 text-xs">{s.description || '-'}</td>
                      <td className="text-center py-2 px-3">{s.isDefault ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" /> : '-'}</td>
                      <td className="text-center py-2 px-3">
                        <button onClick={() => { setEditingScheme({ ...s, isDefault: !!s.isDefault }); setShowModal(true); }} className="text-blue-600 hover:text-blue-800 mr-2"><Edit className="w-4 h-4 inline" /></button>
                        <button onClick={() => handleDeleteScheme(s.id)} className="text-red-600 hover:text-red-800"><Trash2 className="w-4 h-4 inline" /></button>
                      </td>
                    </tr>
                  ))}
                  {schemes.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-6 text-gray-400">暂无方案</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {showModal && (
            <Modal title={editingScheme.id ? '编辑方案' : '新增方案'} onClose={() => setShowModal(false)}>
              <div className="space-y-4">
                <Field label="方案名称" required>
                  <input className="form-input w-full" value={editingScheme.schemeName} onChange={e => setEditingScheme({ ...editingScheme, schemeName: e.target.value })} />
                </Field>
                <Field label="折旧方式" required>
                  <select className="form-input w-full" value={editingScheme.method} onChange={e => setEditingScheme({ ...editingScheme, method: e.target.value })}>
                    <option value="straight_line">直线法（每月均等）</option>
                    <option value="double_declining">双倍余额递减法（前期多折旧）</option>
                    <option value="sum_of_years">年数总和法（逐年递减）</option>
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="使用年限（年）" required>
                    <input type="number" step="0.5" min="0.5" className="form-input w-full" value={editingScheme.usefulLifeYears} onChange={e => setEditingScheme({ ...editingScheme, usefulLifeYears: parseFloat(e.target.value) || 5 })} />
                  </Field>
                  <Field label="残值率">
                    <input type="number" step="0.01" min="0" max="1" className="form-input w-full" value={editingScheme.residualValueRate} onChange={e => setEditingScheme({ ...editingScheme, residualValueRate: parseFloat(e.target.value) || 0.05 })} />
                  </Field>
                </div>
                <Field label="说明">
                  <textarea className="form-input w-full" rows={2} value={editingScheme.description} onChange={e => setEditingScheme({ ...editingScheme, description: e.target.value })} />
                </Field>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={editingScheme.isDefault} onChange={e => setEditingScheme({ ...editingScheme, isDefault: e.target.checked })} />
                  设为默认方案
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">取消</button>
                  <button onClick={handleSaveScheme} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">保存</button>
                </div>
              </div>
            </Modal>
          )}
        </>
      ) : (
        <>
          {/* 折旧计算 */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex flex-wrap items-end gap-3 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">选择折旧方案</label>
                <select className="form-input w-64" value={selectedSchemeId} onChange={e => setSelectedSchemeId(e.target.value ? parseInt(e.target.value) : '')}>
                  <option value="">默认方案</option>
                  {schemes.map(s => (
                    <option key={s.id} value={s.id}>{s.schemeName}（{METHOD_MAP[s.method] || s.method}，{s.usefulLifeYears}年）</option>
                  ))}
                </select>
              </div>
              <button onClick={handleCalculate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1">
                <Calculator className="w-4 h-4" /> 计算折旧
              </button>
              <button onClick={handleApply} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> 应用到台账
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
            ) : calcResults.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="text-left py-2 px-3">资产编号</th>
                      <th className="text-left py-2 px-3">资产名称</th>
                      <th className="text-right py-2 px-3">原值</th>
                      <th className="text-right py-2 px-3">残值</th>
                      <th className="text-right py-2 px-3">月折旧额</th>
                      <th className="text-right py-2 px-3">已用月数</th>
                      <th className="text-right py-2 px-3">累计折旧</th>
                      <th className="text-right py-2 px-3">剩余价值</th>
                      <th className="text-center py-2 px-3">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcResults.map((r, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 px-3 text-gray-600">{r.assetNo}</td>
                        <td className="py-2 px-3 font-medium text-gray-700">{r.assetName}</td>
                        <td className="text-right py-2 px-3">{formatCurrency(r.originalValue)}</td>
                        <td className="text-right py-2 px-3 text-gray-500">{formatCurrency(r.residualValue)}</td>
                        <td className="text-right py-2 px-3 text-blue-600">{formatCurrency(r.monthlyDepreciation)}</td>
                        <td className="text-right py-2 px-3">{r.elapsedMonths}/{r.totalMonths}月</td>
                        <td className="text-right py-2 px-3 text-orange-600">{formatCurrency(r.accumulatedDepreciation)}</td>
                        <td className="text-right py-2 px-3 font-semibold text-green-600">{formatCurrency(r.netValue)}</td>
                        <td className="text-center py-2 px-3">
                          {r.isFullyDepreciated ? <span className="text-xs text-gray-400">已折旧完</span> : <span className="text-xs text-green-500">折旧中</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 font-semibold">
                      <td colSpan={2} className="py-2 px-3 text-right">合计：</td>
                      <td className="text-right py-2 px-3">{formatCurrency(calcResults.reduce((s, r) => s + (r.originalValue || 0), 0))}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(calcResults.reduce((s, r) => s + (r.residualValue || 0), 0))}</td>
                      <td className="text-right py-2 px-3">{formatCurrency(calcResults.reduce((s, r) => s + (r.monthlyDepreciation || 0), 0))}</td>
                      <td></td>
                      <td className="text-right py-2 px-3 text-orange-600">{formatCurrency(calcResults.reduce((s, r) => s + (r.accumulatedDepreciation || 0), 0))}</td>
                      <td className="text-right py-2 px-3 text-green-600">{formatCurrency(calcResults.reduce((s, r) => s + (r.netValue || 0), 0))}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <Calculator className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                选择折旧方案后点击"计算折旧"按钮查看结果
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default FixedAssetPage;
