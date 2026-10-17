// ============================================================
// 企业微信推送 V2 API 路由（多门户多模块）
//
// 包含：
//   GET  /api/wechat-push-v2/modules                 所有模块
//   GET  /api/wechat-push-v2/modules/:code/fields    模块可用字段
//   GET  /api/wechat-push-v2/modules/:code/templates 模块模板
//   POST /api/wechat-push-v2/modules/:code/templates 创建模板
//   PUT  /api/wechat-push-v2/templates/:id           更新模板
//   DELETE /api/wechat-push-v2/templates/:id         删除模板
//   POST /api/wechat-push-v2/templates/preview       模板预览
//   POST /api/wechat-push-v2/push                    手动推送
//   POST /api/wechat-push-v2/repush                  重新推送
//   GET  /api/wechat-push-v2/logs                    推送总列表
//   GET  /api/wechat-push-v2/logs/stats              统计摘要
//   GET  /api/wechat-push-v2/settings                设置
//   PUT  /api/wechat-push-v2/settings                更新设置
//   POST /api/wechat-push-v2/init                    建表初始化
// ============================================================

import { Router, Request, Response } from 'express';
import sql from 'mssql';
import axios from 'axios';
import { getPool } from '../../config/db';
import { pushModuleRegistry } from '../services/push/PushModuleRegistry';
import { dispatchPush, dispatchSummaryPush, dispatchCustomNotification } from '../services/push/PushDispatcher';
import { inspectionLogProvider } from '../services/push/schemaProviders/InspectionLogProvider';
import { directSalesSummaryProvider } from '../services/push/schemaProviders/DirectSalesSummaryProvider';
import { feedbackTaskProvider } from '../services/push/schemaProviders/FeedbackTaskProvider';
import { feedbackDetailProvider } from '../services/push/schemaProviders/FeedbackDetailProvider';
import { coachingProvider } from '../services/push/schemaProviders/CoachingProvider';
import { scoreProvider } from '../services/push/schemaProviders/ScoreProvider';
import { monthlyTargetProvider } from '../services/push/schemaProviders/MonthlyTargetProvider';
import { inspectionTaskProvider } from '../services/push/schemaProviders/InspectionTaskProvider';
import { dailyShopTargetProvider } from '../services/push/schemaProviders/DailyShopTargetProvider';
import { customNotificationProvider } from '../services/push/schemaProviders/CustomNotificationProvider';
import { financeFieldProvider } from '../services/push/schemaProviders/FinanceFieldProvider';
import { noCostPriceProductProvider } from '../services/push/schemaProviders/NoCostPriceProductProvider';
import { registerProvider } from '../services/push/schemaProviders/RegisterProvider';
import { xixieFeedbackProvider } from '../services/push/schemaProviders/XixieFeedbackProvider';
import { shoeFeedbackProvider } from '../services/push/schemaProviders/ShoeFeedbackProvider';
import { hourlyPerformanceProvider } from '../services/push/schemaProviders/HourlyPerformanceProvider';
import { getSettings, isApiConfigured } from '../services/wechatPushService';

const router = Router();

// 服务启动时注册所有 SchemaProvider
pushModuleRegistry.registerAll([
  inspectionLogProvider,
  directSalesSummaryProvider,
  feedbackTaskProvider,
  feedbackDetailProvider,
  coachingProvider,
  scoreProvider,
  monthlyTargetProvider,
  inspectionTaskProvider,
  dailyShopTargetProvider,
  customNotificationProvider,
  financeFieldProvider,
  noCostPriceProductProvider,
  registerProvider,
  xixieFeedbackProvider,
  shoeFeedbackProvider,
  hourlyPerformanceProvider,
]);

// 导出注册函数，供外部调用按需注册其他模块
export function registerPushProviders(): void {
  pushModuleRegistry.register(inspectionLogProvider);
  // 后续其他模块在这里注册
}

// 预置/升级「无成本价商品」每日自动推送模板（summary 汇总，每天 10:00 触发）
// 对齐 finance_field（财务性别）模块的推送机制：
//  - triggerType=scheduled + triggerConfig.cron="10:00"，每天定时触发一次；
//  - 有圈选数据才推送（无数据跳过由 TriggerScheduler 空集逻辑保证）；
//  - 接收人沿用财务性别的指定企微接收人（selectedRecipients 覆盖）。
// 仅当模板不存在、或仍是旧版 manual 预置模板时写入/升级；用户已自定义（非 manual）时不覆盖。
async function ensureDefaultNoCostPriceTemplate(): Promise<void> {
  try {
    const pool = await getPool();
    const exists = await pool.request()
      .input('code', sql.NVarChar, 'no_cost_price_product')
      .query(`SELECT id, triggerType FROM WechatPushTemplateV2 WHERE moduleCode = @code`);
    const fields = JSON.stringify(['{productCode}', '{productName}', '{estimatedCost}', '{year}', '{season}', '{category}']);
    const recipients = JSON.stringify(['MaManLi', 'LiuDeng']);
    const trgConf = JSON.stringify({ cron: '10:00', senderName: '系统管理员' });

    if (!exists.recordset || exists.recordset.length === 0) {
      await pool.request()
        .input('code', sql.NVarChar, 'no_cost_price_product')
        .input('name', sql.NVarChar, '无成本价商品每日推送')
        .input('title', sql.NVarChar, '无成本价商品汇总')
        .input('fields', sql.NVarChar, fields)
        .input('recipients', sql.NVarChar, recipients)
        .input('def', sql.Bit, 1)
        .input('pmode', sql.NVarChar, 'summary')
        .input('trgType', sql.NVarChar, 'scheduled')
        .input('trgConf', sql.NVarChar, trgConf)
        .input('dsMode', sql.NVarChar, 'skip_query')
        .query(`
          INSERT INTO WechatPushTemplateV2 (moduleCode, templateName, title, headerTemplate, bodyTemplate, footerTemplate, selectedFields, selectedRecipients, isDefault, recipientGroup, recipientPosition, pushMode, triggerType, triggerConfig, dataSourceMode)
          VALUES (@code, @name, @title, '', '', '', @fields, @recipients, @def, '', '', @pmode, @trgType, @trgConf, @dsMode)
        `);
      console.log('[WechatPushV2] 已预置「无成本价商品」每日自动推送模板');
      return;
    }

    const row = exists.recordset[0];
    if (String(row.triggerType) === 'manual') {
      await pool.request()
        .input('id', sql.Int, Number(row.id))
        .input('name', sql.NVarChar, '无成本价商品每日推送')
        .input('title', sql.NVarChar, '无成本价商品汇总')
        .input('fields', sql.NVarChar, fields)
        .input('recipients', sql.NVarChar, recipients)
        .input('def', sql.Bit, 1)
        .input('pmode', sql.NVarChar, 'summary')
        .input('trgType', sql.NVarChar, 'scheduled')
        .input('trgConf', sql.NVarChar, trgConf)
        .input('dsMode', sql.NVarChar, 'skip_query')
        .query(`
          UPDATE WechatPushTemplateV2 SET
            templateName = @name, title = @title, selectedFields = @fields, selectedRecipients = @recipients,
            isDefault = @def, pushMode = @pmode, triggerType = @trgType, triggerConfig = @trgConf,
            dataSourceMode = @dsMode, updatedAt = GETDATE()
          WHERE id = @id
        `);
      console.log('[WechatPushV2] 已将「无成本价商品」模板升级为每日自动推送');
    }
  } catch (e: any) {
    console.warn('[WechatPushV2] 预置「无成本价商品」模板失败:', e.message);
  }
}

// 预置「注册管理」默认推送模板（注册申请审批通知，手动触发）
// 与其它模块同机制：register 模块注册后即可在模板生成器中新建/编辑；
// 此处预置一份开箱即用的默认模板，推送内容 = 注册申请关键信息（申请编号/姓名/手机号/仓库类别/所属组织/状态）。
// 仅当该模块尚无模板时写入；用户后续的修改不会被覆盖。
async function ensureDefaultRegisterTemplate(): Promise<void> {
  try {
    const pool = await getPool();
    const exists = await pool.request()
      .input('code', sql.NVarChar, 'register')
      .query(`SELECT id FROM WechatPushTemplateV2 WHERE moduleCode = @code`);
    if (exists.recordset && exists.recordset.length > 0) return;

    const fields = JSON.stringify(['{applyNo}', '{userName}', '{userCode}', '{phone}', '{warehouseType}', '{orgName}', '{status}', '{createTime}']);
    const header = [
      '【注册管理】',
      '',
      '申请编号：{applyNo}',
      '姓    名：{userName}',
      '工    号：{userCode}',
      '手机号：{phone}',
      '仓库类别：{warehouseType}',
      '所属组织：{orgName}',
      '申请状态：{status}',
      '提交时间：{createTime}',
    ].join('\n');
    const footer = '\n————系统自动推送，无需回复————';
    const trgConf = JSON.stringify({ senderName: '系统管理员' });

    await pool.request()
      .input('code', sql.NVarChar, 'register')
      .input('name', sql.NVarChar, '注册申请审批通知')
      .input('title', sql.NVarChar, '【注册管理】')
      .input('header', sql.NVarChar, header)
      .input('footer', sql.NVarChar, footer)
      .input('fields', sql.NVarChar, fields)
      .input('def', sql.Bit, 1)
      .input('pmode', sql.NVarChar, 'detail')
      .input('trgType', sql.NVarChar, 'manual')
      .input('trgConf', sql.NVarChar, trgConf)
      .input('dsMode', sql.NVarChar, 'skip_query')
      .query(`
        INSERT INTO WechatPushTemplateV2 (moduleCode, templateName, title, headerTemplate, bodyTemplate, footerTemplate, selectedFields, selectedRecipients, isDefault, recipientGroup, recipientPosition, pushMode, triggerType, triggerConfig, dataSourceMode)
        VALUES (@code, @name, @title, @header, '', @footer, @fields, '', @def, '', '', @pmode, @trgType, @trgConf, @dsMode)
      `);
    console.log('[WechatPushV2] 已预置「注册管理」默认推送模板');
  } catch (e: any) {
    console.warn('[WechatPushV2] 预置「注册管理」模板失败:', e.message);
  }
}

