const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// ======= 配置 =======
const MATERIALS_DIR = '\\\\192.168.110.199\\tupian\\图片';
const CACHE_DIR = 'h:\\AI测试项目\\卡迪高巡店系统\\src\\server\\data';
const CACHE_FILE = path.join(CACHE_DIR, 'material-features.json');
const CONFIG_PATH = 'h:\\AI测试项目\\卡迪高巡店系统\\config.json';
const CHECKPOINT_INTERVAL = 500;  // 每500张保存一次断点

console.log('===== 开始生成素材库特征向量缓存 =====');
console.log('素材目录:', MATERIALS_DIR);
console.log('缓存文件:', CACHE_FILE);
console.log('');

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// 检查是否有断点缓存
let checkpoint = null;
if (fs.existsSync(CACHE_FILE)) {
  try {
    checkpoint = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    console.log('发现断点缓存：已处理', checkpoint.processed.length, '张');
  } catch (e) {
    console.log('断点缓存损坏，从头开始');
  }
}

// 扫描素材库
console.log('扫描素材库目录...');
const allFiles = fs.readdirSync(MATERIALS_DIR);
const imageFiles = allFiles.filter(f => {
  const ext = path.extname(f).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' || ext === '.png';
});
console.log('找到图片文件总数:', imageFiles.length);
console.log('');

// 已处理的文件名集合（用于断点续传
const processedSet = new Set(checkpoint ? checkpoint.processed.map(p => p.name) : []);
const processed = checkpoint ? checkpoint.processed : [];
const startTime = Date.now();
let processedCount = processed.length;
let failedCount = 0;

console.log('开始处理特征向量...（从第', processedCount, '张开始)');
console.log('预计总时间:', (imageFiles.length * 0.05).toFixed(1), '秒');
console.log('');

// 处理函数 - 提取单张图片的512维颜色直方图特征
async function processImage(fileName, index) {
  try {
    const filePath = path.join(MATERIALS_DIR, fileName);
    const image = sharp(filePath).resize(128, 128, { fit: 'cover' });
    const rawData = await image.raw().toBuffer();

    const histogram = new Array(512).fill(0);
    const totalPixels = 128 * 128;
    for (let i = 0; i < rawData.length; i += 3) {
      const r = Math.floor((rawData[i] / 255) * 7.999);
      const g = Math.floor((rawData[i + 1] / 255) * 7.999);
      const b = Math.floor((rawData[i + 2] / 255) * 7.999);
      const idx = r * 64 + g * 8 + b;
      histogram[idx]++;
    }
    for (let i = 0; i < histogram.length; i++) {
      histogram[i] = histogram[i] / totalPixels;
    }

    // 计算 L2 范数（用于后续的余弦相似度计算）
    let normSq = 0;
    for (let i = 0; i < histogram.length; i++) normSq += histogram[i] * histogram[i];
    const norm = Math.sqrt(normSq);

    return { name: fileName, vector: histogram, norm: norm, mtime: Date.now() };
  } catch (err) {
    failedCount++;
    return { name: fileName, error: err.message };
  }
}

