import axios from './axios';
import { User } from '../types';

/**
 * 登录。桌面客户端会携带自身版本号（version），服务端据此校验
 * 是否低于「最低可用版本」，低版本返回 403 code=VERSION_TOO_OLD；
 * 网页版（浏览器）无版本号，不参与版本拦截。
 */
export const login = async (username: string, password: string, version?: string) => {
  const response = await axios.post('/auth/login', { username, password, version });
  return response.data;
};

export const getCurrentUser = async () => {
  const response = await axios.get('/auth/me');
  return response.data as User;
};