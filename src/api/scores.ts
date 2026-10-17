import axios from './axios';
import { DailyScore } from '../types';

export const getScores = async (): Promise<DailyScore[]> => {
  try {
    const response = await axios.get('/scores');
    return response.data as DailyScore[];
  } catch (error) {
    console.error('获取评分数据失败:', error);
    return [];
  }
};

export const getScoreRanking = async (type: 'top' | 'bottom'): Promise<DailyScore[]> => {
  try {
    const response = await axios.get('/scores/ranking', {
      params: { type }
    });
    return response.data as DailyScore[];
  } catch (error) {
    console.error('获取评分排名失败:', error);
    return [];
  }
};

export const getAverageScore = async (userCode?: string, isAdmin?: boolean, groupName?: string): Promise<number> => {
  try {
    const response = await axios.get('/scores/average', {
      params: {
        userCode,
        isAdmin,
        groupName
      }
    });
    return response.data.averageScore as number;
  } catch (error) {
    console.error('获取平均得分失败:', error);
    return 0;
  }
};

export const calculateScore = (growthRate: number): number => {
  if (growthRate >= 100) return 10;
  if (growthRate >= 75) return 9;
  if (growthRate >= 50) return 8;
  if (growthRate >= 25) return 7;
  if (growthRate >= 10) return 6;
  if (growthRate >= 0) return 5;
  if (growthRate >= -25) return 4;
  if (growthRate >= -50) return 3;
  if (growthRate >= -75) return 2;
  return 1;
};