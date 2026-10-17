-- ============================================================
-- 多门户企业微信推送系统 - 新建表 SQL
-- 数据库：伯俊库 (192.168.110.200:1433)
-- 创建时间：2026-08-07
-- 说明：6张新表，旧表保留不动
-- ============================================================

-- 表1：推送模块注册表
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushModules')
BEGIN
    CREATE TABLE WechatPushModules (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        moduleCode      NVARCHAR(50)  NOT NULL UNIQUE,
        moduleName      NVARCHAR(100) NOT NULL,
        portalCode      NVARCHAR(50)  NOT NULL,
        portalName      NVARCHAR(100) NOT NULL,
        sourceTable     NVARCHAR(200) NOT NULL,
        sourceIdField   NVARCHAR(100) NOT NULL DEFAULT 'id',
        statusField     NVARCHAR(100) NULL,
        statusTriggerValue NVARCHAR(100) NULL,
        recipientStrategy NVARCHAR(50) NOT NULL DEFAULT 'permission_group',
        pollingEnabled  BIT           NOT NULL DEFAULT 1,
        isActive        BIT           NOT NULL DEFAULT 1,
        description     NVARCHAR(500) NULL,
        createdAt       DATETIME      NOT NULL DEFAULT GETDATE(),
        updatedAt       DATETIME      NOT NULL DEFAULT GETDATE()
    );
    PRINT '已创建表 WechatPushModules';
END
GO

-- 表2：模板可用字段注册表
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushTemplateFields')
BEGIN
    CREATE TABLE WechatPushTemplateFields (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        moduleCode      NVARCHAR(50)  NOT NULL,
        fieldKey        NVARCHAR(100) NOT NULL,
        fieldName       NVARCHAR(100) NOT NULL,
        fieldType       NVARCHAR(50)  NOT NULL DEFAULT 'text',
        sourceColumn    NVARCHAR(200) NOT NULL,
        sourceTable     NVARCHAR(200) NULL,
        category        NVARCHAR(50)  NOT NULL DEFAULT 'basic',
        sortOrder       INT           NOT NULL DEFAULT 0,
        description     NVARCHAR(500) NULL,
        createdAt       DATETIME      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_PTF_ModuleField UNIQUE (moduleCode, fieldKey)
    );
    PRINT '已创建表 WechatPushTemplateFields';
END
GO

-- 表3：多模板配置表
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushTemplateV2')
BEGIN
    CREATE TABLE WechatPushTemplateV2 (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        moduleCode      NVARCHAR(50)  NOT NULL,
        templateName    NVARCHAR(100) NOT NULL,
        title           NVARCHAR(200) NOT NULL DEFAULT '',
        headerTemplate  NVARCHAR(2000) NULL,
        bodyTemplate    NVARCHAR(4000) NULL,
        footerTemplate  NVARCHAR(500)  NULL,
        selectedFields  NVARCHAR(MAX) NULL DEFAULT '[]',
        isDefault       BIT           NOT NULL DEFAULT 0,
        isActive        BIT           NOT NULL DEFAULT 1,
        createdBy       NVARCHAR(100) NULL,
        startTime       DATETIME      NULL,
        endTime         DATETIME      NULL,
        createdAt       DATETIME      NOT NULL DEFAULT GETDATE(),
        updatedAt       DATETIME      NOT NULL DEFAULT GETDATE()
    );
    PRINT '已创建表 WechatPushTemplateV2';
END
GO

-- 表4：重构推送日志表
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushLogsV2')
BEGIN
    CREATE TABLE WechatPushLogsV2 (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        moduleCode      NVARCHAR(50)  NOT NULL,
        sourceId        INT           NOT NULL,
        sourceTable     NVARCHAR(200) NOT NULL,
        sourceTitle     NVARCHAR(500) NULL,
        supervisor      NVARCHAR(100) NULL,
        destination     NVARCHAR(200) NULL,
        recipientName   NVARCHAR(100) NOT NULL,
        recipientAccount NVARCHAR(100) NOT NULL,
        messageContent  NVARCHAR(MAX) NOT NULL,
        status          NVARCHAR(20)  NOT NULL,
        errorDetail     NVARCHAR(MAX) NULL,
        retryCount      INT           NOT NULL DEFAULT 0,
        triggeredBy     NVARCHAR(50)  NOT NULL DEFAULT 'auto',
        triggeredAt     DATETIME      NOT NULL,
        createdAt       DATETIME      NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX IX_WPLV2_Module ON WechatPushLogsV2 (moduleCode);
    CREATE INDEX IX_WPLV2_Source ON WechatPushLogsV2 (sourceId, moduleCode);
    CREATE INDEX IX_WPLV2_Status ON WechatPushLogsV2 (status);
    CREATE INDEX IX_WPLV2_CreatedAt ON WechatPushLogsV2 (createdAt DESC);
    PRINT '已创建表 WechatPushLogsV2';
END
GO

-- 表5：重构去重表
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushHistoryV2')
BEGIN
    CREATE TABLE WechatPushHistoryV2 (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        moduleCode      NVARCHAR(50)  NOT NULL,
        sourceId        INT           NOT NULL,
        sourceTable     NVARCHAR(200) NOT NULL,
        pushedAt        DATETIME      NOT NULL DEFAULT GETDATE(),
        pushedBy        NVARCHAR(50)  NOT NULL,
        CONSTRAINT UQ_WPHV2_ModuleSource UNIQUE (moduleCode, sourceId)
    );
    CREATE INDEX IX_WPHV2_Module ON WechatPushHistoryV2 (moduleCode);
    PRINT '已创建表 WechatPushHistoryV2';
END
GO

-- 表6：推送队列
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WechatPushQueue')
BEGIN
    CREATE TABLE WechatPushQueue (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        moduleCode      NVARCHAR(50)  NOT NULL,
        sourceId        INT           NOT NULL,
        sourceTable     NVARCHAR(200) NOT NULL,
        priority        INT           NOT NULL DEFAULT 0,
        status          NVARCHAR(20)  NOT NULL DEFAULT 'queued',
        attemptCount    INT           NOT NULL DEFAULT 0,
        maxAttempts     INT           NOT NULL DEFAULT 3,
        nextAttemptAt   DATETIME      NULL,
        lastError       NVARCHAR(MAX) NULL,
        createdAt       DATETIME      NOT NULL DEFAULT GETDATE(),
        updatedAt       DATETIME      NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX IX_WPQ_Status ON WechatPushQueue (status, nextAttemptAt);
    CREATE INDEX IX_WPQ_Module ON WechatPushQueue (moduleCode, sourceId);
    PRINT '已创建表 WechatPushQueue';
END
GO

PRINT '全部6张新表创建/验证完成';
GO
