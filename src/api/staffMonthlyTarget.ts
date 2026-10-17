import axios from './axios';

export interface StaffMonthlyTargetItem {
  id?: number;
  year: number;
  month: number;
  shopName: string;
  districtManager: string;
  supervisor: string;
  staffName: string;
  monthlyTarget: number;
  status: string;
  createdBy?: string;
  createdAt?: string;
}

export interface StaffMonthlyTargetDaily {
  id: number;
  targetId: number;
  targetDate: string;
  year: number;
  month: number;
  dayIndex: number;
  dayOfWeek: string;
  coefficient: number;
  dailyTarget: number;
  groupName: string;
}

export interface StaffInfo {
  shopName: string;
  staffName: string;
}

export interface StaffChangeRequest {
  id: number;
  targetId: number;
  year: number;
  month: number;
  shopName: string;
  districtManager: string;
  supervisor: string;
  staffName: string;
  oldTarget: number;
  newTarget: number;
  reason: string;
  status: string; // pending / approved / rejected
  applicant: string;
  applicantGroup: string;
  applicantRole: string;
  approver: string;
  approverRole: string;
  approvalComment: string;
  approvedAt: string;
  createdAt: string;
}

export const getStaffMonthlyTargets = async (year: number, month: number, groupName?: string): Promise<{ targets: StaffMonthlyTargetItem[]; changeRequests: StaffChangeRequest[] }> => {
  const res = await axios.get('/staff-monthly-target/list', { params: { year, month, groupName } });
  return res.data || { targets: [], changeRequests: [] };
};

export const getStaffDailyTargets = async (targetId: number): Promise<StaffMonthlyTargetDaily[]> => {
  const res = await axios.get(`/staff-monthly-target/daily/${targetId}`);
  return res.data || [];
};

export const getStaffList = async (groupName?: string): Promise<StaffInfo[]> => {
  const res = await axios.get('/staff-monthly-target/staff-list', { params: { groupName } });
  return res.data || [];
};

export const getLastMonthStaff = async (year: number, month: number, groupName?: string): Promise<StaffInfo[]> => {
  const res = await axios.get('/staff-monthly-target/last-month-staff', { params: { year, month, groupName } });
  return res.data || [];
};

export const saveStaffMonthlyTargets = async (data: {
  year: number; month: number;
  items: Array<{ shopName: string; districtManager: string; supervisor: string; staffName: string; monthlyTarget: number; status: string }>;
  operator?: string; groupName?: string;
}) => {
  const res = await axios.post('/staff-monthly-target/save', data);
  return res.data;
};

export const fetchStaffDailyTargetsByRange = async (startDate: string, endDate: string, groupName?: string): Promise<Record<string, number>> => {
  const res = await axios.get('/staff-monthly-target/daily-targets', { params: { startDate, endDate, groupName } });
  return res.data || {};
};

export const clearStaffMonthlyTargets = async (year: number, month: number, groupName?: string) => {
  const res = await axios.post('/staff-monthly-target/clear', { year, month, groupName });
  return res.data;
};

export const submitStaffChangeRequest = async (data: {
  targetId?: number; year: number; month: number;
  shopName: string; staffName: string; districtManager: string; supervisor: string;
  oldTarget: number; newTarget: number; reason: string;
  applicant?: string; applicantGroup?: string;
}) => {
  const res = await axios.post('/staff-monthly-target/change-request', data);
  return res.data;
};

export const approveStaffChangeRequest = async (data: {
  requestId: number; action: 'approve' | 'reject';
  approver?: string; approverGroup?: string; comment?: string;
}) => {
  const res = await axios.post('/staff-monthly-target/approve', data);
  return res.data;
};
