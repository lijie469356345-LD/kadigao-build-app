import axiosInstance from './axios';
import type { InitialTableParams } from './merge';

export interface TransferRecord {
  id?: number;
  商品代码颜色名称: string;
  商品代码: string;
  颜色名称: string;
  调出店铺: string;
  调入店铺: string;
  '31'?: number; '32'?: number; '33'?: number; '34'?: number;
  '35'?: number; '36'?: number; '37'?: number; '38'?: number;
  '39'?: number; '40'?: number; '41'?: number; '42'?: number;
  '43'?: number; '44'?: number; '45'?: number; '46'?: number;
  合计?: number;
  创建时间?: string;
  操作人?: string;
  备注?: string;
}

export interface TransferListResponse {
  success: boolean;
  data: TransferRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/** 查询并货数据 */
export const fetchOnlineMergeData = (params: InitialTableParams) =>
  axiosInstance.post<{ success: boolean; data: any[]; total: number }>('/online-merge/query', params);

/** 单条创建调拨记录 */
export const createTransferRecord = (data: TransferRecord) =>
  axiosInstance.post<{ success: boolean; data: { id: number }; message: string }>('/online-merge/transfer-single', data);

/** 查询调拨记录列表 */
export const fetchTransferRecords = (params?: { search?: string; page?: number; pageSize?: number }) =>
  axiosInstance.get<TransferListResponse>('/online-merge/transfers', { params });

/** 修改调拨记录 */
export const updateTransferRecord = (id: number, data: Partial<TransferRecord>) =>
  axiosInstance.put<{ success: boolean; message: string }>(`/online-merge/transfer/${id}`, data);

/** 删除调拨记录 */
export const deleteTransferRecord = (id: number) =>
  axiosInstance.delete<{ success: boolean; message: string }>(`/online-merge/transfer/${id}`);
