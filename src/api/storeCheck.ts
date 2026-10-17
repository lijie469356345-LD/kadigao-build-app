import axios from './axios';

export interface CheckIndicator {
  id: number;
  dimId: number;
  dimName: string;
  code?: string;
  name: string;
  score: number;
  sort: number;
  note?: string;
  isActive?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoreOvwRow {
  shopName: string;
  area: string;
  districtManager: string;
  supervisor: string;
  dealer: string;
  manager: string;
  phone: string;
}

export const DIMENSIONS = [
  { id: 1, name: '店', full: 25 },
  { id: 2, name: '人', full: 25 },
  { id: 3, name: '货', full: 20 },
  { id: 4, name: '场', full: 15 },
  { id: 5, name: '会员', full: 15 },
];

export const getIndicators = async (): Promise<CheckIndicator[]> => {
  const res = await axios.get('/store-check/indicators');
  return res.data;
};

export const createIndicator = async (data: { dimId: number; name: string; score: number; sort?: number; note?: string }) => {
  const res = await axios.post('/store-check/indicators', data);
  return res.data;
};

export const updateIndicator = async (id: number, data: Partial<CheckIndicator>) => {
  const res = await axios.put(`/store-check/indicators/${id}`, data);
  return res.data;
};

export const deleteIndicator = async (id: number) => {
  const res = await axios.delete(`/store-check/indicators/${id}`);
  return res.data;
};

export const getCheckShops = async (): Promise<StoreOvwRow[]> => {
  const res = await axios.get('/store-check/shops');
  return res.data;
};

export const getStoreOverviewScores = async (params?: { start?: string; end?: string; t?: string; groupName?: string }): Promise<StoreScoreResult[]> => {
  const res = await axios.get('/store-check/overview-scores', { params: params || {} });
  return res.data;
};

export interface CheckItemResult { dimId: number; dim: string; name: string; full: number; score: number; }
export interface StoreScoreResult {
  shopName: string; area: string; districtManager: string; supervisor: string; dealer: string;
  manager: string; phone: string; warehouse: string;
  total: number; grade: string; full: number; rectCount: number; rectGap: number;
  detail: CheckItemResult[];
}

export interface AlertItem { type: string; name: string; dim: string; prevScore: number; score: number; full: number; }
export interface AlertRow {
  shopName: string; area: string; districtManager: string; supervisor: string; dealer: string;
  manager: string; phone: string; warehouse: string;
  prevTotal: number | null; prevGrade: string; curTotal: number; curGrade: string;
  warnCount: number; warnings: AlertItem[];
}
export interface AlertGroup {
  area: string; dm: string; sup: string; dealer: string;
  count: number; prevAvg: number; curAvg: number; delta: number;
  members: AlertRow[];
}
export interface StoreAlerts {
  month: string; prevMonth: string;
  summary: { flaggedStores: number; avgPrev: number; avgCur: number };
  groups: AlertGroup[];
  rows: AlertRow[];
}
export const getStoreAlerts = async (month?: string, groupName?: string): Promise<StoreAlerts> => {
  const res = await axios.get('/store-check/alerts', { params: month || groupName ? { month, groupName } : {} });
  return res.data;
};

function grade(total: number): string {
  if (total >= 90) return 'S';
  if (total >= 80) return 'A';
  if (total >= 70) return 'B';
  if (total >= 60) return 'C';
  return 'D';
}

export { grade };