import axios from './axios';

export interface FuDaiRow {
  区经?: string;
  仓库类别?: string;
  区域?: string;
  督导: string;
  店铺名称: string;
  转化人数: number;
  总人数: number;
  转化率: number;
  鞋包数量: number;
  鞋包业绩: number;
}

export const getFuDaiReport = async (startDate?: string, endDate?: string, groupName?: string) => {
  const response = await axios.get('/douyin/fudai', {
    params: { startDate, endDate, groupName },
  });
  return response.data as FuDaiRow[];
};

export interface HaoPingRow {
  日期: string;
  区经?: string;
  仓库类别?: string;
  区域?: string;
  督导: string;
  店铺名称: string;
  会员代码: string;
  会员手机: string;
  好评人数: number;
}

export const getHaoPingReport = async (startDate?: string, endDate?: string, groupName?: string) => {
  const response = await axios.get('/douyin/haoping', {
    params: { startDate, endDate, groupName },
  });
  return response.data as HaoPingRow[];
};

export interface WaziRow {
  区经?: string;
  仓库类别?: string;
  区域?: string;
  督导: string;
  店铺名称: string;
  转化人数: number;
  总人数: number;
  转化率: number;
  鞋包数量: number;
  鞋包业绩: number;
}

export const getWaziReport = async (startDate?: string, endDate?: string, groupName?: string) => {
  const response = await axios.get('/douyin/wazi', {
    params: { startDate, endDate, groupName },
  });
  return response.data as WaziRow[];
};
