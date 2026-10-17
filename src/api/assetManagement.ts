import axios from './axios';

// ============================================================
// 固定资产
// ============================================================
export const fixedAssetApi = {
  list: (params?: Record<string, any>) =>
    axios.get('/asset-management/fixed-assets', { params }),
  create: (data: any) =>
    axios.post('/asset-management/fixed-assets', data),
  update: (id: number, data: any) =>
    axios.put(`/asset-management/fixed-assets/${id}`, data),
  remove: (id: number) =>
    axios.delete(`/asset-management/fixed-assets/${id}`),
  getTransfers: (id: number) =>
    axios.get(`/asset-management/fixed-assets/${id}/transfers`),
  createTransfer: (id: number, data: any) =>
    axios.post(`/asset-management/fixed-assets/${id}/transfers`, data),
  export: () =>
    axios.get('/asset-management/fixed-assets/export', { responseType: 'blob' }),
  // 导入资产档案（Excel 批量上传）
  importAssets: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post('/asset-management/fixed-assets/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // 清空全部固定资产档案
  clearAll: () =>
    axios.post('/asset-management/fixed-assets/clear-all'),
  // 获取资产类别列表（去重，供筛选项下拉）
  getCategories: () =>
    axios.get('/asset-management/fixed-assets/categories'),
  // 统计概览
  getStatistics: (params?: Record<string, any>) =>
    axios.get('/asset-management/fixed-assets/statistics', { params }),
  // 资产分布
  getDistributions: (id: number) =>
    axios.get(`/asset-management/fixed-assets/${id}/distributions`),
  getAllDistributions: (params?: Record<string, any>) =>
    axios.get('/asset-management/fixed-assets/distributions/all', { params }),
  saveDistributions: (id: number, items: any[]) =>
    axios.post(`/asset-management/fixed-assets/${id}/distributions`, { items }),
  removeDistribution: (distId: number) =>
    axios.delete(`/asset-management/fixed-assets/distributions/${distId}`),
  exportDistributions: () =>
    axios.get('/asset-management/fixed-assets/distributions/export', { responseType: 'blob' }),
  importDistributions: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return axios.post('/asset-management/fixed-assets/distributions/import', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // 折旧计算
  calculateDepreciation: (assetIds?: number[], schemeId?: number) =>
    axios.post('/asset-management/fixed-assets/calculate-depreciation', { assetIds, schemeId }),
  applyDepreciation: (schemeId?: number) =>
    axios.post('/asset-management/fixed-assets/apply-depreciation', { schemeId }),
  // 上传资产图片
  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post('/asset-management/fixed-assets/upload-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ============================================================
// 盘点
// ============================================================
export const inventoryApi = {
  list: () =>
    axios.get('/asset-management/inventory'),
  create: (data: any) =>
    axios.post('/asset-management/inventory', data),
  getDetails: (id: number) =>
    axios.get(`/asset-management/inventory/${id}/details`),
  submitDetails: (id: number, items: any[]) =>
    axios.post(`/asset-management/inventory/${id}/details`, { items }),
};

// ============================================================
// 报废
// ============================================================
export const disposalApi = {
  list: () =>
    axios.get('/asset-management/disposals'),
  create: (data: any) =>
    axios.post('/asset-management/disposals', data),
  approve: (id: number, approved: boolean, remark?: string) =>
    axios.post(`/asset-management/disposals/${id}/approve`, { approved, remark }),
  getAssetLocations: (assetId: number) =>
    axios.get(`/asset-management/disposals/asset-locations/${assetId}`),
};

// ============================================================
// 车辆管理
// ============================================================
export const vehicleApi = {
  list: (params?: Record<string, any>) =>
    axios.get('/asset-management/vehicles', { params }),
  create: (data: any) =>
    axios.post('/asset-management/vehicles', data),
  update: (id: number, data: any) =>
    axios.put(`/asset-management/vehicles/${id}`, data),
  remove: (id: number) =>
    axios.delete(`/asset-management/vehicles/${id}`),
  getMaintenance: (id: number) =>
    axios.get(`/asset-management/vehicles/${id}/maintenance`),
  createMaintenance: (id: number, data: any) =>
    axios.post(`/asset-management/vehicles/${id}/maintenance`, data),
  getViolations: (id: number) =>
    axios.get(`/asset-management/vehicles/${id}/violations`),
  createViolation: (id: number, data: any) =>
    axios.post(`/asset-management/vehicles/${id}/violations`, data),
  updateViolation: (id: number, data: any) =>
    axios.put(`/asset-management/violations/${id}`, data),
  getExpiryReminders: () =>
    axios.get('/asset-management/vehicles/expiry-reminders'),
  getCostLedger: (id: number) =>
    axios.get(`/asset-management/vehicles/${id}/cost-ledger`),
  // 获取车辆最后一次归还状态（剩余公里数 + 油箱）
  getLastStatus: (id: number) =>
    axios.get(`/asset-management/vehicles/${id}/last-status`),
  // 获取可用车辆列表（排除已出车的）
  getAvailableList: () =>
    axios.get('/asset-management/vehicles/available/list'),
  // 上传年检照片或保险文件（type: 'inspection' | 'insurance'）
  uploadFile: (id: number, file: File, type: 'inspection' | 'insurance') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    return axios.post(`/asset-management/vehicles/${id}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ============================================================
// 资产管理-组织列表（第一层+第二层，供车辆归属组织下拉）
// ============================================================
export const assetOrgApi = {
  getLevels: () =>
    axios.get('/asset-management/org/levels'),
};

// ============================================================
// 申请用车
// ============================================================
export const vehicleApplicationApi = {
  list: (params?: Record<string, any>) =>
    axios.get('/asset-management/vehicle-applications', { params }),
  // 获取当前用户新增申请默认信息：真实姓名、所在组织、最近一次归还剩余油数
  myApplyDefaults: () =>
    axios.get('/asset-management/vehicle-applications/my-apply-defaults'),
  create: (data: any) =>
    axios.post('/asset-management/vehicle-applications', data),
  deptApprove: (id: number, approved: boolean, remark?: string) =>
    axios.post(`/asset-management/vehicle-applications/${id}/dept-approve`, { approved, remark }),
  // 审批派车合并：审批通过同时自动派车
  approveDispatch: (id: number, data: { approved: boolean; vehicleId?: number; remark?: string; departureBattery?: number }) =>
    axios.post(`/asset-management/vehicle-applications/${id}/approve-dispatch`, data),
  // 查询可用车辆 + 最近两辆已出车车辆
  checkVehicles: (id: number) =>
    axios.get(`/asset-management/vehicle-applications/${id}/check-vehicles`),
  // 设置"请等待"提示
  setWait: (id: number, waitRemark: string) =>
    axios.post(`/asset-management/vehicle-applications/${id}/set-wait`, { waitRemark }),
  dispatch: (id: number, data: any) =>
    axios.post(`/asset-management/vehicle-applications/${id}/dispatch`, data),
  departure: (id: number, data: any) =>
    axios.post(`/asset-management/vehicle-applications/${id}/departure`, data),
  return: (id: number, data: any) =>
    axios.post(`/asset-management/vehicle-applications/${id}/return`, data),
  cancel: (id: number) =>
    axios.post(`/asset-management/vehicle-applications/${id}/cancel`),
  export: () =>
    axios.get('/asset-management/vehicle-applications/export'),
  // 归还现场图片上传（里程照片/油箱照片/车辆四维图）
  uploadReturnPhoto: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post('/asset-management/vehicle-return-photo-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ============================================================
// 折旧方案
// ============================================================
export const depreciationSchemeApi = {
  list: () =>
    axios.get('/asset-management/depreciation-schemes'),
  create: (data: any) =>
    axios.post('/asset-management/depreciation-schemes', data),
  update: (id: number, data: any) =>
    axios.put(`/asset-management/depreciation-schemes/${id}`, data),
  remove: (id: number) =>
    axios.delete(`/asset-management/depreciation-schemes/${id}`),
};

// ============================================================
// 授权人管理
// ============================================================
export const authorizedPersonApi = {
  list: (params?: Record<string, any>) =>
    axios.get('/asset-management/authorized-persons', { params }),
  create: (data: any) =>
    axios.post('/asset-management/authorized-persons', data),
  update: (id: number, data: any) =>
    axios.put(`/asset-management/authorized-persons/${id}`, data),
  remove: (id: number) =>
    axios.delete(`/asset-management/authorized-persons/${id}`),
  getCertificates: (personId: number) =>
    axios.get(`/asset-management/authorized-persons/${personId}/certificates`),
  uploadCertificate: (personId: number, file: File, meta: { certType: string; certNo?: string; issueDate?: string; expiryDate?: string; remark?: string }) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('certType', meta.certType);
    if (meta.certNo) formData.append('certNo', meta.certNo);
    if (meta.issueDate) formData.append('issueDate', meta.issueDate);
    if (meta.expiryDate) formData.append('expiryDate', meta.expiryDate);
    if (meta.remark) formData.append('remark', meta.remark);
    return axios.post(`/asset-management/authorized-persons/${personId}/certificates`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  removeCertificate: (certId: number) =>
    axios.delete(`/asset-management/certificates/${certId}`),
};
