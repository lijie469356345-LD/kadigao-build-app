import axios from './axios';

export interface ColumnInfo {
  name: string;
  type: string;
  length: number | null;
  isIdentity: boolean;
}

export interface TableSchema {
  table: string;
  pk: string;
  title: string;
  columns: ColumnInfo[];
}

export const getTableSchema = async (table: string) => {
  const response = await axios.get(`/table-manager/${table}/schema`);
  return response.data as TableSchema;
};

export const getTableRows = async (table: string) => {
  const response = await axios.get(`/table-manager/${table}`);
  return response.data as Record<string, any>[];
};

export const createRow = async (table: string, row: Record<string, any>) => {
  const response = await axios.post(`/table-manager/${table}`, row);
  return response.data;
};

export const updateRow = async (table: string, id: string | number, row: Record<string, any>) => {
  const response = await axios.put(`/table-manager/${table}/${id}`, row);
  return response.data;
};

export const deleteRow = async (table: string, id: string | number) => {
  const response = await axios.delete(`/table-manager/${table}/${id}`);
  return response.data;
};

export const bulkImport = async (table: string, rows: Record<string, any>[], mode: 'append' | 'replace' = 'append') => {
  const response = await axios.post(`/table-manager/${table}/bulk`, { rows, mode });
  return response.data;
};

export const clearTable = async (table: string) => {
  const response = await axios.delete(`/table-manager/${table}/clear`);
  return response.data;
};
