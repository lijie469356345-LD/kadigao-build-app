import axios from './axios';
import { User } from '../types';

export const getUsers = async () => {
  const response = await axios.get('/users');
  return response.data as User[];
};

export const createUser = async (user: Record<string, any>) => {
  const response = await axios.post('/users', user);
  return response.data as User;
};

export const updateUser = async (id: string | number, user: Record<string, any>) => {
  const response = await axios.put(`/users/${id}`, user);
  return response.data as User;
};

export const deleteUser = async (id: number) => {
  await axios.delete(`/users/${id}`);
};

export const deleteUserByCode = async (userCode: string) => {
  await axios.delete(`/users/code/${userCode}`);
};

export const syncUsersFromDB = async () => {
  const response = await axios.post('/users/sync');
  return response.data;
};

export const bulkImportUsers = async (users: Record<string, any>[]) => {
  const response = await axios.post('/users/bulk', { users });
  return response.data;
};

export const clearUsers = async () => {
  const response = await axios.post('/users/clear');
  return response.data;
};
