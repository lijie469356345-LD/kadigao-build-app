import axiosInstance from './axios';

export interface ReplenishParams {
  计划销售天数: number;
  日均销统计天数: number;
  单码最大深度: number;
  总仓留仓比例: number;
  是否节假日放大: boolean;
  节假日前开始: string;
  节假日前结束: string;
  节假日后开始: string;
  节假日后结束: string;
  新品判定天数: number;
  滞销冻结天数: number;
  本店权重: number;
  区域权重: number;
}

export interface SelectedSku {
  id: number;
  商品代码: string;
  颜色名称: string;
  颜色代码: string;
  尺码组: string;
  性别: string;
  添加时间: string;
}

export interface SkuOption {
  商品代码: string;
  颜色名称: string;
  颜色代码: string;
  尺码组: string;
  性别: string;
  大类: string;
  季节: string;
  年份: string;
  风格: string;
  款式: string;
}

export interface SkuFilterOptions {
  years: string[];
  seasons: string[];
  genders: string[];
  styles: string[];
  types: string[];
}

export interface ComputeSummary {
  涉及店铺数: number;
  涉及款色数: number;
  理论补货总量: number;
  实际补货总量: number;
  总仓消耗: number;
  停补滞销: number;
  停补季末: number;
  停补超铺: number;
  停补冗余: number;
  无库存款色: number;
}

export interface ResultRow {
  店铺名称: string;
  商品代码: string;
  颜色名称: string;
  颜色代码: string;
  性别: string;
  店铺等级: string;
  小区域: string;
  齐码率: number;
  存销比: number;
  周转天数: number;
  满足率: number;
  是否新品: string;
  是否滞销: string;
  是否季末: string;
  状态: string;
  现库存合计: number;
  在途合计: number;
  可用合计: number;
  目标合计: number;
  理论补货合计: number;
  实际补货合计: number;
  sizes: Record<string, number>;
}

export interface HistoryItem {
  batchId: string;
  计算时间: string;
  店数: number;
  款色数: number;
  理论补货: number;
  实际补货: number;
}

// ==================== 参数 ====================

export const fetchParams = () =>
  axiosInstance.get<{ success: boolean; data: ReplenishParams; message?: string }>('/replenish/params');

export const saveParams = (params: Partial<ReplenishParams>) =>
  axiosInstance.post<{ success: boolean; data: ReplenishParams; message?: string }>('/replenish/params', params);

// ==================== 款色 ====================

export const fetchSkuOptions = (params: { keyword?: string; gender?: string; category?: string; season?: string; year?: string; style?: string; type?: string; page?: number; pageSize?: number }) =>
  axiosInstance.get<{ success: boolean; data: { list: SkuOption[]; total: number }; message?: string }>('/replenish/sku-options', { params });

export const fetchAllSkuOptions = (params: { keyword?: string; gender?: string; category?: string; season?: string; year?: string; style?: string; type?: string }) =>
  axiosInstance.get<{ success: boolean; data: { list: { 商品代码: string; 颜色名称: string }[]; total: number }; message?: string }>('/replenish/sku-options/all', { params });

export const fetchSkuFilterOptions = () =>
  axiosInstance.get<{ success: boolean; data: SkuFilterOptions; message?: string }>('/replenish/sku-filter-options');

export const fetchSelectedSkus = () =>
  axiosInstance.get<{ success: boolean; data: SelectedSku[]; message?: string }>('/replenish/selected-skus');

export const addSelectedSkus = (items: { 商品代码: string; 颜色名称: string }[]) =>
  axiosInstance.post<{ success: boolean; data: { inserted: number; skipped: number }; message?: string }>('/replenish/selected-skus', { items });

export const importSelectedSkus = (items: { 商品代码: string; 颜色名称: string }[]) =>
  axiosInstance.post<{ success: boolean; data: { inserted: number; skipped: number }; message?: string }>('/replenish/selected-skus/import', { items });

export const deleteSelectedSku = (id: number) =>
  axiosInstance.delete<{ success: boolean; message?: string }>(`/replenish/selected-skus/${id}`);

export const clearSelectedSkus = () =>
  axiosInstance.post<{ success: boolean; message?: string }>('/replenish/selected-skus/clear');

// ==================== 计算 / 结果 ====================

export interface ComputeResponse {
  success: boolean;
  message?: string;
  data: {
    batchId: string;
    summary: ComputeSummary;
    previewRows: ResultRow[];
    total: number;
    warnings: string[];
  };
}

export const computeReplenish = () =>
  axiosInstance.post<ComputeResponse>('/replenish/compute', {}, { timeout: 600000 });

export const fetchResults = (batchId: string, page: number, pageSize: number) =>
  axiosInstance.get<{ success: boolean; data: { rows: ResultRow[]; total: number }; message?: string }>(
    `/replenish/results/${batchId}`, { params: { page, pageSize } }
  );

export const exportReplenishCsv = async (batchId: string) => {
  const response = await axiosInstance.post('/replenish/export', { batchId }, {
    responseType: 'blob',
    timeout: 600000,
  });
  return response.data as Blob;
};

// ==================== 历史 ====================

export const fetchHistory = () =>
  axiosInstance.get<{ success: boolean; data: HistoryItem[]; message?: string }>('/replenish/history');

export const deleteHistory = (batchId: string) =>
  axiosInstance.delete<{ success: boolean; message?: string }>(`/replenish/history/${batchId}`);
