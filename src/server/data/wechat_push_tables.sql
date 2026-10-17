-- ============================================================
-- 企业微信推送功能相关表结构 (SQL Server)
-- 巡店系统：卡迪高巡店系统
-- 用途：存储推送接收人、推送日志、模板配置、全局设置
-- 说明：如已存在同名表，可先执行 DROP TABLE 再重建
-- ============================================================

-- ------------------------------------------------------------
-- 1. 推送接收人表：后台配置接收人列表
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushRecipients')
BEGIN
    CREATE TABLE WechatPushRecipients (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        wechatAccount   NVARCHAR(100) NOT NULL,   -- 企业微信账号/工号
        name            NVARCHAR(50)  NOT NULL,   -- 姓名
        isEnabled       BIT           NOT NULL DEFAULT 1,  -- 是否启用（临时剔除功能）
        createdAt       DATETIME      NOT NULL DEFAULT GETDATE(),
        updatedAt       DATETIME      NOT NULL DEFAULT GETDATE()
    );
    CREATE UNIQUE INDEX IX_WechatPushRecipients_Account
        ON WechatPushRecipients (wechatAccount);
    PRINT '已创建表 WechatPushRecipients';
END
GO

-- ------------------------------------------------------------
-- 2. 推送日志表：每次推送记录到此表
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushLogs')
BEGIN
    CREATE TABLE WechatPushLogs (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        logId           INT           NOT NULL,   -- 巡店日志ID
        supervisor      NVARCHAR(100),            -- 督导（冗余存储）
        destination     NVARCHAR(200),            -- 目的地/店铺（冗余存储）
        recipientName   NVARCHAR(50)  NOT NULL,   -- 接收人姓名
        recipientAccount NVARCHAR(100) NOT NULL,  -- 接收人账号
        status          NVARCHAR(20)  NOT NULL,   -- pending/success/failed/skipped
        message         NVARCHAR(MAX) NOT NULL,   -- 推送内容（冗余存储）
        errorDetail     NVARCHAR(MAX),            -- 失败原因
        retryCount      INT           NOT NULL DEFAULT 0,  -- 重试次数
        triggeredAt     DATETIME      NOT NULL,   -- 实际推送触发时间
        createdAt       DATETIME      NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX IX_WechatPushLogs_logId    ON WechatPushLogs (logId);
    CREATE INDEX IX_WechatPushLogs_status   ON WechatPushLogs (status);
    CREATE INDEX IX_WechatPushLogs_createdAt ON WechatPushLogs (createdAt);
    CREATE INDEX IX_WechatPushLogs_triggeredAt ON WechatPushLogs (triggeredAt);
    PRINT '已创建表 WechatPushLogs';
END
GO

-- ------------------------------------------------------------
-- 3. 推送全局设置表（单行表）：总开关、企业微信API配置、轮询间隔等
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushSettings')
BEGIN
    CREATE TABLE WechatPushSettings (
        id              INT PRIMARY KEY DEFAULT 1,
        enabled         BIT           NOT NULL DEFAULT 1,   -- 全局推送开关
        pollingEnabled  BIT           NOT NULL DEFAULT 1,   -- 是否启用轮询兜底
        pollingInterval INT           NOT NULL DEFAULT 30,  -- 轮询间隔(秒)，默认30
        wechatCorpId    NVARCHAR(200),                       -- 企业微信 CorpID
        wechatSecret    NVARCHAR(500),                       -- 企业微信 Secret
        wechatAgentId   NVARCHAR(100),                       -- 企业微信 应用 AgentId
        updatedAt       DATETIME      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT CK_WechatPushSettings_OneRow CHECK (id = 1)
    );
    -- 默认插入一行配置
    IF NOT EXISTS (SELECT 1 FROM WechatPushSettings)
    BEGIN
        INSERT INTO WechatPushSettings (id, enabled, pollingEnabled, pollingInterval)
        VALUES (1, 1, 1, 30);
    END
    PRINT '已创建表 WechatPushSettings';
END
GO

-- ------------------------------------------------------------
-- 4. 消息模板配置表（单行表）：支持后台修改模板文案
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushTemplate')
BEGIN
    CREATE TABLE WechatPushTemplate (
        id              INT PRIMARY KEY DEFAULT 1,
        title           NVARCHAR(200)   NOT NULL DEFAULT N'【巡店自动通知】',
        headerTemplate  NVARCHAR(1000)  NOT NULL DEFAULT N'督导：{supervisor}
巡店日期：{date}
出发地：{departure}
目的地：{destination}
到店时间：{arrivalTime}
离店时间：{departureTime}',
        itemTemplate    NVARCHAR(1000)  NOT NULL DEFAULT N'{order}.{title}:
{itemsText}',
        singleItemLine  NVARCHAR(1000)  NOT NULL DEFAULT N'  · {item}：{result}{photoLine}',
        photoLineTemplate NVARCHAR(500) NOT NULL DEFAULT N'（图片：{photo}）',
        footerTemplate  NVARCHAR(500)   NOT NULL DEFAULT N'
巡店结论：{remarks}
————系统自动推送，无需回复————',
        updatedAt       DATETIME       NOT NULL DEFAULT GETDATE(),
        CONSTRAINT CK_WechatPushTemplate_OneRow CHECK (id = 1)
    );
    IF NOT EXISTS (SELECT 1 FROM WechatPushTemplate)
    BEGIN
        INSERT INTO WechatPushTemplate (id) VALUES (1);
    END
    PRINT '已创建表 WechatPushTemplate';
END
GO

-- ------------------------------------------------------------
-- 5. 已推送拦截表：用于避免同一巡店日志重复推送
--    同一 logId 在此表中有记录即视为已触发过推送
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushHistory')
BEGIN
    CREATE TABLE WechatPushHistory (
        logId           INT PRIMARY KEY,
        pushedAt        DATETIME NOT NULL DEFAULT GETDATE(),
        pushedBy        NVARCHAR(100)  -- 触发方式：auto/manual/polling
    );
    PRINT '已创建表 WechatPushHistory';
END
GO

-- ------------------------------------------------------------
-- 6. 过期日志清理（90天以前的推送日志可删除）：
--    如需自动清理，可在 SQL Server 代理中创建作业周期性执行：
--    DELETE FROM WechatPushLogs WHERE createdAt < DATEADD(DAY, -90, GETDATE());
-- ------------------------------------------------------------
PRINT '表结构初始化完成';
GO
