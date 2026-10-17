// 洗鞋费用报表 SchemaProvider
// 数据源：XixieCost（洗鞋费用）为主表，关联 XixieInvest（投放）+ XixieWriteoff（核销）
// loadRenderData 按 XixieCost.id 加载，并按 monthYear + 店铺名称 关联查询投放/核销数据，
// 汇总为一条完整的洗鞋费用报表消息推送。
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class XixieFeedbackProvider implements IPushSchemaProvider {
  moduleCode = 'xixie_feedback';
  moduleName = '洗鞋费用报表';
  portalCode = 'xixie';
  portalName = '洗鞋服务';
  sourceTable = 'XixieCost';
  sourceIdField = 'id';

  getAvailableFields(): PushTemplateField[] {
    return [
      // 基本信息
      { fieldKey: '{monthYear}', fieldName: '月份', fieldType: 'text', category: 'basic', sourceColumn: 'XixieCost.monthYear', sortOrder: 1, description: '洗鞋费用月份' },
      { fieldKey: '{quJing}', fieldName: '区经', fieldType: 'text', category: 'basic', sourceColumn: 'XixieCost.区经', sortOrder: 2 },
      { fieldKey: '{warehouseType}', fieldName: '仓库类别', fieldType: 'text', category: 'basic', sourceColumn: 'XixieCost.仓库类别', sortOrder: 3 },
      { fieldKey: '{region}', fieldName: '区域', fieldType: 'text', category: 'basic', sourceColumn: 'XixieCost.区域', sortOrder: 4 },
      { fieldKey: '{supervisor}', fieldName: '督导', fieldType: 'text', category: 'basic', sourceColumn: 'XixieCost.督导', sortOrder: 5 },
      { fieldKey: '{shopName}', fieldName: '店铺名称', fieldType: 'text', category: 'basic', sourceColumn: 'XixieCost.店铺名称', sortOrder: 6 },
      // 费用信息
      { fieldKey: '{shoeCount}', fieldName: '双数', fieldType: 'number', category: 'basic', sourceColumn: 'XixieCost.双数', sortOrder: 10, description: '洗鞋双数' },
      { fieldKey: '{cost}', fieldName: '费用', fieldType: 'number', category: 'basic', sourceColumn: 'XixieCost.费用', sortOrder: 11, description: '洗鞋费用金额' },
      // 投放信息
      { fieldKey: '{issueCount}', fieldName: '发放人数', fieldType: 'number', category: 'detail', sourceColumn: 'XixieInvest.发放人数', sortOrder: 20, description: '洗鞋券发放人数' },
      { fieldKey: '{issueTickets}', fieldName: '发放张数', fieldType: 'number', category: 'detail', sourceColumn: 'XixieInvest.发放张数', sortOrder: 21, description: '洗鞋券发放张数' },
      // 核销信息
      { fieldKey: '{writeoffCount}', fieldName: '核销人数', fieldType: 'number', category: 'detail', sourceColumn: 'XixieWriteoff.核销人数', sortOrder: 30, description: '洗鞋券核销人数' },
      { fieldKey: '{writeoffTickets}', fieldName: '核销张数', fieldType: 'number', category: 'detail', sourceColumn: 'XixieWriteoff.核销张数', sortOrder: 31, description: '洗鞋券核销张数' },
      // 转化信息
      { fieldKey: '{convertCount}', fieldName: '转化人数', fieldType: 'number', category: 'calculated', sourceColumn: 'XixieWriteoff.转化人数', sortOrder: 40, description: '洗鞋券转化人数' },
      { fieldKey: '{convertRevenue}', fieldName: '转化业绩', fieldType: 'number', category: 'calculated', sourceColumn: 'XixieWriteoff.转化业绩', sortOrder: 41, description: '洗鞋转化业绩金额' },
    ];
  }

  async loadRenderData(sourceId: number | string, pool: any): Promise<Record<string, any>> {
    // 1) 查询 XixieCost 主记录
    const result = await pool.request()
      .input('id', sql.Int, Number(sourceId))
      .query('SELECT * FROM XixieCost WHERE id = @id');
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];

    const monthYear = String(r.monthYear || '');
    const shopName = String(r.店铺名称 || '');
    const supervisor = String(r.督导 || '');

    // 2) 关联查询该月该店的投放汇总
    let invest: { 发放人数: number; 发放张数: number } = { 发放人数: 0, 发放张数: 0 };
    if (monthYear && shopName) {
      try {
        const invRes = await pool.request()
          .input('my', sql.NVarChar, monthYear)
          .input('sn', sql.NVarChar, shopName)
          .query(`
            SELECT ISNULL(SUM(发放人数), 0) AS 发放人数, ISNULL(SUM(发放张数), 0) AS 发放张数
            FROM XixieInvest WHERE monthYear = @my AND 店铺名称 = @sn
          `);
        if (invRes.recordset && invRes.recordset.length > 0) {
          invest = {
            发放人数: Number(invRes.recordset[0].发放人数 || 0),
            发放张数: Number(invRes.recordset[0].发放张数 || 0),
          };
        }
      } catch { /* XixieInvest 表可能不存在 */ }
    }

    // 3) 关联查询该月该店的核销汇总
    let writeoff: { 核销人数: number; 核销张数: number; 转化人数: number; 转化业绩: number } = {
      核销人数: 0, 核销张数: 0, 转化人数: 0, 转化业绩: 0,
    };
    if (monthYear && shopName) {
      try {
        const woRes = await pool.request()
          .input('my', sql.NVarChar, monthYear)
          .input('sn', sql.NVarChar, shopName)
          .query(`
            SELECT ISNULL(SUM(核销人数), 0) AS 核销人数, ISNULL(SUM(核销张数), 0) AS 核销张数,
                   ISNULL(SUM(转化人数), 0) AS 转化人数, ISNULL(SUM(转化业绩), 0) AS 转化业绩
            FROM XixieWriteoff WHERE monthYear = @my AND 店铺名称 = @sn
          `);
        if (woRes.recordset && woRes.recordset.length > 0) {
          writeoff = {
            核销人数: Number(woRes.recordset[0].核销人数 || 0),
            核销张数: Number(woRes.recordset[0].核销张数 || 0),
            转化人数: Number(woRes.recordset[0].转化人数 || 0),
            转化业绩: Number(woRes.recordset[0].转化业绩 || 0),
          };
        }
      } catch { /* XixieWriteoff 表可能不存在 */ }
    }

    return {
      _title: `洗鞋服务反馈 ${shopName} ${monthYear}`,
      monthYear,
      quJing: String(r.区经 || ''),
      warehouseType: String(r.仓库类别 || ''),
      region: String(r.区域 || ''),
      supervisor,
      shopName,
      shoeCount: Number(r.双数 || 0),
      cost: Number(r.费用 || 0),
      issueCount: invest.发放人数,
      issueTickets: invest.发放张数,
      writeoffCount: writeoff.核销人数,
      writeoffTickets: writeoff.核销张数,
      convertCount: writeoff.转化人数,
      convertRevenue: writeoff.转化业绩,
      destination: shopName,
    };
  }
}

export const xixieFeedbackProvider = new XixieFeedbackProvider();
