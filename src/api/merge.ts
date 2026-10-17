import axiosInstance from './axios';

export interface InitialTableParams {
  year?: number | '';
  season?: string;
}

export interface InitialTableResponse {
  success: boolean;
  data: Record<string, any>[];
  total: number;
  columns: string[];
  message?: string;
}

export interface FilterOptions {
  years: number[];
  seasons: string[];
}

/** 查询初始并货表（返回全量数据，客户端自行分页） */
export const fetchInitialTable = (params: InitialTableParams) =>
  axiosInstance.post<InitialTableResponse>('/merge/initial-table', params);

/** 获取筛选选项 */
export const fetchMergeFilters = () =>
  axiosInstance.get<{ success: boolean; data: FilterOptions }>('/merge/filters');

/** 导出并货表 CSV */
export const exportMergeCsv = async (params: InitialTableParams) => {
  const response = await axiosInstance.post('/merge/export', params, {
    responseType: 'blob',
    timeout: 300000, // 5分钟超时，数据量可能很大
  });
  return response.data as Blob;
};
