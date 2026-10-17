// 培训反馈明细 SchemaProvider
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class FeedbackDetailProvider implements IPushSchemaProvider {
  moduleCode = 'feedback_detail';
  moduleName = '培训反馈明细';
  portalCode = 'staffChannel';
  portalName = '培训反馈';
  sourceTable = 'FeedbackDetails';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      { fieldKey: '{detailNo}', fieldName: '明细编号', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackDetails.detailNo', sortOrder: 1 },
      { fieldKey: '{taskNo}', fieldName: '任务编号', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackDetails.taskNo', sortOrder: 2 },
      { fieldKey: '{taskTitle}', fieldName: '任务标题', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackDetails.taskTitle', sortOrder: 3 },
      { fieldKey: '{userName}', fieldName: '提交人', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackDetails.userName', sortOrder: 4 },
      { fieldKey: '{shopName}', fieldName: '店铺', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackDetails.shopName', sortOrder: 5 },
      { fieldKey: '{status}', fieldName: '状态', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackDetails.status', sortOrder: 6 },
      { fieldKey: '{remark}', fieldName: '备注', fieldType: 'text', category: 'basic', sourceColumn: 'FeedbackDetails.remark', sortOrder: 7 },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    const result = await pool.request().input('id', sql.Int, sourceId)
      .query('SELECT detailNo, taskNo, taskTitle, userName, shopName, status, remark FROM FeedbackDetails WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];
    return {
      _title: `反馈明细 ${String(r.detailNo || '')}`,
      detailNo: String(r.detailNo || ''), taskNo: String(r.taskNo || ''),
      taskTitle: String(r.taskTitle || ''), userName: String(r.userName || ''),
      shopName: String(r.shopName || ''), status: String(r.status || ''),
      remark: String(r.remark || ''),
      destination: String(r.shopName || ''),
    };
  }
}

export const feedbackDetailProvider = new FeedbackDetailProvider();
