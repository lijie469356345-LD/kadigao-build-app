import { useState, useEffect } from 'react';
import { Eye, EyeOff, Lock, User, UserPlus, Download, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { login } from '../../api/auth';
import { getVersionPolicy, compareVersions } from '../../api/system';
import { useNavigate } from 'react-router-dom';

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUsername, setRememberUsername] = useState(true);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 版本策略状态：checking=正在检查；blocked=当前版本过低被禁止登录
  const [versionChecking, setVersionChecking] = useState(false);
  const [blocked, setBlocked] = useState<{ current: string; minVersion: string } | null>(null);
  const { login: handleLogin, isLoggedIn } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    const savedUsername = localStorage.getItem('login_username');
    const savedPassword = localStorage.getItem('login_password');
    const savedRememberUsername = localStorage.getItem('login_remember_username');
    const savedRememberPassword = localStorage.getItem('login_remember_password');
    if (savedUsername) {
      setUsername(savedUsername);
    }
    if (savedRememberUsername === 'true') {
      setRememberUsername(true);
    }
    if (savedPassword && savedRememberPassword === 'true') {
      setPassword(savedPassword);
      setRememberPassword(true);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      window.location.href = '/';
    }
  }, [isLoggedIn]);

  // 桌面客户端登录前强制版本检查：发布新版本后，低于最低可用版本的客户端禁止登录
  useEffect(() => {
    if (!window.appInfo?.isDesktop) return; // 网页版不拦截
    let cancelled = false;
    const checkVersion = async () => {
      setVersionChecking(true);
      try {
        const current = (await window.appInfo!.getVersion()) || '0.0.0';
        const policy = await getVersionPolicy();
        if (!cancelled && policy?.available && policy.minVersion && compareVersions(current, policy.minVersion) < 0) {
          setBlocked({ current, minVersion: policy.minVersion });
        }
      } catch (e) {
        // 策略拉取失败（离线/后端未就绪）：放行，登录接口会做最终裁决
        console.error('版本策略检查失败，放行:', e);
      } finally {
        if (!cancelled) setVersionChecking(false);
      }
    };
    checkVersion();
    return () => {
      cancelled = true;
    };
  }, []);

  const getClientVersion = async (): Promise<string | undefined> => {
    if (!window.appInfo?.isDesktop) return undefined;
    try {
      return (await window.appInfo.getVersion()) || undefined;
    } catch {
      return undefined;
    }
  };

  const applyTooOld = (current: string, minVersion: string) => {
    setBlocked({ current, minVersion });
    setError('当前版本过低，请升级客户端后再登录');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const version = await getClientVersion();
      const user = await login(username, password, version);
      handleLogin(user, user.token || '');
      if (rememberUsername) {
        localStorage.setItem('login_username', username);
      }
      else {
        localStorage.removeItem('login_username');
      }
      localStorage.setItem('login_remember_username', rememberUsername.toString());
      if (rememberPassword) {
        localStorage.setItem('login_password', password);
      }
      else {
        localStorage.removeItem('login_password');
      }
      localStorage.setItem('login_remember_password', rememberPassword.toString());
      window.location.href = '/';
    }
    catch (err: any) {
      const data = err?.response?.data;
      // 服务端兜底拦截：版本过低时同样切到阻断提示
      if (data?.code === 'VERSION_TOO_OLD') {
        const current = await getClientVersion();
        applyTooOld(current || '0.0.0', data.minVersion || data.message || '最新版本');
        setLoading(false);
        return;
      }
      const msg = data?.message || '用户名或密码错误';
      setError(msg);
    }
    finally {
      setLoading(false);
    }
  };

  // 版本过低阻断页：不渲染登录表单，引导前往下载中心升级
  if (blocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
            </div>
            <h1 className="text-xl font-bold text-gray-800">当前版本过低，无法登录</h1>
            <p className="text-gray-500 mt-2 text-sm leading-relaxed">
              您当前使用的是 <span className="font-semibold text-gray-700">v{blocked.current}</span>，
              系统要求最低 <span className="font-semibold text-gray-700">v{blocked.minVersion}</span>。
              <br />
              发布新版本后，旧版本客户端将不再允许登录，请升级到最新版本后继续使用。
            </p>
            <div className="mt-6 space-y-3">
              <button
                onClick={() => navigate('/download-center')}
                className="inline-flex items-center justify-center gap-2 w-full bg-primary hover:bg-primary-dark text-white font-medium py-3 px-4 rounded-lg transition-all"
              >
                <Download size={18} />
                前往下载中心获取新版本
              </button>
              <button
                onClick={() => { setBlocked(null); window.location.reload(); }}
                className="inline-flex items-center justify-center gap-2 w-full py-2.5 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors"
              >
                <RefreshCw size={16} />
                重新检查版本
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center justify-center gap-2">
              <img src="/logo.jpg" alt="logo" className="h-8 w-8 object-contain" />
              卡迪高运营管理系统
            </h1>
            <p className="text-gray-500 mt-2">请登录您的账号</p>
          </div>

          {versionChecking && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-600 text-sm flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
              正在检查版本…
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
              {error.includes('未注册') && (
                <button
                  onClick={() => navigate('/register')}
                  className="mt-2 w-full bg-primary hover:bg-primary-dark text-white font-medium py-2 px-4 rounded-lg transition-all text-sm"
                >
                  立即注册
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">用户名</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入用户名" className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" className="w-full pl-10 pr-12 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={rememberUsername} onChange={(e) => setRememberUsername(e.target.checked)} className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary" />
                <span className="text-sm text-gray-600">记住账号</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={rememberPassword} onChange={(e) => setRememberPassword(e.target.checked)} className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary" />
                <span className="text-sm text-gray-600">记住密码</span>
              </label>
            </div>

            <button type="submit" disabled={loading || versionChecking} className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {loading ? (<>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>登录中...</span>
              </>) : (<span>登 录</span>)}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => navigate('/register')}
              className="inline-flex items-center gap-2 w-full justify-center py-2.5 border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 rounded-lg text-sm font-medium transition-colors"
            >
              <UserPlus size={16} />
              前往注册（新用户申请账号）
            </button>
          </div>
          <div className="mt-3 text-center">
            <button
              onClick={() => navigate('/download-center')}
              className="inline-flex items-center gap-2 w-full justify-center py-2.5 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors"
            >
              <Download size={16} />
              下载中心（获取客户端安装包）
            </button>
          </div>
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-500">
              © 2026 卡迪高运营管理系统
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;