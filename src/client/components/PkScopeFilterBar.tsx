import { useEffect, useRef, useState } from 'react';
import { PkScopeMeta, PkDataDimFilter } from '../../api/pk';
import { Filter, Warehouse, Store, UserCog, ChevronDown, Search } from 'lucide-react';

/** 多选下拉：按钮 + 悬浮面板（搜索可选 / 全选清空 / checkbox 列表） */
function MultiSelectDropdown({ label, value, options, onChange, disabled, placeholder, searchable }: {
  label: string;
  value: string[];
  options: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  placeholder: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const shown = searchable
    ? options.filter(o => o.toLowerCase().includes(kw.trim().toLowerCase()))
    : options;
  const selCount = value.length;
  const display = selCount === 0 ? placeholder : selCount === 1 ? value[0] : `已选 ${selCount} 项`;
  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  };
  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        title={selCount > 0 ? `已选：${value.join('、')}` : placeholder}
        className={`inline-flex items-center gap-1 border rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 max-w-56 h-8 ${
          selCount > 0 ? 'border-blue-400 text-blue-700 bg-blue-50 font-medium' : 'border-gray-200 text-gray-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className="truncate">{display}</span>
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-60 bg-white border border-gray-200 rounded-lg shadow-xl p-2">
          {searchable && (
            <div className="relative mb-2">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={kw}
                onChange={e => setKw(e.target.value)}
                placeholder="搜索"
                className="w-full border border-gray-200 rounded-md pl-7 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-200"
              />
            </div>
          )}
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-xs font-bold text-gray-500">{label}</span>
            <div className="flex items-center gap-1.5">
              <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => onChange([...options])}>全选</button>
              <span className="text-gray-300">|</span>
              <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => onChange([])}>清空</button>
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto">
            {shown.length === 0 && <div className="text-xs text-gray-400 px-1 py-2">无匹配项</div>}
            {shown.map(o => (
              <label key={o} className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  className="accent-blue-600 shrink-0"
                  checked={value.includes(o)}
                  onChange={() => toggle(o)}
                />
                <span className="truncate">{o}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * PK 范围筛选栏：全部 / 本区 / 本店 / 仓库 / 督导 / 区经 / 经销商 / 店铺名称
 * - filter 值：''（全部）| 'area' | 'shop' | 'warehouse:xx' | 'dealer:xx'（旧 2 维模式）
 * - meta 由 /pk/scope-meta 提供：仓库/经销商/督导/区经列表 + 店铺候选 + 本区可用性 + 本店数
 * - 「本区」仅当前登录用户命中店仓全.区经时可用；「本店」仅存在直接绑定店铺时可用
 * - 传入 dims（可选）后启用 5 维筛选：仓库类别/督导/区经/经销商下拉 + 店铺名称可搜索输入
 *   （datalist 提示），filter 仅承载 全部/本区/本店；不传 dims 时保持原 2 维（仓库/经销商）
 *   行为，兼容 PK日目标跟进 / PK日目标上传页。
 */
interface Props {
  meta: PkScopeMeta | null;
  filter: string;
  onChange: (filter: string) => void;
  /** 数据未就绪或加载中时整体禁用 */
  disabled?: boolean;
  /** 传入后启用 5 维筛选项（PK数据表页使用） */
  dims?: {
    value: PkDataDimFilter;
    onChange: (v: PkDataDimFilter) => void;
  };
  /** 传入后隐藏「范围筛选」区块（全部/本区/本店按钮及标题、分隔线），仅保留维筛选项（PK数据表页使用） */
  hideScope?: boolean;
  /** 多选模式：五维筛选项渲染为多选下拉（含全选/清空），dims.value 各字段须为 string[]（PK数据表页使用） */
  multiSelect?: boolean;
}

export default function PkScopeFilterBar({ meta, filter, onChange, disabled, dims, hideScope, multiSelect }: Props) {
  const scopeOf = filter === '' ? 'all' : filter.split(':')[0];
  const whVal = (!dims && scopeOf === 'warehouse') ? filter.slice('warehouse:'.length) : '';
  const dealerVal = (!dims && scopeOf === 'dealer') ? filter.slice('dealer:'.length) : '';

  const baseBtn = (active: boolean, enabled: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap ${
      active
        ? 'bg-gray-900 text-white shadow-sm'
        : enabled
          ? 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
          : 'bg-gray-50 text-gray-300 border border-gray-200 cursor-not-allowed'
    }`;

  const selCls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 max-w-48';
  const inpCls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 w-44';

  const canArea = !!meta && meta.areaName !== '' && meta.areaShopCount > 0;
  const canShop = !!meta && meta.myShopCount > 0;

  const d = dims?.value;
  const setDim = (patch: Partial<PkDataDimFilter>) => {
    if (!dims) return;
    dims.onChange({ ...dims.value, ...patch });
  };
  /** 多选模式下各维度取值（兼容单选字符串升级场景） */
  const dimArr = (v: string | string[] | undefined): string[] =>
    Array.isArray(v) ? v : (v && v !== '' ? [v] : []);

  return (
    <div className="flex items-center gap-2 flex-wrap bg-white rounded-xl shadow-sm border border-gray-100 px-3 py-2">
      {!hideScope && (
        <>
          <span className="text-xs font-bold text-gray-500 flex items-center gap-1 whitespace-nowrap">
            <Filter size={13} /> 范围筛选
          </span>
          <button
            type="button"
            title="全部可见店铺"
            disabled={disabled}
            className={baseBtn(scopeOf === 'all', !disabled)}
            onClick={() => onChange('')}
          >
            全部
          </button>
          <button
            type="button"
            title={canArea ? `本区（${meta!.areaName}，${meta!.areaShopCount} 店）` : '当前账号非区经，无本区可选'}
            disabled={disabled || !canArea}
            className={baseBtn(scopeOf === 'area', !disabled && canArea)}
            onClick={() => onChange('area')}
          >
            <UserCog size={12} className="inline-block mr-1 -mt-0.5" />
            本区{canArea ? `（${meta!.areaName}）` : ''}
          </button>
          <button
            type="button"
            title={canShop ? `本店（${meta!.myShopCount} 店）` : '当前账号无直接绑定店铺，无本店可选'}
            disabled={disabled || !canShop}
            className={baseBtn(scopeOf === 'shop', !disabled && canShop)}
            onClick={() => onChange('shop')}
          >
            <Store size={12} className="inline-block mr-1 -mt-0.5" />
            本店{canShop ? `（${meta!.myShopCount} 店）` : ''}
          </button>
          <span className="text-gray-300">|</span>
        </>
      )}
      <span className="text-xs text-gray-500 flex items-center gap-1 whitespace-nowrap">
        <Warehouse size={13} /> 仓库类别
      </span>
      {dims && multiSelect ? (
        <MultiSelectDropdown
          label="仓库类别"
          value={dimArr(d?.warehouse)}
          options={meta?.warehouses || []}
          onChange={v => setDim({ warehouse: v })}
          disabled={disabled}
          placeholder="全部仓库"
        />
      ) : (
        <select
          value={dims ? (d?.warehouse as string || '') : whVal}
          disabled={disabled}
          onChange={e => dims ? setDim({ warehouse: e.target.value }) : onChange(e.target.value ? `warehouse:${e.target.value}` : '')}
          className={selCls}
        >
          <option value="">全部仓库</option>
          {(meta?.warehouses || []).map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      )}

      {dims && (
        <>
          {multiSelect ? (
            <>
              <span className="text-xs text-gray-500 whitespace-nowrap">督导</span>
              <MultiSelectDropdown
                label="督导"
                value={dimArr(d?.supervisor)}
                options={meta?.supervisors || []}
                onChange={v => setDim({ supervisor: v })}
                disabled={disabled}
                placeholder="全部督导"
              />
              <span className="text-xs text-gray-500 whitespace-nowrap">区经</span>
              <MultiSelectDropdown
                label="区经"
                value={dimArr(d?.districtManager)}
                options={meta?.districtManagers || []}
                onChange={v => setDim({ districtManager: v })}
                disabled={disabled}
                placeholder="全区经"
              />
              <span className="text-xs text-gray-500 whitespace-nowrap">经销商</span>
              <MultiSelectDropdown
                label="经销商"
                value={dimArr(d?.dealer)}
                options={meta?.dealers || []}
                onChange={v => setDim({ dealer: v })}
                disabled={disabled}
                placeholder="全部经销商"
              />
              <span className="text-xs text-gray-500 whitespace-nowrap">店铺名称</span>
              <MultiSelectDropdown
                label="店铺名称"
                value={dimArr(d?.shopName)}
                options={meta?.shops || []}
                onChange={v => setDim({ shopName: v })}
                disabled={disabled}
                placeholder="全部店铺"
                searchable
              />
            </>
          ) : (
            <>
              <span className="text-xs text-gray-500 whitespace-nowrap">督导</span>
              <select
                value={dims.value.supervisor as string}
                disabled={disabled}
                onChange={e => setDim({ supervisor: e.target.value })}
                className={selCls}
              >
                <option value="">全部督导</option>
                {(meta?.supervisors || []).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="text-xs text-gray-500 whitespace-nowrap">区经</span>
              <select
                value={dims.value.districtManager as string}
                disabled={disabled}
                onChange={e => setDim({ districtManager: e.target.value })}
                className={selCls}
              >
                <option value="">全区经</option>
                {(meta?.districtManagers || []).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <span className="text-xs text-gray-500 whitespace-nowrap">经销商</span>
              <select
                value={dims.value.dealer as string}
                disabled={disabled}
                onChange={e => setDim({ dealer: e.target.value })}
                className={selCls}
              >
                <option value="">全部经销商</option>
                {(meta?.dealers || []).map(x => <option key={x} value={x}>{x}</option>)}
              </select>
              <span className="text-xs text-gray-500 whitespace-nowrap">店铺名称</span>
              <input
                list="pk-shop-name-list"
                value={dims.value.shopName as string}
                disabled={disabled}
                onChange={e => setDim({ shopName: e.target.value })}
                placeholder="输入店铺名称"
                className={inpCls}
              />
              <datalist id="pk-shop-name-list">
                {(meta?.shops || []).map(s => <option key={s} value={s} />)}
              </datalist>
            </>
          )}
        </>
      )}

      {!dims && (
        <>
          <span className="text-xs text-gray-500 whitespace-nowrap">经销商</span>
          <select
            value={dealerVal}
            disabled={disabled}
            onChange={e => onChange(e.target.value ? `dealer:${e.target.value}` : '')}
            className={selCls}
          >
            <option value="">全部经销商</option>
            {(meta?.dealers || []).map(dr => <option key={dr} value={dr}>{dr}</option>)}
          </select>
        </>
      )}
    </div>
  );
}