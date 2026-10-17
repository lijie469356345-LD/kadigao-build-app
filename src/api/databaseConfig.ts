import axios from './axios';

export const testConnection = async (config: {
  server: string;
  port: string;
  database: string;
  user: string;
  password: string;
}) => {
  const response = await axios.post('/config/test-connection', config);
  return response.data;
};