// 预置「洗鞋费用报表」默认推送模板（手动触发，detail 模式）
// 推送内容 = 洗鞋费用 + 投放 + 核销 + 转化 的完整费用报表
// 仅当该模块尚无模板时写入；用户后续的修改不会被覆盖。
async function ensureDefaultXixieFeedbackTemplate(): Promise<void> {
  try {
    const pool = await getPool();
    // 重命名旧模板名称（从"洗鞋服务反馈通知"改为"洗鞋费用报表通知"）
    await pool.request()
      .input('code', sql.NVarChar, 'xixie_feedback')
      .input('oldName', sql.NVarChar, '洗鞋服务反馈通知')
      .input('newName', sql.NVarChar, '洗鞋费用报表通知')
      .input('newTitle', sql.NVarChar, '【洗鞋费用报表】')
      .query(`UPDATE WechatPushTemplateV2 SET templateName = @newName, title = @newTitle WHERE moduleCode = @code AND templateName = @oldName`);

    const exists = await pool.request()
      .input('code', sql.NVarChar, 'xixie_feedback')
      .query(`SELECT id FROM WechatPushTemplateV2 WHERE moduleCode = @code`);
    if (exists.recordset && exists.recordset.length > 0) return;

    const fields = JSON.stringify([
      '{monthYear}', '{quJing}', '{warehouseType}', '{region}', '{supervisor}', '{shopName}',
      '{shoeCount}', '{cost}',
      '{issueCount}', '{issueTickets}',
      '{writeoffCount}', '{writeoffTickets}',
      '{convertCount}', '{convertRevenue}',
    ]);
    const header = [
      '【洗鞋费用报表】',
      '',
      '月    份：{monthYear}',
      '区    经：{quJing}',
      '仓库类别：{warehouseType}',
      '区    域：{region}',
      '督    导：{supervisor}',
      '店铺名称：{shopName}',
      '',
      '— 费用信息 —',
      '洗鞋双数：{shoeCount} 双',
      '洗鞋费用：{cost} 元',
      '',
      '— 投放信息 —',
      '发放人数：{issueCount} 人',
      '发放张数：{issueTickets} 张',
      '',
      '— 核销信息 —',
      '核销人数：{writeoffCount} 人',
      '核销张数：{writeoffTickets} 张',
      '',
      '— 转化信息 —',
      '转化人数：{convertCount} 人',
      '转化业绩：{convertRevenue} 元',
    ].join('\n');
    const footer = '\n————系统自动推送，无需回复————';
    const trgConf = JSON.stringify({ senderName: '系统管理员' });

    await pool.request()
      .input('code', sql.NVarChar, 'xixie_feedback')
      .input('name', sql.NVarChar, '洗鞋服务反馈通知')
      .input('title', sql.NVarChar, '【洗鞋服务反馈】')
      .input('header', sql.NVarChar, header)
      .input('footer', sql.NVarChar, footer)
      .input('fields', sql.NVarChar, fields)
      .input('def', sql.Bit, 1)
      .input('pmode', sql.NVarChar, 'detail')
      .input('trgType', sql.NVarChar, 'manual')
      .input('trgConf', sql.NVarChar, trgConf)
      .input('dsMode', sql.NVarChar, 'realtime')
      .query(`
        INSERT INTO WechatPushTemplateV2 (moduleCode, templateName, title, headerTemplate, bodyTemplate, footerTemplate, selectedFields, selectedRecipients, isDefault, recipientGroup, recipientPosition, pushMode, triggerType, triggerConfig, dataSourceMode)
        VALUES (@code, @name, @title, @header, '', @footer, @fields, '', @def, '', '', @pmode, @trgType, @trgConf, @dsMode)
      `);
    console.log('[WechatPushV2] 已预置「洗鞋费用报表」默认推送模板');
  } catch (e: any) {
    console.warn('[WechatPushV2] 预置「洗鞋费用报表」模板失败:', e.message);
  }
}

// 预置「洗鞋服务反馈」默认推送模板（手动触发，detail 模式）
// 数据源：XS_ShoeFeedback 表（顾客提交的洗鞋充值反馈）
// 推送内容 = 反馈编号 + 充值信息 + 券使用 + 同意状态 + 提交人信息
// 仅当该模块尚无模板时写入；用户后续的修改不会被覆盖。
async function ensureDefaultShoeFeedbackTemplate(): Promise<void> {
  try {
    const pool = await getPool();
    const exists = await pool.request()
      .input('code', sql.NVarChar, 'shoe_feedback')
      .query(`SELECT id FROM WechatPushTemplateV2 WHERE moduleCode = @code`);
    if (exists.recordset && exists.recordset.length > 0) return;

    const fields = JSON.stringify([
      '{feedbackNo}', '{status}',
      '{rechargeDate}', '{rechargeAmount}',
      '{usedTicketCount}', '{estimatedTickets}',
      '{agreeStatus}', '{disagreeDesc}',
      '{submitterName}', '{submitterPhone}',
      '{handlerName}', '{handlerRemark}',
      '{rating}', '{createdAt}',
    ]);
    const header = [
      '【洗鞋服务反馈】',
      '',
      '反馈编号：{feedbackNo}',
      '状    态：{status}',
      '',
      '— 充值信息 —',
      '充值时间：{rechargeDate}',
      '充值金额：{rechargeAmount} 元',
      '',
      '— 券使用情况 —',
      '已用券数：{usedTicketCount} 张',
      '预估补发：{estimatedTickets} 张',
      '',
      '— 同意状态 —',
      '同意状态：{agreeStatus}',
      '不同意见描述：{disagreeDesc}',
      '',
      '— 提交人信息 —',
      '提交人：{submitterName}',
      '手机号：{submitterPhone}',
      '提交时间：{createdAt}',
      '',
      '— 处理信息 —',
      '处理人：{handlerName}',
      '处理备注：{handlerRemark}',
      '顾客评价：{rating}',
    ].join('\n');
    const footer = '\n————系统自动推送，无需回复————';
    const trgConf = JSON.stringify({ senderName: '系统管理员' });

    await pool.request()
      .input('code', sql.NVarChar, 'shoe_feedback')
      .input('name', sql.NVarChar, '洗鞋服务反馈通知')
      .input('title', sql.NVarChar, '【洗鞋服务反馈】')
      .input('header', sql.NVarChar, header)
      .input('footer', sql.NVarChar, footer)
      .input('fields', sql.NVarChar, fields)
      .input('def', sql.Bit, 1)
      .input('pmode', sql.NVarChar, 'detail')
      .input('trgType', sql.NVarChar, 'manual')
      .input('trgConf', sql.NVarChar, trgConf)
      .input('dsMode', sql.NVarChar, 'realtime')
      .query(`
        INSERT INTO WechatPushTemplateV2 (moduleCode, templateName, title, headerTemplate, bodyTemplate, footerTemplate, selectedFields, selectedRecipients, isDefault, recipientGroup, recipientPosition, pushMode, triggerType, triggerConfig, dataSourceMode)
        VALUES (@code, @name, @title, @header, '', @footer, @fields, '', @def, '', '', @pmode, @trgType, @trgConf, @dsMode)
      `);
    console.log('[WechatPushV2] 已预置「洗鞋服务反馈」默认推送模板');
  } catch (e: any) {
    console.warn('[WechatPushV2] 预置「洗鞋服务反馈」模板失败:', e.message);
  }
}

// 预置「时段业绩播报」默认推送模板（定时触发，detail 模式）
// 数据源：有效业绩全表实时查询，按时段和店铺聚合
// 推送内容 = 查询时间 + 今日业绩目标 + 时段业绩列表 + 店铺业绩列表 + 合计
// 仅当该模块尚无模板时写入；用户后续的修改不会被覆盖。
async function ensureDefaultHourlyPerformanceTemplate(): Promise<void> {
  try {
    const pool = await getPool();
    const exists = await pool.request()
      .input('code', sql.NVarChar, 'hourly_performance')
      .query(`SELECT id FROM WechatPushTemplateV2 WHERE moduleCode = @code`);
    if (exists.recordset && exists.recordset.length > 0) return;

    const fields = JSON.stringify([
      '{queryTime}', '{todayTarget}', '{totalAmount}', '{shopCount}',
      '{hourlyList}', '{shopList}',
    ]);
    const header = [
      '【陪跑跟进-时段业绩播报】',
      '查询时间：{queryTime}',
      '今日业绩目标：{todayTarget}',
      '',
      '陪跑店铺时段业绩汇总',
      '{hourlyList}',
      '',
      '————————',
      '店铺业绩明细',
      '{shopList}',
      '',
      '合计：{totalAmount}（{shopCount}家店）',
    ].join('\n');
    const footer = '\n————系统自动推送，无需回复————';
    const recipients = JSON.stringify(['wangjiahui', 'LiuDeng']);
    const trgConf = JSON.stringify({ cron: '10:00,12:00,14:00,16:00,18:00,20:00,22:00', senderName: '系统管理员' });

    await pool.request()
      .input('code', sql.NVarChar, 'hourly_performance')
      .input('name', sql.NVarChar, '时段业绩播报')
      .input('title', sql.NVarChar, '【陪跑跟进-时段业绩播报】')
      .input('header', sql.NVarChar, header)
      .input('footer', sql.NVarChar, footer)
      .input('fields', sql.NVarChar, fields)
      .input('recipients', sql.NVarChar, recipients)
      .input('def', sql.Bit, 1)
      .input('pmode', sql.NVarChar, 'detail')
      .input('trgType', sql.NVarChar, 'scheduled')
      .input('trgConf', sql.NVarChar, trgConf)
      .input('dsMode', sql.NVarChar, 'realtime')
      .query(`
        INSERT INTO WechatPushTemplateV2 (moduleCode, templateName, title, headerTemplate, bodyTemplate, footerTemplate, selectedFields, selectedRecipients, isDefault, recipientGroup, recipientPosition, pushMode, triggerType, triggerConfig, dataSourceMode)
        VALUES (@code, @name, @title, @header, '', @footer, @fields, @recipients, @def, '', '', @pmode, @trgType, @trgConf, @dsMode)
      `);
    console.log('[WechatPushV2] 已预置「时段业绩播报」默认推送模板');
  } catch (e: any) {
    console.warn('[WechatPushV2] 预置「时段业绩播报」模板失败:', e.message);
  }
}

