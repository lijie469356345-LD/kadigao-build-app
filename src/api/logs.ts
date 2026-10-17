import axios from './axios';
import { LogItem } from '../types';

export const getLogs = async (
  userCode: string,
  isAdmin: boolean,
  groupName?: string,
  startDate?: string,
  endDate?: string,
  showShared?: boolean,
  page?: number,
  pageSize?: number
): Promise<{ data: LogItem[]; total: number }> => {
  try {
    const response = await axios.get('/logs', {
      params: {
        userCode,
        isAdmin,
        groupName,
        startDate,
        endDate,
        showShared,
        page: page || 1,
        pageSize: pageSize || 50,
      },
      timeout: 30000,
    });
    // 新分页格式
    if (response.data && Array.isArray(response.data.data)) {
      return { data: response.data.data, total: response.data.total };
    }
    // 兼容旧格式
    return { data: Array.isArray(response.data) ? response.data : [], total: 0 };
  } catch (error) {
    console.error('获取日志失败:', error);
    return { data: [], total: 0 };
  }
};

export const createLog = async (log: any) => {
  const response = await axios.post('/logs', log);
  return response.data as LogItem;
};

export const getLogById = async (id: string) => {
  const response = await axios.get(`/logs/${id}`);
  return response.data as LogItem;
};

export const updateLog = async (id: string, log: any) => {
  const response = await axios.put(`/logs/${id}`, log);
  return response.data;
};

export const deleteLog = async (id: number) => {
  const response = await axios.delete(`/logs/${id}`);
  return response.data;
};

// 获取每日日志填报统计列表
export const getDailyStats = async (startDate?: string, endDate?: string, groupName?: string) => {
  const response = await axios.get('/logs/daily-stats', {
    params: { startDate, endDate, groupName },
  });
  return response.data as {
    totalRequired: number;
    dailyStats: Array<{
      date: string;
      totalRequired: number;
      completed: number;
      incomplete: number;
    }>;
  };
};

// 获取某日/某段时间日志填报详细统计
export const getDailyStatsDetail = async (date: string, endDate?: string, groupName?: string) => {
  const response = await axios.get(`/logs/daily-stats/${date}`, {
    params: { ...(endDate ? { endDate } as any : {}), ...(groupName ? { groupName } as any : {}) },
  });
  return response.data as {
    date: string;
    startDate: string;
    endDate: string;
    totalRequired: number;
    completed: number;
    incomplete: number;
    earliestDate: string | null;
    totalDays: number;
    details: Array<{
      date: string;
      userName: string;
      groupName: string;
      submitted: boolean;
      logId: number | null;
      destination: string | null;
      submittedAt: string | null;
      cumulativeMissed: number;
    }>;
  };
};

export const getMaintenanceStatus = async (): Promise<{ isMaintenance: boolean; message: string; estimatedTime: string }> => {
  try {
    const response = await axios.get('/maintenance/status');
    const data = response.data as { isMaintenance?: boolean; message?: string; estimatedTime?: string };
    return {
      isMaintenance: data.isMaintenance || false,
      message: data.message || '',
      estimatedTime: data.estimatedTime || '',
    };
  } catch (error) {
    console.error('获取维护状态失败:', error);
    return { isMaintenance: false, message: '', estimatedTime: '' };
  }
};

export const toggleMaintenance = async () => {
  const response = await axios.post('/maintenance/toggle');
  return response.data;
};
