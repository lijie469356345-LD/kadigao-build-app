import axios from './axios';

export interface StoreScoreHeader {
  id: number;
  shopName: string;
  address: string;
  supervisor: string;
  staffCount: string;
  evalMonth: string;
  evaluator: string;
  totalScore: number;
  fullScore: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoreScoreRecordFull extends StoreScoreHeader {
  scores: Record<string, number>;
  rectificationJson?: string | null;
}

export interface ShopOption {
  shopName: string;
  shopCode?: string;
  address?: string;
  warehouse?: string;
  area?: string;
  districtManager?: string;
  dealer?: string;
  supervisor?: string;
}

export const getShopOptions = async (groupName?: string): Promise<ShopOption[]> => {
  const res = await axios.get('/store-score-records/shops', { params: groupName ? { groupName } : {} });
  return res.data;
};

export interface WechatRecipientUser {
  userCode: string;
  userName: string;
  groupName: string;
  position: string;
  wechatAccount: string;
}

export const getStoreScoreRecords = async (groupName?: string): Promise<StoreScoreHeader[]> => {
  const res = await axios.get('/store-score-records', { params: groupName ? { groupName } : {} });
  return res.data;
};

export const getStoreScoreRecord = async (id: number, groupName?: string): Promise<StoreScoreRecordFull> => {
  const res = await axios.get(`/store-score-records/${id}`, { params: groupName ? { groupName } : {} });
  return res.data;
};

export const createStoreScoreRecord = async (data: {
  shopName: string; address: string; supervisor: string; staffCount: string;
  evalMonth: string; evaluator: string; fullScore: number; totalScore: number;
  scores: Record<string, number>;
}) => {
  const res = await axios.post('/store-score-records', data);
  return res.data;
};

export const updateStoreScoreRecord = async (id: number, data: {
  shopName: string; address: string; supervisor: string; staffCount: string;
  evalMonth: string; evaluator: string; fullScore: number; totalScore: number;
  scores: Record<string, number>;
}) => {
  const res = await axios.put(`/store-score-records/${id}`, data);
  return res.data;
};

export const deleteStoreScoreRecord = async (id: number) => {
  const res = await axios.delete(`/store-score-records/${id}`);
  return res.data;
};

// 企微推送整改报告（多选接收人）
export const pushStoreRectification = async (
  message: string,
  recipients: { name: string; wechatAccount: string }[]
) => {
  const res = await axios.post('/store-score-records/push', { message, recipients });
  return res.data;
};

// 复用系统企微接收人查询接口
export const getWechatRecipientOptions = async () => {
  const res = await axios.get('/wechat-push-v2/recipient-options');
  return res.data as { groups: string[]; positions: string[] };
};

export const searchWechatRecipients = async (params: {
  groupName?: string; position?: string; keyword?: string;
}) => {
  const res = await axios.get('/wechat-push-v2/recipient-search', { params });
  return res.data as { total: number; withWechat: WechatRecipientUser[]; withoutWechat: WechatRecipientUser[] };
};