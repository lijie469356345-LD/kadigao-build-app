import { useState, useEffect, useMemo } from 'react';
import { Save, RefreshCw, Plus, Trash2, FileSpreadsheet, FileText, Send, Lock, Unlock, Eye } from 'lucide-react';
import Layout from '../components/Layout';
import { useAuthStore } from '../../store/authStore';
import { useAreaSupervisorShopFilter, AreaSupervisorShopFilter } from '../components/AreaSupervisorShopFilter';
import { getSalesReport } from '../../api/reports';
import type { SalesReport } from '../../types';
import axios from '../../api/axios';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface WorkItem { time: string; category: string; content: string; dueDate: string; summary: string; feedback: string; penalty: string; followUp: string; _locked?: boolean; }
interface SummaryData {
  userCode: string; monthYear: string; dealer: string; supervisor: string;
  monthlyTarget: number; monthlyAchieved: number; achievementRate: number; coefficientRatio: number; performanceGap: number;
  areaTarget: number; areaAchieved: number; areaAchievementRate: number; remainingDailyAvg: number;
  orderCountTarget: number; orderCountDone: number; giftRatioTarget: number; giftRatioDone: number;
  newMemberTarget: number; newMemberDone: number; attachmentRateTarget: number; attachmentRateDone: number;
  mainProductTarget: number; mainProductDone: number;
  oldMemberTarget: number; oldMemberDone: number; birthdayTarget: number; birthdayDone: number;
  workItems: WorkItem[];
  weeklySnapshot?: { weekStart: string; weekEnd: string; data: any[] };
  submitted?: boolean;
}
const emptyWI: WorkItem = { time: '', category: '', content: '', dueDate: '', summary: '', feedback: '', penalty: '', followUp: '', _locked: false };

const COLS = [120, 130, 130, 130, 110, 130, 110, 150, 150, 150, 150, 150, 150, 150];
const TOTAL_W = COLS.reduce((a, b) => a + b, 0);

function getDefaultWeekRange() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now); monday.setDate(now.getDate() - day + 1);
  const sunday = new Date(now); sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { startDate: fmt(monday), endDate: fmt(sunday) };
}

