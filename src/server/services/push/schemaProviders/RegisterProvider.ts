// 注册管理 SchemaProvider（基于 register_apply 注册申请/审核表）
// 推送场景：管理员在「模板生成器」选择 注册管理 模块，推送**待审核（pending）**的注册申请提醒；
// 已通过（approved）与已拒绝（rejected）的申请不推送、不在候选列表中展示。
// 数据源过滤由 sourceFilter 驱动（候选列表），loadRenderData 兜底校验（预览/推送链路双保险）。
// 接收人未指定时走系统兜底（经理+管理组），与注册审核管理员的受众一致。
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

// 申请状态 → 中文展示文案
const STATUS_CN: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
};

export class RegisterProvider implements IPushSchemaProvider {
  moduleCode = 'register';
  moduleName = '注册管理';
  portalCode = 'system';
  portalName = '系统管理';
  sourceTable = 'register_apply';
  sourceIdField = 'id';
  /** 仅推送待审核记录：候选列表（source-data）与圈选数据均按此过滤 */
  sourceFilter = "status = 'pending'";

  getAvailableFields(): PushTemplateField[] {
    return [
      // 基本信息字段
      { fieldKey: '{applyNo}', fieldName: '申请编号', fieldType: 'text', category: 'basic', sourceColumn: 'register_apply.apply_no', sortOrder: 1 },
      { fieldKey: '{userName}', fieldName: '姓名', fieldType: 'text', category: 'basic', sourceColumn: 'register_apply.user_name', sortOrder: 2 },
      { fieldKey: '{userCode}', fieldName: '工号', fieldType: 'text', category: 'basic', sourceColumn: 'register_apply.user_code', sortOrder: 3 },
      { fieldKey: '{phone}', fieldName: '手机号', fieldType: 'text', category: 'basic', sourceColumn: 'register_apply.phone', sortOrder: 4 },
      { fieldKey: '{warehouseType}', fieldName: '仓库类别', fieldType: 'text', category: 'basic', sourceColumn: 'register_apply.warehouse_type', sortOrder: 5 },
      { fieldKey: '{orgName}', fieldName: '所属组织', fieldType: 'text', category: 'basic', sourceColumn: 'register_apply.org_name', sortOrder: 6 },
      { fieldKey: '{status}', fieldName: '申请状态', fieldType: 'text', category: 'basic', sourceColumn: 'register_apply.status', sortOrder: 7 },
      { fieldKey: '{createTime}', fieldName: '提交时间', fieldType: 'datetime', category: 'basic', sourceColumn: 'register_apply.create_time', sortOrder: 8 },
      // 明细字段（审核结果补充信息）
      { fieldKey: '{rejectReason}', fieldName: '拒绝原因', fieldType: 'text', category: 'detail', sourceColumn: 'register_apply.reject_reason', sortOrder: 10 },
      { fieldKey: '{approverName}', fieldName: '审核人', fieldType: 'text', category: 'detail', sourceColumn: 'register_apply.approver_name', sortOrder: 11 },
      { fieldKey: '{approveTime}', fieldName: '审核时间', fieldType: 'datetime', category: 'detail', sourceColumn: 'register_apply.approve_time', sortOrder: 12 },
    ];
  }

  async loadRenderData(sourceId: number | string, pool: any): Promise<Record<string, any>> {
    const id = Number(sourceId);
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM register_apply WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];
    // 仅待审核（pending）可推送：已通过/已拒绝的申请返回空数据，预览/推送链路自然拦截
    if (String(r.status || '') !== 'pending') return {};
    const status = String(r.status || 'pending');
    const userName = String(r.user_name || '');
    const applyNo = String(r.apply_no || '');
    return {
      _title: `注册申请 ${userName}（${applyNo}）`,
      applyNo,
      userName,
      userCode: String(r.user_code || ''),
      phone: String(r.phone || ''),
      warehouseType: String(r.warehouse_type || ''),
      orgName: String(r.org_name || ''),
      status: STATUS_CN[status] || status,
      createTime: r.create_time ? new Date(r.create_time).toLocaleString('zh-CN', { hour12: false }) : '',
      rejectReason: String(r.reject_reason || ''),
      approverName: String(r.approver_name || ''),
      approveTime: r.approve_time ? new Date(r.approve_time).toLocaleString('zh-CN', { hour12: false }) : '',
    };
  }
}

export const registerProvider = new RegisterProvider();