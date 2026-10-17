import axios from './axios';

export interface DataExtractionItem {
  id?: number;
  fieldName: string;
  sqlQuery: string;
  params: string;
  description: string;
  category: string;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export const getDataExtractions = async (keyword?: string, category?: string): Promise<DataExtractionItem[]> => {
  const res = await axios.get('/data-extraction', { params: { keyword, category } });
  return res.data;
};

export const getCategories = async (): Promise<string[]> => {
  const res = await axios.get('/data-extraction/categories');
  return res.data;
};

export const createDataExtraction = async (item: DataExtractionItem): Promise<DataExtractionItem> => {
  const res = await axios.post('/data-extraction', item);
  return res.data;
};

export const updateDataExtraction = async (id: number, item: DataExtractionItem): Promise<DataExtractionItem> => {
  const res = await axios.put(`/data-extraction/${id}`, item);
  return res.data;
};

export const deleteDataExtraction = async (id: number): Promise<void> => {
  await axios.delete(`/data-extraction/${id}`);
};

export const getByFieldName = async (fieldName: string): Promise<DataExtractionItem> => {
  const res = await axios.get(`/data-extraction/by-name/${fieldName}`);
  return res.data;
};
