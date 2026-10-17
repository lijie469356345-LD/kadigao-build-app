import axios from './axios';

// ============================================================
// 成长课堂（行政资产下新门户，按部门分类上传展示资料）
// ============================================================
export const growthClassroomApi = {
  // 分类列表（含各分类资料数）
  getCategories: () =>
    axios.get('/growth-classroom/categories'),
  // 子类（子区）列表：全部分类下的子区，供上传弹窗选择
  getSubCategories: () =>
    axios.get('/growth-classroom/subcategories'),
  // 新增子区
  createSubCategory: (categoryCode: string, subName: string) =>
    axios.post('/growth-classroom/subcategories', { categoryCode, subName }),
  // 子区改名（级联同步该分类下资料引用）
  renameSubCategory: (id: number, subName: string) =>
    axios.patch(`/growth-classroom/subcategories/${id}`, { subName }),
  // 删除子区（其下资料移入未分区）
  removeSubCategory: (id: number) =>
    axios.delete(`/growth-classroom/subcategories/${id}`),
  // 资料列表：category 分类筛选；keyword 标题/概述搜索
  list: (params?: Record<string, any>) =>
    axios.get('/growth-classroom/materials', { params }),
  // 上传资料（title/category/summary/file）
  upload: (data: FormData) =>
    axios.post('/growth-classroom/materials', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600000,
    }),
  // 上报观看进度增量（秒）
  reportWatch: (id: number, seconds: number) =>
    axios.post(`/growth-classroom/materials/${id}/watch`, { seconds }),
  // 记录下载
  reportDownload: (id: number) =>
    axios.post(`/growth-classroom/materials/${id}/download`),
  // 下载（服务端叠加水印 + 写下载留痕，返回文件 Blob）
  downloadFile: (id: number) =>
    axios.get(`/growth-classroom/materials/${id}/download`, { responseType: 'blob' }),
  // 在线预览取原文件（文档类预览走此接口，避免静态直出）
  getFile: (id: number) =>
    axios.get(`/growth-classroom/materials/${id}/file`, { responseType: 'blob' }),
  // 移动资料到指定子区（subCategory 为空字符串表示移入未分区；categoryCode 可选，用于跨大区移动）
  moveSubCategory: (id: number, subCategory: string, categoryCode?: string) =>
    axios.post(`/growth-classroom/materials/${id}/move-subcategory`, { subCategory, categoryCode }),
  // 删除资料（记录 + 磁盘文件 + 关联日志；所有分区联动消失）
  remove: (id: number) =>
    axios.delete(`/growth-classroom/materials/${id}`),
  // 日志明细（观看 + 下载，聚合与逐条）
  getLogs: (id: number) =>
    axios.get(`/growth-classroom/materials/${id}/logs`),
};