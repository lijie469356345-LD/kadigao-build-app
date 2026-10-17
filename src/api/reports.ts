import axios from './axios';
import { SalesReport, CompareReport } from '../types';

export const getSalesReport = async (dateRange: string, filterType: string, groupName?: string, params?: Record<string, string>): Promise<{ data: SalesReport[]; timeProgress: number }> => {
  try {
    const response = await axios.get('/reports/sales', {
      params: { dateRange, filterType, groupName, ...params },
      timeout: 120000, // 增加超时时间到120秒
    });
    const data = response.data as { data?: SalesReport[]; timeProgress?: number };
    return {
      data: Array.isArray(data.data) ? data.data : [],
      timeProgress: typeof data.timeProgress === 'number' ? data.timeProgress : 0,
    };
  } catch (error) {
    console.error('获取销售报表失败:', error);
    return { data: [], timeProgress: 0 };
  }
};

export const getCompareReport = async (compareType?: string, currentDate?: string, compareDate?: string, groupName?: string): Promise<CompareReport[]> => {
  try {
    const response = await axios.get('/reports/compare', {
      params: { compareType, currentDate, compareDate, groupName },
    });
    return response.data as CompareReport[];
  } catch (error) {
    console.error('获取对比报表失败:', error);
    return [];
  }
};

export const getSalesReports = async (): Promise<SalesReport[]> => {
  try {
    const response = await axios.get('/reports/sales');
    return response.data as SalesReport[];
  } catch (error) {
    console.error('获取销售报表失败:', error);
    return [];
  }
};

export const getCompareReports = async (): Promise<CompareReport[]> => {
  try {
    const response = await axios.get('/reports/compare');
    return response.data as CompareReport[];
  } catch (error) {
    console.error('获取对比报表失败:', error);
    return [];
  }
};

import type { ShopDiagnosis } from '../types';

export const getShopDiagnosis = async (params: {
  currentStartDate: string;
  currentEndDate: string;
  momStartDate?: string;
  momEndDate?: string;
  yearStartDate?: string;
  yearEndDate?: string;
  shopName?: string;
  area?: string;
  supervisor?: string;
  districtManager?: string;
  groupName?: string;
}): Promise<{ data: ShopDiagnosis[] }> => {
  try {
    const response = await axios.get('/reports/shop-diagnosis', {
      params,
      timeout: 120000,
    });
    return response.data as { data: ShopDiagnosis[] };
  } catch (error) {
    console.error('获取店铺诊断数据失败:', error);
    return { data: [] };
  }
};

export const get7DayComparison = async (groupName?: string): Promise<any[]> => {
  try {
    const response = await axios.get('/reports/shop/7day-comparison', {
      params: { groupName },
      timeout: 120000, // 增加超时时间到120秒
    });
    // 检查响应是否为数组，如果不是则返回空数组
    if (Array.isArray(response.data)) {
      return response.data;
    } else {
      console.warn('7日对比数据不是数组:', response.data);
      return [];
    }
  } catch (error) {
    console.error('获取7日对比数据失败:', error);
    return [];
  }
};

import type { StaffSalesTarget } from '../types';

export const getStaffSalesTarget = async (dateRange: string, filterType?: string, groupName?: string, supervisor?: string, shopName?: string, params?: Record<string, string>): Promise<{ data: StaffSalesTarget[]; timeProgress: number }> => {
  try {
    const response = await axios.get('/reports/staff-sales-target', {
      params: { dateRange, filterType, groupName, supervisor, shopName, ...params },
      timeout: 120000,
    });
    const data = response.data as { data?: StaffSalesTarget[]; timeProgress?: number };
    return {
      data: Array.isArray(data.data) ? data.data : [],
      timeProgress: typeof data.timeProgress === 'number' ? data.timeProgress : 0,
    };
  } catch (error) {
    console.error('获取店员销售指标失败:', error);
    return { data: [], timeProgress: 0 };
  }
};
