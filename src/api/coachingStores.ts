import axios from './axios';

export interface CoachingStore {
  id?: number;
  shopName: string;
  monthYear?: string;
  warehouseType?: string;
  area?: string;
  districtManager?: string;
  supervisor?: string;
  product?: string;
  contactPerson?: string;
  phone?: string;
  dealer?: string;
  openDate?: string;
}

export const getCoachingStores = async (monthYear?: string, groupName?: string): Promise<CoachingStore[]> => {
  const res = await axios.get('/coaching-stores', { params: { monthYear, groupName } });
  return res.data || [];
};

export const addCoachingStore = async (store: CoachingStore) => {
  return (await axios.post('/coaching-stores', store)).data;
};

export const batchImportCoachingStores = async (shopNames: string[], monthYear: string) => {
  return (await axios.post('/coaching-stores/batch', { shopNames, monthYear })).data;
};

export const deleteCoachingStore = async (id: number) => {
  return (await axios.delete(`/coaching-stores/${id}`)).data;
};

export const clearCoachingStores = async (monthYear: string) => {
  return (await axios.delete(`/coaching-stores/clear/${monthYear}`)).data;
};
