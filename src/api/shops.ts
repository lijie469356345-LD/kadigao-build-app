import axios from './axios';
import { Shop } from '../types';

export const getShops = async (groupName?: string) => {
  const response = await axios.get('/shops/archive', {
    params: groupName ? { groupName } : {}
  });
  return response.data;
};

export const createShop = async (shop: Omit<Shop, 'id'>) => {
  const response = await axios.post('/shops', shop);
  return response.data as Shop;
};

export const updateShop = async (id: number, shop: Partial<Shop>) => {
  const response = await axios.put(`/shops/${id}`, shop);
  return response.data as Shop;
};

export const deleteShop = async (id: number) => {
  const response = await axios.delete(`/shops/${id}`);
  return response.data;
};
