// 一次性脚本：创建所有企微推送相关表并写入配置
// 使用方法：node dist/server/setupWechatConfig.js
import { getPool } from '../config/db';
import * as sql from 'mssql';

const CORP_ID = 'ww0dfb932920dec9eb';
const SECRET = 'm3I_s5eIVADS5Ln3H6rHaBkkFckH3qaxBWgfvg8jusY';
const AGENT_ID = '1000022';

async function main() {
  const pool = await getPool();

  // 1. WechatPushSettings
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushSettings')
    CREATE TABLE WechatPushSettings (
      id INT PRIMARY KEY DEFAULT 1,
      enabled BIT NOT NULL DEFAULT 1,
      pollingEnabled BIT NOT NULL DEFAULT 1,
      pollingInterval INT NOT NULL DEFAULT 30,
      wechatCorpId NVARCHAR(200),
      wechatSecret NVARCHAR(500),
      wechatAgentId NVARCHAR(100),
      proxyUrl NVARCHAR(500),
      updatedAt DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);
  // 对旧库补齐 proxyUrl 列
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'WechatPushSettings' AND COLUMN_NAME = 'proxyUrl')
    ALTER TABLE WechatPushSettings ADD proxyUrl NVARCHAR(500) NULL
  `);
  console.log('WechatPushSettings 已存在/创建完成');

  // 写入/更新配置
  await pool.request()
    .input('corpId', sql.NVarChar, CORP_ID)
    .input('secret', sql.NVarChar, SECRET)
    .input('agentId', sql.NVarChar, AGENT_ID)
    .query(`
      IF EXISTS (SELECT 1 FROM WechatPushSettings WHERE id = 1)
        UPDATE WechatPushSettings SET
          wechatCorpId = @corpId, wechatSecret = @secret, wechatAgentId = @agentId,
          enabled = 1, updatedAt = GETDATE() WHERE id = 1
      ELSE
        INSERT INTO WechatPushSettings (id, enabled, pollingEnabled, pollingInterval, wechatCorpId, wechatSecret, wechatAgentId)
        VALUES (1, 1, 1, 30, @corpId, @secret, @agentId)
    `);
  console.log('企业微信配置写入完成');

  // 2. WechatPushLogs
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushLogs')
    CREATE TABLE WechatPushLogs (
      id INT IDENTITY(1,1) PRIMARY KEY,
      logId INT NOT NULL,
      supervisor NVARCHAR(100),
      destination NVARCHAR(200),
      recipientName NVARCHAR(50) NOT NULL,
      recipientAccount NVARCHAR(100) NOT NULL,
      status NVARCHAR(20) NOT NULL,
      message NVARCHAR(MAX) NOT NULL,
      errorDetail NVARCHAR(MAX),
      retryCount INT NOT NULL DEFAULT 0,
      triggeredAt DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log('WechatPushLogs 已存在/创建完成');

  // 3. WechatPushTemplate（带默认值）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushTemplate')
    CREATE TABLE WechatPushTemplate (
      id INT PRIMARY KEY DEFAULT 1,
      title NVARCHAR(200) NOT NULL DEFAULT N'【巡店自动通知】',
      headerTemplate NVARCHAR(1000) NOT NULL DEFAULT N'督导：{supervisor}
巡店日期：{date}
出发地：{departure}
目的地：{destination}
到店时间：{arrivalTime}
离店时间：{departureTime}',
      itemTemplate NVARCHAR(1000) NOT NULL DEFAULT N'{order}.{title}:
{itemsText}',
      singleItemLine NVARCHAR(1000) NOT NULL DEFAULT N'  · {item}：{result}{photoLine}',
      photoLineTemplate NVARCHAR(500) NOT NULL DEFAULT N'（图片：{photo}）',
      footerTemplate NVARCHAR(500) NOT NULL DEFAULT N'
巡店结论：{remarks}
————系统自动推送，无需回复————',
      updatedAt DATETIME NOT NULL DEFAULT GETDATE()
    );

    IF NOT EXISTS (SELECT 1 FROM WechatPushTemplate)
      INSERT INTO WechatPushTemplate (id) VALUES (1);
  `);
  console.log('WechatPushTemplate 已存在/创建完成');

  // 4. WechatPushHistory（去重表）
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushHistory')
    CREATE TABLE WechatPushHistory (
      logId INT PRIMARY KEY,
      pushedAt DATETIME NOT NULL DEFAULT GETDATE(),
      pushedBy NVARCHAR(100)
    )
  `);
  console.log('WechatPushHistory 已存在/创建完成');

  // 校验
  const rows = (await pool.request().query(`
    SELECT id, enabled, pollingEnabled, pollingInterval, wechatCorpId, wechatAgentId
    FROM WechatPushSettings WHERE id = 1
  `)).recordset;
  console.log('最终配置:', JSON.stringify(rows, null, 2));

  process.exit(0);
}

main().catch((e: any) => {
  console.error('出错了:', e);
  process.exit(1);
});
