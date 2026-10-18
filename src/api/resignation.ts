import axios from './axios';

export interface ResignationRecord {
  id: number;
  userCode: string;
  userName: string;
  orgName: string;
  phone: string;
  status: string;          // pending 待审批（后续流程扩展）
  remark: string;
  operatorCode: string;
  operatorName: string;
  resignTime: string;
}

export const registerResignation = async (userCode: string, remark?: string) => {
  const response = await axios.post('/resignation', { userCode, remark });
  return response.data;
};

export const getResignations = async () => {
  const response = await axios.get('/resignation');
  return response.data as ResignationRecord[];
};