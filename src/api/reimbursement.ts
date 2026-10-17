const API = '/api/reimbursement';

export const reimbursementApi = {
  list: (params?: Record<string, string>) =>
    fetch(`${API}/list${params ? '?' + new URLSearchParams(params) : ''}`).then(r => r.json()),

  getById: (id: number) =>
    fetch(`${API}/${id}`).then(r => r.json()),

  create: (data: any) =>
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  update: (id: number, data: any) =>
    fetch(`${API}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  delete: (id: number) =>
    fetch(`${API}/${id}`, { method: 'DELETE' }).then(r => r.json()),

  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    return fetch(`${API}/upload`, { method: 'POST', body: fd }).then(r => r.json());
  },

  invoiceOcr: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`${API}/invoice-ocr`, { method: 'POST', body: fd }).then(r => r.json());
  },

  financeReview: (id: number, data: any) =>
    fetch(`${API}/${id}/finance-review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  payment: (id: number, data: any) =>
    fetch(`${API}/${id}/payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  exportPayments: () =>
    fetch(`${API}/export/payments`).then(r => r.json()),

  generateVoucher: (id: number) =>
    fetch(`${API}/${id}/generate-voucher`, { method: 'POST' }).then(r => r.json()),

  voucherList: (params?: Record<string, string>) =>
    fetch(`${API}/voucher/list${params ? '?' + new URLSearchParams(params) : ''}`).then(r => r.json()),

  templates: () =>
    fetch(`${API}/templates/list`).then(r => r.json()),

  createTemplate: (data: any) =>
    fetch(`${API}/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  deleteTemplate: (id: number) =>
    fetch(`${API}/templates/${id}`, { method: 'DELETE' }).then(r => r.json()),

  advances: (employeeId?: string, approvalStatus?: string) =>
    fetch(`${API}/advances/list${employeeId || approvalStatus ? '?' + new URLSearchParams({ ...(employeeId ? { employeeId } : {}), ...(approvalStatus ? { approvalStatus } : {}) }).toString() : ''}`).then(r => r.json()),

  createAdvance: (data: any) =>
    fetch(`${API}/advances`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  approveAdvance: (id: number, data: any) =>
    fetch(`${API}/advances/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  availableAdvances: (employeeId: string) =>
    fetch(`${API}/advances/available?employeeId=${employeeId}`).then(r => r.json()),

  budgets: () =>
    fetch(`${API}/budgets/list`).then(r => r.json()),

  createBudget: (data: any) =>
    fetch(`${API}/budgets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  budgetRemaining: (department?: string) =>
    fetch(`${API}/budgets/remaining${department ? '?department=' + encodeURIComponent(department) : ''}`).then(r => r.json()),

  debtSummary: (params?: Record<string, string>) =>
    fetch(`${API}/debt-summary${params ? '?' + new URLSearchParams(params) : ''}`).then(r => r.json()),

  debtDetail: (employeeId: string) =>
    fetch(`${API}/debt-detail/${encodeURIComponent(employeeId)}`).then(r => r.json()),

  // 审批流配置
  approvalList: (params?: Record<string, string>) =>
    fetch(`${API}/approval/list${params ? '?' + new URLSearchParams(params) : ''}`).then(r => r.json()),

  approvalGet: (id: number) =>
    fetch(`${API}/approval/${id}`).then(r => r.json()),

  approvalCreate: (data: any) =>
    fetch(`${API}/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  approvalUpdate: (id: number, data: any) =>
    fetch(`${API}/approval/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  approvalDelete: (id: number) =>
    fetch(`${API}/approval/${id}`, { method: 'DELETE' }).then(r => r.json()),

  approvalUsers: (keyword?: string) =>
    fetch(`${API}/approval/users${keyword ? '?keyword=' + encodeURIComponent(keyword) : ''}`).then(r => r.json()),

  approvalGroups: () =>
    fetch(`${API}/approval/groups`).then(r => r.json()),

  // 账簿管理
  ledgerList: (params?: Record<string, string>) =>
    fetch(`${API}/ledger/list${params ? '?' + new URLSearchParams(params) : ''}`).then(r => r.json()),

  ledgerCreate: (data: any) =>
    fetch(`${API}/ledger`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  ledgerUpdate: (id: number, data: any) =>
    fetch(`${API}/ledger/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  ledgerDelete: (id: number) =>
    fetch(`${API}/ledger/${id}`, { method: 'DELETE' }).then(r => r.json()),

  ledgerPayments: (params?: Record<string, string>) =>
    fetch(`${API}/ledger/payments${params ? '?' + new URLSearchParams(params) : ''}`).then(r => r.json()),

  // 付款记录
  paymentList: (params?: Record<string, string>) =>
    fetch(`${API}/payment/list${params ? '?' + new URLSearchParams(params) : ''}`).then(r => r.json()),

  paymentCreate: (data: any) =>
    fetch(`${API}/payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  paymentGenerateVoucher: (id: number) =>
    fetch(`${API}/payment/${id}/generate-voucher`, { method: 'POST' }).then(r => r.json()),

  // 预付款申请
  advancePaymentList: (params?: Record<string, string>) =>
    fetch(`${API}/advance-payment/list${params ? '?' + new URLSearchParams(params) : ''}`).then(r => r.json()),

  advancePaymentGet: (id: number) =>
    fetch(`${API}/advance-payment/${id}`).then(r => r.json()),

  advancePaymentCreate: (data: any) =>
    fetch(`${API}/advance-payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  advancePaymentUpdate: (id: number, data: any) =>
    fetch(`${API}/advance-payment/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  advancePaymentApprove: (id: number, data: any) =>
    fetch(`${API}/advance-payment/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  advancePaymentDelete: (id: number) =>
    fetch(`${API}/advance-payment/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // 审批任务
  approvalTaskMyPending: (params: Record<string, string>) =>
    fetch(`${API}/approval-task/my-pending?${new URLSearchParams(params)}`).then(r => r.json()),

  approvalTaskBySource: (sourceType: string, sourceId: number) =>
    fetch(`${API}/approval-task/source/${sourceType}/${sourceId}`).then(r => r.json()),

  approvalTaskApprove: (id: number, data: any) =>
    fetch(`${API}/approval-task/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),

  approvalTaskReject: (id: number, data: any) =>
    fetch(`${API}/approval-task/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
};
