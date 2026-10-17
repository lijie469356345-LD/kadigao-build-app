import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED') {
      console.error('请求超时');
    } else if (error.response?.status === 401) {
      // 登录页不跳转，让 catch 块处理错误消息
      if (window.location.pathname !== '/login') {
        console.error('未授权，需要重新登录');
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    } else if (error.code === 'ERR_CANCELED') {
      console.log('请求被取消');
    } else {
      console.error('请求失败:', error.message);
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;