import axios from './axios';
import { FeedbackTask, FeedbackDetail } from '../types';

export const getFeedbackTasks = async () => {
  const response = await axios.get('/feedback/tasks');
  return response.data as FeedbackTask[];
};

export const getFeedbackTask = async (id: number | string) => {
  const response = await axios.get(`/feedback/tasks/${id}`);
  return response.data as FeedbackTask;
};

export const createFeedbackTask = async (data: Partial<FeedbackTask>) => {
  const response = await axios.post('/feedback/tasks', data);
  return response.data as FeedbackTask;
};

export const updateFeedbackTask = async (id: number | string, data: Partial<FeedbackTask>) => {
  const response = await axios.put(`/feedback/tasks/${id}`, data);
  return response.data as FeedbackTask;
};

export const deleteFeedbackTask = async (id: number | string) => {
  const response = await axios.delete(`/feedback/tasks/${id}`);
  return response.data;
};

export const executeFeedbackTask = async (id: number | string) => {
  const response = await axios.post(`/feedback/tasks/${id}/execute`);
  return response.data;
};

export const getFeedbackDetails = async (params?: { taskId?: number | string; hideExpired?: boolean }) => {
  const response = await axios.get('/feedback/details', { params });
  return response.data as (FeedbackDetail & { expired?: boolean })[];
};

export const getFeedbackDetail = async (id: number | string) => {
  const response = await axios.get(`/feedback/details/${id}`);
  return response.data as FeedbackDetail;
};

export const generateFeedbackDetail = async (data: { taskId: number | string; userName?: string; shopName?: string; phone?: string }) => {
  const response = await axios.post('/feedback/details/generate', data);
  return response.data as FeedbackDetail;
};

export const updateFeedbackDetail = async (id: number | string, data: Partial<FeedbackDetail>) => {
  const response = await axios.put(`/feedback/details/${id}`, data);
  return response.data as FeedbackDetail;
};

export const submitFeedbackDetail = async (id: number | string, data: Partial<FeedbackDetail>) => {
  const response = await axios.post(`/feedback/details/${id}/submit`, data);
  return response.data as FeedbackDetail;
};

export const deleteFeedbackDetail = async (id: number | string) => {
  const response = await axios.delete(`/feedback/details/${id}`);
  return response.data;
};
