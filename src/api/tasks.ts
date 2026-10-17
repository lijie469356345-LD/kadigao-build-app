import axios from './axios';
import { InspectionTask } from '../types';

export const getTasks = async (userCode: string, isAdmin: boolean, groupName?: string): Promise<InspectionTask[]> => {
  try {
    const response = await axios.get('/tasks', {
      params: { userCode, isAdmin, groupName }
    });
    return response.data as InspectionTask[];
  } catch (error) {
    console.error('获取巡店任务失败:', error);
    return [];
  }
};

export const getTaskCount = async (userCode: string, isAdmin: boolean, groupName?: string, status?: string): Promise<number> => {
  try {
    console.log('getTaskCount called with:', { userCode, isAdmin, groupName, status });
    const response = await axios.get('/tasks/count', {
      params: { userCode, isAdmin, groupName, status }
    });
    return response.data.count as number;
  } catch (error) {
    console.error('获取任务数量失败:', error);
    return 0;
  }
};

export const createTask = async (task: InspectionTask) => {
  const response = await axios.post('/tasks', task);
  return response.data as InspectionTask;
};

export const updateTask = async (id: string, task: Partial<InspectionTask>) => {
  const response = await axios.put(`/tasks/${id}`, task);
  return response.data;
};

export const deleteTask = async (id: number) => {
  const response = await axios.delete(`/tasks/${id}`);
  return response.data;
};

export const executeTask = async (id: number) => {
  const response = await axios.post(`/tasks/${id}/execute`);
  return response.data;
};

export const getTaskById = async (id: string): Promise<InspectionTask | null> => {
  try {
    const response = await axios.get(`/tasks/${id}`);
    return response.data as InspectionTask;
  } catch (error) {
    console.error('获取巡店任务详情失败:', error);
    return null;
  }
};