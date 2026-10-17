import { useEffect, useState } from 'react';
import PageHeader from './_WechatPageHeader';
import WechatPushSidebar from './_WechatPushSidebar';
import { getWechatRecipients, WechatRecipientUser } from '../../api/wechatPush';
import { getRecipientOptions, RecipientRoleOption, RecipientOrgOption } from '../../api/wechatPushV2';
import { Search, RefreshCw } from 'lucide-react';

export default function WechatPushRecipientsPage() {
  const [users, setUsers] = useState<WechatRecipientUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [roles, setRoles] = useState<RecipientRoleOption[]>([]);
  const [orgs, setOrgs] = useState<RecipientOrgOption[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getWechatRecipients({ search, roleId: roleFilter || undefined, orgId: orgFilter || undefined });
      setUsers(Array.isArray(data) ? data : []);
    } catch { setUsers([]); }
    setLoading(false);
  };

  useEffect(() => {
    load();
    getRecipientOptions().then(r => {
      setRoles((r.roles || []).filter(x => x.roleName && !/实测|临时/.test(x.roleName)));
      setOrgs(r.orgs || []);
    }).catch(() => {});
  }, []);

  const th = 'border border-gray-300 px-2 py-1.5 text-xs font-bold text-gray-700 bg-gray-50 text-left';
  const td = 'border border-gray-300 px-2 py-1.5 text-xs';

  return (
    <div className="min-h-screen bg-gray-100">
      <PageHeader title="推送接收人" subtitle="按角色/组织筛选企微推送目标" />
      <div className="max-w-7xl mx-auto px-4 py-4 flex gap-4">
        <WechatPushSidebar />
        <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="border rounded pl-7 pr-2 py-1.5 text-sm w-48" placeholder="搜索工号/姓名/手机"
              value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
          </div>
          <select className="border rounded px-2 py-1.5 text-sm" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="">全部角色</option>
            {roles.map(x => <option key={x.roleId} value={x.roleId}>{x.roleName}</option>)}
          </select>
          <select className="border rounded px-2 py-1.5 text-sm" value={orgFilter} onChange={e => setOrgFilter(e.target.value)}>
            <option value="">全部组织（含下级）</option>
            {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.orgName}</option>)}
          </select>
          <button onClick={load} disabled={loading} className="px-3 py-1.5 bg-gray-100 rounded text-sm"><RefreshCw size={14} /> 查询</button>
          <span className="text-xs text-gray-400">{users.length} 人</span>
        </div>

        {loading ? <p className="text-gray-400 py-8 text-center">加载中...</p> : users.length === 0 ? (
          <p className="text-gray-400 py-8 text-center">无匹配用户（需要有企微账号）</p>
        ) : (
          <div className="bg-white border rounded overflow-x-auto">
            <table className="border-collapse w-full">
              <thead>
                <tr>
                  <th className={th}>工号</th><th className={th}>姓名</th><th className={th}>手机号</th>
                  <th className={th}>组织</th><th className={th}>角色</th><th className={th}>企微账号</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={i} className={i%2===0?'bg-white':'bg-gray-50'}>
                    <td className={td}>{u.userCode}</td><td className={td}>{u.userName}</td>
                    <td className={td}>{u.phone}</td><td className={td}>{u.groupName}</td>
                    <td className={td}>{u.position}</td><td className={td}>{u.wechatAccount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}