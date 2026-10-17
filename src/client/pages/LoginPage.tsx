import { useState, useEffect } from 'react';
import { Eye, EyeOff, Lock, User, UserPlus } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { login } from '../../api/auth';
import { useNavigate } from 'react-router-dom';
function LoginPage() {
 const [username, setUsername] = useState('');
 const [password, setPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [rememberUsername, setRememberUsername] = useState(true);
 const [rememberPassword, setRememberPassword] = useState(false);
 const [error, setError] = useState('');
 const [loading, setLoading] = useState(false);
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
 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setError('');
 setLoading(true);
 try {
const user = await login(username, password);
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
    const msg = err?.response?.data?.message || '用户名或密码错误';
    setError(msg);
  }
 finally {
 setLoading(false);
 }
 };
 return (<div className="min-h-screen bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center p-4">
 <div className="w-full max-w-md">
 <div className="bg-white rounded-2xl shadow-2xl p-8">
 <div className="text-center mb-8">
 <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
 <Lock className="w-8 h-8 text-primary"/>
 </div>
  <h1 className="text-2xl font-bold text-gray-800 flex items-center justify-center gap-2">
    <img src="/logo.jpg" alt="logo" className="h-8 w-8 object-contain" />
    卡迪高运营管理系统
  </h1>
  <p className="text-gray-500 mt-2">请登录您的账号</p>
 </div>

  {error && (<div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
  {error}
  {error.includes('未注册') && (
    <button
      onClick={() => navigate('/register')}
      className="mt-2 w-full bg-primary hover:bg-primary-dark text-white font-medium py-2 px-4 rounded-lg transition-all text-sm"
    >
      立即注册
    </button>
  )}
  </div>)}

 <form onSubmit={handleSubmit} className="space-y-4">
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-2">用户名</label>
 <div className="relative">
 <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"/>
 <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入用户名" className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"/>
 </div>
 </div>

 <div>
 <label className="block text-sm font-medium text-gray-700 mb-2">密码</label>
 <div className="relative">
 <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"/>
 <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" className="w-full pl-10 pr-12 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"/>
 <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
 {showPassword ? <EyeOff className="w-5 h-5"/> : <Eye className="w-5 h-5"/>}
 </button>
 </div>
 </div>

 <div className="flex items-center justify-between">
 <label className="flex items-center gap-2 cursor-pointer">
 <input type="checkbox" checked={rememberUsername} onChange={(e) => setRememberUsername(e.target.checked)} className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"/>
 <span className="text-sm text-gray-600">记住账号</span>
 </label>
 <label className="flex items-center gap-2 cursor-pointer">
 <input type="checkbox" checked={rememberPassword} onChange={(e) => setRememberPassword(e.target.checked)} className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"/>
 <span className="text-sm text-gray-600">记住密码</span>
 </label>
 </div>

 <button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
 {loading ? (<>
 <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
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
<div className="mt-4 text-center">
 <p className="text-sm text-gray-500">
 © 2026 卡迪高运营管理系统
</p>
 </div>
 </div>
 </div>
 </div>);
}
export default LoginPage;
