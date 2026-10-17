import axios from './axios';
import { UserGroup, Shop } from '../types';

export const getUserGroups = async () => {
  const response = await axios.get('/permissions/groups');
  return response.data as UserGroup[];
};

export const getShops = async () => {
  const response = await axios.get('/permissions/shops');
  return response.data as Shop[];
};

export const getGroupPermissions = async (groupId: number) => {
  const response = await axios.get(`/permissions/${groupId}`);
  return response.data as number[];
};

export const updateGroupPermissions = async (groupId: number, shopIds: number[]) => {
  await axios.put(`/permissions/${groupId}`, { shopIds });
};

export const createUserGroup = async (name: string) => {
  const response = await axios.post('/permissions/groups', { name });
  return response.data;
};

export const updateUserGroup = async (groupId: number, name: string) => {
  const response = await axios.put(`/permissions/groups/${groupId}`, { name });
  return response.data;
};