// 主循环：顺序处理每张图片
(async () => {
  try {
    for (let i = processedCount; i < imageFiles.length; i++) {
      const fileName = imageFiles[i];
      if (processedSet.has(fileName)) continue;

      const result = await processImage(fileName, i);

      if (result.vector) {
        processed.push(result);
        processedSet.add(fileName);
      }

      processedCount++;

      // 进度输出
      if (processedCount % 100 === 0 || processedCount === imageFiles.length) {
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = processedCount / elapsed;
        const remaining = (imageFiles.length - processedCount) / speed;
        console.log(`  [${processedCount}/${imageFiles.length}] ${speed.toFixed(1)} 张/秒, 剩余 ${remaining.toFixed(1)} 秒`);
      }

      // 断点保存
      if (processedCount % CHECKPOINT_INTERVAL === 0 || processedCount === imageFiles.length) {
        const cacheData = {
          createdAt: Date.now(),
          totalCount: imageFiles.length,
          processedCount: processed.length,
          failedCount: failedCount,
          processed: processed
        };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData));
        console.log(`  💾 断点已保存: ${processed.length} 张特征写入 ${CACHE_FILE}`);
      }
    }

    console.log('');
    console.log('===== 特征提取完成 =====');
    console.log('成功处理:', processed.length, '张');
    console.log('失败数量:', failedCount);

    // ------------------------------------------------------------
    // 新增：从数据库查询商品元数据并补充到缓存
    // ------------------------------------------------------------
    console.log('');
    console.log('===== 开始从数据库补充商品元数据 =====');
    try {
      const sql = require('mssql');
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      const dbConfig = {
        server: config.database.server || '192.168.110.200',
        port: config.database.port || 1433,
        database: config.database.database || 'test',
        user: config.database.user || 'sa',
        password: config.database.password || '123456',
        connectionTimeout: 30000,
        requestTimeout: 120000,
        options: {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
        },
      };

      // 从文件名提取唯一货号
      function extractCode(fileName) {
        const baseName = path.basename(fileName, path.extname(fileName));
        const strictPattern = baseName.match(/(\d{2,3}[A-Za-z]\d{4,5})/);
        if (strictPattern) return strictPattern[1].toUpperCase();
        const spMatch = baseName.match(/(SP|sp)[A-Za-z0-9]+/);
        if (spMatch) return spMatch[0].toUpperCase();
        const sepMatch = baseName.split(/[-_\s]/)[0];
        if (sepMatch && /^[A-Za-z0-9]+$/.test(sepMatch) && sepMatch.length >= 4) {
          return sepMatch.toUpperCase();
        }
        const clean = baseName.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        return clean.substring(0, 12);
      }

      const uniqueCodes = new Set();
      processed.forEach((item) => {
        const code = extractCode(item.name);
        if (code && code.length >= 4) uniqueCodes.add(code);
      });
      console.log('提取到唯一货号:', uniqueCodes.size, '个');

      // 连接数据库
      console.log('连接数据库...');
      const pool = await sql.connect(dbConfig);
      console.log('✅ 数据库连接成功');

      // 分批查询
      const codesArray = Array.from(uniqueCodes);
      const batchSize = 500;
      const goodsMap = new Map();

      for (let batchIdx = 0; batchIdx < codesArray.length; batchIdx += batchSize) {
        const batch = codesArray.slice(batchIdx, batchIdx + batchSize);
        const inClause = batch.map((_, i) => `@code${i}`).join(',');
        const request = pool.request();
        batch.forEach((code, i) => request.input(`code${i}`, sql.NVarChar(100), code));

        const query = `
          SELECT 
            商品代码 as style_code,
            性别 as gender,
            风格 as style_type,
            款式 as goods_type
          FROM [商品全]
          WHERE 商品代码 IN (${inClause})
        `;

        const result = await request.query(query);
        result.recordset.forEach((row) => {
          const key = (row.style_code || '').toString().toUpperCase();
          if (key) {
            goodsMap.set(key, {
              gender: row.gender ? String(row.gender).trim() : null,
              style_type: row.style_type ? String(row.style_type).trim() : null,
              goods_type: row.goods_type ? String(row.goods_type).trim() : null,
            });
          }
        });
        console.log(`  批处理 ${Math.floor(batchIdx / batchSize) + 1}/${Math.ceil(codesArray.length / batchSize)}: 查询 ${batch.length} 个，命中 ${result.recordset.length} 条`);
      }

      console.log('✅ 数据库查询完成，共命中', goodsMap.size, '个商品');

      // 为每条记录补充元数据并写入缓存
      const enrichedItems = processed.map((item) => {
        const code = extractCode(item.name);
        const meta = goodsMap.get(code);
        return {
          name: item.name,
          vector: item.vector,
          mtime: item.mtime || Date.now(),
          norm: item.norm || 0,
          styleCode: code,
          gender: meta ? meta.gender : null,
          style_type: meta ? meta.style_type : null,
          goods_type: meta ? meta.goods_type : null,
        };
      });

      const finalOutput = {
        createdAt: Date.now(),
        totalCount: imageFiles.length,
        processedCount: enrichedItems.length,
        matchedMetaCount: goodsMap.size,
        failedCount: failedCount,
        processed: enrichedItems,
      };

      fs.writeFileSync(CACHE_FILE, JSON.stringify(finalOutput));
      console.log('💾 带元数据的缓存已保存:', CACHE_FILE);
      console.log('缓存文件大小:', (fs.statSync(CACHE_FILE).size / 1024 / 1024).toFixed(2), 'MB');

    } catch (dbError) {
      console.error('⚠️  补充元数据失败:', dbError.message);
      console.log('将只保存特征向量缓存（不包含元数据）...');
      fs.writeFileSync(CACHE_FILE, JSON.stringify({
        createdAt: Date.now(),
        totalCount: imageFiles.length,
        processedCount: processed.length,
        failedCount: failedCount,
        processed: processed,
      }));
      console.log('缓存已保存（无元数据）:', CACHE_FILE);
    }

    console.log('');
    console.log('===== 全部完成 =====');
    console.log('提示: 运行 enrich-material-cache-with-metadata.js 可以单独为已有缓存补充元数据');
  } catch (err) {
    console.error('处理过程中发生致命错误:', err.message);
    process.exit(1);
  }
})();
