// 洗鞋服务反馈 SchemaProvider（基于 XS_ShoeFeedback 表）
// 数据源：XS_ShoeFeedback —— 顾客通过 H5 提交的洗鞋充值反馈
// 推送场景：当有新的反馈提交（status='evaluating'）时，推送通知给管理人员审核
// 与 xixie_feedback（洗鞋费用报表，基于 XixieCost）区分开
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

// 状态中文映射
const STATUS_CN: Record<string, string> = {
  pending: '待处理',
  evaluating: '评估中',
  submitted: '已提交',
  accepted: '已受理',
  completed: '已完成',
};

// 同意状态中文映射
const AGREE_CN: Record<string, string> = {
  agree: '同意',
  disagree: '不同意',
  '': '未确认',
};

export class ShoeFeedbackProvider implements IPushSchemaProvider {
  moduleCode = 'shoe_feedback';
  moduleName = '洗鞋服务反馈';
  portalCode = 'xixie';
  portalName = '洗鞋养护专区';
  sourceTable = 'XS_ShoeFeedback';
  sourceIdField = 'id';
  // 仅推送评估中或已提交的反馈记录（顾客刚提交，待管理人员审核）
  sourceFilter = "status IN ('evaluating', 'submitted')";

  getAvailableFields(): PushTemplateField[] {
    return [
      // 反馈基本信息
      { fieldKey: '{feedbackNo}', fieldName: '反馈编号', fieldType: 'text', category: 'basic', sourceColumn: 'XS_ShoeFeedback.feedbackNo', sortOrder: 1, description: '反馈唯一编号' },
      { fieldKey: '{status}', fieldName: '状态', fieldType: 'text', category: 'basic', sourceColumn: 'XS_ShoeFeedback.status', sortOrder: 2, description: '反馈状态' },
      // 充值信息
      { fieldKey: '{rechargeDate}', fieldName: '充值时间', fieldType: 'text', category: 'basic', sourceColumn: 'XS_ShoeFeedback.rechargeDate', sortOrder: 10, description: '顾客充值日期' },
      { fieldKey: '{rechargeAmount}', fieldName: '充值金额', fieldType: 'text', category: 'basic', sourceColumn: 'XS_ShoeFeedback.rechargeAmount', sortOrder: 11, description: '顾客充值金额' },
      // 券使用信息
      { fieldKey: '{usedTicketCount}', fieldName: '已用券数', fieldType: 'number', category: 'basic', sourceColumn: 'XS_ShoeFeedback.usedTicketCount', sortOrder: 20, description: '已使用洗鞋券数量' },
      { fieldKey: '{estimatedTickets}', fieldName: '预估补发券数', fieldType: 'number', category: 'calculated', sourceColumn: 'XS_ShoeFeedback.estimatedTickets', sortOrder: 21, description: '系统计算的预估补发券数' },
      // 同意状态
      { fieldKey: '{agreeStatus}', fieldName: '同意状态', fieldType: 'text', category: 'basic', sourceColumn: 'XS_ShoeFeedback.agreeStatus', sortOrder: 30, description: '顾客是否同意评估结果' },
      { fieldKey: '{disagreeDesc}', fieldName: '不同意见描述', fieldType: 'text', category: 'detail', sourceColumn: 'XS_ShoeFeedback.disagreeDesc', sortOrder: 31, description: '顾客不同意时的描述' },
      // 提交人信息
      { fieldKey: '{submitterName}', fieldName: '提交人', fieldType: 'text', category: 'basic', sourceColumn: 'XS_ShoeFeedback.submitterName', sortOrder: 40, description: '反馈提交人姓名' },
      { fieldKey: '{submitterPhone}', fieldName: '提交人手机', fieldType: 'text', category: 'basic', sourceColumn: 'XS_ShoeFeedback.submitterPhone', sortOrder: 41, description: '反馈提交人手机号' },
      // 处理信息
      { fieldKey: '{handlerName}', fieldName: '处理人', fieldType: 'text', category: 'detail', sourceColumn: 'XS_ShoeFeedback.handlerName', sortOrder: 50, description: '处理该反馈的管理员' },
      { fieldKey: '{handlerRemark}', fieldName: '处理备注', fieldType: 'text', category: 'detail', sourceColumn: 'XS_ShoeFeedback.handlerRemark', sortOrder: 51, description: '处理备注信息' },
      { fieldKey: '{rating}', fieldName: '评价', fieldType: 'text', category: 'detail', sourceColumn: 'XS_ShoeFeedback.rating', sortOrder: 60, description: '顾客对处理的评价' },
      // 时间信息
      { fieldKey: '{createdAt}', fieldName: '提交时间', fieldType: 'datetime', category: 'basic', sourceColumn: 'XS_ShoeFeedback.createdAt', sortOrder: 70, description: '反馈提交时间' },
      { fieldKey: '{handledAt}', fieldName: '处理时间', fieldType: 'datetime', category: 'detail', sourceColumn: 'XS_ShoeFeedback.handledAt', sortOrder: 71, description: '处理时间' },
      { fieldKey: '{completedAt}', fieldName: '完成时间', fieldType: 'datetime', category: 'detail', sourceColumn: 'XS_ShoeFeedback.completedAt', sortOrder: 72, description: '完成时间' },
    ];
  }

  async loadRenderData(sourceId: number | string, pool: any): Promise<Record<string, any>> {
    const result = await pool.request()
      .input('id', sql.Int, Number(sourceId))
      .query('SELECT * FROM XS_ShoeFeedback WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];

    const fmtDT = (v: any): string => {
      if (!v) return '';
      const d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
    };

    return {
      _title: `洗鞋反馈 ${String(r.feedbackNo || '')}`,
      feedbackNo: String(r.feedbackNo || ''),
      status: STATUS_CN[String(r.status || '')] || String(r.status || ''),
      rechargeDate: String(r.rechargeDate || ''),
      rechargeAmount: String(r.rechargeAmount || ''),
      usedTicketCount: Number(r.usedTicketCount || 0),
      estimatedTickets: Number(r.estimatedTickets || 0),
      agreeStatus: AGREE_CN[String(r.agreeStatus || '')] || String(r.agreeStatus || ''),
      disagreeDesc: String(r.disagreeDesc || ''),
      submitterName: String(r.submitterName || ''),
      submitterPhone: String(r.submitterPhone || ''),
      handlerName: String(r.handlerName || ''),
      handlerRemark: String(r.handlerRemark || ''),
      rating: String(r.rating || ''),
      createdAt: fmtDT(r.createdAt),
      handledAt: fmtDT(r.handledAt),
      completedAt: fmtDT(r.completedAt),
      destination: String(r.submitterName || ''),
    };
  }
}

export const shoeFeedbackProvider = new ShoeFeedbackProvider();
