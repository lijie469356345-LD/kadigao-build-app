import axios from './axios';

export type RectStatus = '待整改' | '整改中' | '已完成';

export interface RectItem {
  id: number;
  recordId: number;
  shopName: string;
  evalMonth: string;
  project: string;
  section: string;
  content: string;
  gap: number;
  status: RectStatus;
  remark: string;
  updatedAt?: string;
}

export interface RectSummary {
  total: number;
  pending: number;
  inProgress: number;
  done: number;
  openShops: number;
  completionRate: number;
}

// 一条“打分提交记录”的整改汇总（列表默认只展示这些，点击后展开明细）
export interface RectRecord {
  id: number;
  shopName: string;
  evalMonth: string;
  totalScore: number;
  fullScore: number;
  createdAt: string;
  deductCount: number;
  deductTotal: number;
  doneCount: number;
}

export interface RectListResult {
  summary: RectSummary;
  records: RectRecord[];
  items: RectItem[];
}

// GET 会先同步扣分项再返回
export const getRectifications = async (groupName?: string): Promise<RectListResult> => {
  const res = await axios.get('/store-rectifications', { params: groupName ? { groupName } : {} });
  return res.data;
};

export const updateRectification = async (id: number, data: { status?: string; remark?: string }) => {
  const res = await axios.put(`/store-rectifications/${id}`, data);
  return res.data;
};

export const bulkMarkRectifications = async (recordIds: number[], status: string) => {
  const res = await axios.post('/store-rectifications/bulk', { recordIds, status });
  return res.data;
};

export const deleteRectification = async (id: number) => {
  const res = await axios.delete(`/store-rectifications/${id}`);
  return res.data;
};