function DirectSalesSupervisorPage() {
  const pageTitle = '直营督导运营工作汇报';
  const { user } = useAuthStore();
  const now = new Date();
  const [monthYear, setMonthYear] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const defaultWeek = getDefaultWeekRange();
  const [weekStart, setWeekStart] = useState(defaultWeek.startDate);
  const [weekEnd, setWeekEnd] = useState(defaultWeek.endDate);
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [salesData, setSalesData] = useState<SalesReport[]>([]);
  const [shopTargets, setShopTargets] = useState<Record<string, Record<string, number>>>({});
  const [weekShopTargets, setWeekShopTargets] = useState<Record<string, Record<string, number>>>({});
  const [weeklySalesData, setWeeklySalesData] = useState<SalesReport[]>([]);
  const [submittedList, setSubmittedList] = useState<any[]>([]);
  const [viewUserCode, setViewUserCode] = useState('');
  const [unsubmitting, setUnsubmitting] = useState(false);

  const isAdmin = user?.isAdmin === '是' || (user?.roleCodes || []).includes('super_admin') || (user?.roleCodes || []).includes('data_admin');
  const isViewingOther = !!viewUserCode;

  const loadWeeklySalesData = async () => {
    try {
      const result = await getSalesReport('custom', 'all', user?.groupName || undefined, { startDate: weekStart, endDate: weekEnd });
      setWeeklySalesData(result.data || []);
      return result.data || [];
    } catch (e) { console.error(e); return []; }
  };

  const loadDailyTargets = async (my: string) => {
    try {
      const res = await axios.get(`/daily-shop-targets/by-month/${my}?_t=${Date.now()}`);
      const list = res.data || [];
      const map: Record<string, Record<string, number>> = {};
      list.forEach((r: any) => {
        map[r.shopName] = {
          orderCountTarget: r.orderCountTarget || 0,
          giftRatioTarget: r.giftRatioTarget || 0,
          newMemberTarget: r.newMemberTarget || 0,
          attachmentRateTarget: r.attachmentRateTarget || 0,
          mainProductTarget: r.mainProductTarget || 0,
          oldMemberTarget: r.oldMemberTarget || 0,
          birthdayTarget: r.birthdayTarget || 0,
        };
      });
      setShopTargets(map);
      return map;
    } catch (e) { console.error(e); return {}; }
  };

  const loadWeekDailyTargets = async (startDate: string, endDate: string) => {
    try {
      const [y, m] = startDate.split('-').map(Number);
      const wmy = `${y}-${String(m).padStart(2, '0')}`;
      const res = await axios.get(`/daily-shop-targets/daily-sums/${wmy}/${startDate}/${endDate}?_t=${Date.now()}`);
      const list = res.data || [];
      const map: Record<string, Record<string, number>> = {};
      list.forEach((r: any) => {
        if (!map[r.shopName]) map[r.shopName] = {};
        map[r.shopName][r.fieldName] = (map[r.shopName][r.fieldName] || 0) + (r.weekTarget || 0);
      });
      setWeekShopTargets(map);
      return map;
    } catch (e) { console.error(e); return {}; }
  };

  const loadSalesData = async (my: string) => {
    try {
      const [y, m] = my.split('-').map(Number);
      const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
      const endDate = `${y}-${String(m).padStart(2,'0')}-${new Date(y, m, 0).getDate()}`;
      const result = await getSalesReport('month', 'all', user?.groupName || undefined, { startDate, endDate });
      setSalesData(result.data || []);
      return result.data || [];
    } catch (e) { console.error(e); return []; }
  };

  const loadData = async () => {
    if (!user?.userCode) return; setLoading(true);
    const my = monthYear;
    const effectiveUserCode = viewUserCode || user.userCode;
    try {
      const [res, sales] = await Promise.all([
        axios.get(`/direct-sales-summary/${encodeURIComponent(effectiveUserCode)}/${my}?_t=${Date.now()}`),
        loadSalesData(my),
        loadDailyTargets(my),
      ]);
      loadWeeklySalesData(); // 异步加载本周数据
      const d = res.data;
      if (d && typeof d.workItems === 'string') d.workItems = JSON.parse(d.workItems);
      if (d && !Array.isArray(d.workItems)) d.workItems = [];
      if (sales.length > 0 && !d.monthlyTarget) d.monthlyTarget = sales.reduce((s:number,r:any)=>s+(r.target||0),0);
      if (sales.length > 0 && !d.monthlyAchieved) d.monthlyAchieved = sales.reduce((s:number,r:any)=>s+(r.amount||0),0);
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // 管理员：加载已提交汇报列表
  const loadSubmittedList = async () => {
    try {
      const res = await axios.get(`/direct-sales-summary/submitted/${monthYear}?_t=${Date.now()}`);
      setSubmittedList(res.data || []);
    } catch (e) { console.error(e); setSubmittedList([]); }
  };

  // 管理员：反提交
  const handleUnsubmit = async () => {
    const targetCode = viewUserCode || user?.userCode;
    if (!targetCode) return;
    if (!confirm(`确认反提交 ${targetCode} 的 ${monthYear} 工作汇报？反提交后督导可再次修改。`)) return;
    setUnsubmitting(true);
    try {
      await axios.post('/direct-sales-summary/unsubmit', { userCode: targetCode, monthYear });
      alert('反提交成功，督导可再次修改');
      setViewUserCode('');
      await loadSubmittedList();
      await loadData();
    } catch (e: any) {
      alert('反提交失败: ' + (e?.response?.data?.error || e.message));
    }
    setUnsubmitting(false);
  };

  useEffect(() => { loadData(); if (isAdmin) loadSubmittedList(); }, [monthYear, viewUserCode]); // 跟随时间筛选器切换月份
  useEffect(() => { if (user?.userCode) { loadWeeklySalesData(); loadWeekDailyTargets(weekStart, weekEnd); } }, [weekStart, weekEnd]);
  const up = (f: string, v: any) => setData(p => p ? { ...p, [f]: v } : null);
  const saveData = async () => { if (!data || !user?.userCode) return; setSaving(true); try { await axios.put(`/direct-sales-summary/${encodeURIComponent(user.userCode)}/${monthYear}`, { ...data, createdBy: user.userCode }); alert('保存成功'); } catch (e: any) { alert('保存失败'); } setSaving(false); };

  const submitData = async () => {
    if (!data || !user?.userCode) return;
    setSubmitting(true);
    try {
      const monthlySum = dealerRows.reduce((a, r) => ({
        target: a.target + r.target, achieved: a.achieved + r.achieved,
        orders: a.orders + r.orders, gifts: a.gifts + r.gifts,
        newMember: a.newMember + r.newMember, mainProduct: a.mainProduct + r.mainProduct,
        oldMember: a.oldMember + Math.round(r.oldMember), birthMember: a.birthMember + Math.round(r.birthMember),
        orderCountTarget: a.orderCountTarget + r.orderCountTarget,
        giftRatioTarget: a.giftRatioTarget + r.giftRatioTarget,
        newMemberTarget: a.newMemberTarget + r.newMemberTarget,
        mainProductTarget: a.mainProductTarget + r.mainProductTarget,
        oldMemberTarget: a.oldMemberTarget + r.oldMemberTarget,
        birthdayTarget: a.birthdayTarget + r.birthdayTarget,
      }), { target:0, achieved:0, orders:0, gifts:0, newMember:0, mainProduct:0, oldMember:0, birthMember:0, orderCountTarget:0, giftRatioTarget:0, newMemberTarget:0, mainProductTarget:0, oldMemberTarget:0, birthdayTarget:0 });

      const monthlyData = {
        totalTarget: monthlySum.target, totalAchieved: monthlySum.achieved,
        achievementRate: monthlySum.target > 0 ? +(monthlySum.achieved / monthlySum.target * 100).toFixed(1) : 0,
        performanceGap: monthlySum.target - monthlySum.achieved,
        orderCountTarget: monthlySum.orderCountTarget, orderCountDone: monthlySum.orders,
        giftRatioTarget: monthlySum.giftRatioTarget, giftRatioDone: monthlySum.gifts,
        newMemberTarget: monthlySum.newMemberTarget, newMemberDone: monthlySum.newMember,
        attachmentRateTarget: data.attachmentRateTarget || 0, attachmentRateDone: data.attachmentRateDone || 0,
        mainProductTarget: monthlySum.mainProductTarget, mainProductDone: monthlySum.mainProduct,
        oldMemberTarget: monthlySum.oldMemberTarget, oldMemberDone: monthlySum.oldMember,
        birthdayTarget: monthlySum.birthdayTarget, birthdayDone: monthlySum.birthMember,
        remainingDailyAvg: Math.round((monthlySum.target - monthlySum.achieved) / remainingDays),
      };

      const weeklyData = weeklyDealerRows.map(r => ({
        dealer: r.dm, supervisor: r.sv, target: r.target, achieved: r.achieved,
        orderCountTarget: r.orderCountTarget, orders: r.orders,
        giftRatioTarget: r.giftRatioTarget, gifts: r.gifts,
        attachmentRateTarget: r.attachmentRateTarget, attachment: r.attachment,
        mainProductTarget: r.mainProductTarget, mainProduct: r.mainProduct,
        oldMemberTarget: r.oldMemberTarget, oldMember: Math.round(r.oldMember),
        birthdayTarget: r.birthdayTarget, birthMember: Math.round(r.birthMember),
      }));

      const lockedItems = data.workItems.map(w => ({ ...w, _locked: true }));
      await axios.post('/direct-sales-summary/submit', {
        userCode: user.userCode, monthYear,
        dealer: data.dealer, supervisor: data.supervisor,
        monthlyData, weeklyData, weekStart, weekEnd,
        workItems: lockedItems,
      });
      setData(p => p ? { ...p, workItems: lockedItems } : null);
      alert('提交成功！本月和本周数据已保存。');
    } catch (e: any) {
      alert('提交失败: ' + (e?.response?.data?.error || e.message));
    }
    setSubmitting(false);
  };
  const fmt = (v: number) => v?.toLocaleString?.('zh-CN', { useGrouping: false }) || '0';
  const pct = (a: number, b: number) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '-';

  // ===== 权限过滤：后端已按 GroupPermissions/角色模式过滤，前端直接信任后端 =====
  const permittedSalesData = useMemo(() => {
    return salesData;
  }, [salesData]);

  const filter = useAreaSupervisorShopFilter<SalesReport>(permittedSalesData, {
    getArea: (r) => r.area, getSupervisor: (r) => r.supervisor, getShopName: (r) => r.shopName,
    getWarehouseType: (r) => (r as any).warehouseType, onChange: () => {},
  });

  const computed = useMemo(() => {
    const fd = filter.filteredData.filter(r => !selectedDealer || r.districtManager === selectedDealer);
    const totalTarget = fd.reduce((s,r) => s + (r.target||0), 0);
    const totalAchieved = fd.reduce((s,r) => s + (r.amount||0), 0);
    const dealers = [...new Set(fd.map(r => r.districtManager).filter(Boolean))].sort();
    const supervisors = [...new Set(fd.map(r => r.supervisor).filter(Boolean))].sort();
    return { dealers, supervisors, totalTarget, totalAchieved };
  }, [filter.filteredData, selectedDealer]);

  const remainingDays = useMemo(() => {
    const [y,m] = monthYear.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    const td = new Date();
    const tdy = (td.getFullYear()===y && td.getMonth()+1===m) ? td.getDate() : dim;
    return Math.max(1, dim - tdy);
  }, [monthYear]);

  const timeProgress = useMemo(() => {
    const [y,m] = monthYear.split('-').map(Number);
    const now = new Date();
    const monthStart = new Date(y, m-1, 1);
    const monthEnd = new Date(y, m, 1); // 下月1日0点 = 本月末日24点
    const totalHours = (monthEnd.getTime() - monthStart.getTime()) / 3600000;
    if (now < monthStart) return 0; // 未来月份
    if (now >= monthEnd) return 100; // 已过月份
    const elapsedHours = (now.getTime() - monthStart.getTime()) / 3600000;
    return Math.min(100, (elapsedHours / totalHours) * 100);
  }, [monthYear]);

  const dealerRows = useMemo(() => {
    const map = new Map<string, { dm:string; sv:string; shopName:string; target:number; achieved:number; orders:number; qty:number; gifts:number; giftAmt:number; avgOrder:number; avgItem:number; attachment:number; mainProduct:number; oldMember:number; birthMember:number; newMember:number; orderCountTarget:number; giftRatioTarget:number; newMemberTarget:number; attachmentRateTarget:number; mainProductTarget:number; oldMemberTarget:number; birthdayTarget:number; attShopCount:number }>();
    filter.filteredData.filter(r => !selectedDealer || r.districtManager === selectedDealer).forEach(r => {
      const sv = r.supervisor || '', sn = r.shopName, key = sv+'|'+sn;
      if (!map.has(key)) map.set(key, { dm: r.districtManager||'', sv, shopName: sn, target:0, achieved:0, orders:0, qty:0, gifts:0, giftAmt:0, avgOrder:0, avgItem:0, attachment:0, mainProduct:0, oldMember:0, birthMember:0, newMember:0, orderCountTarget:0, giftRatioTarget:0, newMemberTarget:0, attachmentRateTarget:0, mainProductTarget:0, oldMemberTarget:0, birthdayTarget:0, attShopCount:0 });
      const v = map.get(key)!;
      v.target += r.target||0; v.achieved += r.amount||0; v.orders += r.orderCount||0; v.qty += r.quantity||0;
      v.gifts += r.giftPackageCount||0; v.giftAmt += r.giftPackageAmount||0;
      v.mainProduct += (r as any).mainProductCount||0;
      v.oldMember += (r as any).oldMemberAmount||0;
      v.birthMember += (r as any).birthMemberAmount||0;
      v.newMember += (r as any).newMemberCount||0;
      const st = shopTargets[r.shopName];
      if (st) {
        v.orderCountTarget += st.orderCountTarget || 0;
        v.giftRatioTarget += st.giftRatioTarget || 0;
        v.newMemberTarget += st.newMemberTarget || 0;
        v.attachmentRateTarget += st.attachmentRateTarget || 0;
        v.attShopCount++;
        v.mainProductTarget += st.mainProductTarget || 0;
        v.oldMemberTarget += st.oldMemberTarget || 0;
        v.birthdayTarget += st.birthdayTarget || 0;
      }
    });
    for (const v of map.values()) {
      v.qty = Math.round(v.qty); v.avgOrder = v.orders>0?v.achieved/v.orders:0; v.avgItem = v.qty>0?v.achieved/v.qty:0; v.attachment = v.orders>0?v.qty/v.orders:0;
      if (v.attShopCount > 0) v.attachmentRateTarget = +(v.attachmentRateTarget / v.attShopCount).toFixed(2);
    }
    return Array.from(map.values()).sort((a,b)=>a.sv.localeCompare(b.sv)||a.shopName.localeCompare(b.shopName));
  }, [filter.filteredData, selectedDealer, shopTargets]);

  const filteredWeeklyData = useMemo(() => {
    return weeklySalesData.filter(r => {
      if (filter.selectedAreas.length > 0 && !filter.selectedAreas.includes(r.area || '')) return false;
      if (filter.selectedSupervisors.length > 0 && !filter.selectedSupervisors.includes(r.supervisor || '')) return false;
      if (filter.selectedShops.length > 0 && !filter.selectedShops.includes(r.shopName)) return false;
      if (filter.selectedWarehouses.length > 0 && !filter.selectedWarehouses.includes((r as any).warehouseType || '')) return false;
      return true;
    });
  }, [weeklySalesData, filter.selectedAreas, filter.selectedSupervisors, filter.selectedShops, filter.selectedWarehouses]);

  const weeklyDealerRows = useMemo(() => {
    const map = new Map<string, { dm:string; sv:string; shopName:string; target:number; achieved:number; orderCountTarget:number; orders:number; qty:number; giftRatioTarget:number; gifts:number; attachmentRateTarget:number; attachment:number; mainProductTarget:number; mainProduct:number; oldMemberTarget:number; oldMember:number; birthdayTarget:number; birthMember:number }>();
    filteredWeeklyData.filter(r => !selectedDealer || r.districtManager === selectedDealer).forEach(r => {
      const sv = r.supervisor || '', sn = r.shopName, key = sv+'|'+sn;
      if (!map.has(key)) {
        const st = weekShopTargets[sn] || {};
        map.set(key, { dm: r.districtManager||'', sv, shopName: sn, target:0, achieved:0,
          orderCountTarget: st.orderCountTarget || 0, orders:0, qty:0,
          giftRatioTarget: st.giftRatioTarget || 0, gifts:0,
          attachmentRateTarget: st.attachmentRateTarget || 0, attachment:0,
          mainProductTarget: st.mainProductTarget || 0, mainProduct:0,
          oldMemberTarget: st.oldMemberTarget || 0, oldMember:0,
          birthdayTarget: st.birthdayTarget || 0, birthMember:0 });
      }
      const v = map.get(key)!;
      v.target += r.target||0; v.achieved += r.amount||0; v.orders += r.orderCount||0;
      v.qty += r.quantity||0;
      v.gifts += r.giftPackageCount||0; v.mainProduct += (r as any).mainProductCount||0;
      v.oldMember += (r as any).oldMemberAmount||0; v.birthMember += (r as any).birthMemberAmount||0;
    });
    for (const v of map.values()) {
      v.attachment = v.orders>0?v.qty/v.orders:0;
    }
    return Array.from(map.values()).sort((a,b)=>a.sv.localeCompare(b.sv)||a.shopName.localeCompare(b.shopName));
  }, [filteredWeeklyData, selectedDealer, weekShopTargets]);

  const inp = 'w-14 px-1 py-0.5 border border-gray-300 rounded text-center text-xs outline-none focus:ring-1 focus:ring-blue-400';
  const inpW = 'w-full px-1 py-0.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-blue-400';

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet1: 本月数据详情
    const monthRows: any[][] = [['督导','店铺名称','区域目标','区域业绩','区域达成率','剩余日均销','开单数(目标)','开单数(完成)','礼包量(目标)','礼包量(完成)','新增消费会员','连带率(目标)','连带率(完成)','主推款(目标)','主推款(完成)','老会员贡献(目标)','老会员贡献(完成)','生日会员贡献(目标)','生日会员贡献(完成)']];
    dealerRows.forEach(r => {
      monthRows.push([r.sv, r.shopName, fmt(r.target), fmt(r.achieved), pct(r.achieved, r.target), Math.round((r.target - r.achieved) / remainingDays),
        r.orderCountTarget||0, r.orders, r.giftRatioTarget||0, r.gifts, r.newMember,
        r.attachmentRateTarget||0, r.attachment.toFixed(2), r.mainProductTarget||0, r.mainProduct,
        r.oldMemberTarget||0, Math.round(r.oldMember), r.birthdayTarget||0, Math.round(r.birthMember)]);
    });
    const ws1 = XLSX.utils.aoa_to_sheet(monthRows);
    XLSX.utils.book_append_sheet(wb, ws1, '本月数据详情');

    // Sheet2: 本周数据详情
    const weekRows: any[][] = [['督导','店铺名称','本周目标','本周业绩','本周达成率','开单数目标','开单数达成','礼包数目标','礼包数达成','连带率目标','连带率达成','主推目标','主推达成','老会员目标','老会员达成','生日会员目标','生日会员达成']];
    weeklyDealerRows.forEach(r => {
      weekRows.push([r.sv, r.shopName, fmt(r.target), fmt(r.achieved), r.target>0?((r.achieved/r.target)*100).toFixed(1)+'%':'-',
        r.orderCountTarget||0, r.orders, r.giftRatioTarget||0, r.gifts,
        r.attachmentRateTarget||0, r.attachment.toFixed(2), r.mainProductTarget||0, r.mainProduct,
        r.oldMemberTarget||0, Math.round(r.oldMember), r.birthdayTarget||0, Math.round(r.birthMember)]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(weekRows);
    XLSX.utils.book_append_sheet(wb, ws2, '本周数据详情');

    // Sheet3: 本月工作重点
    const workRows: any[][] = [['执行时间','工作类目','具体内容','预计完成','工作总结','反馈方式','乐捐机制','工作计划项目跟进','状态']];
    (data?.workItems||[]).forEach(item => {
      workRows.push([item.time, item.category, item.content, item.dueDate, item.summary, item.feedback, item.penalty, item.followUp, item._locked?'已锁定':'编辑中']);
    });
    const ws3 = XLSX.utils.aoa_to_sheet(workRows);
    XLSX.utils.book_append_sheet(wb, ws3, '本月工作重点');

    XLSX.writeFile(wb, `运营工作汇报_${monthYear}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportPDF = async () => {
    // 本月数据详情 HTML
    const monthHTML = dealerRows.map((r,i) => {
      const bg = i%2?'#f9fafb':'#fff';
      const td = (c: string) => '<td style="border:1px solid #9ca3af;padding:3px 4px;text-align:center;font-size:10px">'+c+'</td>';
      const rateHTML = (tgt: number, done: number) => tgt > 0 ? ' <span style="color:#006633;font-size:9px">('+Math.round(done/tgt*100)+'%)</span>' : '';
      return '<tr style="background:'+bg+'">'+td(r.sv)+td(r.shopName)+td(fmt(r.target))+td(fmt(r.achieved))+td(pct(r.achieved,r.target))+td(String(Math.round((r.target-r.achieved)/remainingDays)))+
        td('<span style="color:#004799;font-weight:bold">'+(r.orderCountTarget?fmt(r.orderCountTarget):'-')+'</span> / <span style="color:#990000;font-weight:bold">'+r.orders+'</span>'+rateHTML(r.orderCountTarget,r.orders))+
        td('<span style="color:#004799;font-weight:bold">'+(r.giftRatioTarget?fmt(r.giftRatioTarget):'-')+'</span> / <span style="color:#990000;font-weight:bold">'+r.gifts+'</span>'+rateHTML(r.giftRatioTarget,r.gifts))+
        td('<span style="color:#004799;font-weight:bold">'+(r.newMemberTarget?fmt(r.newMemberTarget):'-')+'</span> / <span style="color:#990000;font-weight:bold">'+r.newMember+'</span>'+rateHTML(r.newMemberTarget,r.newMember))+
        td('<span style="color:#004799;font-weight:bold">'+(r.attachmentRateTarget?r.attachmentRateTarget.toFixed(2):'-')+'</span> / <span style="color:#990000;font-weight:bold">'+r.attachment.toFixed(2)+'</span>'+rateHTML(r.attachmentRateTarget,Number(r.attachment.toFixed(2))))+
        td('<span style="color:#004799;font-weight:bold">'+(r.mainProductTarget?fmt(r.mainProductTarget):'-')+'</span> / <span style="color:#990000;font-weight:bold">'+r.mainProduct+'</span>'+rateHTML(r.mainProductTarget,r.mainProduct))+
        td('<span style="color:#004799;font-weight:bold">'+(r.oldMemberTarget?fmt(r.oldMemberTarget):'-')+'</span> / <span style="color:#990000;font-weight:bold">'+fmt(Math.round(r.oldMember))+'</span>'+rateHTML(r.oldMemberTarget,Math.round(r.oldMember)))+
        td('<span style="color:#004799;font-weight:bold">'+(r.birthdayTarget?fmt(r.birthdayTarget):'-')+'</span> / <span style="color:#990000;font-weight:bold">'+fmt(Math.round(r.birthMember))+'</span>'+rateHTML(r.birthdayTarget,Math.round(r.birthMember)))+'</tr>';
    }).join('');

    // 本周数据详情 HTML
    const weekHTML = weeklyDealerRows.length === 0 ? '<tr><td colspan="18" style="border:1px solid #9ca3af;padding:8px;text-align:center;color:#888;font-size:10px">暂无本周数据</td></tr>' :
      weeklyDealerRows.map((r,i) => {
        const bg = i%2?'#f9fafb':'#fff';
        const td = (c: string) => '<td style="border:1px solid #9ca3af;padding:3px 4px;text-align:center;font-size:10px">'+c+'</td>';
        const wkRate = r.target>0 ? ((r.achieved/r.target)*100).toFixed(1)+'%' : '-';
        return '<tr style="background:'+bg+'">'+td(r.sv)+td(r.shopName)+td(fmt(r.target))+td(fmt(r.achieved))+td(wkRate)+
          td((r.orderCountTarget||0)+'/'+r.orders)+td((r.giftRatioTarget||0)+'/'+r.gifts)+
          td((r.attachmentRateTarget||0).toFixed(2)+'/'+r.attachment.toFixed(2))+
          td((r.mainProductTarget||0)+'/'+r.mainProduct)+td((r.oldMemberTarget||0)+'/'+Math.round(r.oldMember))+
          td((r.birthdayTarget||0)+'/'+Math.round(r.birthMember))+'</tr>';
      }).join('');

    // 本月工作重点 HTML
    const workHTML = (!data?.workItems||data.workItems.length===0) ? '<tr><td colspan="9" style="border:1px solid #9ca3af;padding:8px;text-align:center;color:#888;font-size:10px">暂无工作项目</td></tr>' :
      data.workItems.map((item) => {
        const td = (c: string) => '<td style="border:1px solid #9ca3af;padding:3px 4px;text-align:center;font-size:10px">'+(c||'')+'</td>';
        const status = item._locked ? '<span style="color:#990000">已锁定</span>' : '<span style="color:#006633">编辑中</span>';
        return '<tr>'+td(item.time)+td(item.category)+td(item.content)+td(item.dueDate)+td(item.summary)+td(item.feedback)+td(item.penalty)+td(item.followUp)+td(status)+'</tr>';
      }).join('');

    const html = '<div style="background:#fff;padding:8px;font-family:Arial">' +
      '<h2 style="text-align:center;color:#004799;font-size:16px;margin:0 0 8px">运营工作汇报 - '+monthYear+' | 时间进度 '+timeProgress.toFixed(1)+'%</h2>' +
      '<h3 style="color:#004799;font-size:13px;border-bottom:1px solid #93c5fd;padding-bottom:4px;margin:8px 0 4px">本月数据详情</h3>' +
      '<table style="border-collapse:collapse;font-size:10px;width:100%"><thead><tr style="background:#dbeafe;font-weight:bold;text-align:center">'+
      '<td style="border:1px solid #9ca3af;padding:3px">督导</td><td style="border:1px solid #9ca3af;padding:3px">店铺名称</td><td style="border:1px solid #9ca3af;padding:3px">区域目标</td><td style="border:1px solid #9ca3af;padding:3px">区域业绩</td><td style="border:1px solid #9ca3af;padding:3px">达成率</td><td style="border:1px solid #9ca3af;padding:3px">剩余日均销</td><td style="border:1px solid #9ca3af;padding:3px">开单数</td><td style="border:1px solid #9ca3af;padding:3px">礼包量</td><td style="border:1px solid #9ca3af;padding:3px">新增会员</td><td style="border:1px solid #9ca3af;padding:3px">连带率</td><td style="border:1px solid #9ca3af;padding:3px">主推款</td><td style="border:1px solid #9ca3af;padding:3px">老会员</td><td style="border:1px solid #9ca3af;padding:3px">生日会员</td></tr></thead><tbody>'+monthHTML+'</tbody></table>' +
      '<h3 style="color:#059669;font-size:13px;border-bottom:1px solid #86efac;padding-bottom:4px;margin:12px 0 4px">本周数据详情 ('+weekStart+' ~ '+weekEnd+')</h3>' +
      '<table style="border-collapse:collapse;font-size:10px;width:100%"><thead><tr style="background:#dcfce7;font-weight:bold;text-align:center">'+
      '<td style="border:1px solid #9ca3af;padding:3px">督导</td><td style="border:1px solid #9ca3af;padding:3px">店铺名称</td><td style="border:1px solid #9ca3af;padding:3px">本周目标</td><td style="border:1px solid #9ca3af;padding:3px">本周业绩</td><td style="border:1px solid #9ca3af;padding:3px">达成率</td><td style="border:1px solid #9ca3af;padding:3px">开单数(目/达)</td><td style="border:1px solid #9ca3af;padding:3px">礼包(目/达)</td><td style="border:1px solid #9ca3af;padding:3px">连带率(目/达)</td><td style="border:1px solid #9ca3af;padding:3px">主推(目/达)</td><td style="border:1px solid #9ca3af;padding:3px">老会员(目/达)</td><td style="border:1px solid #9ca3af;padding:3px">生日会员(目/达)</td></tr></thead><tbody>'+weekHTML+'</tbody></table>' +
      '<h3 style="color:#7c3aed;font-size:13px;border-bottom:1px solid #c4b5fd;padding-bottom:4px;margin:12px 0 4px">本月工作重点</h3>' +
      '<table style="border-collapse:collapse;font-size:10px;width:100%"><thead><tr style="background:#ede9fe;font-weight:bold;text-align:center">'+
      '<td style="border:1px solid #9ca3af;padding:3px">执行时间</td><td style="border:1px solid #9ca3af;padding:3px">工作类目</td><td style="border:1px solid #9ca3af;padding:3px">具体内容</td><td style="border:1px solid #9ca3af;padding:3px">预计完成</td><td style="border:1px solid #9ca3af;padding:3px">工作总结</td><td style="border:1px solid #9ca3af;padding:3px">反馈方式</td><td style="border:1px solid #9ca3af;padding:3px">乐捐机制</td><td style="border:1px solid #9ca3af;padding:3px">工作跟进</td><td style="border:1px solid #9ca3af;padding:3px">状态</td></tr></thead><tbody>'+workHTML+'</tbody></table></div>';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:-9999px;top:0';
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    await new Promise(r=>setTimeout(r,300));
    const canvas = await html2canvas(wrap, { scale: 1.5, backgroundColor: '#fff', useCORS: true, allowTaint: true, logging: false });
    document.body.removeChild(wrap);
    const img = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF('l', 'mm', 'a4');
    const pw = pdf.internal.pageSize.getWidth(); const ph = pdf.internal.pageSize.getHeight();
    const ratio = pw / canvas.width; const imgH = canvas.height * ratio;
    pdf.addImage(img, 'JPEG', 0, 0, pw, imgH);
    let remaining = imgH - ph;
    let pos = 0;
    while (remaining > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); remaining -= ph; }
    pdf.save('运营工作汇报_'+monthYear+'_'+new Date().toISOString().slice(0,10)+'.pdf');
  };
  const achievementColor = (rate: number) => rate >= 80 ? '#006633' : rate >= 50 ? '#eab308' : '#990000';

  const tdB = 'border border-gray-400 px-3 py-2 text-base font-bold text-center align-middle';
  const th2 = 'border border-gray-400 px-2 py-1.5 text-xs font-bold text-gray-700 text-center bg-gray-100 align-middle';
  const tdV = 'border border-gray-400 px-2 py-1.5 text-xs text-center align-middle';

  if (!user) return <Layout title={pageTitle}><p className="text-gray-500 p-8">请先登录</p></Layout>;

  return (
    <Layout title={pageTitle} subtitle={`${monthYear} 运营数据填报`}>
      <div className="p-2 work-report-container" style={{ width: TOTAL_W + 16 }}>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-xs text-gray-500 font-bold">月筛选:</span>
          <input type="month" value={monthYear} onChange={e=>setMonthYear(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm w-36" />
          <span className={`text-xs font-bold px-2 py-1 rounded ${timeProgress >= 80 ? 'bg-red-100 text-red-600' : timeProgress >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-600'}`}>
            本月时间进度 {timeProgress.toFixed(1)}%
          </span>
          <span className="text-xs text-gray-500 font-bold ml-2">时间筛选:</span>
          <input type="date" value={weekStart} onChange={e=>setWeekStart(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm" />
          <span className="text-xs text-gray-400">至</span>
          <input type="date" value={weekEnd} onChange={e=>setWeekEnd(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-sm" />
          <button onClick={loadData} disabled={loading} className="px-3 py-1 bg-gray-100 rounded text-sm hover:bg-gray-200"><RefreshCw size={14} className={loading?'animate-spin inline':'inline'} /> 刷新</button>
          <button onClick={saveData} disabled={saving || isViewingOther} className="px-4 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"><Save size={14} className="inline" /> {saving?'保存中...':'保存'}</button>
          <button onClick={submitData} disabled={submitting || isViewingOther} className="px-4 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"><Send size={14} className="inline" /> {submitting?'提交中...':'提交'}</button>
          {isViewingOther && (data?.submitted || (data?.workItems || []).some(w => w._locked)) && (
            <button onClick={handleUnsubmit} disabled={unsubmitting} className="px-4 py-1 bg-orange-500 text-white rounded text-sm hover:bg-orange-600"><Unlock size={14} className="inline" /> {unsubmitting?'反提交中...':'反提交'}</button>
          )}
          {isViewingOther && (
            <button onClick={() => setViewUserCode('')} className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"><RefreshCw size={14} className="inline" /> 返回我的汇报</button>
          )}
          {isAdmin && (
            <>
              <span className="text-xs text-gray-400 mx-1">|</span>
              <span className="text-xs text-gray-500 font-bold">已提交汇报:</span>
              <select
                value={viewUserCode}
                onChange={e => setViewUserCode(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-xs max-w-[200px]"
              >
                  <option value="">-- 查看已提交 --</option>
                {submittedList.map((s, i) => (
                  <option key={i} value={s.userCode}>
                    {s.userName || s.supervisor || s.dealer || s.userCode} ({s.workItemCount}项) {new Date(s.updatedAt).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </>
          )}
          <span className="text-xs text-gray-400 mx-1">|</span>
          <span className="text-xs text-gray-500">区经:</span>
          <select value={selectedDealer} onChange={e=>setSelectedDealer(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs">
            <option value="">全部</option>
            {computed.dealers.map(d=><option key={d} value={d}>{d}</option>)}
          </select>
          <AreaSupervisorShopFilter filter={filter as any} />
          <span className="text-xs text-gray-400 mx-1">|</span>
          <button onClick={exportExcel} className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"><FileSpreadsheet size={14} className="inline" /> 导出Excel</button>
          <button onClick={exportPDF} className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"><FileText size={14} className="inline" /> 导出PDF</button>
        </div>
        {loading ? <p className="text-gray-400 py-8 text-center">加载中...</p> : data && (<>
          <div className="bg-white border border-gray-400 rounded mb-4 overflow-x-auto">
            <h3 className="text-sm font-bold text-blue-600 px-3 py-2 border-b border-gray-400 bg-blue-50">本月数据详情</h3>
            <table className="border-collapse table-fixed" style={{ width: TOTAL_W }}>
              <colgroup>{COLS.map((w,i)=><col key={i} width={w} />)}</colgroup>
              <tbody>
                <tr className="bg-blue-50">
                  <td className={tdB} rowSpan={dealerRows.length+3}>本月<br/>数据<br/>详情</td>
                  <td className={tdB}>本月目标</td><td className={tdB}>{fmt(computed.totalTarget)}</td>
                  <td className={tdB}>本月业绩</td><td className={tdB}>{fmt(computed.totalAchieved)}</td>
                  <td className={tdB}>达成率</td><td className={tdB} style={{color:computed.totalTarget>0&&computed.totalAchieved>=computed.totalTarget?'#006633':'#990000'}}>{pct(computed.totalAchieved,computed.totalTarget)}</td>
                  <td className={tdB}>时间进度</td><td className={tdB}>{timeProgress.toFixed(1)}%</td>
                  <td className={tdB}>业绩差额</td><td className={tdB} style={{color:'#990000'}}>{fmt(computed.totalTarget - computed.totalAchieved)}</td>
                  <td className={tdB}>人效同比</td><td className={tdB}>33000/30000</td>
                  <td className={tdB}>10%</td>
                </tr>
                <tr className="bg-gray-100">
                  <td className={th2}>督导</td><td className={th2}>店铺名称</td>
                  <td className={th2}>区域目标</td><td className={th2}>区域业绩</td><td className={th2}>区域达成率</td>
                  <td className={th2}>剩余日均销</td><td className={th2}>开单数</td><td className={th2}>礼包量</td>
                  <td className={th2}>新增消费会员</td><td className={th2}>连带率</td><td className={th2}>主推款</td>
                  <td className={th2}>老会员贡献</td><td className={th2}>生日会员贡献</td>
                </tr>
                {dealerRows.map((r,i)=>{
                  const achRate = r.target > 0 ? (r.achieved / r.target) * 100 : 0;
                  const bgColor = achievementColor(achRate);
                  return (
                <tr key={i} className={i%2===0?'bg-white':'bg-gray-50'} style={{borderLeft:'4px solid '+bgColor}}>
                  <td className={tdV}>{r.sv}</td><td className={tdV}>{r.shopName}</td>
                  <td className={tdV}>{fmt(r.target)}</td><td className={tdV}>{fmt(r.achieved)}</td>
                  <td className={tdV} style={{color:bgColor,fontWeight:'bold'}}>{pct(r.achieved,r.target)}</td>
                  {(()=>{const v=Math.round((r.target-r.achieved)/remainingDays);return <td className={tdV} style={{color:v<=0?'#006633':'#990000',fontWeight:'bold'}}>{v}</td>;})()}
                  {(() => {
                    const sTgt = { color: '#004799', fontSize: '15px', fontWeight: 'bold' };
                    const sDone = { color: '#990000', fontSize: '15px', fontWeight: 'bold' };
                    const sRate = { color: '#006633', fontSize: '12px' };
                    const rateVal = (tgt: number, done: number) => tgt > 0 ? ((done / tgt) * 100).toFixed(0) + '%' : '';
                    const cell = (tgt: number, done: number | string) => (
                      <td className={tdV} style={{ textAlign: 'center' }}>
                        <span style={sDone}>{typeof done === 'string' ? done : fmt(done)}</span>
                        <span style={{ fontSize: '10px', color: '#888', margin: '0 2px' }}>/</span>
                        <span style={sTgt}>{tgt ? (typeof done === 'number' && !Number.isInteger(done) ? fmt(Math.round(tgt)) : fmt(tgt)) : '-'}</span>
                        {typeof done === 'number' && tgt > 0 && <span style={sRate}> ({rateVal(tgt, done)})</span>}
                      </td>
                    );
                    return <>
                      {cell(r.orderCountTarget, r.orders)}
                      {cell(r.giftRatioTarget, r.gifts)}
                      {cell(r.newMemberTarget, r.newMember)}
                      {cell(r.attachmentRateTarget.toFixed(2) as any, r.attachment.toFixed(2))}
                      {cell(r.mainProductTarget, r.mainProduct)}
                      {cell(r.oldMemberTarget, Math.round(r.oldMember))}
                      {cell(r.birthdayTarget, Math.round(r.birthMember))}
                    </>;
                  })()}
                </tr>
                )})}
                {dealerRows.length > 0 && (() => {
                  const t = dealerRows.reduce((a, r) => ({
                    target: a.target + r.target, achieved: a.achieved + r.achieved,
                    orders: a.orders + r.orders, gifts: a.gifts + r.gifts,
                    newMember: a.newMember + r.newMember, mainProduct: a.mainProduct + r.mainProduct,
                    oldMember: a.oldMember + Math.round(r.oldMember), birthMember: a.birthMember + Math.round(r.birthMember),
                    orderCountTarget: a.orderCountTarget + r.orderCountTarget,
                    giftRatioTarget: a.giftRatioTarget + r.giftRatioTarget,
                    newMemberTarget: a.newMemberTarget + r.newMemberTarget,
                    mainProductTarget: a.mainProductTarget + r.mainProductTarget,
                    oldMemberTarget: a.oldMemberTarget + r.oldMemberTarget,
                    birthdayTarget: a.birthdayTarget + r.birthdayTarget,
                    attCount: a.attCount + 1,
                    attSum: a.attSum + r.attachmentRateTarget,
                    attDoneSum: a.attDoneSum + Number(r.attachment.toFixed(2)),
                  }), { target:0, achieved:0, orders:0, gifts:0, newMember:0, mainProduct:0, oldMember:0, birthMember:0, orderCountTarget:0, giftRatioTarget:0, newMemberTarget:0, mainProductTarget:0, oldMemberTarget:0, birthdayTarget:0, attCount:0, attSum:0, attDoneSum:0 });
                  const achRate = t.target > 0 ? ((t.achieved / t.target) * 100).toFixed(0) + '%' : '-';
                  const sBig = { fontSize: '15px', fontWeight: 'bold' };
                  const sBlue = { ...sBig, color: '#004799' };
                  const sRed = { ...sBig, color: '#990000' };
                  const sGreen = { color: '#006633', fontSize: '12px' };
                  const rateCell = (tgt:number, done:number) => tgt>0 ? <span style={sGreen}> ({(done/tgt*100).toFixed(0)}%)</span> : null;
                  const sv2 = Math.round((t.target-t.achieved)/remainingDays);
                  return (
                    <tr className="bg-yellow-100" style={{fontWeight:'bold',fontSize:'15px'}}>
                      <td className={tdV}></td>
                      <td className={tdV} style={{fontSize:'16px'}}>合计</td>
                      <td className={tdV}>{fmt(t.target)}</td>
                      <td className={tdV}>{fmt(t.achieved)}</td>
                      <td className={tdV}>{achRate}</td>
                      <td className={tdV} style={{color:sv2<=0?'#006633':'#990000',fontWeight:'bold'}}>{sv2}</td>
                      <td className={tdV}><span style={sRed}>{fmt(t.orders)}</span> / <span style={sBlue}>{fmt(t.orderCountTarget)}</span>{rateCell(t.orderCountTarget, t.orders)}</td>
                      <td className={tdV}><span style={sRed}>{fmt(t.gifts)}</span> / <span style={sBlue}>{fmt(t.giftRatioTarget)}</span>{rateCell(t.giftRatioTarget, t.gifts)}</td>
                      <td className={tdV}><span style={sRed}>{fmt(t.newMember)}</span> / <span style={sBlue}>{fmt(t.newMemberTarget)}</span>{rateCell(t.newMemberTarget, t.newMember)}</td>
                      <td className={tdV}><span style={sRed}>{t.attCount>0?(t.attDoneSum/t.attCount).toFixed(2):'-'}</span> / <span style={sBlue}>{t.attCount>0?(t.attSum/t.attCount).toFixed(2):'-'}</span></td>
                      <td className={tdV}><span style={sRed}>{fmt(t.mainProduct)}</span> / <span style={sBlue}>{fmt(t.mainProductTarget)}</span>{rateCell(t.mainProductTarget, t.mainProduct)}</td>
                      <td className={tdV}><span style={sRed}>{fmt(t.oldMember)}</span> / <span style={sBlue}>{fmt(t.oldMemberTarget)}</span>{rateCell(t.oldMemberTarget, t.oldMember)}</td>
                      <td className={tdV}><span style={sRed}>{fmt(t.birthMember)}</span> / <span style={sBlue}>{fmt(t.birthdayTarget)}</span>{rateCell(t.birthdayTarget, t.birthMember)}</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
          {/* 本周数据详情 */}
          <div className="bg-white border border-gray-400 rounded mb-4 overflow-x-auto">
            <h3 className="text-sm font-bold text-green-600 px-3 py-2 border-b border-gray-400 bg-green-50">本周数据详情</h3>
            <table className="border-collapse text-xs w-full" style={{ minWidth: 1900 }}>
              <colgroup>
                <col width="70" />
                <col width="100" /><col width="100" />
                <col width="100" /><col width="100" /><col width="90" />
                <col width="100" /><col width="90" />
                <col width="100" /><col width="90" />
                <col width="100" /><col width="90" />
                <col width="100" /><col width="90" />
                <col width="100" /><col width="90" />
                <col width="100" /><col width="90" />
              </colgroup>
              <thead>
                <tr className="bg-green-50">
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700"></th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">经销商</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">督导</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">本周目标</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">本周业绩</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">本周达成</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">开单数目标</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">开单数达成</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">礼包数目标</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">礼包数达成</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">连带率目标</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">连带率</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">主推目标</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">主推达成</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">老会员目标</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">老会员达成</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">生日会员目标</th>
                  <th className="border border-gray-400 px-2 py-1.5 text-gray-700">生日会员达成</th>
                </tr>
              </thead>
              <tbody>
                {weeklyDealerRows.length === 0 ? (
                  <tr><td colSpan={18} className="border border-gray-400 px-6 py-4 text-center text-gray-400">暂无本周数据</td></tr>
                ) : (<>
                  {weeklyDealerRows.map((r,i)=>{
                    const wkAchRate = r.target > 0 ? ((r.achieved / r.target) * 100).toFixed(1) + '%' : '-';
                    const td = 'border border-gray-400 px-2 py-1.5 text-xs text-center align-middle';
                    const tgtCell = (v:number) => <td className={td} style={{color:'#004799',fontWeight:'bold',fontSize:'15px'}}>{v>0?fmt(v):'-'}</td>;
                    const rateCell = (tgt:number, done:number) => {
                      const rv = tgt>0 ? ((done/tgt)*100).toFixed(1)+'%' : '-';
                      return <td className={td} style={{fontWeight:'bold',fontSize:'15px',color:tgt>0&&done>=tgt?'#006633':'#990000'}}>{rv}</td>;
                    };
                    return (
                      <tr key={i} className={i%2===0?'bg-white':'bg-gray-50'}>
                        {i===0 && <td className={td} rowSpan={weeklyDealerRows.length+1} style={{fontWeight:'bold',color:'#059669',fontSize:'13px'}}>本周<br/>数据<br/>详情</td>}
                        <td className={td}>{r.sv}</td><td className={td}>{r.shopName}</td>
                        <td className={td}>{fmt(r.target)}</td>
                        <td className={td}>{fmt(r.achieved)}</td>
                        <td className={td} style={{fontWeight:'bold',color:r.target>0&&r.achieved>=r.target?'#006633':'#990000'}}>{wkAchRate}</td>
                        {tgtCell(r.orderCountTarget)}
                        {rateCell(r.orderCountTarget, r.orders)}
                        {tgtCell(r.giftRatioTarget)}
                        {rateCell(r.giftRatioTarget, r.gifts)}
                        {tgtCell(r.attachmentRateTarget.toFixed(2) as any)}
                        <td className={td} style={{fontSize:'15px',fontWeight:'bold'}}>{r.attachment>0?r.attachment.toFixed(2):'-'}</td>
                        {tgtCell(r.mainProductTarget)}
                        {rateCell(r.mainProductTarget, r.mainProduct)}
                        {tgtCell(r.oldMemberTarget)}
                        {rateCell(r.oldMemberTarget, Math.round(r.oldMember))}
                        {tgtCell(r.birthdayTarget)}
                        {rateCell(r.birthdayTarget, Math.round(r.birthMember))}
                      </tr>
                    );
                  })}
                  {/* 合计行 */}
                  {(() => {
                    const wt = weeklyDealerRows.reduce((a,r) => ({
                      target: a.target+r.target, achieved: a.achieved+r.achieved,
                      orderCountTarget: a.orderCountTarget+r.orderCountTarget, orders: a.orders+r.orders, qty: a.qty+(r.qty||0),
                      giftRatioTarget: a.giftRatioTarget+r.giftRatioTarget, gifts: a.gifts+r.gifts,
                      attachmentRateTarget: a.attachmentRateTarget+r.attachmentRateTarget, attachment: a.attachment+r.attachment,
                      mainProductTarget: a.mainProductTarget+r.mainProductTarget, mainProduct: a.mainProduct+r.mainProduct,
                      oldMemberTarget: a.oldMemberTarget+r.oldMemberTarget, oldMember: a.oldMember+r.oldMember,
                      birthdayTarget: a.birthdayTarget+r.birthdayTarget, birthMember: a.birthMember+r.birthMember,
                    }), { target:0, achieved:0, orderCountTarget:0, orders:0, qty:0, giftRatioTarget:0, gifts:0, attachmentRateTarget:0, attachment:0, mainProductTarget:0, mainProduct:0, oldMemberTarget:0, oldMember:0, birthdayTarget:0, birthMember:0 });
                    const td2 = 'border border-gray-400 px-2 py-1.5 text-xs text-center font-bold align-middle';
                    const wr = (t:number,d:number) => t>0 ? ((d/t)*100).toFixed(1) : '-';
                    const tgtC2 = (v:number) => <td className={td2} style={{color:'#004799',fontSize:'15px'}}>{v>0?fmt(v):'-'}</td>;
                    const rateC2 = (t:number,d:number) => <td className={td2} style={{fontSize:'15px'}}>{wr(t,d)}%</td>;
                    return (
                      <tr className="bg-yellow-100" style={{fontWeight:'bold'}}>
                        <td className={td2}></td>
                        <td className={td2} style={{fontSize:'14px'}}>合计</td>
                        <td className={td2}>{fmt(wt.target)}</td>
                        <td className={td2}>{fmt(wt.achieved)}</td>
                        <td className={td2}>{wr(wt.target, wt.achieved)}%</td>
                        {tgtC2(wt.orderCountTarget)}
                        {rateC2(wt.orderCountTarget, wt.orders)}
                        {tgtC2(wt.giftRatioTarget)}
                        {rateC2(wt.giftRatioTarget, wt.gifts)}
                        {tgtC2(wt.attachmentRateTarget as any)}
                        <td className={td2} style={{fontSize:'15px'}}>{wt.orders>0?(wt.qty/wt.orders).toFixed(2):'-'}</td>
                        {tgtC2(wt.mainProductTarget)}
                        {rateC2(wt.mainProductTarget, wt.mainProduct)}
                        {tgtC2(wt.oldMemberTarget)}
                        {rateC2(wt.oldMemberTarget, Math.round(wt.oldMember))}
                        {tgtC2(wt.birthdayTarget)}
                        {rateC2(wt.birthdayTarget, Math.round(wt.birthMember))}
                      </tr>
                    );
                  })()}
                </>)}
              </tbody>
            </table>
          </div>
          <div className="bg-white border border-gray-400 rounded mb-4">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-400 bg-blue-50">
              <h3 className="text-sm font-bold text-blue-600">本月工作重点</h3>
              <button onClick={()=>setData(p=>p?{...p,workItems:[...p.workItems,{...emptyWI}]}:null)} className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600"><Plus size={12} className="inline" /> 新增行</button>
            </div>
            <div className="overflow-x-auto">
              <table className="border-collapse table-fixed" style={{width:TOTAL_W, fontSize:'16px'}}>
                <colgroup><col width="80"/><col width="60"/><col width="160"/><col width="80"/><col width="160"/><col width="60"/><col width="60"/><col width="160"/><col width="60"/></colgroup>
                <thead><tr className="bg-gray-100">
                  <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>执行时间</th><th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>工作类目</th>
                  <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>具体内容</th><th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>预计完成</th>
                  <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>工作总结</th><th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>反馈方式</th>
                  <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>乐捐机制</th><th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>工作计划项目跟进</th>
                  <th className="border border-gray-400 px-1 py-2 text-gray-700" style={{fontSize:'20px'}}>操作</th>
                </tr></thead>
                <tbody>
                  {(!data?.workItems||data.workItems.length===0)&&(<tr><td colSpan={9} className="border border-gray-400 px-3 py-4 text-center text-gray-400">暂无工作项目</td></tr>)}
                  {data?.workItems.map((item,idx)=>{
                    const locked = item._locked === true;
                    return (
                    <tr key={idx} className={locked ? 'bg-gray-50' : ''}>
                      {['time','category','content','dueDate','summary','feedback','penalty','followUp'].map(f=>{
                        const isDate = f==='time'||f==='dueDate';
                        const val = (item as any)[f]||'';
                        return (
                        <td key={f} className="border border-gray-400 px-1 py-1 align-top">
                          {isDate ? (
                            <input type="date"
                              className={`w-full px-1 py-1 border rounded ${locked ? 'bg-gray-100 border-gray-200 cursor-not-allowed text-red-600 font-bold' : 'border-gray-200 text-black'}`}
                              style={{fontSize:'16px', height:'36px'}}
                              value={val} readOnly={locked} disabled={locked}
                              onChange={e=>{ if(locked) return; setData(p=>{if(!p)return null;const items=[...p.workItems];items[idx]={...items[idx],[f]:e.target.value};return{...p,workItems:items}}) }}
                            />
                          ) : (
                            <textarea
                              className={`w-full px-1 py-1 border rounded resize-none ${locked ? 'bg-gray-100 border-gray-200 cursor-not-allowed text-red-600 font-bold' : 'border-gray-200 text-black'}`}
                              style={{fontSize:'16px', minHeight:'36px', lineHeight:'1.4'}}
                              value={val} readOnly={locked} disabled={locked}
                              rows={1}
                              ref={el => { if (el) { el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; } }}
                              onInput={e=>{
                                const el = e.currentTarget;
                                el.style.height = 'auto';
                                el.style.height = (el.scrollHeight + 2) + 'px';
                              }}
                              onFocus={e=>{
                                const el = e.currentTarget;
                                el.style.height = 'auto';
                                el.style.height = (el.scrollHeight + 2) + 'px';
                              }}
                              onChange={e=>{
                                if(locked) return;
                                setData(p=>{if(!p)return null;const items=[...p.workItems];items[idx]={...items[idx],[f]:e.target.value};return{...p,workItems:items}})
                              }}
                            />
                          )}
                        </td>
                      )})}
                      <td className="border border-gray-400 px-1 py-1 text-center">
                        {locked ? (
                          <span className="text-gray-300"><Lock size={18} /></span>
                        ) : (
                          <button onClick={()=>setData(p=>p?{...p,workItems:p.workItems.filter((_,i)=>i!==idx)}:null)} className="text-red-500 hover:text-red-700"><Trash2 size={18}/></button>
                        )}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        </>)}
      </div>
    </Layout>
  );
}
export default DirectSalesSupervisorPage;
