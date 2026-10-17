import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Calendar, Calculator, Download, Upload, Target, TrendingUp, PieChart, RefreshCw, ChevronDown, ChevronRight, Search, X, Lock, Edit3, CheckCircle2, Clock, XCircle, FileText, Save, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { getShops } from '../../api/shops';
import { saveMonthlyTargets, getMonthlyTargets, submitChangeRequest, approveChangeRequest, getChangeRequests, clearMonthlyTargets, getMonthlyTargetRatio, saveMonthlyTargetRatio } from '../../api/monthlyTarget';
import { useDataCacheStore } from '../../store/dataCacheStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import type { Shop } from '../../types';

const SHOPS_CACHE_KEY = 'monthlyTargetShops';

interface DailyTarget {
  date: string;
  dayOfWeek: string;
  dayIndex: number;
  coefficient: number;
  target: number;
  group: 'first15' | 'middle' | 'last2';
}

interface ShopTarget {
  shopName: string;
  districtManager: string;
  supervisor: string;
  monthlyTarget: number;
  dailyTargets: DailyTarget[];
}

interface SavedTarget {
  id: number;
  year: number;
  month: number;
  shopName: string;
  districtManager: string;
  supervisor: string;
  monthlyTarget: number;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

interface ChangeRequest {
  id: number;
  targetId: number;
  year: number;
  month: number;
  shopName: string;
  districtManager: string;
  supervisor: string;
  oldTarget: number;
  newTarget: number;
  reason: string;
  status: string; // pending / approved / rejected
  applicant: string;
  applicantGroup: string;
  applicantRole: string;
  approver: string;
  approverRole: string;
  approvedAt: string;
  approvalComment: string;
  createdAt: string;
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 解析单行 CSV，正确处理双引号包裹的字段（Excel 导出时含逗号的单元格会被双引号包裹）。
 * 同时兼容制表符分隔。
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          // 转义的双引号
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',' || ch === '\t') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// 兼容 UTF-8 / GBK(ANSI) 编码的 csv/txt 文本解码
// Excel 在中文 Windows 下导出的 .csv 是 GBK（ANSI）编码，若直接用 UTF-8 解码会中文乱码
function decodeCsvText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const utf8Text = new TextDecoder('utf-8').decode(bytes);
  // UTF-8 解码出现替换字符（U+FFFD）通常表示原文件是 GBK/ANSI 编码，改用 GBK 解码
  if (utf8Text.indexOf('\uFFFD') !== -1) {
    try {
      return new TextDecoder('gbk').decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      return utf8Text.replace(/^\uFEFF/, '');
    }
  }
  return utf8Text.replace(/^\uFEFF/, '');
}

const getDayCoefficient = (dayOfWeek: number, coefficients?: Record<number, number>): number => {
  if (coefficients && dayOfWeek in coefficients) return coefficients[dayOfWeek];
  switch (dayOfWeek) {
    case 0: return 1.2;
    case 5: return 1.1;
    case 6: return 1.5;
    default: return 1.0;
  }
};

const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month, 0).getDate();
};

/**
 * 月目标分解规则（按新规则）：
 *  - 1~15号 占月度总目标的 60%：1~15号每天先按星期系数分摊得到期初值（15号也参与计算），
 *    1~15号期初值合计后与 总目标*0.6 对比，差额（超过/缺少的部分）在15号基础上调整，
 *    保证 1~15号合计 = 总目标*0.6。
 *  - 16~28号 占月度总目标的 40%：同理，16~28号每天按系数分摊（28号参与），
 *    差额在28号基础上调整，保证合计 = 总目标*0.4。
 *  - 29号及以后无指标（target=0）。
 *  - 全部取整。
 */
function decomposeMonthlyTarget(monthlyTarget: number, year: number, month: number, coefficients?: Record<number, number>, firstRatio: number = 0.6, firstEndDay: number = 15, secondEndDay: number = 26): DailyTarget[] {
  if (!monthlyTarget || monthlyTarget <= 0) return [];

  const totalDays = getDaysInMonth(year, month);
  // 前段截止日与后段截止日可配置（默认 1-15 / 16-26）
  const firstEnd = Math.min(Math.max(1, Math.floor(firstEndDay)), totalDays);
  const secondEnd = Math.min(Math.max(firstEnd + 1, Math.floor(secondEndDay)), totalDays);

  // 前段/后段 占比可调，默认 60% / 40%
  const ratio1 = Math.max(0.01, Math.min(0.99, firstRatio));
  const ratio2 = 1 - ratio1;

  const results: DailyTarget[] = [];

  // 区间分解：startDay~endDay 合计 = round(monthlyTarget*ratio)，
  // 区间内每天先按系数分摊得到期初值（尾日也参与），差额在尾日基础上调整
  const decomposeSegment = (
    startDay: number,
    endDay: number,
    ratio: number,
    group: 'first15' | 'middle'
  ) => {
    const segTarget = Math.round(monthlyTarget * ratio);
    const days: { dayIndex: number; coeff: number; dow: number; base: number }[] = [];
    for (let d = startDay; d <= endDay; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      days.push({ dayIndex: d, coeff: getDayCoefficient(dow, coefficients), dow, base: 0 });
    }
    const sumCoeff = days.reduce((s, x) => s + x.coeff, 0);
    // 期初：每天按系数分摊（含尾日）
    days.forEach(x => {
      x.base = sumCoeff > 0 ? Math.round(segTarget * (x.coeff / sumCoeff)) : 0;
    });
    // 尾日差额调整：合计与 segTarget 之差，加到尾日上
    const last = days[days.length - 1];
    const sumBase = days.reduce((s, x) => s + x.base, 0);
    const diff = segTarget - sumBase;
    last.base += diff;
    // 输出
    days.forEach(x => {
      results.push({
        date: `${month}/${x.dayIndex}`,
        dayOfWeek: WEEKDAY_NAMES[x.dow],
        dayIndex: x.dayIndex,
        coefficient: x.coeff,
        target: x.base,
        group,
      });
    });
  };

  decomposeSegment(1, firstEnd, ratio1, 'first15');
  decomposeSegment(firstEnd + 1, secondEnd, ratio2, 'middle');

  // ---------- 29号及以后：无指标 ----------
  for (let d = secondEnd + 1; d <= totalDays; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    results.push({
      date: `${month}/${d}`,
      dayOfWeek: WEEKDAY_NAMES[dow],
      dayIndex: d,
      coefficient: 0,
      target: 0,
      group: 'last2',
    });
  }

  return results;
}

