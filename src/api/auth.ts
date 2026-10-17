import axios from './axios';
import { User } from '../types';

export const login = async (username: string, password: string) => {
  const response = await axios.post('/auth/login', { username, password });
  return response.data;
};

export const getCurrentUser = async () => {
  const response = await axios.get('/auth/me');
  return response.data as User;
};