// 幂等确保 WechatPushTemplateV2.dataSourceMode 列存在（老库兼容）
async function ensureDataSourceModeColumn(): Promise<void> {
  try {
    const pool = await getPool();
    const check = await pool.request().query(`
      SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'WechatPushTemplateV2' AND COLUMN_NAME = 'dataSourceMode'
    `);
    if (Number(check.recordset?.[0]?.c || 0) === 0) {
      await pool.request().query(`
        ALTER TABLE WechatPushTemplateV2 ADD dataSourceMode NVARCHAR(20) NOT NULL DEFAULT 'realtime'
      `);
      console.log('[WechatPushV2] 已为 WechatPushTemplateV2 增加 dataSourceMode 列');
    }
  } catch (e: any) {
    console.warn('[WechatPushV2] 确保 dataSourceMode 列失败:', e.message);
  }
}

// 幂等确保 WechatPushTemplateV2.startTime / endTime 列存在（老库兼容）
async function ensureTimeRangeColumns(): Promise<void> {
  try {
    const pool = await getPool();
    for (const col of ['startTime', 'endTime']) {
      const check = await pool.request().query(`
        SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'WechatPushTemplateV2' AND COLUMN_NAME = '${col}'
      `);
      if (Number(check.recordset?.[0]?.c || 0) === 0) {
        await pool.request().query(`
          ALTER TABLE WechatPushTemplateV2 ADD ${col} DATETIME NULL
        `);
        console.log(`[WechatPushV2] 已为 WechatPushTemplateV2 增加 ${col} 列`);
      }
    }
  } catch (e: any) {
    console.warn('[WechatPushV2] 确保 startTime/endTime 列失败:', e.message);
  }
}

// 启动时同步模块和字段到数据库
setTimeout(() => {
  pushModuleRegistry.syncModulesToDatabase().then((count: number) => {
    if (count > 0) console.log(`[WechatPushV2] 新增 ${count} 个模块`);
  }).catch((e: any) => {
    console.warn('[WechatPushV2] 模块同步失败:', e.message);
  });
  pushModuleRegistry.syncFieldsToDatabase().catch((e: any) => {
    console.warn('[WechatPushV2] 字段同步失败:', e.message);
  });
  ensureDataSourceModeColumn();
  ensureTimeRangeColumns();
  ensureDefaultNoCostPriceTemplate();
  ensureDefaultRegisterTemplate();
  ensureDefaultXixieFeedbackTemplate();
  ensureDefaultShoeFeedbackTemplate();
  ensureDefaultHourlyPerformanceTemplate();
}, 3000);

