// 无成本价商品 SchemaProvider（基于价格刘全表）
// 圈选条件：预估成本=0 或为空，且 年份>=YEAR(GETDATE()-1)-1
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class NoCostPriceProductProvider implements IPushSchemaProvider {
  moduleCode = 'no_cost_price_product';
  moduleName = '无成本价商品';
  portalCode = 'financial';
  portalName = '财务年度评估';
  sourceTable = '价格刘全';
  sourceIdField = '商品代码';
  sourceFilter = '(预估成本 = 0 OR 预估成本 IS NULL) AND 年份 >= YEAR(GETDATE() - 1) - 1';
  dedupColumn = '商品代码';
  allowRepush = true; // 只要有符合条件的数据就重复推送，直到查无数据
  summaryGroupedByField = true; // 汇总推送按字段分组去重聚合（商品代码、年份等各列合并去重）
  dataExtractionKey = 'noCostPriceProduct'; // 取值按数据提取台账 DataExtraction.noCostPriceProduct 的最新 SQL（与页面数据一致）

  getAvailableFields(): PushTemplateField[] {
    return [
      { fieldKey: '{productCode}', fieldName: '商品代码', fieldType: 'text', category: 'basic', sourceColumn: '价格刘全.商品代码', sortOrder: 1 },
      { fieldKey: '{productName}', fieldName: '品名', fieldType: 'text', category: 'basic', sourceColumn: '价格刘全.品名', sortOrder: 2 },
      { fieldKey: '{estimatedCost}', fieldName: '预估成本', fieldType: 'number', category: 'basic', sourceColumn: '价格刘全.预估成本', sortOrder: 3 },
      { fieldKey: '{year}', fieldName: '年份', fieldType: 'text', category: 'basic', sourceColumn: '价格刘全.年份', sortOrder: 4 },
      { fieldKey: '{season}', fieldName: '季节', fieldType: 'text', category: 'basic', sourceColumn: '价格刘全.季节', sortOrder: 5 },
      { fieldKey: '{gender}', fieldName: '性别', fieldType: 'text', category: 'basic', sourceColumn: '价格刘全.性别', sortOrder: 6 },
      { fieldKey: '{style}', fieldName: '风格', fieldType: 'text', category: 'basic', sourceColumn: '价格刘全.风格', sortOrder: 7 },
      { fieldKey: '{model}', fieldName: '款式', fieldType: 'text', category: 'basic', sourceColumn: '价格刘全.款式', sortOrder: 8 },
      { fieldKey: '{category}', fieldName: '大类', fieldType: 'text', category: 'basic', sourceColumn: '价格刘全.大类', sortOrder: 9 },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    // sourceId 是商品代码（字符串）
    const code = String(sourceId);
    const result = await pool.request()
      .input('code', sql.NVarChar, code)
      .query(`
        SELECT TOP 1 商品代码, 品名, 预估成本, 年份, 季节, 性别, 风格, 款式, 大类
        FROM 价格刘全
        WHERE 商品代码 = @code
      `);
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];

    const productCode = String(r.商品代码 || '');
    const productName = String(r.品名 || '');

    return {
      _title: `无成本价商品 ${productCode} ${productName}`,
      productCode,
      productName,
      estimatedCost: r.预估成本 === null || r.预估成本 === undefined ? 0 : Number(r.预估成本),
      year: String(r.年份 || ''),
      season: String(r.季节 || ''),
      gender: String(r.性别 || ''),
      style: String(r.风格 || ''),
      model: String(r.款式 || ''),
      category: String(r.大类 || ''),
      destination: productName || productCode,
    };
  }
}

export const noCostPriceProductProvider = new NoCostPriceProductProvider();