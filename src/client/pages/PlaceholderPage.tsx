import { Construction } from 'lucide-react';
import Layout from '../components/Layout';

interface PlaceholderPageProps {
  title: string;
  /** 所属门户中文名，如 基础资料/考勤/自动薪资/工作台 */
  portalCn?: string;
}

/**
 * 占位页面：新层级框架中已上线菜单但暂无业务实现时展示
 * （基础资料 入职/转正/调岗/离职、考勤、自动薪资、工作台扩展、会员报表等）
 */
function PlaceholderPage({ title, portalCn }: PlaceholderPageProps) {
  return (
    <Layout title={title} subtitle={portalCn ? `所属门户：${portalCn}` : undefined}>
      <div className="bg-white rounded-xl shadow-sm p-12 flex flex-col items-center justify-center text-center">
        <div className="p-5 rounded-full bg-amber-50 mb-4">
          <Construction size={40} className="text-amber-500" />
        </div>
        <h3 className="text-lg font-bold text-gray-800">{title}</h3>
        <p className="text-gray-400 text-sm mt-2">
          该功能已纳入「{portalCn || title}」菜单，页面功能建设中，敬请期待
        </p>
      </div>
    </Layout>
  );
}

export default PlaceholderPage;