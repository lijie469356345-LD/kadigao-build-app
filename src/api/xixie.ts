import axios from './axios';

// 取当前登录用户的用户组，供洗鞋数据按店铺权限隔离
function currentGroupName(): string {
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    return u?.groupName || '';
  } catch {
    return '';
  }
}

export interface XixieCostRow {
  id: number;
  monthYear: string;
  区经?: string;
  仓库类别?: string;
  区域?: string;
  督导?: string;
  店铺名称: string;
  双数: number;
  费用: number;
}

export const getXixieCost = async (monthYear?: string) => {
  const response = await axios.get('/xixie/cost', {
    params: { ...(monthYear ? { monthYear } : {}), groupName: currentGroupName() },
  });
  return response.data as XixieCostRow[];
};

export const addXixieCost = async (row: Record<string, any>) => {
  const response = await axios.post('/xixie/cost', row);
  return response.data;
};

export const bulkImportXixieCost = async (rows: Record<string, any>[]) => {
  const response = await axios.post('/xixie/cost/bulk', { rows });
  return response.data;
};

export const clearXixieCost = async () => {
  const response = await axios.delete('/xixie/cost/clear');
  return response.data;
};

export const deleteXixieCost = async (id: number) => {
  const response = await axios.delete(`/xixie/cost/${id}`);
  return response.data;
};

export interface XixieInvestRow {
  id: number;
  monthYear: string;
  区经?: string;
  仓库类别?: string;
  督导?: string;
  店铺名称: string;
  会员手机?: string;
  发放人数: number;
  发放张数: number;
}

export interface XixieInvestQuery {
  monthYear?: string;
  page?: number;
  pageSize?: number;
  sv?: string; // 督导，逗号分隔多选
  sh?: string; // 店铺名称，逗号分隔
  wh?: string; // 仓库类别
  dm?: string; // 区经
  kw?: string; // 关键字（店铺/会员手机）
}

export const getXixieInvest = async (params: XixieInvestQuery) => {
  const response = await axios.get('/xixie/invest', { params: { ...params, groupName: currentGroupName() } });
  return response.data as { rows: XixieInvestRow[]; total: number; aggregates: Record<string, number> } | XixieInvestRow[];
};

export const getXixieInvestMeta = async (monthYear?: string) => {
  const response = await axios.get('/xixie/invest/meta', {
    params: { ...(monthYear ? { monthYear } : {}), groupName: currentGroupName() },
  });
  return response.data as { 店铺名称: string; 督导?: string; 仓库类别?: string; 区经?: string }[];
};

export const addXixieInvest = async (row: Record<string, any>) => {
  const response = await axios.post('/xixie/invest', row);
  return response.data;
};

export const bulkImportXixieInvest = async (rows: Record<string, any>[]) => {
  const response = await axios.post('/xixie/invest/bulk', { rows });
  return response.data;
};

export const clearXixieInvest = async () => {
  const response = await axios.delete('/xixie/invest/clear');
  return response.data;
};

export const deleteXixieInvest = async (id: number) => {
  const response = await axios.delete(`/xixie/invest/${id}`);
  return response.data;
};

export interface XixieWriteoffRow {
  id: number;
  monthYear: string;
  区经?: string;
  仓库类别?: string;
  督导?: string;
  店铺名称: string;
  会员手机?: string;
  核销人数: number;
  核销张数: number;
  转化人数: number;
  转化业绩: number;
}

export const getXixieWriteoff = async (monthYear?: string) => {
  const response = await axios.get('/xixie/writeoff', {
    params: { ...(monthYear ? { monthYear } : {}), groupName: currentGroupName() },
  });
  return response.data as XixieWriteoffRow[];
};

export const addXixieWriteoff = async (row: Record<string, any>) => {
  const response = await axios.post('/xixie/writeoff', row);
  return response.data;
};

export const bulkImportXixieWriteoff = async (rows: Record<string, any>[]) => {
  const response = await axios.post('/xixie/writeoff/bulk', { rows });
  return response.data;
};

export const clearXixieWriteoff = async () => {
  const response = await axios.delete('/xixie/writeoff/clear');
  return response.data;
};

export const deleteXixieWriteoff = async (id: number) => {
  const response = await axios.delete(`/xixie/writeoff/${id}`);
  return response.data;
};

export interface XixieSummaryRow {
  monthYear: string;
  区经?: string;
  仓库类别?: string;
  督导?: string;
  店铺名称: string;
  双数: number;
  费用: number;
  发放人数: number;
  发放张数: number;
  核销人数: number;
  核销张数: number;
  转化人数: number;
  转化业绩: number;
}

export const getXixieSummary = async (monthYear?: string) => {
  const response = await axios.get('/xixie/summary', {
    params: { ...(monthYear ? { monthYear } : {}), groupName: currentGroupName() },
  });
  return response.data as XixieSummaryRow[];
};
