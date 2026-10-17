import { Router } from 'express';
import { testConnection, setDbConfig, connectDB, saveDbConfig, dbConfig, refreshConnectionPool } from '../../config/db';
import sql from 'mssql';

const router = Router();

// 读取当前数据库连接配置（前端页面初始化用，按用户实际保存/内置配置返回，无硬编码）
router.get('/database', (req, res) => {
  res.json({
    server: dbConfig.server || '',
    port: dbConfig.port || 1433,
    database: dbConfig.database || '',
    user: dbConfig.user || '',
    password: dbConfig.password || '',
  });
});

router.post('/test-connection', async (req, res) => {
  try {
    const { server, port, database, user, password } = req.body;

    const config: any = {
      server,
      port: parseInt(port) || 1433,
      database,
      user,
      password,
      connectionTimeout: 30000,
      requestTimeout: 60000,
      maxRows: 10000,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectionPool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      },
    };

    const result: any = await testConnection(config);
    // 添加额外信息以帮助用户验证
    if (result.success) {
      // 如果连接成功，测试一下能获取什么表（可选功能）
      try {
        const testPool = await sql.connect(config);
        const tablesResult = await testPool.request().query(`
          SELECT TABLE_NAME
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE = 'BASE TABLE'
          ORDER BY TABLE_NAME
        `);
        const tables = tablesResult.recordset.map((row: any) => row.TABLE_NAME);
        result.tables = tables;
        await testPool.close();
      } catch (e) {
        console.error('获取表列表失败:', e);
        // 即使无法获取表列表也不影响基本连接测试
      }
    }

    res.json(result);
  } catch (error: any) {
    console.error('数据库连接测试失败:', error);
    res.status(400).json({
      success: false,
      message: error.message || '数据库连接失败'
    });
  }
});

router.post('/save-config', async (req, res) => {
  try {
    const { server, port, database, user, password } = req.body;

    const config: any = {
      server,
      port: parseInt(port) || 1433,
      database,
      user,
      password,
      connectionTimeout: 30000,
      requestTimeout: 60000,
      maxRows: 10000,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectionPool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      },
    };

    // 1) 立即按用户输入更新内存配置（页面填什么就连什么）
    setDbConfig(config);

    // 2) 持久化到可写配置（exe 同级目录），重启后仍生效
    const persisted = saveDbConfig(config);

    try {
      await connectDB();
      // 确保刷新连接池
      refreshConnectionPool();

      res.json({
        success: true,
        persisted,
        message: persisted
          ? '配置已保存并连接数据库，重启后依然生效'
          : '配置已应用但落盘失败（重启后会丢失，请检查程序目录写权限）'
      });
    } catch (error: any) {
      res.json({
        success: true,
        persisted,
        message: '配置已保存，但数据库当前连接失败: ' + error.message
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: '保存配置失败: ' + error.message });
  }
});

export default router;