function MonthlyTargetDecomposition() {
  const { user } = useAuthStore();
  const { pageCache, setPageCache, clearPageCache } = useDataCacheStore();
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [shops, setShops] = useState<Shop[]>(pageCache[SHOPS_CACHE_KEY] || []);
  const [loading, setLoading] = useState(false);
  const [shopTargets, setShopTargets] = useState<Record<string, string>>({});
  const [decomposed, setDecomposed] = useState<ShopTarget[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [batchInput, setBatchInput] = useState('');
  const [showBatch, setShowBatch] = useState(false);
  const [dayCoefficients, setDayCoefficients] = useState<Record<number, number>>({0: 1.2, 1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0, 5: 1.1, 6: 1.5});
  const [firstRatioPercent, setFirstRatioPercent] = useState(60); // 前段占比，可调
  const [firstEndDay, setFirstEndDay] = useState(15);  // 前段截止日（默认15号）
  const [secondEndDay, setSecondEndDay] = useState(26); // 后段截止日（默认26号）

  // 加载该年月的分解比例并返回解析值（供分解/重建使用，避免时序竞态）
  const loadRatio = async () => {
    let pct = 60, fe = 15, se = 26;
    try {
      const res = await getMonthlyTargetRatio({ year, month });
      const r = Number(res.data?.ratio);
      if (typeof r === 'number' && r > 0 && r < 1) pct = Math.round(r * 100);
      const feV = Number(res.data?.firstEnd);
      if (typeof feV === 'number' && feV >= 1) fe = Math.min(31, feV);
      const seV = Number(res.data?.secondEnd);
      if (typeof seV === 'number' && seV >= 1) se = Math.min(31, Math.max(seV, fe || 1));
    } catch { }
    setFirstRatioPercent(pct); setFirstEndDay(fe); setSecondEndDay(se);
    return { pct, fe, se };
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  // DB persisted state
  const [savedTargets, setSavedTargets] = useState<SavedTarget[]>([]);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [saving, setSaving] = useState(false);
  const [showChangeModal, setShowChangeModal] = useState<string | null>(null); // shopName
  const [changeNewTarget, setChangeNewTarget] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [showApproveModal, setShowApproveModal] = useState<number | null>(null); // requestId
  const [approveComment, setApproveComment] = useState('');
  const [approveNewTargets, setApproveNewTargets] = useState<DailyTarget[]>([]);

  const isAdmin = useMemo(() => {
    const gn = user?.groupName || '';
    return gn.includes('管理组') || gn.includes('管理') || gn.includes('admin') || gn.includes('Admin');
  }, [user]);

  const isDistrictManager = useMemo(() => {
    const gn = user?.groupName || '';
    return gn.startsWith('区经组') || gn.startsWith('经理');
  }, [user]);

  const isDirector = useMemo(() => {
    const gn = user?.groupName || '';
    return gn.startsWith('总监组');
  }, [user]);

  const canApprove = isAdmin || isDistrictManager || isDirector;

  // Load shops from archive (cached)
  useEffect(() => {
    if (!pageCache[SHOPS_CACHE_KEY]) {
      loadShops();
    }
  }, []);

  const handleRefreshShops = () => {
    clearPageCache(SHOPS_CACHE_KEY);
    loadShops();
  };

  // Load saved targets when year/month changes（先取该月比例，再按比例重建分解）
  useEffect(() => {
    (async () => {
      const cfg = await loadRatio();
      loadSavedTargets(cfg);
    })();
  }, [year, month]);

  const loadShops = async () => {
    setLoading(true);
    try {
      const result = await getShops(user?.groupName);
      const arr = Array.isArray(result) ? result : [];
      setShops(arr);
      setPageCache(SHOPS_CACHE_KEY, arr);
    } catch (err) {
      console.error('Failed to load shops:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSavedTargets = async (ratioCfg?: { pct: number; fe: number; se: number }) => {
    try {
      // 未显式传入时，先从数据库读取该年月的已保存比例，避免回退到默认 60/40
      let cfg = ratioCfg;
      if (!cfg) cfg = await loadRatio();
      const rPct = (cfg ? cfg.pct : firstRatioPercent);
      const rFe = (cfg ? cfg.fe : firstEndDay);
      const rSe = (cfg ? cfg.se : secondEndDay);
      const res = await getMonthlyTargets({ year, month, groupName: user?.groupName });
      setSavedTargets(res.data.targets || []);
      setChangeRequests(res.data.changeRequests || []);
      // 只保留当前选中月份的目标，整体替换（避免切换月份后残留上一月旧值）
      const savedMap: Record<string, string> = {};
      (res.data.targets || []).forEach((t: SavedTarget) => {
        savedMap[t.shopName] = String(t.monthlyTarget);
      });
      setShopTargets(savedMap);
      // Reconstruct decomposed from saved data
      if ((res.data.targets || []).length > 0) {
        const decomposedList: ShopTarget[] = (res.data.targets || []).map((t: SavedTarget) => ({
          shopName: t.shopName,
          districtManager: t.districtManager || '',
          supervisor: t.supervisor || '',
          monthlyTarget: t.monthlyTarget,
          dailyTargets: decomposeMonthlyTarget(t.monthlyTarget, year, month, dayCoefficients, rPct / 100, rFe, rSe),
        }));
        setDecomposed(decomposedList);
      } else {
        setDecomposed([]);
      }
    } catch (err) {
      console.error('Failed to load saved targets:', err);
    }
  };

  // 已锁定（不可直接编辑）：active（已分解锁定）或 pending_change（变更审批中）均不可改
  const isLocked = useCallback((shopName: string): boolean => {
    const saved = savedTargets.find(t => t.shopName === shopName);
    return !!(saved && (saved.status === 'active' || saved.status === 'pending_change'));
  }, [savedTargets]);

  // Check if a shop has pending change request
  const hasPendingChange = useCallback((shopName: string): boolean => {
    return changeRequests.some(r => r.shopName === shopName && r.status === 'pending');
  }, [changeRequests]);

  // 三级联动多选筛选
  const areaSupervisorShopFilter = useAreaSupervisorShopFilter<Shop>(shops, {
    getArea: (s) => s.area,
    getSupervisor: (s) => s.supervisor || '',
    getShopName: (s) => s.shopName,
    getWarehouseType: (s: any) => (s.warehouseType) || ((s.shopName || '').endsWith('_JM') ? '加盟' : (s.shopName || '').endsWith('_ZY') ? '直营' : ''),
  });

  // 在筛选结果上叠加搜索
  const filteredShops = useMemo(() => {
    let result = areaSupervisorShopFilter.filteredData;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(s =>
        s.shopName.toLowerCase().includes(term) ||
        (s.districtManager || '').toLowerCase().includes(term) ||
        (s.supervisor || '').toLowerCase().includes(term)
      );
    }
    return result;
  }, [areaSupervisorShopFilter.filteredData, searchTerm]);

  // Group shops by district manager then supervisor
  const groupedShops = useMemo(() => {
    const groups: Record<string, Record<string, Shop[]>> = {};
    filteredShops.forEach(s => {
      const dm = s.districtManager || '未分配区经';
      const sv = s.supervisor || '未分配督导';
      if (!groups[dm]) groups[dm] = {};
      if (!groups[dm][sv]) groups[dm][sv] = [];
      groups[dm][sv].push(s);
    });
    return groups;
  }, [filteredShops]);

  // Update single shop target (only if not locked)
  const updateShopTarget = useCallback((shopName: string, value: string) => {
    if (isLocked(shopName)) return;
    setShopTargets(prev => ({ ...prev, [shopName]: value }));
    setDecomposed([]);
  }, [isLocked]);

  // Batch import - 兼容 csv/txt/xlsx 转出的文本
  // 每行格式：店铺名称,月目标金额（列分隔符支持逗号/制表符；Excel导出时单元格含逗号会用双引号包裹）
  const handleBatchImport = useCallback(async () => {
    if (!batchInput.trim()) return;
    const lines = batchInput.split(/\r?\n/).filter(l => l.trim());
    const newTargets: Record<string, string> = {};
    let imported = 0;
    let detectedYear: number | null = null;
    let detectedMonth: number | null = null;

    lines.forEach((line, lineIdx) => {
      const parts = parseCsvLine(line).map(p => p.trim());
      if (parts.length < 2) return;
      const joined = parts.join(' ');
      // 跳过表头（首行，且含表头关键字）
      if (lineIdx === 0 && /(年份|月份|店铺名称|月目标|目标)/.test(joined)) return;
      const clean = (s: string) => s.replace(/[,，\s元]/g, '');

      // 格式①（下载模板）：年份 月份 店铺名称 月目标金额 —— 识别年月并切换
      if (parts.length >= 3 && parts[0] && parts[1] && isFinite(Number(parts[0])) && isFinite(Number(parts[1])) && parts[2]) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const name = parts[2];
        const target = parts[3] ? clean(parts[3]) : '';
        if (y > 2000 && m >= 1 && m <= 12 && name && target) {
          if (detectedYear === null) { detectedYear = y; detectedMonth = m; }
          const match = shops.find(s => s.shopName.includes(name) || name.includes(s.shopName));
          if (match && !isLocked(match.shopName)) { newTargets[match.shopName] = target; imported++; }
        }
        return;
      }

      // 格式②（旧）：店铺名称 月目标金额
      const name = parts[0];
      const target = clean(parts[1]);
      if (!name || !target) return;
      if (isNaN(Number(target)) || Number(target) <= 0) { if (lineIdx === 0) return; return; }
      const match = shops.find(s => s.shopName.includes(name) || name.includes(s.shopName));
      if (match && !isLocked(match.shopName)) { newTargets[match.shopName] = target; imported++; }
    });

    // 导入目标填入输入框，并直接写入月目标数据库（daily 留空，分解时再写日）
    setShopTargets(prev => ({ ...prev, ...newTargets }));
    const ymNote = detectedYear && detectedMonth ? `，模板年月：${detectedYear}年${detectedMonth}月` : '';
    const importedKeys = Object.keys(newTargets);
    if (importedKeys.length > 0) {
      setSaving(true);
      try {
        await saveMonthlyTargets({
          year, month,
          items: importedKeys.map(shopName => {
            const shop = shops.find(s => s.shopName === shopName);
            return {
              shopName,
              districtManager: shop?.districtManager || '',
              supervisor: shop?.supervisor || '',
              monthlyTarget: Number(newTargets[shopName]) || 0,
              dailyTargets: [],
            };
          }),
          operator: user?.userName || '',
          groupName: user?.groupName,
        });
        await loadSavedTargets();
        alert(`已导入并写入 ${importedKeys.length} 个店铺的月目标${ymNote}。点击「分解」即可生成每日目标。`);
      } catch (err: any) {
        console.error('导入失败:', err);
        alert('写入数据库失败: ' + (err?.response?.data?.error || err.message));
      } finally {
        setSaving(false);
      }
    } else {
      alert(`未导入任何目标${ymNote}，请确认模板中已在「月目标金额」列填写数值，且店铺名称能匹配系统店铺。`);
    }
    setShowBatch(false);
    setBatchInput('');
  }, [batchInput, shops, isLocked, year, month, user]);

  // 导入文件行：解析后按(年,月)分组直接写入月目标库（daily 空=pending 待分解），支持多月
  const importFileRows = useCallback(async (rows: any[][]) => {
    setSaving(true);
    try {
      const keyed = new Map<string, { y: number; m: number; items: any[] }>();
      let unmatched = 0;
      rows.forEach((row, idx) => {
        const parts = (row || []).map(c => String(c ?? '').trim());
        if (parts.length < 2) return;
        const joined = parts.join(' ');
        if (idx === 0 && isNaN(Number(parts[0])) && /(年份|月份|店铺名称|月目标|目标)/.test(joined)) return; // 表头行
        const clean = (s: string) => s.replace(/[,，\s元]/g, '');
        // 格式①：年份 月份 店铺名称 月目标金额（支持多月）
        if (parts.length >= 3 && isFinite(Number(parts[0])) && isFinite(Number(parts[1])) && parts[2]) {
          const y = Number(parts[0]), m = Number(parts[1]);
          const name = parts[2], target = clean(parts[3] || '');
          if (!(y > 2000 && m >= 1 && m <= 12 && name && target)) return;
          const shop = shops.find(s => s.shopName.includes(name) || name.includes(s.shopName));
          const nm = `${y}-${m}`;
          if (shop) {
            if (!keyed.has(nm)) keyed.set(nm, { y, m, items: [] });
            keyed.get(nm)!.items.push({ shopName: shop.shopName, districtManager: shop.districtManager || '', supervisor: shop.supervisor || '', monthlyTarget: Number(target) || 0, dailyTargets: [] });
          } else unmatched++;
          return;
        }
        // 格式②：店铺名称 月目标金额（用当前页面年月）
        const name = parts[0], target = clean(parts[1]);
        const shop = shops.find(s => s.shopName.includes(name) || name.includes(s.shopName));
        if (shop && target) {
          const nm = `${year}-${month}`;
          if (!keyed.has(nm)) keyed.set(nm, { y: year, m: month, items: [] });
          keyed.get(nm)!.items.push({ shopName: shop.shopName, districtManager: shop.districtManager || '', supervisor: shop.supervisor || '', monthlyTarget: Number(target) || 0, dailyTargets: [] });
        } else unmatched++;
      });

      const summary: string[] = [];
      for (const [, v] of keyed) {
        await saveMonthlyTargets({ year: v.y, month: v.m, items: v.items, operator: user?.userName || '', groupName: user?.groupName });
        summary.push(`${v.y}年${v.m}月×${v.items.length}店`);
      }
      let msg = summary.length ? `已导入对应月份的月目标（待分解状态）：\n${summary.join('\n')}` : '未识别到有效的月目标行';
      if (unmatched > 0) msg += `\n（${unmatched} 条未能匹配系统店铺名称）`;
      alert(msg);
      if (keyed.has(`${year}-${month}`)) await loadSavedTargets();
    } catch (err: any) {
      console.error('导入失败:', err);
      alert('导入失败: ' + (err?.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  }, [shops, year, month, user]);

  // File upload - 支持 csv/txt/xlsx/xls（选择文件后直接解析入库）
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    if (isExcel) {
      // .xls（Excel 97-2003）的中文 codepage 在 xlsx 社区版中已不支持，极易乱码，
      // 直接引导用户另存为 .xlsx，避免把乱码数据塞进预览/导入。
      if (fileName.endsWith('.xls')) {
        alert('检测到 .xls 格式。\n当前组件对中文 .xls 支持有限，上传后汉字会乱码。\n请用 Excel / WPS 打开后「另存为」.xlsx，再重新上传。');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      // .xlsx: 用 ArrayBuffer 读取再交给 SheetJS 解析
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = new Uint8Array(ev.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          // 取第一个工作表
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) {
            alert('Excel文件中没有工作表，请检查文件内容');
            return;
          }
          const worksheet = workbook.Sheets[firstSheetName];
          // 直接读为二维数组（正确解码中文），避免 sheet_to_csv 文本中转带来的编码风险
          const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
          importFileRows(rows);
        } catch (err) {
          console.error('解析Excel文件失败:', err);
          alert('解析Excel文件失败，请确认文件格式正确');
        }
      };
      reader.onerror = () => {
        alert('读取文件失败，请重试');
      };
      reader.readAsArrayBuffer(file);
    } else {
      // csv/txt: 按二进制读取后用 decodeCsvText 解码，兼容 Excel 导出的 GBK(ANSI) 编码，避免中文乱码
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result as ArrayBuffer;
        const text = decodeCsvText(buffer);
        importFileRows(text.split(/\r?\n/).map(l => parseCsvLine(l)));
      };
      reader.readAsArrayBuffer(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [importFileRows]);

  // 分解并直接写入日目标数据库（点击即保存，无需再点保存）
  const handleDecompose = useCallback(async () => {
    const pending: ShopTarget[] = [];
    shops.forEach(s => {
      const t = Number(shopTargets[s.shopName] || 0);
      // 对所有已填月目标(含已锁定/已导入)的店铺都生成日目标并写入，避免残留"待分解"
      if (t > 0) {
        pending.push({
          shopName: s.shopName,
          districtManager: s.districtManager || '',
          supervisor: s.supervisor || '',
          monthlyTarget: t,
          dailyTargets: decomposeMonthlyTarget(t, year, month, dayCoefficients, firstRatioPercent / 100, firstEndDay, secondEndDay),
        });
      }
    });
    if (pending.length === 0) {
      alert('没有可分解的店铺（请先填写月目标）');
      return;
    }
    setSaving(true);
    try {
      await saveMonthlyTargets({
        year, month,
        items: pending,
        operator: user?.userName || '',
        groupName: user?.groupName,
      });
      // 保存当前分解比例与截止日（前段占比+前/后段截止日），持久化供每月调整
      await saveMonthlyTargetRatio({ year, month, ratio: firstRatioPercent / 100, firstEnd: firstEndDay, secondEnd: secondEndDay });
      setDecomposed(pending);
      alert(`已完成 ${pending.length} 个店铺的分解并写入日目标数据库`);
      await loadSavedTargets();
    } catch (err: any) {
      console.error('分解保存失败:', err);
      alert('分解保存失败: ' + (err?.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  }, [shops, shopTargets, year, month, isLocked, dayCoefficients, firstRatioPercent, firstEndDay, secondEndDay, user]);

  // 下载导入模板（带年月列，列出全部店铺供填写）
  const handleDownloadTemplate = useCallback(() => {
    const rows: any[][] = [
      ['年份', '月份', '店铺名称', '月目标金额'],
      ...shops.map(s => [year, month, s.shopName, '']),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '月目标模板');
    XLSX.writeFile(wb, `${year}年${month}月_月目标导入模板.xlsx`);
  }, [year, month, shops]);

  // 清空本月目标（仅区经/管理员）
  const handleClear = useCallback(async () => {
    if (!window.confirm(`确定要清空 ${year}年${month}月 的所有店铺月目标分解吗？\n此操作不可恢复，且会一并清除本月的变更申请！`)) {
      return;
    }
    try {
      await clearMonthlyTargets({
        year, month,
        operator: user?.userName || '',
        groupName: user?.groupName,
      });
      setDecomposed([]);
      setShopTargets({});
      await loadSavedTargets();
      alert('已清空本月目标');
    } catch (err: any) {
      console.error('清空失败:', err);
      alert('清空失败: ' + (err?.response?.data?.error || err.message));
    }
  }, [year, month, user]);

  // Submit change request
  const handleSubmitChangeRequest = useCallback(async (shopName: string) => {
    const newTargetNum = Number(changeNewTarget);
    if (!newTargetNum || newTargetNum <= 0) {
      alert('请输入有效的新目标金额');
      return;
    }

    const saved = savedTargets.find(t => t.shopName === shopName);
    const shopData = shops.find(s => s.shopName === shopName);

    try {
      await submitChangeRequest({
        targetId: saved?.id,
        year, month,
        shopName,
        districtManager: shopData?.districtManager || '',
        supervisor: shopData?.supervisor || '',
        oldTarget: saved?.monthlyTarget || 0,
        newTarget: newTargetNum,
        reason: changeReason,
        applicant: user?.userName || '',
        applicantGroup: user?.groupName || '',
      });
      alert('变更申请已提交，等待区经/管理员审批');
      setShowChangeModal(null);
      setChangeNewTarget('');
      setChangeReason('');
      await loadSavedTargets();
    } catch (err: any) {
      alert('提交失败: ' + (err?.response?.data?.error || err.message));
    }
  }, [changeNewTarget, changeReason, savedTargets, shops, year, month, user]);

  // Approve change request
  const handleApprove = useCallback(async (requestId: number, action: 'approve' | 'reject') => {
    const req = changeRequests.find(r => r.id === requestId);
    if (!req) return;

    try {
      const newDaily = action === 'approve'
        ? decomposeMonthlyTarget(req.newTarget, req.year, req.month, dayCoefficients, firstRatioPercent / 100, firstEndDay, secondEndDay)
        : undefined;

      await approveChangeRequest({
        requestId,
        action,
        approver: user?.userName || '',
        approverGroup: user?.groupName || '',
        comment: approveComment,
        newDailyTargets: newDaily,
      });
      alert(action === 'approve' ? '已通过变更申请' : '已驳回变更申请');
      setShowApproveModal(null);
      setApproveComment('');
      await loadSavedTargets();
    } catch (err: any) {
      alert('操作失败: ' + (err?.response?.data?.error || err.message));
    }
  }, [changeRequests, user, approveComment, dayCoefficients, firstRatioPercent, firstEndDay, secondEndDay]);

  // Toggle expand
  const toggleExpand = useCallback((shopName: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(shopName)) next.delete(shopName);
      else next.add(shopName);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(decomposed.map(d => d.shopName)));
  }, [decomposed]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  // Export
  const handleExport = useCallback(() => {
    if (decomposed.length === 0) return;
    const firstLabel = `1-${firstEndDay}号(${firstRatioPercent}%)`;
    const midLabel = `${firstEndDay + 1}-${secondEndDay}号(${100 - firstRatioPercent}%)`;
    const lastLabel = `${secondEndDay + 1}号起(无指标)`;
    const groupLabel = (g: string) => g === 'first15' ? firstLabel : g === 'middle' ? midLabel : lastLabel;
    const rows: string[] = ['区经,督导,店铺,日期,星期,系数,组别,日目标(元)'];
    decomposed.forEach(shop => {
      shop.dailyTargets.forEach(d => {
        rows.push(`${shop.districtManager},${shop.supervisor},${shop.shopName},${d.date},${d.dayOfWeek},${d.coefficient},${groupLabel(d.group)},${d.target}`);
      });
    });
    const csv = '\uFEFF' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `月目标分解_${year}年${month}月.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [decomposed, year, month, firstRatioPercent, firstEndDay, secondEndDay]);

  // Stats
  const totalMonthlyTarget = useMemo(() => decomposed.reduce((s, t) => s + t.monthlyTarget, 0), [decomposed]);
  const shopCount = useMemo(() => decomposed.length, [decomposed]);
  const pendingRequestCount = useMemo(() => changeRequests.filter(r => r.status === 'pending').length, [changeRequests]);

  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i), []);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  const formatCurrency = (v: number) => `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: false })}`;

  // Find change requests for a shop
  const shopChangeRequests = useCallback((shopName: string) => {
    return changeRequests.filter(r => r.shopName === shopName);
  }, [changeRequests]);

  return (
    <Layout title="月目标分解" subtitle="导入月度总指标，自动按规则分解到每日，支持变更审批">
      <div className="space-y-6">
        {/* Top bar */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-gray-400" />
              <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                {years.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
              <select value={month} onChange={e => setMonth(Number(e.target.value))} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                {months.map(m => <option key={m} value={m}>{m}月</option>)}
              </select>
            </div>

            <div className="h-6 w-px bg-gray-200" />

            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400" />
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="搜索店铺/区经/督导..." className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-56" />
              {searchTerm && <button onClick={() => setSearchTerm('')} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>}
            </div>

            <AreaSupervisorShopFilter filter={areaSupervisorShopFilter} />

            <div className="ml-auto flex items-center gap-2">
              <button onClick={handleDownloadTemplate} className="flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                <Download className="w-4 h-4" /> 下载模板
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                <Upload className="w-4 h-4" /> 批量导入
              </button>
              <input ref={fileInputRef} type="file" accept=".csv,.txt,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
              <button onClick={handleDecompose} disabled={saving || Object.entries(shopTargets).filter(([, v]) => Number(v) > 0).length === 0} className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                {saving ? '处理中...' : '分解到日'}
              </button>
              {canApprove && (
                <button onClick={handleClear} className="flex items-center gap-1 px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50">
                  <Trash2 className="w-4 h-4" /> 清空本月目标
                </button>
              )}
            </div>
          </div>

          {/* Batch import panel */}
          {showBatch && (
            <div className="mt-4 p-4 border border-blue-200 bg-blue-50 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-blue-800 flex items-center gap-1"><Upload className="w-4 h-4" /> 批量导入店铺月目标</h4>
                <button onClick={() => setShowBatch(false)} className="text-blue-500 hover:text-blue-700"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-blue-600">每行一个店铺，格式：年份,月份,店铺名称,月目标金额（或 店铺名称,月目标金额）。支持 CSV / TXT / Excel(xlsx/xls) 文件，从模板导入会自动识别年月。</p>
              <textarea value={batchInput} onChange={e => setBatchInput(e.target.value)} placeholder={`店铺A,500000\n店铺B,600000`} className="w-full h-32 px-3 py-2 border border-blue-300 rounded-lg text-sm font-mono resize-none" />
              <div className="flex items-center gap-2">
                <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 border border-blue-300 bg-white text-blue-700 rounded-lg text-sm hover:bg-blue-100">上传文件 (CSV/Excel)</button>
                <button onClick={handleBatchImport} disabled={!batchInput.trim()} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">确认导入</button>
              </div>
            </div>
          )}

          {/* 目标配置：前段/后段截止日 + 占比可调 */}
          <div className="mt-4 p-3 border border-gray-200 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-600 mr-2 font-medium">目标配置：</span>
              <span className="text-xs text-gray-600">前段截止</span>
              <input
                type="number"
                value={firstEndDay}
                min={1}
                max={30}
                step={1}
                onChange={e => setFirstEndDay(Math.max(1, Math.min(30, Number(e.target.value) || 15)))}
                className="w-14 px-1 py-0.5 border border-gray-200 bg-white rounded text-xs text-center"
              />
              <span className="text-xs text-gray-600">号</span>
              <span className="text-xs text-gray-500 mx-1">/</span>
              <span className="text-xs text-gray-600">后段截止</span>
              <input
                type="number"
                value={secondEndDay}
                min={2}
                max={31}
                step={1}
                onChange={e => setSecondEndDay(Math.max((firstEndDay || 15) + 1, Math.min(31, Number(e.target.value) || 26)))}
                className="w-14 px-1 py-0.5 border border-gray-200 bg-white rounded text-xs text-center"
              />
              <span className="text-xs text-gray-600">号</span>
              <span className="text-xs text-gray-500 mx-1">|</span>
              <span className="text-xs text-gray-600">{1}~{firstEndDay}号占比</span>
              <input
                type="number"
                value={firstRatioPercent}
                min={1}
                max={99}
                step={1}
                onChange={e => setFirstRatioPercent(Math.max(1, Math.min(99, Number(e.target.value) || 60)))}
                className="w-16 px-1 py-0.5 border border-gray-200 bg-white rounded text-xs text-center"
              />
              <span className="text-xs text-gray-600">%（后段 {100 - firstRatioPercent}%）</span>
              <span className="text-xs text-gray-400 ml-2">（保存分解后自动生效，每月可调整）</span>
            </div>
          </div>

          {/* 星期系数调整 */}
          <div className="mt-4 p-3 border border-gray-200 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs text-gray-500 mr-2 font-medium">星期系数：</span>
              {WEEKDAY_NAMES.map((name, idx) => (
                <div key={idx} className="flex items-center gap-1 bg-white border border-gray-200 rounded px-2 py-1">
                  <span className="text-xs text-gray-600 whitespace-nowrap">{name}</span>
                  <input
                    type="number"
                    value={dayCoefficients[idx] ?? getDayCoefficient(idx)}
                    onChange={e => setDayCoefficients(prev => ({ ...prev, [idx]: parseFloat(e.target.value) || 0 }))}
                    className="w-12 px-1 py-0.5 border border-gray-200 rounded text-xs text-center"
                    step="0.1"
                    min="0"
                  />
                </div>
              ))}
              <button
                onClick={() => setDayCoefficients({0: 1.2, 1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0, 5: 1.1, 6: 1.5})}
                className="ml-2 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
              >恢复默认</button>
            </div>
          </div>
        </div>

        {/* Summary cards */}
        {decomposed.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0"><Target className="w-5 h-5 text-primary" /></div>
              <div><p className="text-xs text-gray-500">月度总目标</p><p className="text-lg font-bold text-gray-800">{formatCurrency(totalMonthlyTarget)}</p></div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0"><TrendingUp className="w-5 h-5 text-blue-500" /></div>
              <div><p className="text-xs text-gray-500">1-{firstEndDay}号合计({firstRatioPercent}%)</p><p className="text-lg font-bold text-blue-600">{formatCurrency(Math.round(totalMonthlyTarget * (firstRatioPercent / 100)))}</p></div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0"><PieChart className="w-5 h-5 text-purple-500" /></div>
              <div><p className="text-xs text-gray-500">{firstEndDay + 1}-{secondEndDay}号合计({100 - firstRatioPercent}%)</p><p className="text-lg font-bold text-purple-600">{formatCurrency(Math.round(totalMonthlyTarget * ((100 - firstRatioPercent) / 100)))}</p></div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0"><CheckCircle2 className="w-5 h-5 text-green-500" /></div>
              <div><p className="text-xs text-gray-500">已分解店铺 / 待审批</p><p className="text-lg font-bold text-gray-800">{shopCount}家 / {pendingRequestCount}件</p></div>
            </div>
          </div>
        )}

        {/* Pending change requests (for approvers) */}
        {canApprove && pendingRequestCount > 0 && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Clock className="w-5 h-5 text-orange-500" />
              <h3 className="text-lg font-semibold text-gray-800">待审批的变更申请 ({pendingRequestCount})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">店铺</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">区经</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">督导</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">原目标</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">新目标</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">申请人</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">原因</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {changeRequests.filter(r => r.status === 'pending').map(req => (
                    <tr key={req.id} className="hover:bg-orange-50/50">
                      <td className="px-3 py-2 font-medium text-gray-800">{req.shopName}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{req.districtManager}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{req.supervisor}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{req.oldTarget?.toLocaleString('zh-CN', { useGrouping: false })}</td>
                      <td className="px-3 py-2 text-right text-orange-600 font-semibold">{req.newTarget.toLocaleString('zh-CN', { useGrouping: false })}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{req.applicant}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs max-w-xs truncate">{req.reason || '-'}</td>
                      <td className="px-3 py-2 text-center">
                        {showApproveModal === req.id ? (
                          <div className="flex items-center gap-1">
                            <input type="text" value={approveComment} onChange={e => setApproveComment(e.target.value)} placeholder="审批意见" className="px-2 py-1 border border-gray-200 rounded text-xs w-32" />
                            <button onClick={() => handleApprove(req.id, 'approve')} className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700">通过</button>
                            <button onClick={() => handleApprove(req.id, 'reject')} className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">驳回</button>
                            <button onClick={() => { setShowApproveModal(null); setApproveComment(''); }} className="px-2 py-1 text-gray-400 text-xs">取消</button>
                          </div>
                        ) : (
                          <button onClick={() => setShowApproveModal(req.id)} className="px-3 py-1 border border-orange-300 text-orange-600 rounded text-xs hover:bg-orange-100">审批</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Shops table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold text-gray-800">店铺指标分解 {loading ? '(加载中...)' : `(${filteredShops.length}家)`}</h3>
            </div>
            <div className="flex items-center gap-2">
              {decomposed.length > 0 && (
                <>
                  <button onClick={expandAll} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">展开全部</button>
                  <button onClick={collapseAll} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">收起全部</button>
                  <button onClick={handleExport} className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-xs hover:bg-primary-dark"><Download className="w-3 h-3" />导出CSV</button>
                </>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>
          ) : filteredShops.length === 0 ? (
            <div className="text-center py-20 text-gray-400"><Calculator className="w-12 h-12 mx-auto mb-3 text-gray-300" /><p>暂无店铺数据</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-8"></th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">区经</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">督导</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">店铺</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-44">月度目标(元)</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 w-28">状态</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 w-28">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {Object.entries(groupedShops).map(([dm, supervisorsMap]) => (
                    <DMGroup
                      key={dm}
                      districtManager={dm}
                      supervisors={supervisorsMap}
                      shopTargets={shopTargets}
                      updateShopTarget={updateShopTarget}
                      decomposed={decomposed}
                      expanded={expanded}
                      toggleExpand={toggleExpand}
                      isLocked={isLocked}
                      hasPendingChange={hasPendingChange}
                      shopChangeRequests={shopChangeRequests}
                      onApplyChange={(shopName) => { setShowChangeModal(shopName); setChangeNewTarget(''); setChangeReason(''); }}
                      savedTargets={savedTargets}
                      decomposeConfig={{ firstRatioPercent, firstEndDay, secondEndDay }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Change request history */}
        {changeRequests.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-gray-400" />
              <h3 className="text-lg font-semibold text-gray-800">变更申请记录</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">店铺</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">原目标</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">新目标</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">申请人</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">原因</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">状态</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">审批人</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">审批意见</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {changeRequests.map(req => (
                    <tr key={req.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800 text-xs">{req.shopName}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{req.oldTarget?.toLocaleString('zh-CN', { useGrouping: false })}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{req.newTarget.toLocaleString('zh-CN', { useGrouping: false })}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{req.applicant}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs max-w-xs truncate">{req.reason || '-'}</td>
                      <td className="px-3 py-2 text-center">
                        {req.status === 'pending' && <span className="px-2 py-0.5 bg-yellow-50 text-yellow-600 text-xs rounded-full border border-yellow-200 flex items-center gap-1 w-fit"><Clock className="w-3 h-3" />待审批</span>}
                        {req.status === 'approved' && <span className="px-2 py-0.5 bg-green-50 text-green-600 text-xs rounded-full border border-green-200 flex items-center gap-1 w-fit"><CheckCircle2 className="w-3 h-3" />已通过</span>}
                        {req.status === 'rejected' && <span className="px-2 py-0.5 bg-red-50 text-red-500 text-xs rounded-full border border-red-200 flex items-center gap-1 w-fit"><XCircle className="w-3 h-3" />已驳回</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{req.approver || '-'}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs max-w-xs truncate">{req.approvalComment || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Rule reference */}
        <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 flex items-center gap-2">
          <span className="font-semibold">分解规则：</span>
          1-{firstEndDay}号 占 {firstRatioPercent}%（前 {firstEndDay - 1} 天按系数分摊，{firstEndDay}号为平衡值=总目标×{firstRatioPercent}%−之前之和） |
          {firstEndDay + 1}-{secondEndDay}号 占 {100 - firstRatioPercent}%（前段按系数分摊，{secondEndDay}号为平衡值） |
          {secondEndDay + 1}号起无指标 | 全部取整
          周1-4×1.0 | 周5×1.1 | 周6×1.5 | 周日×1.2
          <span className="ml-4 text-orange-600 font-semibold">已分解锁定的指标不可直接修改，需提交变更申请</span>
        </div>
      </div>

      {/* Change request modal */}
      {showChangeModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowChangeModal(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-96" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Edit3 className="w-5 h-5 text-orange-500" />
              <h3 className="text-lg font-semibold text-gray-800">变更指标申请</h3>
            </div>
            <p className="text-sm text-gray-500 mb-1">店铺：<strong className="text-gray-800">{showChangeModal}</strong></p>
            <p className="text-sm text-gray-500 mb-4">原目标：{savedTargets.find(t => t.shopName === showChangeModal)?.monthlyTarget.toLocaleString('zh-CN', { useGrouping: false }) || 0} 元</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">新目标金额(元)</label>
                <input type="number" value={changeNewTarget} onChange={e => setChangeNewTarget(e.target.value)} placeholder="输入新目标" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" min="0" />
              </div>
              <div>
                <label className="text-xs text-gray-500">变更原因</label>
                <textarea value={changeReason} onChange={e => setChangeReason(e.target.value)} placeholder="说明变更原因..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm h-20 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowChangeModal(null)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={() => handleSubmitChangeRequest(showChangeModal)} className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600">提交申请</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

// District Manager group component
function DMGroup({
  districtManager, supervisors, shopTargets, updateShopTarget, decomposed, expanded, toggleExpand, isLocked, hasPendingChange, shopChangeRequests, onApplyChange, savedTargets, decomposeConfig,
}: {
  districtManager: string;
  supervisors: Record<string, Shop[]>;
  shopTargets: Record<string, string>;
  updateShopTarget: (name: string, val: string) => void;
  decomposed: ShopTarget[];
  expanded: Set<string>;
  toggleExpand: (name: string) => void;
  isLocked: (shopName: string) => boolean;
  hasPendingChange: (shopName: string) => boolean;
  shopChangeRequests: (shopName: string) => ChangeRequest[];
  onApplyChange: (shopName: string) => void;
  savedTargets: SavedTarget[];
  decomposeConfig: { firstRatioPercent: number; firstEndDay: number; secondEndDay: number };
}) {
  return (
    <>
      <tr className="bg-orange-50">
        <td colSpan={7} className="px-3 py-2">
          <span className="font-semibold text-orange-700 text-sm">区经：{districtManager}</span>
          <span className="ml-2 text-xs text-orange-500">(下辖 {Object.values(supervisors).flat().length} 家店铺)</span>
        </td>
      </tr>
      {Object.entries(supervisors).map(([sv, svShops]) => (
        <SupervisorGroup
          key={sv}
          supervisor={sv}
          shops={svShops}
          shopTargets={shopTargets}
          updateShopTarget={updateShopTarget}
          decomposed={decomposed}
          expanded={expanded}
          toggleExpand={toggleExpand}
          isLocked={isLocked}
          hasPendingChange={hasPendingChange}
          shopChangeRequests={shopChangeRequests}
          onApplyChange={onApplyChange}
          savedTargets={savedTargets}
          decomposeConfig={decomposeConfig}
        />
      ))}
    </>
  );
}

// Supervisor group component
function SupervisorGroup({
  supervisor, shops, shopTargets, updateShopTarget, decomposed, expanded, toggleExpand, isLocked, hasPendingChange, shopChangeRequests, onApplyChange, savedTargets, decomposeConfig,
}: {
  supervisor: string;
  shops: Shop[];
  shopTargets: Record<string, string>;
  updateShopTarget: (name: string, val: string) => void;
  decomposed: ShopTarget[];
  expanded: Set<string>;
  toggleExpand: (name: string) => void;
  isLocked: (shopName: string) => boolean;
  hasPendingChange: (shopName: string) => boolean;
  shopChangeRequests: (shopName: string) => ChangeRequest[];
  onApplyChange: (shopName: string) => void;
  savedTargets: SavedTarget[];
  decomposeConfig: { firstRatioPercent: number; firstEndDay: number; secondEndDay: number };
}) {
  const svTotal = shops.reduce((sum, s) => {
    const v = shopTargets[s.shopName];
    return sum + (v ? Number(v) : 0);
  }, 0);

  return (
    <>
      <tr className="bg-gray-50">
        <td colSpan={7} className="px-3 py-1.5">
          <span className="font-medium text-gray-600 text-xs">督导：{supervisor}</span>
          {svTotal > 0 && <span className="ml-2 text-xs text-primary font-medium">(合计: {svTotal.toLocaleString('zh-CN', { useGrouping: false })}元)</span>}
        </td>
      </tr>
      {shops.map(shop => {
        const shopDecomp = decomposed.find(d => d.shopName === shop.shopName);
        const isExpanded = expanded.has(shop.shopName);
        const locked = isLocked(shop.shopName);
        const pendingChange = hasPendingChange(shop.shopName);
        const reqs = shopChangeRequests(shop.shopName);

        return (
          <ShopRow
            key={shop.shopName}
            shop={shop}
            target={shopTargets[shop.shopName] || ''}
            updateTarget={updateShopTarget}
            shopDecomp={shopDecomp}
            isExpanded={isExpanded}
            toggleExpand={toggleExpand}
            locked={locked}
            pendingChange={pendingChange}
            changeRequests={reqs}
            onApplyChange={onApplyChange}
            decomposeConfig={decomposeConfig}
          />
        );
      })}
    </>
  );
}

// Single shop row
function ShopRow({
  shop, target, updateTarget, shopDecomp, isExpanded, toggleExpand, locked, pendingChange, changeRequests, onApplyChange, decomposeConfig,
}: {
  shop: Shop;
  target: string;
  updateTarget: (name: string, val: string) => void;
  shopDecomp: ShopTarget | undefined;
  isExpanded: boolean;
  toggleExpand: (name: string) => void;
  locked: boolean;
  pendingChange: boolean;
  changeRequests: ChangeRequest[];
  onApplyChange: (shopName: string) => void;
  decomposeConfig: { firstRatioPercent: number; firstEndDay: number; secondEndDay: number };
}) {
  const hasTarget = target && Number(target) > 0;
  const firstLabel = `1-${decomposeConfig.firstEndDay}号(${decomposeConfig.firstRatioPercent}%)`;
  const midLabel = `${decomposeConfig.firstEndDay + 1}-${decomposeConfig.secondEndDay}号(${100 - decomposeConfig.firstRatioPercent}%)`;
  const lastLabel = `${decomposeConfig.secondEndDay + 1}号起(无指标)`;

  return (
    <>
      <tr className={`hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-blue-50/50' : ''} ${locked ? 'bg-gray-50/30' : ''}`}>
        <td className="px-3 py-2">
          {shopDecomp && (
            <button onClick={() => toggleExpand(shop.shopName)} className="text-gray-400 hover:text-gray-600">
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          )}
        </td>
        <td className="px-3 py-2 text-gray-500 text-xs">{shop.districtManager}</td>
        <td className="px-3 py-2 text-gray-500 text-xs">{shop.supervisor}</td>
        <td className="px-3 py-2 font-medium text-gray-800">{shop.shopName}</td>
        <td className="px-3 py-2">
          <input
            type="number"
            value={target}
            onChange={e => updateTarget(shop.shopName, e.target.value)}
            placeholder="输入月度目标"
            disabled={locked}
            className={`w-full px-3 py-1.5 border rounded-lg text-sm text-right outline-none ${locked ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed' : 'border-gray-200 focus:ring-2 focus:ring-primary/50 focus:border-primary'}`}
            min="0"
            step="1000"
          />
        </td>
        <td className="px-3 py-2 text-center">
          {locked ? (
            <span className="px-2 py-0.5 bg-green-50 text-green-600 text-xs rounded-full border border-green-200 flex items-center gap-1 w-fit mx-auto">
              <Lock className="w-3 h-3" />已锁定
            </span>
          ) : hasTarget ? (
            <span className="px-2 py-0.5 bg-yellow-50 text-yellow-600 text-xs rounded-full border border-yellow-200">待分解</span>
          ) : (
            <span className="px-2 py-0.5 bg-gray-50 text-gray-400 text-xs rounded-full border border-gray-200">未设置</span>
          )}
          {pendingChange && (
            <span className="px-2 py-0.5 bg-orange-50 text-orange-500 text-xs rounded-full border border-orange-200 flex items-center gap-1 w-fit mx-auto mt-1">
              <Clock className="w-3 h-3" />变更中
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-center">
          {locked && !pendingChange && (
            <button onClick={() => onApplyChange(shop.shopName)} className="flex items-center gap-1 px-2 py-1 border border-orange-300 text-orange-600 rounded text-xs hover:bg-orange-100 mx-auto">
              <Edit3 className="w-3 h-3" />申请变更
            </button>
          )}
        </td>
      </tr>

      {/* Expandable daily detail */}
      {isExpanded && shopDecomp && (
        <tr>
          <td colSpan={7} className="px-4 py-3 bg-blue-50/30">
            <div className="text-xs text-gray-600 mb-2 flex items-center gap-2">
              <span>月目标：<strong>{shopDecomp.monthlyTarget.toLocaleString('zh-CN', { useGrouping: false })}元</strong></span>
              <span className="text-gray-300">|</span>
              <span>日均：<strong>{(shopDecomp.dailyTargets.filter(d => d.target > 0).reduce((s, d) => s + d.target, 0) / shopDecomp.dailyTargets.filter(d => d.target > 0).length || 0).toFixed(0)}元</strong></span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    {shopDecomp.dailyTargets.map(d => (
                      <th key={d.dayIndex} className={`px-1 py-1 text-center font-medium min-w-[52px] ${d.coefficient >= 1.5 ? 'text-red-600' : d.coefficient >= 1.2 ? 'text-orange-500' : d.coefficient >= 1.1 ? 'text-blue-600' : 'text-gray-500'}`}>
                        {d.dayIndex}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-100">
                    {shopDecomp.dailyTargets.map(d => (
                      <td key={d.dayIndex} className="px-1 py-1 text-center text-gray-400" style={{ fontSize: '10px' }}>{d.dayOfWeek}</td>
                    ))}
                  </tr>
                  <tr>
                    {shopDecomp.dailyTargets.map(d => (
                      <td key={d.dayIndex} className={`px-1 py-1 text-center font-mono ${d.target > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                        {d.target > 0 ? d.target.toLocaleString('zh-CN', { useGrouping: false }) : '-'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-50 border border-blue-200 inline-block" />{firstLabel}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-purple-50 border border-purple-200 inline-block" />{midLabel}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-50 border border-gray-200 inline-block" />{lastLabel}</span>
              <span className="flex items-center gap-1"><span className="text-red-600 font-bold">高</span> 周六×1.5</span>
              <span className="flex items-center gap-1"><span className="text-orange-500 font-bold">中</span> 周日×1.2</span>
              <span className="flex items-center gap-1"><span className="text-blue-600 font-bold">中</span> 周五×1.1</span>
              <span className="flex items-center gap-1"><span className="text-gray-500 font-bold">基</span> 周1-4×1.0</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default MonthlyTargetDecomposition;
