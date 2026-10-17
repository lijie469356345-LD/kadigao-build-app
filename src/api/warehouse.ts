import axios from './axios';

export interface WarehouseScanRecord {
  id: number;
  uuid: string;
  客户名称: string;
  货号: string;
  商品名称: string;
  颜色编号: string;
  颜色名称: string;
  供应商编号: string;
  单据编号: string;
  单据日期: string;
  数量: number | null;
  件数: number | null;
  仓库名称: string;
  仓库代码: string;
  31: number | null;
  32: number | null;
  33: number | null;
  34: number | null;
  35: number | null;
  36: number | null;
  37: number | null;
  38: number | null;
  39: number | null;
  40: number | null;
  41: number | null;
  42: number | null;
  43: number | null;
  44: number | null;
  45: number | null;
  完整数据: string;
  原始返回: string;
  入库单号: string;
  入库日期: string;
  入库时间: string;
  createdAt: string;
}

export const SIZE_LIST = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45];

export interface WarehouseScanResult {
  success: boolean;
  orderNo?: string;
  record?: WarehouseScanRecord;
}

export const warehouseScan = async (uuid: string, authorization?: string) => {
  const response = await axios.post('/warehouse/scan', { uuid, authorization });
  return response.data as WarehouseScanResult;
};

export const getWarehouseRecords = async () => {
  const response = await axios.get('/warehouse/records');
  return response.data as WarehouseScanRecord[];
};

export const deleteWarehouseRecord = async (id: number) => {
  const response = await axios.delete(`/warehouse/records/${id}`);
  return response.data as { success: boolean; deleted: number };
};

export const clearTodayWarehouseRecords = async () => {
  const response = await axios.delete('/warehouse/clear-today');
  return response.data as { success: boolean; deleted: number; date: string };
};

export interface WarehouseExportRow {
  单据编号: string;
  单据日期: string;
  采购店仓: string;
  供应商: string;
  备注: string;
  品牌: string;
  条码或国标码: string;
  采购价: string;
  数量: number;
  入库日期: string;
}

export const exportWarehouseToday = async () => {
  const response = await axios.get('/warehouse/export');
  return response.data as { success: boolean; date: string; rows: WarehouseExportRow[] };
};