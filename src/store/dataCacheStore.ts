import { create } from 'zustand';
import type { SalesReport, CompareReport, DayComparison } from '../types';

interface DashboardData {
  logs: any[];
  reports: SalesReport[];
  users: any[];
  avgScore: string;
  taskCount: number;
  timeProgress: number;
}

interface DataCache {
  // 仪表盘数据
  dashboardData: DashboardData | null;
  // 销售报表数据
  reportData: { data: SalesReport[]; timeProgress: number } | null;
  // 对比报表数据
  compareData: CompareReport[] | null;
  // 巡店日志数据
  logData: any[] | null;
  // 巡店任务数据
  taskData: any[] | null;
  // 评分体系数据
  scoreData: DayComparison[] | null;
  // 通用页面缓存：key = 页面标识, value = 任意数据
  pageCache: Record<string, any>;
  // 更新数据的方法
  setDashboardData: (data: DashboardData) => void;
  setReportData: (data: { data: SalesReport[]; timeProgress: number }) => void;
  setCompareData: (data: CompareReport[]) => void;
  setLogData: (data: any[]) => void;
  setTaskData: (data: any[]) => void;
  setScoreData: (data: DayComparison[]) => void;
  setPageCache: (key: string, data: any) => void;
  clearPageCache: (key?: string) => void;
  // 清除缓存（登出时用）
  clearCache: () => void;
}

export const useDataCacheStore = create<DataCache>((set) => ({
  dashboardData: null,
  reportData: null,
  compareData: null,
  logData: null,
  taskData: null,
  scoreData: null,
  pageCache: {},
  
  setDashboardData: (data) => set({ dashboardData: data }),
  setReportData: (data) => set({ reportData: data }),
  setCompareData: (data) => set({ compareData: data }),
  setLogData: (data) => set({ logData: data }),
  setTaskData: (data) => set({ taskData: data }),
  setScoreData: (data) => set({ scoreData: data }),
  setPageCache: (key, data) => set((state) => ({ pageCache: { ...state.pageCache, [key]: data } })),
  clearPageCache: (key) => set((state) => {
    if (!key) return { pageCache: {} };
    const { [key]: _, ...rest } = state.pageCache;
    return { pageCache: rest };
  }),
  
  clearCache: () => set({
    dashboardData: null,
    reportData: null,
    compareData: null,
    logData: null,
    taskData: null,
    scoreData: null,
    pageCache: {}
  }),
}));
