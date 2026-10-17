// 财务字段 SchemaProvider（基于商品全表）
import sql from 'mssql';
import { IPushSchemaProvider, PushTemplateField } from '../PushModuleRegistry';

export class FinanceFieldProvider implements IPushSchemaProvider {
  moduleCode = 'finance_field';
  moduleName = '财务字段';
  portalCode = 'sales';
  portalName = '销售管理';
  sourceTable = '商品全';
  sourceIdField = 'sku';
  // 只圈选财务性别为空/NULL的记录推送（已有财务性别的不推）
  sourceFilter = "财务性别 IS NULL OR 财务性别 = ''";

  getAvailableFields(): PushTemplateField[] {
    return [
      { fieldKey: '{productCode}', fieldName: '商品代码', fieldType: 'text', category: 'basic', sourceColumn: '商品全.商品代码', sortOrder: 1 },
      { fieldKey: '{productName}', fieldName: '品名', fieldType: 'text', category: 'basic', sourceColumn: '商品全.品名', sortOrder: 2 },
      { fieldKey: '{colorName}', fieldName: '颜色名称', fieldType: 'text', category: 'basic', sourceColumn: '商品全.颜色名称', sortOrder: 3 },
      { fieldKey: '{colorCode}', fieldName: '颜色代码', fieldType: 'text', category: 'basic', sourceColumn: '商品全.颜色代码', sortOrder: 4 },
      { fieldKey: '{year}', fieldName: '年份', fieldType: 'text', category: 'basic', sourceColumn: '商品全.年份', sortOrder: 5 },
      { fieldKey: '{season}', fieldName: '季节', fieldType: 'text', category: 'basic', sourceColumn: '商品全.季节', sortOrder: 6 },
      { fieldKey: '{gender}', fieldName: '性别', fieldType: 'text', category: 'basic', sourceColumn: '商品全.性别', sortOrder: 7 },
      { fieldKey: '{financeGender}', fieldName: '财务性别', fieldType: 'text', category: 'basic', sourceColumn: '商品全.财务性别', sortOrder: 8, description: '财务分类性别，为空表示缺失' },
      { fieldKey: '{category}', fieldName: '大类', fieldType: 'text', category: 'basic', sourceColumn: '商品全.大类', sortOrder: 9 },
      { fieldKey: '{style}', fieldName: '风格', fieldType: 'text', category: 'basic', sourceColumn: '商品全.风格', sortOrder: 10 },
      { fieldKey: '{model}', fieldName: '款式', fieldType: 'text', category: 'basic', sourceColumn: '商品全.款式', sortOrder: 11 },
      { fieldKey: '{lining}', fieldName: '内里', fieldType: 'text', category: 'basic', sourceColumn: '商品全.内里', sortOrder: 12 },
      { fieldKey: '{subSeries}', fieldName: '小系列', fieldType: 'text', category: 'basic', sourceColumn: '商品全.小系列', sortOrder: 13 },
      { fieldKey: '{heelType}', fieldName: '跟型', fieldType: 'text', category: 'basic', sourceColumn: '商品全.跟型', sortOrder: 14 },
      { fieldKey: '{heelHeight}', fieldName: '鞋跟', fieldType: 'text', category: 'basic', sourceColumn: '商品全.鞋跟', sortOrder: 15 },
      { fieldKey: '{commonName}', fieldName: '俗称', fieldType: 'text', category: 'basic', sourceColumn: '商品全.俗称', sortOrder: 16 },
    ];
  }

  async loadRenderData(sourceId: number, pool: any): Promise<Record<string, any>> {
    // sourceId 是 sku（字符串）
    const code = String(sourceId);
    const result = await pool.request()
      .input('code', sql.NVarChar, code)
      .query(`
        SELECT TOP 1 sku, 商品代码, 品名, 颜色名称, 颜色代码, 年份, 季节, 性别,
               财务性别, 大类, 风格, 款式, 内里, 小系列, 跟型, 鞋跟, 俗称
        FROM 商品全
        WHERE sku = @code
      `);
    if (!result.recordset || result.recordset.length === 0) return {};
    const r = result.recordset[0];

    // 【财务性别过滤】业务规则：只推送财务性别缺失(NULL/空)的记录，
    //   由 sourceFilter 在触发器圈选阶段过滤；loadRenderData 只处理已圈选
    //   的记录，财务性别为空时以「缺失」占位展示。
    const productCode = String(r.商品代码 || '');
    const productName = String(r.品名 || '');

    return {
      _title: `财务字段 ${productCode} ${productName}`,
      productCode,
      productName,
      colorName: String(r.颜色名称 || ''),
      colorCode: String(r.颜色代码 || ''),
      year: String(r.年份 || ''),
      season: String(r.季节 || ''),
      gender: String(r.性别 || ''),
      financeGender: r.财务性别 === null || r.财务性别 === undefined || r.财务性别 === '' ? '缺失' : String(r.财务性别),
      category: String(r.大类 || ''),
      style: String(r.风格 || ''),
      model: String(r.款式 || ''),
      lining: String(r.内里 || ''),
      subSeries: String(r.小系列 || ''),
      heelType: String(r.跟型 || ''),
      heelHeight: String(r.鞋跟 || ''),
      commonName: String(r.俗称 || ''),
      destination: productName || productCode,
    };
  }
}

export const financeFieldProvider = new FinanceFieldProvider();