// ============================================================
// 模块列表
// ============================================================
router.get('/modules', async (_req, res) => {
  try {
    const modules = await pushModuleRegistry.getModulesFromDb();
    // 补充每个模块的字段数
    const result = [];
    for (const m of modules) {
      const fields = await pushModuleRegistry.getModuleFields(m.moduleCode);
      result.push({
        ...m,
        isActive: m.isActive === 1 || m.isActive === true,
        pollingEnabled: m.pollingEnabled === 1 || m.pollingEnabled === true,
        fieldCount: fields.length,
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 模块源数据列表（用于手动推送选数据）
// ============================================================
router.get('/modules/:code/source-data', async (req, res) => {
  try {
    // 自定义通知没有源数据表
    if (req.params.code === 'custom_notification') {
      res.json({ total: 0, page: 1, pageSize: 30, sourceTable: '(无)', sourceIdField: 'id', rows: [], isCustom: true });
      return;
    }
    const { page = '1', pageSize = '30', keyword } = req.query;
    const pool = await getPool();
    const modResult = await pool.request()
      .input('code', sql.NVarChar, req.params.code)
      .query('SELECT * FROM WechatPushModules WHERE moduleCode = @code');
    if (!modResult.recordset || modResult.recordset.length === 0) {
      res.status(404).json({ error: '模块未注册' }); return;
    }
    const mod = modResult.recordset[0];
    const table = String(mod.sourceTable);
    const idField = String(mod.sourceIdField || 'id');

    // 尝试获取表的列名，构建查询
    let displayCols = '*';
    try {
      const cols = await pool.request().query(`
        SELECT TOP 0 * FROM ${table}
      `);
      const colNames = Object.keys(cols.recordset.columns || {});
      // 过滤：最多取前8列，优先取常见字段
      const priority = ['id', 'shopName', 'supervisor', 'destination', 'title', 'userName', 'monthYear', 'taskNo', 'detailNo', 'date', 'createdAt'];
      const ordered = [...priority.filter(p => colNames.includes(p)), ...colNames.filter(c => !priority.includes(c))];
      displayCols = ordered.slice(0, 8).map(c => `[${c}]`).join(', ');
    } catch {}

    // 查询
    let where = '';
    const inputs: any[] = [];
    // 模块配置的数据源过滤条件（如无成本价商品：预估成本=0或NULL 且 年份>=YEAR(GETDATE()-1)-1）
    // 必须应用，否则"查询源数据"会把不满足条件（如已有预估成本）的记录也查询出来
    if (mod.sourceFilter) {
      where = ` WHERE (${mod.sourceFilter})`;
    }
    if (keyword && typeof keyword === 'string') {
      // 尝试搜索常见文本列
      where += `${where ? ' AND' : ' WHERE'} CAST(${idField} AS NVARCHAR) LIKE @kw`;
      inputs.push({ name: 'kw', type: sql.NVarChar, value: `%${keyword}%` });
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(10, Number(pageSize) || 30));
    const offset = (pageNum - 1) * size;

    // 模块配置了数据提取台账（如无成本价商品）：按台账最新 SQL 返回源数据（与数据提取页面一致）
    const deRows = await pushModuleRegistry.queryModuleRowsByDataExtraction(req.params.code, pool);
    if (deRows) {
      let filtered = deRows;
      if (keyword && typeof keyword === 'string') {
        const kw = String(keyword).toLowerCase();
        filtered = deRows.filter(row => {
          const v = row[idField];
          return v !== undefined && v !== null && String(v).toLowerCase().includes(kw);
        });
      }
      const total = filtered.length;
      const pageRows = filtered.slice(offset, offset + size);
      const rows = (pageRows || []).map((r: any) => ({ ...r, _sourceId: String(r[idField] ?? ''), _pushed: false }));
      res.json({ total, page: pageNum, pageSize: size, sourceTable: table, sourceIdField: idField, rows, fromDataExtraction: true });
      return;
    }

    const reqSql = pool.request();
    inputs.forEach(i => reqSql.input(i.name, i.type, i.value));

    // 计数
    const cntResult = await reqSql.query(`SELECT COUNT(*) AS total FROM ${table}${where}`);
    const total = Number(cntResult.recordset?.[0]?.total || 0);

    // 取数据
    const dataResult = await pool.request()
      .query(`SELECT ${displayCols} FROM (SELECT ${displayCols}, ROW_NUMBER() OVER (ORDER BY ${idField} DESC) AS rn FROM ${table}${where}) AS src WHERE rn > ${offset} AND rn <= ${offset + size}`);

    // 检查是否已推送过（allowRepush 模块表示可重复推送，不标记已推送，始终可推）
    const allowRepush = !!pushModuleRegistry.getProvider(req.params.code)?.allowRepush;
    const rows = (dataResult.recordset || []).map((r: any) => {
      const sid = String(r[idField] ?? '');
      return { ...r, _sourceId: sid, _pushed: false };
    });

    // 批量查推送历史（allowRepush 模块跳过，不展示已推送标记）
    if (rows.length > 0 && !allowRepush) {
      const ids = rows.map(r => r._sourceId);
      const placeholders = ids.map((_id, i) => `@id${i}`).join(',');
      const histReq = pool.request();
      histReq.input('mcode', sql.NVarChar, req.params.code);
      ids.forEach((id, i) => histReq.input(`id${i}`, sql.NVarChar, String(id)));
      const histResult = await histReq.query(`
        SELECT sourceId FROM WechatPushHistoryV2
        WHERE moduleCode = @mcode AND sourceId IN (${placeholders})
      `);
      const pushedIds = new Set((histResult.recordset || []).map((r: any) => String(r.sourceId)));
      rows.forEach(r => { r._pushed = pushedIds.has(r._sourceId); });
    }

    res.json({ total, page: pageNum, pageSize: size, sourceTable: table, sourceIdField: idField, sourceFilter: mod.sourceFilter || '', rows });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 模块可用字段
// ============================================================
router.get('/modules/:code/fields', async (req, res) => {
  try {
    const fields = await pushModuleRegistry.getModuleFields(req.params.code);
    // 按分类分组
    const grouped: Record<string, any[]> = { basic: [], detail: [], calculated: [] };
    for (const f of fields) {
      (grouped[f.category] || (grouped[f.category] = [])).push(f);
    }
    const pool = await getPool();
    const modResult = await pool.request()
      .input('code', sql.NVarChar, req.params.code)
      .query('SELECT * FROM WechatPushModules WHERE moduleCode = @code');
    const moduleInfo = modResult.recordset?.[0] || null;
    res.json({ moduleCode: req.params.code, moduleInfo, fields, grouped });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 模块模板列表
// ============================================================
router.get('/modules/:code/templates', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('code', sql.NVarChar, req.params.code)
      .query(`
        SELECT id, moduleCode, templateName, title, headerTemplate, bodyTemplate, footerTemplate,
               selectedFields, selectedRecipients, isDefault, isActive, createdBy,
               recipientGroup, recipientPosition, pushMode, triggerType, triggerConfig,
               dataSourceMode, startTime, endTime, createdAt, updatedAt
        FROM WechatPushTemplateV2
        WHERE moduleCode = @code AND isActive = 1
        ORDER BY isDefault DESC, createdAt DESC
      `);
    const templates = (result.recordset || []).map((r: any) => ({
      ...r,
      isDefault: r.isDefault === 1 || r.isDefault === true,
      isActive: r.isActive === 1 || r.isActive === true,
      selectedFields: safeJsonParse(r.selectedFields, []),
      selectedRecipients: safeJsonParse(r.selectedRecipients, []),
      triggerConfig: safeJsonParse(r.triggerConfig, {}),
    }));
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 全部模板列表（跨模块）
// ============================================================
router.get('/templates', async (_req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT id, moduleCode, templateName, title, headerTemplate, footerTemplate,
             selectedFields, selectedRecipients, isDefault, pushMode,
             triggerType, triggerConfig, dataSourceMode, startTime, endTime, createdAt, updatedAt
      FROM WechatPushTemplateV2 WHERE isActive = 1
      ORDER BY moduleCode, isDefault DESC, createdAt DESC
    `);
    const templates = (result.recordset || []).map((r: any) => ({
      ...r,
      isDefault: r.isDefault === 1 || r.isDefault === true,
      selectedFields: safeJsonParse(r.selectedFields, []),
      selectedRecipients: safeJsonParse(r.selectedRecipients, []),
      triggerConfig: safeJsonParse(r.triggerConfig, {}),
    }));
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 创建模板
// ============================================================
router.post('/modules/:code/templates', async (req, res) => {
  try {
    const { templateName, title, headerTemplate, bodyTemplate, footerTemplate, selectedFields, selectedRecipients, isDefault, recipientGroup, recipientPosition, pushMode, triggerType, triggerConfig, dataSourceMode, startTime, endTime } = req.body;
    if (!templateName) { res.status(400).json({ error: '模板名称必填' }); return; }
    const pool = await getPool();
    const result = await pool.request()
      .input('code', sql.NVarChar, req.params.code)
      .input('name', sql.NVarChar, templateName)
      .input('title', sql.NVarChar, title || '')
      .input('header', sql.NVarChar, headerTemplate || '')
      .input('body', sql.NVarChar, bodyTemplate || '')
      .input('footer', sql.NVarChar, footerTemplate || '')
      .input('fields', sql.NVarChar, JSON.stringify(selectedFields || []))
      .input('recipients', sql.NVarChar, JSON.stringify(selectedRecipients || []))
      .input('def', sql.Bit, isDefault ? 1 : 0)
      .input('rgroup', sql.NVarChar, recipientGroup || '')
      .input('rpos', sql.NVarChar, recipientPosition || '')
      .input('pmode', sql.NVarChar, pushMode || 'detail')
      .input('trgType', sql.NVarChar, triggerType || 'manual')
      .input('trgConf', sql.NVarChar, JSON.stringify(triggerConfig || {}))
      .input('dsMode', sql.NVarChar, dataSourceMode || 'realtime')
      .input('startTime', sql.DateTime, startTime ? new Date(startTime) : null)
      .input('endTime', sql.DateTime, endTime ? new Date(endTime) : null)
      .query(`
        INSERT INTO WechatPushTemplateV2 (moduleCode, templateName, title, headerTemplate, bodyTemplate, footerTemplate, selectedFields, selectedRecipients, isDefault, recipientGroup, recipientPosition, pushMode, triggerType, triggerConfig, dataSourceMode, startTime, endTime)
        OUTPUT INSERTED.id
        VALUES (@code, @name, @title, @header, @body, @footer, @fields, @recipients, @def, @rgroup, @rpos, @pmode, @trgType, @trgConf, @dsMode, @startTime, @endTime)
      `);
    const newId = result.recordset?.[0]?.id;
    res.json({ ok: true, id: newId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 更新模板
// ============================================================
router.put('/templates/:id', async (req, res) => {
  try {
    const { templateName, title, headerTemplate, bodyTemplate, footerTemplate, selectedFields, selectedRecipients, isDefault, recipientGroup, recipientPosition, pushMode, triggerType, triggerConfig, dataSourceMode, startTime, endTime } = req.body;
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, Number(req.params.id))
      .input('name', sql.NVarChar, templateName || '')
      .input('title', sql.NVarChar, title || '')
      .input('header', sql.NVarChar, headerTemplate || '')
      .input('body', sql.NVarChar, bodyTemplate || '')
      .input('footer', sql.NVarChar, footerTemplate || '')
      .input('fields', sql.NVarChar, JSON.stringify(selectedFields || []))
      .input('recipients', sql.NVarChar, JSON.stringify(selectedRecipients || []))
      .input('def', sql.Bit, isDefault ? 1 : 0)
      .input('rgroup', sql.NVarChar, recipientGroup || '')
      .input('rpos', sql.NVarChar, recipientPosition || '')
      .input('pmode', sql.NVarChar, pushMode || 'detail')
      .input('trgType', sql.NVarChar, triggerType || 'manual')
      .input('trgConf', sql.NVarChar, JSON.stringify(triggerConfig || {}))
      .input('dsMode', sql.NVarChar, dataSourceMode || 'realtime')
      .input('startTime', sql.DateTime, startTime ? new Date(startTime) : null)
      .input('endTime', sql.DateTime, endTime ? new Date(endTime) : null)
      .query(`
        UPDATE WechatPushTemplateV2 SET
          templateName = @name, title = @title, headerTemplate = @header,
          bodyTemplate = @body, footerTemplate = @footer, selectedFields = @fields,
          selectedRecipients = @recipients,
          isDefault = @def, recipientGroup = @rgroup, recipientPosition = @rpos,
          pushMode = @pmode, triggerType = @trgType, triggerConfig = @trgConf,
          dataSourceMode = @dsMode,
          startTime = @startTime, endTime = @endTime,
          updatedAt = GETDATE()
        WHERE id = @id
      `);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 删除模板
// ============================================================
router.delete('/templates/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, Number(req.params.id))
      .query(`DELETE FROM WechatPushTemplateV2 WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 模板预览（用真实数据或模拟数据渲染）
// ============================================================
router.post('/templates/preview', async (req, res) => {
  try {
    const { moduleCode, sourceId, selectedFields, templateTitle, templateHeader, templateFooter, senderName } = req.body;
    if (!moduleCode) { res.status(400).json({ error: 'moduleCode 必填' }); return; }

    // 自定义通知：直接显示模板文本
    if (moduleCode === 'custom_notification') {
      const title = templateTitle || '【自定义通知】';
      const body = templateHeader || '（正文内容为空，请在编辑器中填写）';
      const footer = templateFooter || '';
      const sender = senderName || '系统管理员';
      const msg = `${title}\n${body}${footer}`
        .replace(/\{time\}/g, new Date().toLocaleString('zh-CN'))
        .replace(/\{sender\}/g, sender);
      res.json({ message: msg, isCustom: true });
      return;
    }

    const provider = pushModuleRegistry.getProvider(moduleCode);
    if (!provider) { res.status(404).json({ error: `模块 ${moduleCode} 未注册` }); return; }

    let data: Record<string, any>;
    if (sourceId) {
      data = await provider.loadRenderData(String(sourceId), await getPool());
      if (!data || Object.keys(data).length === 0) {
        res.status(404).json({ error: `未找到源数据 (sourceId=${sourceId})` }); return;
      }
    } else {
      data = getMockData(moduleCode);
    }

    const allFields = provider.getAvailableFields();
    // 如果传了 selectedFields，只渲染选中的字段
    const selectedSet = selectedFields && Array.isArray(selectedFields)
      ? new Set(selectedFields.map((s: string) => s.trim()))
      : null;
    const fields = selectedSet
      ? allFields.filter(f => selectedSet.has(f.fieldKey))
      : allFields;

    // 构建预览文本
    const lines: string[] = [];
    lines.push(`【${provider.moduleName}】`);
    for (const f of fields.filter(x => x.category === 'basic')) {
      const key = f.fieldKey.replace(/[{}]/g, '');
      const val = data[key];
      const display = val !== undefined && val !== null && val !== '' ? String(val) : '(无)';
      lines.push(`${f.fieldName}：${display}`);
    }
    for (const f of fields.filter(x => x.category === 'detail')) {
      const key = f.fieldKey.replace(/[{}]/g, '');
      const val = data[key];
      if (val === undefined || val === null || val === '') continue;
      lines.push('');
      lines.push(`${f.fieldName}：`);
      if (Array.isArray(val)) {
        val.forEach((item: any, i: number) => {
          lines.push(`  ${i + 1}. 事项：${item.item || '-'} / 结果：${item.result || '-'}`);
        });
      } else {
        lines.push(`  ${String(val)}`);
      }
    }
    for (const f of fields.filter(x => x.category === 'calculated')) {
      const key = f.fieldKey.replace(/[{}]/g, '');
      const val = data[key];
      const display = val !== undefined && val !== null && val !== '' ? String(val) : '(无)';
      lines.push(`${f.fieldName}：${display}`);
    }
    lines.push('');
    lines.push('————系统自动推送，无需回复————');
    res.json({ message: lines.join('\n'), data, fieldCount: fields.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 手动推送
// ============================================================
// 按模块数据源配置圈选符合条件（且默认排除已推送历史）的记录 id
// （与 TriggerScheduler 自动推送圈选逻辑一致：
//   应用模块 sourceFilter 过滤 + dedupColumn 去重 + 排除已推送历史；
//   模块 allowRepush=true 时不过滤已推送历史，有数据就推，直到查无数据）
// ============================================================
async function circleUnpushedSourceIds(pool: any, moduleCode: string): Promise<string[]> {
  const modResult = await pool.request()
    .input('code', sql.NVarChar, moduleCode)
    .query('SELECT sourceTable, sourceIdField, sourceFilter, dedupColumn FROM WechatPushModules WHERE moduleCode = @code');
  const mod = modResult.recordset?.[0];
  if (!mod) return [];

  // 模块配置了数据提取台账（如无成本价商品）：优先按台账最新 SQL 圈选，保证与数据提取页面数据一致
  const deRows = await pushModuleRegistry.queryModuleRowsByDataExtraction(moduleCode, pool);
  if (deRows) {
    const idField = String(mod.sourceIdField || 'id');
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const row of deRows) {
      const v = row[idField] ?? row[Object.keys(row)[0]];
      if (v === undefined || v === null) continue;
      const s = String(v);
      if (!seen.has(s)) { seen.add(s); ids.push(s); }
    }
    return ids;
  }

  const { sourceTable, sourceIdField, sourceFilter, dedupColumn } = mod;
  const whereClause = sourceFilter ? `(${sourceFilter})` : '1=1';
  const allowRepush = !!pushModuleRegistry.getProvider(moduleCode)?.allowRepush;
  let ids;
  if (dedupColumn) {
    // 按 dedupColumn 去重：同业务键取最小 sourceId
    ids = await pool.request()
      .input('mcode', sql.NVarChar, moduleCode)
      .query(`
        SELECT c.[${sourceIdField}] AS id FROM (
          SELECT [${sourceIdField}], ROW_NUMBER() OVER (PARTITION BY [${dedupColumn}] ORDER BY [${sourceIdField}]) AS rn
          FROM ${sourceTable}
          WHERE ${whereClause}
        ) c
        ${allowRepush ? '' : `
        LEFT JOIN WechatPushHistoryV2 h
          ON h.moduleCode = @mcode
         AND CAST(h.sourceId AS nvarchar(100)) = CAST(c.[${sourceIdField}] AS nvarchar(100))
        WHERE c.rn = 1 AND h.id IS NULL`}
        ${allowRepush ? 'WHERE c.rn = 1' : ''}
        ORDER BY c.[${sourceIdField}] DESC
      `);
  } else {
    // 不去重：全部符合条件的记录
    ids = await pool.request()
      .input('mcode', sql.NVarChar, moduleCode)
      .query(allowRepush
        ? `
        SELECT s.[${sourceIdField}] AS id
        FROM ${sourceTable} s
        WHERE ${whereClause}
        ORDER BY s.[${sourceIdField}] DESC
      `
        : `
        SELECT s.[${sourceIdField}] AS id
        FROM ${sourceTable} s
        LEFT JOIN WechatPushHistoryV2 h
          ON h.moduleCode = @mcode
         AND CAST(h.sourceId AS nvarchar(100)) = CAST(s.[${sourceIdField}] AS nvarchar(100))
        WHERE ${whereClause} AND h.id IS NULL
        ORDER BY s.[${sourceIdField}] DESC
      `);
  }
  return (ids.recordset || []).map((r: any) => String(r.id));
}

// ============================================================
// 手动推送（支持两种数据源策略：
//   skip_query  —— 不查询数据源，有数据就推（sourceIds 可省略，后端自动圈选）
//   realtime    —— 实时查询数据再推（必须由前端查询源数据并勾选 sourceIds）
// 策略优先级：请求显式传 dataSourceMode > 模板 dataSourceMode > 默认 realtime）
// ============================================================
router.post('/push', async (req, res) => {
  try {
    const { moduleCode, sourceIds, forceRepush, templateId, dataSourceMode } = req.body;
    if (!moduleCode) {
      res.status(400).json({ error: 'moduleCode 必填' }); return;
    }

    // 如果指定了模板，读取模板配置
    let tplOptions: any = {};
    let effectiveDataSourceMode = 'realtime';
    if (templateId) {
      const pool = await getPool();
      const tplResult = await pool.request()
        .input('id', sql.Int, Number(templateId))
        .query('SELECT * FROM WechatPushTemplateV2 WHERE id = @id');
      const tpl = tplResult.recordset?.[0];
      if (tpl) {
        tplOptions.templateTitle = tpl.title || '';
        tplOptions.templatePushMode = tpl.pushMode || 'detail';
        tplOptions.templateSelectedFields = safeJsonParse(tpl.selectedFields, []);
        tplOptions.templateHeader = tpl.headerTemplate || '';
        tplOptions.templateBody = tpl.bodyTemplate || '';
        tplOptions.templateFooter = tpl.footerTemplate || '';
        effectiveDataSourceMode = tpl.dataSourceMode || 'realtime';
        // 读取模板指定的接收人
        const savedRecipients = safeJsonParse(tpl.selectedRecipients, []);
        if (savedRecipients.length > 0) {
          tplOptions.recipientOverride = savedRecipients.map((acc: string) => ({
            name: acc, wechatAccount: acc
          }));
        }
      }
    }
    // 请求显式指定的数据源策略优先（前端可直接指定，不依赖模板保存值）
    if (dataSourceMode === 'skip_query' || dataSourceMode === 'realtime') {
      effectiveDataSourceMode = dataSourceMode;
    }

    const pushMode = tplOptions.templatePushMode || 'detail';

    // 自定义通知：直接发送模板文本，无需源数据
    if (moduleCode === 'custom_notification' && templateId) {
      const pool2 = await getPool();
      const tpl2 = await pool2.request().input('id', sql.Int, Number(templateId))
        .query('SELECT * FROM WechatPushTemplateV2 WHERE id = @id');
      const tpl = tpl2.recordset?.[0];
      if (!tpl) { res.status(404).json({ error: '模板不存在' }); return; }
      const title = tpl.title || '自定义通知';
      const header = tpl.headerTemplate || '';
      const footer = tpl.footerTemplate || '';
      const msg = `${title}\n${header}${footer}`
        .replace(/\{time\}/g, new Date().toLocaleString('zh-CN'))
        .replace(/\{sender\}/g, safeJsonParse(tpl.triggerConfig, {}).senderName || '系统管理员');
      const r = await dispatchCustomNotification(msg, 'manual', {
        recipientOverride: tplOptions.recipientOverride,
      });
      res.json({ ok: true, results: [{ mode: 'custom', summary: r.summary, detail: r.detail }], pushMode: 'custom' });
      return;
    }

    // 源数据主键统一按字符串处理（兼容字符串主键模块，如无成本价商品=商品代码）
    let finalSourceIds: string[] = Array.isArray(sourceIds) ? sourceIds.map((s: any) => String(s)) : [];

    // 「不查询数据源，有数据就推」：sourceIds 可省略，后端按模块数据源配置圈选
    if (effectiveDataSourceMode === 'skip_query' && finalSourceIds.length === 0) {
      finalSourceIds = await circleUnpushedSourceIds(await getPool(), moduleCode);
      if (finalSourceIds.length === 0) {
        res.json({ ok: true, skipped: true, reason: 'no_data', summary: '当前没有符合条件且未推送的数据，已跳过推送', results: [], pushMode, dataSourceMode: effectiveDataSourceMode });
        return;
      }
    }

    // 「实时查询数据再推」：必须由前端先查询源数据并勾选 sourceIds
    if (effectiveDataSourceMode === 'realtime' && finalSourceIds.length === 0) {
      res.status(400).json({ error: 'moduleCode 和 sourceIds 必填（模板数据源策略为「实时查询数据再推」，请先查询源数据并勾选记录）' }); return;
    }

    // register 模块：仅待审核（pending）记录可推送；已通过/已拒绝的申请一律拦截，不进入发送链路
    if (moduleCode === 'register' && finalSourceIds.length > 0) {
      const poolChk = await getPool();
      const placeholders = finalSourceIds.map((_s, i) => `@id${i}`).join(',');
      const chkReq = poolChk.request();
      finalSourceIds.forEach((sid, i) => chkReq.input(`id${i}`, sql.NVarChar, String(sid)));
      const chk = await chkReq.query(`SELECT id, status FROM register_apply WHERE id IN (${placeholders})`);
      const statusMap = new Map((chk.recordset || []).map((r: any) => [String(r.id), String(r.status)]));
      const notPending = finalSourceIds.filter(sid => statusMap.get(String(sid)) !== 'pending');
      if (notPending.length > 0) {
        res.status(400).json({
          error: '仅待审核的注册申请可推送',
          blockedIds: notPending,
          detail: '已通过 / 已拒绝的注册申请不推送，请取消勾选后重试',
        });
        return;
      }
    }

    const results: any[] = [];

    if (pushMode === 'summary') {
      const r = await dispatchSummaryPush(moduleCode, finalSourceIds, 'manual', {
        templateTitle: tplOptions.templateTitle,
        templateSelectedFields: tplOptions.templateSelectedFields,
        templateHeader: tplOptions.templateHeader,
        templateBody: tplOptions.templateBody,
        templateFooter: tplOptions.templateFooter,
        recipientOverride: tplOptions.recipientOverride,
      });
      results.push({ mode: 'summary', summary: r.summary, detail: r.detail });
    } else {
      for (const id of finalSourceIds) {
        const r = await dispatchPush(moduleCode, String(id), 'manual', {
          forceRepush,
          templateSelectedFields: tplOptions.templateSelectedFields,
          ...(tplOptions.templateHeader ? {
            templateHeader: tplOptions.templateHeader,
            templateBody: tplOptions.templateBody,
            templateFooter: tplOptions.templateFooter,
          } : {}),
          ...tplOptions.recipientOverride ? { recipientOverride: tplOptions.recipientOverride } : {},
        });
        results.push({ sourceId: String(id), summary: r.summary, detail: r.detail });
      }
    }
    res.json({ ok: true, results, pushMode, dataSourceMode: effectiveDataSourceMode });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 重新推送（从日志列表勾选已推送记录，按 logId 重新推送）
// 支持 mode: 'detail'(默认，每条单独推) | 'summary'(汇总为一条)
// ============================================================
// ============================================================
// 重新推送（从日志列表勾选已推送记录，按 logId 重新推送）
// 读取模块模板的接收人与模板文本配置
// ============================================================
async function getTemplateConfig(pool: any, moduleCode: string): Promise<{
  recipientOverride?: { name: string; wechatAccount: string }[];
  headerTemplate?: string;
  bodyTemplate?: string;
  footerTemplate?: string;
  selectedFields?: string[];
} | undefined> {
  try {
    const tplResult = await pool.request()
      .input('code', sql.NVarChar, moduleCode)
      .query(`SELECT TOP 1 selectedRecipients, recipientGroup, recipientPosition, headerTemplate, bodyTemplate, footerTemplate, selectedFields, pushMode, startTime, endTime FROM WechatPushTemplateV2 WHERE moduleCode = @code AND isActive = 1 ORDER BY isDefault DESC, updatedAt DESC`);
    if (!tplResult.recordset || tplResult.recordset.length === 0) return undefined;
    const row = tplResult.recordset[0];
    const cfg: any = {
      headerTemplate: row.headerTemplate || '',
      bodyTemplate: row.bodyTemplate || '',
      footerTemplate: row.footerTemplate || '',
      selectedFields: safeJsonParse(row.selectedFields, []),
    };
    const recipients = safeJsonParse(row.selectedRecipients, []);
    if (recipients.length > 0) {
      cfg.recipientOverride = recipients.map((acc: string) => ({ name: acc, wechatAccount: acc }));
    }
    return cfg;
  } catch { return undefined; }
}

router.post('/repush', async (req, res) => {
  try {
    const { logIds, mode } = req.body;
    if (!Array.isArray(logIds) || logIds.length === 0) {
      res.status(400).json({ error: 'logIds 必填' }); return;
    }
    const isSummary = mode === 'summary';
    const pool = await getPool();
    const results: any[] = [];

    if (isSummary) {
      // 汇总模式：按 moduleCode 分组聚合
      const grouped: Record<string, string[]> = {};
      for (const logId of logIds) {
        const row = await pool.request()
          .input('id', sql.Int, Number(logId))
          .query('SELECT moduleCode, sourceId FROM WechatPushLogsV2 WHERE id = @id');
        if (row.recordset && row.recordset.length > 0) {
          const { moduleCode, sourceId } = row.recordset[0];
          if (!grouped[moduleCode]) grouped[moduleCode] = [];
          grouped[moduleCode].push(String(sourceId));
        }
      }
      for (const [modCode, sourceIds] of Object.entries(grouped)) {
        const tplCfg = await getTemplateConfig(pool, modCode);
        const r = await dispatchSummaryPush(modCode, [...new Set(sourceIds)], 'manual', {
          recipientOverride: tplCfg?.recipientOverride,
          templateHeader: tplCfg?.headerTemplate,
          templateBody: tplCfg?.bodyTemplate,
          templateFooter: tplCfg?.footerTemplate,
          templateSelectedFields: tplCfg?.selectedFields,
        });
        results.push({ moduleCode: modCode, sourceCount: sourceIds.length, mode: 'summary', summary: r.summary });
      }
    } else {
      // 明细模式：逐条推送
      const recipientCache: Record<string, { name: string; wechatAccount: string }[] | undefined> = {};
      for (const logId of logIds) {
        const row = await pool.request()
          .input('id', sql.Int, Number(logId))
          .query('SELECT moduleCode, sourceId FROM WechatPushLogsV2 WHERE id = @id');
        if (row.recordset && row.recordset.length > 0) {
          const { moduleCode, sourceId } = row.recordset[0];
          if (!recipientCache[moduleCode]) {
            const tplCfg = await getTemplateConfig(pool, moduleCode);
            recipientCache[moduleCode] = tplCfg?.recipientOverride;
          }
          const r = await dispatchPush(moduleCode, String(sourceId), 'manual', {
            forceRepush: true,
            recipientOverride: recipientCache[moduleCode],
          });
          results.push({ logId: Number(logId), moduleCode, sourceId: String(sourceId), mode: 'detail', summary: r.summary });
        } else {
          results.push({ logId: Number(logId), error: '未找到对应推送记录' });
        }
      }
    }
    res.json({ ok: true, mode: isSummary ? 'summary' : 'detail', results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 推送总列表（支持筛选、分组、分页）
// ============================================================
router.get('/logs', async (req, res) => {
  try {
    const {
      moduleCode, status, startDate, endDate,
      keyword, page = '1', pageSize = '50', groupBy = 'module'
    } = req.query;

    const pool = await getPool();
    const clauses: string[] = [];
    const inputs: { name: string; type: any; value: any }[] = [];

    if (moduleCode && typeof moduleCode === 'string' && moduleCode !== 'all') {
      clauses.push('moduleCode = @moduleCode');
      inputs.push({ name: 'moduleCode', type: sql.NVarChar, value: moduleCode });
    }
    if (status && typeof status === 'string' && status !== 'all') {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        clauses.push('status = @status');
        inputs.push({ name: 'status', type: sql.NVarChar, value: statuses[0] });
      } else if (statuses.length > 1) {
        const placeholders = statuses.map((_s, i) => `@st${i}`).join(', ');
        statuses.forEach((s, i) => inputs.push({ name: `st${i}`, type: sql.NVarChar, value: s }));
        clauses.push(`status IN (${placeholders})`);
      }
    }
    if (startDate && typeof startDate === 'string') {
      clauses.push('createdAt >= @startDate');
      inputs.push({ name: 'startDate', type: sql.DateTime, value: new Date(startDate) });
    }
    if (endDate && typeof endDate === 'string') {
      clauses.push('createdAt <= @endDate');
      inputs.push({ name: 'endDate', type: sql.DateTime, value: new Date(`${endDate}T23:59:59`) });
    }
    if (keyword && typeof keyword === 'string') {
      clauses.push('(sourceTitle LIKE @kw OR supervisor LIKE @kw OR destination LIKE @kw OR recipientName LIKE @kw)');
      inputs.push({ name: 'kw', type: sql.NVarChar, value: `%${keyword}%` });
    }

    const where = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : '';

    // 统计
    const reqCount = pool.request();
    inputs.forEach(i => reqCount.input(i.name, i.type, i.value));
    const countResult = await reqCount.query(`SELECT COUNT(*) AS c FROM WechatPushLogsV2${where}`);
    const total = Number((countResult.recordset || [])[0]?.c || 0);

    // 分页
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(200, Math.max(10, Number(pageSize) || 50));
    const offset = (pageNum - 1) * size;

    const reqData = pool.request();
    inputs.forEach(i => reqData.input(i.name, i.type, i.value));
    const rows = (await reqData.query(`
      SELECT * FROM (
        SELECT id, moduleCode, sourceId, sourceTable, sourceTitle, supervisor, destination,
               recipientName, recipientAccount, messageContent, status, errorDetail,
               retryCount, triggeredBy, triggeredAt, createdAt,
               ROW_NUMBER() OVER (ORDER BY createdAt DESC) AS rn
        FROM WechatPushLogsV2${where}
      ) AS ranked
      WHERE rn > ${offset} AND rn <= ${offset + size}
      ORDER BY createdAt DESC
    `)).recordset || [];

    // 如果需要按模块分组
    let groups: any[] = [];
    if (groupBy === 'module') {
      const reqGroup = pool.request();
      inputs.forEach(i => reqGroup.input(i.name, i.type, i.value));
      const groupData = await reqGroup.query(`
        SELECT moduleCode,
               COUNT(*) AS total,
               SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successCount,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount,
               SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
               SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skippedCount
        FROM WechatPushLogsV2${where}
        GROUP BY moduleCode
        ORDER BY moduleCode
      `);
      groups = (groupData.recordset || []).map((r: any) => ({
        moduleCode: r.moduleCode,
        total: Number(r.total),
        successCount: Number(r.successCount),
        failedCount: Number(r.failedCount),
        pendingCount: Number(r.pendingCount),
        skippedCount: Number(r.skippedCount),
      }));
    }

    res.json({ total, page: pageNum, pageSize: size, logs: rows, groups });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 删除推送记录 + 清理关联资源
// ============================================================
router.delete('/logs/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = await getPool();
    const row = await pool.request().input('id', sql.Int, id)
      .query('SELECT moduleCode, sourceId FROM WechatPushLogsV2 WHERE id = @id');
    if (row.recordset && row.recordset.length > 0) {
      const { moduleCode, sourceId } = row.recordset[0];
      // 清理去重表，释放这条数据允许重新推送
      await pool.request().input('m', sql.NVarChar, moduleCode).input('s', sql.NVarChar, String(sourceId))
        .query('DELETE FROM WechatPushHistoryV2 WHERE moduleCode = @m AND sourceId = @s');
      // 清理队列
      await pool.request().input('m', sql.NVarChar, moduleCode).input('s', sql.NVarChar, String(sourceId))
        .query('DELETE FROM WechatPushQueue WHERE moduleCode = @m AND sourceId = @s');
    }
    await pool.request().input('id', sql.Int, id).query('DELETE FROM WechatPushLogsV2 WHERE id = @id');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 批量删除
router.post('/logs/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: 'ids 必填' }); return; }
    const pool = await getPool();
    for (const id of ids) {
      const row = await pool.request().input('id', sql.Int, Number(id))
        .query('SELECT moduleCode, sourceId FROM WechatPushLogsV2 WHERE id = @id');
      if (row.recordset && row.recordset.length > 0) {
        const { moduleCode, sourceId } = row.recordset[0];
        await pool.request().input('m', sql.NVarChar, moduleCode).input('s', sql.NVarChar, String(sourceId))
          .query('DELETE FROM WechatPushHistoryV2 WHERE moduleCode = @m AND sourceId = @s');
        await pool.request().input('m', sql.NVarChar, moduleCode).input('s', sql.NVarChar, String(sourceId))
          .query('DELETE FROM WechatPushQueue WHERE moduleCode = @m AND sourceId = @s');
      }
      await pool.request().input('id', sql.Int, Number(id)).query('DELETE FROM WechatPushLogsV2 WHERE id = @id');
    }
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 统计摘要
// ============================================================
router.get('/logs/stats', async (_req, res) => {
  try {
    const pool = await getPool();
    const summary = await pool.request().query(`
      SELECT
        COUNT(*) AS totalToday,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successToday,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedToday,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        MAX(createdAt) AS lastPushTime
      FROM WechatPushLogsV2
      WHERE CAST(createdAt AS DATE) = CAST(GETDATE() AS DATE)
    `);
    const byModule = await pool.request().query(`
      SELECT moduleCode, COUNT(*) AS cnt,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS ok,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS fail
      FROM WechatPushLogsV2
      WHERE CAST(createdAt AS DATE) = CAST(GETDATE() AS DATE)
      GROUP BY moduleCode
    `);
    res.json({
      summary: summary.recordset?.[0] || {},
      byModule: byModule.recordset || [],
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 全局设置（复用 WechatPushSettings 表）
// ============================================================
router.get('/settings', async (_req, res) => {
  try {
    const settings = await getSettings();
    const apiOk = isApiConfigured(settings);
    // 获取所有模块的启用状态
    const pool = await getPool();
    const modules = await pool.request().query('SELECT moduleCode, moduleName, isActive, pollingEnabled FROM WechatPushModules');
    res.json({
      settings: {
        enabled: settings.enabled,
        pollingEnabled: settings.pollingEnabled,
        pollingInterval: settings.pollingInterval,
        wechatCorpId: settings.wechatCorpId || '',
        wechatSecret: settings.wechatSecret ? '******' : '',
        wechatAgentId: settings.wechatAgentId || '',
        proxyUrl: settings.proxyUrl || '',
      },
      apiConfigured: apiOk,
      modules: modules.recordset || [],
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const { enabled, pollingEnabled, pollingInterval, wechatCorpId, wechatSecret, wechatAgentId, proxyUrl } = req.body;
    const pool = await getPool();
    const proxyColCheck = await pool.request().query(`
      SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'WechatPushSettings' AND COLUMN_NAME = 'proxyUrl'
    `);
    const hasProxy = Number(proxyColCheck.recordset?.[0]?.c || 0) > 0;
    if (!hasProxy) {
      await pool.request().query('ALTER TABLE WechatPushSettings ADD proxyUrl NVARCHAR(500) NULL');
    }
    const existing = (await pool.request().query('SELECT id, wechatSecret FROM WechatPushSettings WHERE id = 1')).recordset?.[0];
    const keepSecret = !wechatSecret || wechatSecret === '******';
    const finalSecret = keepSecret ? (existing?.wechatSecret || '') : wechatSecret;

    if (existing) {
      await pool.request()
        .input('enabled', sql.Bit, enabled ? 1 : 0)
        .input('pollEnabled', sql.Bit, pollingEnabled ? 1 : 0)
        .input('interval', sql.Int, Math.max(30, Number(pollingInterval) || 30))
        .input('corpId', sql.NVarChar, wechatCorpId || '')
        .input('secret', sql.NVarChar, finalSecret || '')
        .input('agentId', sql.NVarChar, wechatAgentId || '')
        .input('proxy', sql.NVarChar, proxyUrl || '')
        .query(`UPDATE WechatPushSettings SET enabled=@enabled, pollingEnabled=@pollEnabled, pollingInterval=@interval,
                wechatCorpId=@corpId, wechatSecret=@secret, wechatAgentId=@agentId, proxyUrl=@proxy, updatedAt=GETDATE()
                WHERE id=1`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 一键建表+字段同步
// ?clearTemplates=true  同时清空 WechatPushTemplateV2 表（方便重建模板）
// ============================================================
router.post('/init', async (req, res) => {
  try {
    const pool = await getPool();
    const results: string[] = [];

    // 1) 确保 6 张新表存在（幂等）
    const tableDefs: { name: string; sql: string }[] = [
      {
        name: 'WechatPushModules',
        sql: `CREATE TABLE WechatPushModules (
          id INT IDENTITY(1,1) PRIMARY KEY, moduleCode NVARCHAR(50) NOT NULL UNIQUE,
          moduleName NVARCHAR(100) NOT NULL, portalCode NVARCHAR(50) NOT NULL,
          portalName NVARCHAR(100) NOT NULL, sourceTable NVARCHAR(200) NOT NULL,
          sourceIdField NVARCHAR(100) NOT NULL DEFAULT 'id', statusField NVARCHAR(100),
          statusTriggerValue NVARCHAR(100), recipientStrategy NVARCHAR(50) NOT NULL DEFAULT 'permission_group',
          pollingEnabled BIT NOT NULL DEFAULT 1, isActive BIT NOT NULL DEFAULT 1,
          description NVARCHAR(500), createdAt DATETIME NOT NULL DEFAULT GETDATE(),
          updatedAt DATETIME NOT NULL DEFAULT GETDATE())`,
      },
      {
        name: 'WechatPushTemplateFields',
        sql: `CREATE TABLE WechatPushTemplateFields (
          id INT IDENTITY(1,1) PRIMARY KEY, moduleCode NVARCHAR(50) NOT NULL,
          fieldKey NVARCHAR(100) NOT NULL, fieldName NVARCHAR(100) NOT NULL,
          fieldType NVARCHAR(50) NOT NULL DEFAULT 'text', sourceColumn NVARCHAR(200) NOT NULL,
          sourceTable NVARCHAR(200), category NVARCHAR(50) NOT NULL DEFAULT 'basic',
          sortOrder INT NOT NULL DEFAULT 0, description NVARCHAR(500),
          createdAt DATETIME NOT NULL DEFAULT GETDATE(),
          CONSTRAINT UQ_PTF_ModuleField UNIQUE (moduleCode, fieldKey))`,
      },
      {
        name: 'WechatPushTemplateV2',
        sql: `CREATE TABLE WechatPushTemplateV2 (
          id INT IDENTITY(1,1) PRIMARY KEY, moduleCode NVARCHAR(50) NOT NULL,
          templateName NVARCHAR(100) NOT NULL, title NVARCHAR(200) NOT NULL DEFAULT '',
          headerTemplate NVARCHAR(2000), bodyTemplate NVARCHAR(4000), footerTemplate NVARCHAR(500),
          selectedFields NVARCHAR(MAX) DEFAULT '[]', selectedRecipients NVARCHAR(MAX),
          isDefault BIT NOT NULL DEFAULT 0, isActive BIT NOT NULL DEFAULT 1,
          createdBy NVARCHAR(100), recipientGroup NVARCHAR(200), recipientPosition NVARCHAR(100),
          pushMode NVARCHAR(20) NOT NULL DEFAULT 'detail', triggerType NVARCHAR(30) NOT NULL DEFAULT 'manual',
          triggerConfig NVARCHAR(MAX), dataSourceMode NVARCHAR(20) NOT NULL DEFAULT 'realtime',
          startTime DATETIME NULL, endTime DATETIME NULL,
          createdAt DATETIME NOT NULL DEFAULT GETDATE(),
          updatedAt DATETIME NOT NULL DEFAULT GETDATE())`,
      },
      {
        name: 'WechatPushLogsV2',
        sql: `CREATE TABLE WechatPushLogsV2 (
          id INT IDENTITY(1,1) PRIMARY KEY, moduleCode NVARCHAR(50) NOT NULL,
          sourceId NVARCHAR(100) NOT NULL, sourceTable NVARCHAR(200) NOT NULL,
          sourceTitle NVARCHAR(500), supervisor NVARCHAR(100), destination NVARCHAR(200),
          recipientName NVARCHAR(100) NOT NULL, recipientAccount NVARCHAR(100) NOT NULL,
          messageContent NVARCHAR(MAX) NOT NULL, status NVARCHAR(20) NOT NULL,
          errorDetail NVARCHAR(MAX), retryCount INT NOT NULL DEFAULT 0,
          triggeredBy NVARCHAR(50) NOT NULL DEFAULT 'auto',
          triggeredAt DATETIME NOT NULL, createdAt DATETIME NOT NULL DEFAULT GETDATE())`,
      },
      {
        name: 'WechatPushHistoryV2',
        sql: `CREATE TABLE WechatPushHistoryV2 (
          id INT IDENTITY(1,1) PRIMARY KEY, moduleCode NVARCHAR(50) NOT NULL,
          sourceId NVARCHAR(100) NOT NULL, sourceTable NVARCHAR(200) NOT NULL,
          pushedAt DATETIME NOT NULL DEFAULT GETDATE(), pushedBy NVARCHAR(50) NOT NULL,
          CONSTRAINT UQ_WPHV2_ModuleSource UNIQUE (moduleCode, sourceId))`,
      },
      {
        name: 'WechatPushQueue',
        sql: `CREATE TABLE WechatPushQueue (
          id INT IDENTITY(1,1) PRIMARY KEY, moduleCode NVARCHAR(50) NOT NULL,
          sourceId NVARCHAR(100) NOT NULL, sourceTable NVARCHAR(200) NOT NULL,
          priority INT NOT NULL DEFAULT 0, status NVARCHAR(20) NOT NULL DEFAULT 'queued',
          attemptCount INT NOT NULL DEFAULT 0, maxAttempts INT NOT NULL DEFAULT 3,
          nextAttemptAt DATETIME, lastError NVARCHAR(MAX),
          createdAt DATETIME NOT NULL DEFAULT GETDATE(), updatedAt DATETIME NOT NULL DEFAULT GETDATE())`,
      },
    ];

    let tablesCreated = 0;
    for (const def of tableDefs) {
      const exists = await pool.request()
        .input('name', sql.NVarChar, def.name)
        .query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @name`);
      if (exists.recordset.length === 0) {
        await pool.request().query(def.sql);
        tablesCreated++;
        results.push(`表 ${def.name} 已创建`);
      }
    }

    // 创建索引（幂等）
    const indexDefs = [
      'CREATE NONCLUSTERED INDEX IX_WPLV2_Module ON WechatPushLogsV2 (moduleCode)',
      'CREATE NONCLUSTERED INDEX IX_WPLV2_Source ON WechatPushLogsV2 (sourceId, moduleCode)',
      'CREATE NONCLUSTERED INDEX IX_WPLV2_Status ON WechatPushLogsV2 (status)',
      'CREATE NONCLUSTERED INDEX IX_WPLV2_CreatedAt ON WechatPushLogsV2 (createdAt DESC)',
      'CREATE NONCLUSTERED INDEX IX_WPHV2_Module ON WechatPushHistoryV2 (moduleCode)',
      'CREATE NONCLUSTERED INDEX IX_WPQ_Status ON WechatPushQueue (status, nextAttemptAt)',
      'CREATE NONCLUSTERED INDEX IX_WPQ_Module ON WechatPushQueue (moduleCode, sourceId)',
    ];
    for (const idx of indexDefs) {
      try { await pool.request().query(idx); } catch { /* 索引可能已存在 */ }
    }

    // 2) 同步模块到 WechatPushModules 表
    const newModules = await pushModuleRegistry.syncModulesToDatabase();
    results.push(`模块已同步（新增 ${newModules} 个）`);

    // 3) 清空并重新同步所有字段
    if (req.query.clearTemplates === 'true') {
      await pool.request().query('DELETE FROM WechatPushTemplateV2');
      results.push('已清空旧模板数据');
    }
    await pushModuleRegistry.syncFieldsToDatabase();
    const modules = await pushModuleRegistry.getModulesFromDb();
    const totalFields = modules.length > 0
      ? await pool.request().query(`SELECT COUNT(*) as c FROM WechatPushTemplateFields`).then(r => r.recordset[0]?.c || 0)
      : 0;
    results.push(`字段已同步，共 ${totalFields} 个字段`);

    res.json({
      ok: true,
      tablesCreated,
      moduleCount: modules.length,
      fieldCount: totalFields,
      message: results.join('；'),
      modules,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 测试企微连接
// ============================================================
router.post('/test-connection', async (req, res) => {
  try {
    const settings = await getSettings();
    if (!isApiConfigured(settings)) {
      res.json({ ok: false, error: '企业微信 API 未配置（CorpID / Secret / AgentId 至少缺一项）' });
      return;
    }

    const { wechatCorpId, wechatSecret, wechatAgentId, proxyUrl } = settings;
    const proxyCfg = (() => {
      if (!proxyUrl) return undefined;
      try {
        const u = new URL(proxyUrl);
        return {
          protocol: u.protocol === 'https:' ? 'https' : 'http',
          host: u.hostname,
          port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
          auth: u.username ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password || '') } : undefined,
        };
      } catch { return undefined; }
    })();

    const startTime = Date.now();

    // 步骤1: 获取 access_token
    const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(wechatCorpId!)}&corpsecret=${encodeURIComponent(wechatSecret!)}`;
    const tokenResp = await axios.get(tokenUrl, { proxy: proxyCfg, timeout: 15000 });
    const tokenJson = tokenResp.data;

    if (tokenJson.errcode !== 0) {
      res.json({
        ok: false,
        step: '获取 access_token',
        error: `errcode=${tokenJson.errcode}, errmsg=${tokenJson.errmsg}`,
        elapsed: Date.now() - startTime,
      });
      return;
    }

    const accessToken = tokenJson.access_token;
    const expiresIn = tokenJson.expires_in;

    // 步骤2: 尝试查询部门列表（验证 token 可用性 + AgentId 有效性）
    const deptUrl = `https://qyapi.weixin.qq.com/cgi-bin/department/list?access_token=${encodeURIComponent(accessToken)}`;
    const deptResp = await axios.get(deptUrl, { proxy: proxyCfg, timeout: 15000 });

    if (deptResp.data.errcode !== 0) {
      res.json({
        ok: false,
        step: '查询部门列表',
        tokenOk: true,
        expiresIn,
        error: `errcode=${deptResp.data.errcode}, errmsg=${deptResp.data.errmsg}`,
        elapsed: Date.now() - startTime,
      });
      return;
    }

    const deptCount = deptResp.data.department?.length || 0;

    // 步骤3: 检测出网IP（通过企微回调方式 — 直接用 gettoken 的 IP 来判断）
    let publicIp = '';
    try {
      const ipResp = await axios.get('https://api.ipify.org?format=json', { proxy: proxyCfg ? undefined : false, timeout: 5000 });
      publicIp = ipResp.data?.ip || '';
    } catch {}

    res.json({
      ok: true,
      tokenOk: true,
      expiresIn,
      agentId: wechatAgentId,
      departmentCount: deptCount,
      publicIp,
      elapsed: Date.now() - startTime,
      proxyUsed: !!proxyUrl,
    });
  } catch (err: any) {
    const msg = err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND'
      ? `无法连接企微API（${err.code}），请检查网络或代理配置`
      : (err?.message || String(err));
    res.json({ ok: false, error: msg });
  }
});

// ============================================================
// 获取本机出网IP
// ============================================================
router.get('/public-ip', async (_req, res) => {
  try {
    const sources = [
      { url: 'https://api.ipify.org?format=json', parse: (d: any) => d?.ip || '' },
      { url: 'https://api.myip.com', parse: (d: any) => d?.ip || '' },
      { url: 'https://ipinfo.io/json', parse: (d: any) => d?.ip || '' },
    ];
    for (const { url, parse } of sources) {
      try {
        const resp = await axios.get(url, { timeout: 3000, proxy: false });
        const ip = parse(resp.data);
        if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
          res.json({ ip, source: url });
          return;
        }
      } catch {}
    }
    res.json({ ip: '', error: '所有IP检测源均失败，请手动检测' });
  } catch (err: any) {
    res.json({ ip: '', error: err?.message || '检测失败' });
  }
});

// 辅助函数
function safeJsonParse(str: any, fallback: any): any {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ============================================================
// 接收人筛选：获取可选的角色、组织列表（岗位维度已下线，改为组织/角色维度）
// ============================================================
router.get('/recipient-options', async (_req, res) => {
  try {
    const pool = await getPool();
    const [roles, orgs] = await Promise.all([
      pool.request().query(
        `SELECT role_id AS roleId, role_code AS roleCode, role_name AS roleName
         FROM sys_role WHERE del_flag = 0 AND status = 1
           AND role_name NOT LIKE '%实测%' AND role_name NOT LIKE '%临时%'
         ORDER BY role_id`
      ),
      pool.request().query(
        `SELECT org_id AS orgId, org_name AS orgName, org_type AS orgType, org_level AS orgLevel
         FROM sys_org WHERE del_flag = 0
         ORDER BY org_level, org_id`
      ),
    ]);
    res.json({
      groups: [], // 用户组列已物理删除，选项下线
      roles: (roles.recordset || []).map((r: any) => ({
        roleId: r.roleId, roleCode: r.roleCode, roleName: r.roleName,
      })),
      orgs: (orgs.recordset || []).map((o: any) => ({
        orgId: o.orgId, orgName: o.orgName, orgType: o.orgType, orgLevel: o.orgLevel,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 接收人搜索：按角色/组织筛选用户（区分有无企微账号）；岗位维度已下线
// roleId 精确匹配角色；orgId 匹配该组织及其全部下级（按 ancestors 前缀）
// groupName=组织名聚合、position=角色名聚合（展示用，非岗位）
// ============================================================
router.get('/recipient-search', async (req, res) => {
  try {
    const { roleId, orgId, keyword } = req.query;
    const pool = await getPool();
    const clauses: string[] = [];
    const inputs: { name: string; type: any; value: any }[] = [];

    if (roleId && String(roleId) !== '') {
      clauses.push('ur.role_id = @roleId');
      inputs.push({ name: 'roleId', type: sql.Int, value: Number(roleId) });
    }
    if (orgId && String(orgId) !== '') {
      const orgIdNum = Number(orgId);
      clauses.push(`(ur.org_id = @orgId OR EXISTS (
        SELECT 1 FROM sys_org so WHERE so.org_id = ur.org_id
          AND so.ancestors LIKE @orgPath AND so.del_flag = 0
      ))`);
      inputs.push({ name: 'orgId', type: sql.Int, value: orgIdNum });
      inputs.push({ name: 'orgPath', type: sql.NVarChar, value: `%/${orgIdNum}/%` });
    }
    if (keyword && typeof keyword === 'string') {
      clauses.push('(u.用户名称 LIKE @kw OR u.用户代码 LIKE @kw)');
      inputs.push({ name: 'kw', type: sql.NVarChar, value: `%${keyword}%` });
    }

    const where = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : ' WHERE 1=1';
    const reqSql = pool.request();
    inputs.forEach(i => reqSql.input(i.name, i.type, i.value));
    const result = await reqSql.query(`
      SELECT u.用户代码 AS userCode,
             u.用户名称 AS userName,
             ISNULL((SELECT STUFF((SELECT DISTINCT '、' + org_name FROM sys_org so
                JOIN sys_user_role ur2 ON ur2.org_id = so.org_id AND ur2.user_code = u.用户代码
                WHERE so.del_flag = 0
                FOR XML PATH('')), 1, 1, '')), '') AS groupName,
             ISNULL((SELECT STUFF((SELECT DISTINCT '、' + role_name FROM sys_role sr
                JOIN sys_user_role ur3 ON ur3.role_id = sr.role_id AND ur3.user_code = u.用户代码
                WHERE sr.del_flag = 0
                FOR XML PATH('')), 1, 1, '')), '') AS position,
             ISNULL(u.企微账号, '') AS wechatAccount
      FROM 用户全 u
      JOIN sys_user_role ur ON ur.user_code = u.用户代码
      ${where}
      GROUP BY u.用户代码, u.用户名称, u.企微账号
      ORDER BY u.用户名称
    `);

    // 分组：有企微账号 和 无企微账号
    const withWechat: any[] = [];
    const withoutWechat: any[] = [];
    for (const r of (result.recordset || [])) {
      const u = {
        userCode: String(r.userCode || ''),
        userName: String(r.userName || ''),
        groupName: String(r.groupName || ''),
        position: String(r.position || ''),
        wechatAccount: String(r.wechatAccount || ''),
      };
      if (u.wechatAccount) {
        withWechat.push(u);
      } else {
        withoutWechat.push(u);
      }
    }
    res.json({ total: withWechat.length + withoutWechat.length, withWechat, withoutWechat });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

function getMockData(moduleCode: string): Record<string, any> {
  const mocks: Record<string, Record<string, any>> = {
    inspection_log: {
      supervisor: '张督导', date: '2025-01-01', departure: '总部',
      destination: '时代广场六店', arrivalTime: '2025-01-01 10:00', departureTime: '2025-01-01 18:00',
      remarks: '运营情况良好', userName: '张三',
      coreItems: [{ item: '员工到岗', result: '全部到岗' }],
      shopIssues: [{ item: '货架整理', result: '部分乱' }],
    },
    direct_sales_summary: {
      monthYear: '2025-01', dealer: '郑州经销商', supervisor: '王区经',
      monthlyTarget: '100万', monthlyAchieved: '95万', achievementRate: '95%',
      orderCountDone: '120', giftRatioDone: '80%', newMemberDone: '50',
    },
    feedback_task: {
      taskNo: 'F2025001', title: '1月培训反馈', startTime: '2025-01-01', endTime: '2025-01-31',
      status: '进行中', createdByName: '管理员',
    },
    coaching_store: {
      shopName: '时代广场六店', monthYear: '2025-01', area: '郑州',
      supervisor: '张督导', contactPerson: '李店长',
    },
    daily_score: {
      shopName: '时代广场六店', supervisor: '张督导', scoreDate: '2025-01-01',
      totalScore: '85', rank: '优秀',
    },
    monthly_target: {
      monthYear: '2025-01', shopName: '时代广场六店',
      monthlyTarget: '100万', achievedRate: '95%',
    },
    register: {
      applyNo: 'RA202509191030001', userName: '李四', userCode: 'RG00042',
      phone: '13800001234', warehouseType: '直营', orgName: '时代广场六店',
      status: '待审核', createTime: '2025-09-19 10:30:00',
      rejectReason: '', approverName: '', approveTime: '',
    },
    xixie_feedback: {
      monthYear: '2026-09', quJing: '王区经', warehouseType: '直营', region: '郑州',
      supervisor: '张督导', shopName: '时代广场六店',
      shoeCount: 120, cost: 3600,
      issueCount: 80, issueTickets: 150,
      writeoffCount: 65, writeoffTickets: 110,
      convertCount: 45, convertRevenue: 28000,
    },
    shoe_feedback: {
      feedbackNo: 'SFB20260924AB12', status: '评估中',
      rechargeDate: '2025-08-15', rechargeAmount: '299',
      usedTicketCount: 3, estimatedTickets: 7,
      agreeStatus: '同意', disagreeDesc: '',
      submitterName: '李顾客', submitterPhone: '138****5678',
      handlerName: '', handlerRemark: '', rating: '',
      createdAt: '2026-09-24 09:15:00',
      handledAt: '', completedAt: '',
    },
  };
  return mocks[moduleCode] || { supervisor: '示例', date: '2025-01-01', destination: '示例店铺' };
}

export default router;
