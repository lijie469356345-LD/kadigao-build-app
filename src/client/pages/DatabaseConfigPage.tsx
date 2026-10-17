import { Database, Settings, CheckCircle, XCircle, RefreshCw, Save, Wand2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import Layout from '../components/Layout';

interface DbConfig {
  driver: string;
  server: string;
  database: string;
  uid: string;
  pwd: string;
  port: string;
}

// 不再硬编码任何默认地址：初始为空，页面打开时从服务端拉取当前配置（用户已保存的或内置的）
const emptyConfig: DbConfig = {
  driver: '{SQL Server}',
  server: '',
  database: '',
  uid: '',
  pwd: '',
  port: '1433'
};

function DatabaseConfigPage() {
  const [config, setConfig] = useState<DbConfig>(emptyConfig);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  // 页面打开即加载当前数据库连接配置（按用户输入/已保存值显示，不再写死 192.168.110.200）
  useEffect(() => {
    fetch('/api/config/database')
      .then(r => r.json())
      .then(d => {
        setConfig({
          driver: '{SQL Server}',
          server: d.server || '',
          database: d.database || '',
          uid: d.user || '',
          pwd: d.password || '',
          port: d.port ? String(d.port) : '1433'
        });
      })
      .catch(() => {
        setConfig(emptyConfig);
      })
      .finally(() => setLoaded(true));
  }, []);

  const handleConfigChange = (key: keyof DbConfig, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setConnectionStatus('idle');
    setStatusMessage('');
  };

  const handleTestConnection = async () => {
    setConnectionStatus('connecting');
    setStatusMessage('正在测试数据库连接...');

    try {
      const response = await fetch('/api/config/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: config.server,
          port: config.port,
          database: config.database,
          user: config.uid,
          password: config.pwd
        })
      });

      const result = await response.json();

      if (result.success) {
        setConnectionStatus('success');
        setStatusMessage('数据库连接成功！');
        setTables(result.tables || []);
      } else {
        setConnectionStatus('error');
        setStatusMessage(result.message || '数据库连接失败');
      }
    } catch (error) {
      setConnectionStatus('error');
      setStatusMessage('连接失败，请检查网络或配置');
    }
  };

  const handleSaveConfig = async () => {
    try {
      const response = await fetch('/api/config/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: config.server,
          port: config.port,
          database: config.database,
          user: config.uid,
          password: config.pwd
        })
      });

      const result = await response.json();

      if (result.success) {
        alert('配置已保存！');
      } else {
        alert('保存失败：' + result.message);
      }
    } catch (error) {
      alert('保存失败，请检查网络');
    }
  };

  const handleTableSelect = (tableName: string) => {
    const newSelected = new Set(selectedTables);
    if (newSelected.has(tableName)) {
      newSelected.delete(tableName);
    } else {
      newSelected.add(tableName);
    }
    setSelectedTables(newSelected);
  };

  const handleSelectAllTables = () => {
    if (selectedTables.size === tables.length) {
      setSelectedTables(new Set());
    } else {
      setSelectedTables(new Set(tables));
    }
  };

  return (
    <Layout>
      <div className="p-6">
        <header className="bg-white shadow-sm px-6 py-4 rounded-xl mb-6">
          <div className="flex items-center gap-3">
            <Database className="w-6 h-6 text-primary" />
            <div>
              <h2 className="text-xl font-bold text-gray-800">数据库连接</h2>
              <p className="text-gray-500 text-sm mt-1">配置数据库连接参数</p>
            </div>
          </div>
        </header>

        <div className="bg-white rounded-xl shadow-sm">
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-600" />
              <h3 className="text-lg font-bold text-gray-800">连接配置</h3>
            </div>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">数据库驱动</label>
                <select
                  value={config.driver}
                  onChange={(e) => handleConfigChange('driver', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                >
                  <option value="{SQL Server}">SQL Server</option>
                  <option value="{ODBC Driver 17 for SQL Server}">ODBC Driver 17</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">服务器地址</label>
                <input
                  type="text"
                  value={config.server}
                  onChange={(e) => handleConfigChange('server', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  placeholder="例如: 192.168.110.200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">端口</label>
                <input
                  type="text"
                  value={config.port}
                  onChange={(e) => handleConfigChange('port', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  placeholder="默认: 1433"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">数据库名称</label>
                <input
                  type="text"
                  value={config.database}
                  onChange={(e) => handleConfigChange('database', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  placeholder="例如: 伯俊库"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">用户名</label>
                <input
                  type="text"
                  value={config.uid}
                  onChange={(e) => handleConfigChange('uid', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  placeholder="例如: sa"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">密码</label>
                <input
                  type="password"
                  value={config.pwd}
                  onChange={(e) => handleConfigChange('pwd', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  placeholder="输入密码"
                />
              </div>
            </div>

            <div className={`mt-4 p-4 rounded-lg flex items-center gap-3 ${
              connectionStatus === 'success' ? 'bg-green-50' :
              connectionStatus === 'error' ? 'bg-red-50' :
              connectionStatus === 'connecting' ? 'bg-yellow-50' : 'bg-gray-50'
            }`}>
              {connectionStatus === 'success' && (
                <>
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span className="text-green-700">{statusMessage}</span>
                </>
              )}
              {connectionStatus === 'error' && (
                <>
                  <XCircle className="w-5 h-5 text-red-500" />
                  <span className="text-red-700">{statusMessage}</span>
                </>
              )}
              {connectionStatus === 'connecting' && (
                <>
                  <RefreshCw className="w-5 h-5 text-yellow-500 animate-spin" />
                  <span className="text-yellow-700">{statusMessage}</span>
                </>
              )}
              {connectionStatus === 'idle' && (
                <>
                  <Database className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-500">请点击测试连接按钮验证配置</span>
                </>
              )}
            </div>

            <div className="mt-6 flex gap-4">
              <button
                onClick={handleTestConnection}
                disabled={connectionStatus === 'connecting'}
                className="flex items-center gap-2 px-6 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Wand2 size={16} />
                <span>测试连接</span>
              </button>
              <button
                onClick={handleSaveConfig}
                className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Save size={16} />
                <span>保存配置</span>
              </button>
            </div>
          </div>
        </div>

        {connectionStatus === 'success' && tables.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm mt-6">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-800">可用数据表</h3>
                <button
                  onClick={handleSelectAllTables}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <input
                    type="checkbox"
                    checked={selectedTables.size === tables.length && tables.length > 0}
                    onChange={handleSelectAllTables}
                    className="rounded"
                  />
                  <span>全选</span>
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-3 gap-3">
                {tables.map(table => (
                  <div
                    key={table}
                    onClick={() => handleTableSelect(table)}
                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      selectedTables.has(table)
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedTables.has(table)}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleTableSelect(table);
                        }}
                        className="rounded"
                      />
                      <span className="text-sm font-medium text-gray-800 truncate">{table}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between">
                <span className="text-sm text-gray-500">已选择 {selectedTables.size} 个表</span>
                <button
                  onClick={() => {
                    if (selectedTables.size > 0) {
                      alert(`将从以下表获取数据: ${Array.from(selectedTables).join(', ')}`);
                    } else {
                      alert('请先选择数据表');
                    }
                  }}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                >
                  确认选择
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default DatabaseConfigPage;