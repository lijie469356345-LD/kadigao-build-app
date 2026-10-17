import { useState, useMemo } from 'react';
import { Filter } from 'lucide-react';

// ========== Hook ==========

export interface UseFilterOptions<T> {
  getArea?: (item: T) => string | undefined;
  getSupervisor: (item: T) => string | string[];
  getShopName: (item: T) => string | string[];
  getWarehouseType?: (item: T) => string | undefined;
  getDealer?: (item: T) => string | undefined;
  getDistrictManager?: (item: T) => string | undefined;
  getMonthComparable?: (item: T) => string | undefined;
  getYearComparable?: (item: T) => string | undefined;
  /** 从店铺档案加载的月可比性候选值（无该值时才从数据行派生） */
  monthComparableOptions?: string[];
  /** 从店铺档案加载的年可比性候选值（无该值时才从数据行派生） */
  yearComparableOptions?: string[];
  onChange?: () => void;
}

export function useAreaSupervisorShopFilter<T>(
  data: T[],
  options: UseFilterOptions<T>
) {
  const { getArea, getSupervisor, getShopName, onChange } = options;
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [selectedSupervisors, setSelectedSupervisors] = useState<string[]>([]);
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  const [showAreaPanel, setShowAreaPanel] = useState(false);
  const [showSupervisorPanel, setShowSupervisorPanel] = useState(false);
  const [showShopPanel, setShowShopPanel] = useState(false);
  const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>([]);
  const [showWarehousePanel, setShowWarehousePanel] = useState(false);
  const [selectedDealers, setSelectedDealers] = useState<string[]>([]);
  const [showDealerPanel, setShowDealerPanel] = useState(false);
  const [selectedDistrictManagers, setSelectedDistrictManagers] = useState<string[]>([]);
  const [showDistrictManagerPanel, setShowDistrictManagerPanel] = useState(false);
  const [selectedMonthComparables, setSelectedMonthComparables] = useState<string[]>([]);
  const [showMonthComparablePanel, setShowMonthComparablePanel] = useState(false);
  const [selectedYearComparables, setSelectedYearComparables] = useState<string[]>([]);
  const [showYearComparablePanel, setShowYearComparablePanel] = useState(false);

  // Helper: get shop names as array from an item
  const getShopNames = (item: T): string[] => {
    const val = getShopName(item);
    return Array.isArray(val) ? val : (val ? [val] : []);
  };

  // Helper: get supervisors as array from an item
  const getSupervisors = (item: T): string[] => {
    const val = getSupervisor(item);
    return Array.isArray(val) ? val : (val ? [val] : []);
  };

  // Helper: check if item matches selected areas
  const matchesArea = (item: T): boolean => {
    if (selectedAreas.length === 0) return true;
    const area = getArea?.(item) || '';
    return selectedAreas.includes(area);
  };

  // Helper: check if item matches selected supervisors
  const matchesSupervisor = (item: T): boolean => {
    if (selectedSupervisors.length === 0) return true;
    return getSupervisors(item).some(s => selectedSupervisors.includes(s));
  };

  // Helper: check if item matches selected shops
  const matchesShop = (item: T): boolean => {
    if (selectedShops.length === 0) return true;
    const shops = getShopNames(item);
    return shops.some(s => selectedShops.includes(s));
  };

  const matchesWarehouse = (item: T): boolean => {
    if (selectedWarehouses.length === 0) return true;
    const wh = options.getWarehouseType?.(item) || "";
    return selectedWarehouses.includes(wh);
  };

  const matchesDealer = (item: T): boolean => {
    if (selectedDealers.length === 0) return true;
    const dl = options.getDealer?.(item) || '';
    return selectedDealers.includes(dl);
  };

  const matchesDistrictManager = (item: T): boolean => {
    if (selectedDistrictManagers.length === 0) return true;
    const dm = options.getDistrictManager?.(item) || '';
    return selectedDistrictManagers.includes(dm);
  };

  const matchesMonthComparable = (item: T): boolean => {
    if (selectedMonthComparables.length === 0) return true;
    return selectedMonthComparables.includes(options.getMonthComparable?.(item) || '');
  };

  const matchesYearComparable = (item: T): boolean => {
    if (selectedYearComparables.length === 0) return true;
    return selectedYearComparables.includes(options.getYearComparable?.(item) || '');
  };

  // All unique values (deduped & sorted)
  const allAreas = useMemo(() => {
    if (!getArea) return [];
    const set = new Set<string>();
    data.forEach(item => {
      const area = getArea(item);
      if (area) set.add(area);
    });
    return Array.from(set).sort();
  }, [data, getArea]);

  const allSupervisors = useMemo(() => {
    const set = new Set<string>();
    data.forEach(item => {
      getSupervisors(item).forEach(s => { if (s) set.add(s); });
    });
    return Array.from(set).sort();
  }, [data, getSupervisor]);

  const allShops = useMemo(() => {
    const set = new Set<string>();
    data.forEach(item => {
      getShopNames(item).forEach(s => { if (s) set.add(s); });
    });
    return Array.from(set).sort();
  }, [data, getShopName]);

  const allWarehouses = useMemo(() => {
    const getWH = options.getWarehouseType;
    if (!getWH) return [];
    const set = new Set<string>();
    data.forEach(item => { const wh = getWH(item); if (wh) set.add(wh); });
    return Array.from(set).sort();
  }, [data, options.getWarehouseType]);

  const allDealers = useMemo(() => {
    const getDL = options.getDealer;
    if (!getDL) return [];
    const set = new Set<string>();
    data.forEach(item => { const dl = getDL(item); if (dl) set.add(dl); });
    return Array.from(set).sort();
  }, [data, options.getDealer]);

  const allDistrictManagers = useMemo(() => {
    const getDM = options.getDistrictManager;
    if (!getDM) return [];
    const set = new Set<string>();
    data.forEach(item => { const dm = getDM(item); if (dm) set.add(dm); });
    return Array.from(set).sort();
  }, [data, options.getDistrictManager]);

  const allMonthComparables = useMemo(() => {
    if (options.monthComparableOptions && options.monthComparableOptions.length > 0) {
      return Array.from(new Set(options.monthComparableOptions)).sort();
    }
    const getC = options.getMonthComparable;
    if (!getC) return [];
    const set = new Set<string>();
    data.forEach(item => { const v = getC(item); if (v) set.add(v); });
    return Array.from(set).sort();
  }, [data, options.getMonthComparable, options.monthComparableOptions]);

  const allYearComparables = useMemo(() => {
    if (options.yearComparableOptions && options.yearComparableOptions.length > 0) {
      return Array.from(new Set(options.yearComparableOptions)).sort();
    }
    const getC = options.getYearComparable;
    if (!getC) return [];
    const set = new Set<string>();
    data.forEach(item => { const v = getC(item); if (v) set.add(v); });
    return Array.from(set).sort();
  }, [data, options.getYearComparable, options.yearComparableOptions]);

  // 可比性候选值受其他维度筛选联动收敛
  const matchesOtherThanComparable = (item: T): boolean =>
    matchesArea(item) && matchesSupervisor(item) && matchesShop(item) && matchesWarehouse(item) && matchesDealer(item) && matchesDistrictManager(item);

  const availableMonthComparables = useMemo(() => {
    if (selectedAreas.length === 0 && selectedSupervisors.length === 0 && selectedShops.length === 0 && selectedWarehouses.length === 0 && selectedDealers.length === 0 && selectedDistrictManagers.length === 0) return allMonthComparables;
    const getC = options.getMonthComparable;
    if (!getC) return allMonthComparables;
    const set = new Set<string>();
    data.filter(matchesOtherThanComparable).forEach(item => { const v = getC(item); if (v) set.add(v); });
    return Array.from(set).sort();
  }, [data, allMonthComparables, selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedDealers, selectedDistrictManagers]);

  const availableYearComparables = useMemo(() => {
    if (selectedAreas.length === 0 && selectedSupervisors.length === 0 && selectedShops.length === 0 && selectedWarehouses.length === 0 && selectedDealers.length === 0 && selectedDistrictManagers.length === 0) return allYearComparables;
    const getC = options.getYearComparable;
    if (!getC) return allYearComparables;
    const set = new Set<string>();
    data.filter(matchesOtherThanComparable).forEach(item => { const v = getC(item); if (v) set.add(v); });
    return Array.from(set).sort();
  }, [data, allYearComparables, selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedDealers, selectedDistrictManagers]);

  const availableDealers = useMemo(() => {
    if (selectedAreas.length === 0 && selectedSupervisors.length === 0 && selectedShops.length === 0 && selectedWarehouses.length === 0 && selectedDistrictManagers.length === 0 && selectedMonthComparables.length === 0 && selectedYearComparables.length === 0) return allDealers;
    const getDL = options.getDealer;
    if (!getDL) return [];
    const filtered = data.filter(item => matchesArea(item) && matchesSupervisor(item) && matchesShop(item) && matchesWarehouse(item) && matchesDistrictManager(item) && matchesMonthComparable(item) && matchesYearComparable(item));
    const set = new Set<string>();
    filtered.forEach(item => { const dl = getDL(item); if (dl) set.add(dl); });
    return Array.from(set).sort();
  }, [data, allDealers, selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedDistrictManagers, selectedMonthComparables, selectedYearComparables]);

  const availableDistrictManagers = useMemo(() => {
    if (selectedAreas.length === 0 && selectedSupervisors.length === 0 && selectedShops.length === 0 && selectedWarehouses.length === 0 && selectedDealers.length === 0 && selectedMonthComparables.length === 0 && selectedYearComparables.length === 0) return allDistrictManagers;
    const getDM = options.getDistrictManager;
    if (!getDM) return [];
    const filtered = data.filter(item => matchesArea(item) && matchesSupervisor(item) && matchesShop(item) && matchesWarehouse(item) && matchesDealer(item) && matchesMonthComparable(item) && matchesYearComparable(item));
    const set = new Set<string>();
    filtered.forEach(item => { const dm = getDM(item); if (dm) set.add(dm); });
    return Array.from(set).sort();
  }, [data, allDistrictManagers, selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedDealers, selectedMonthComparables, selectedYearComparables]);

  const availableWarehouses = useMemo(() => {
    if (selectedAreas.length === 0 && selectedSupervisors.length === 0 && selectedShops.length === 0 && selectedDealers.length === 0 && selectedDistrictManagers.length === 0 && selectedMonthComparables.length === 0 && selectedYearComparables.length === 0) return allWarehouses;
    const getWH = options.getWarehouseType;
    if (!getWH) return [];
    const filtered = data.filter(item => matchesArea(item) && matchesSupervisor(item) && matchesShop(item) && matchesDealer(item) && matchesDistrictManager(item) && matchesMonthComparable(item) && matchesYearComparable(item));
    const set = new Set<string>();
    filtered.forEach(item => { const wh = getWH(item); if (wh) set.add(wh); });
    return Array.from(set).sort();
  }, [data, allWarehouses, selectedAreas, selectedSupervisors, selectedShops, selectedDealers, selectedDistrictManagers, selectedMonthComparables, selectedYearComparables]);

  // Linked available options
  const availableAreas = useMemo(() => {
    if (selectedSupervisors.length === 0 && selectedShops.length === 0 && selectedDealers.length === 0 && selectedDistrictManagers.length === 0 && selectedMonthComparables.length === 0 && selectedYearComparables.length === 0) return allAreas;
    if (!getArea) return [];
    const filtered = data.filter(item => matchesSupervisor(item) && matchesShop(item) && matchesDealer(item) && matchesDistrictManager(item) && matchesMonthComparable(item) && matchesYearComparable(item));
    const set = new Set<string>();
    filtered.forEach(item => {
      const area = getArea(item);
      if (area) set.add(area);
    });
    return Array.from(set).sort();
  }, [data, allAreas, selectedSupervisors, selectedShops, selectedDealers, selectedDistrictManagers, selectedMonthComparables, selectedYearComparables, getArea]);

  const availableSupervisors = useMemo(() => {
    if (selectedAreas.length === 0 && selectedShops.length === 0 && selectedDealers.length === 0 && selectedDistrictManagers.length === 0 && selectedMonthComparables.length === 0 && selectedYearComparables.length === 0) return allSupervisors;
    const filtered = data.filter(item => matchesArea(item) && matchesShop(item) && matchesDealer(item) && matchesDistrictManager(item) && matchesMonthComparable(item) && matchesYearComparable(item));
    const set = new Set<string>();
    filtered.forEach(item => {
      getSupervisors(item).forEach(s => { if (s) set.add(s); });
    });
    return Array.from(set).sort();
  }, [data, allSupervisors, selectedAreas, selectedShops, selectedDealers, selectedDistrictManagers, selectedMonthComparables, selectedYearComparables, getSupervisor]);

  const availableShops = useMemo(() => {
    if (selectedAreas.length === 0 && selectedSupervisors.length === 0 && selectedDealers.length === 0 && selectedDistrictManagers.length === 0 && selectedMonthComparables.length === 0 && selectedYearComparables.length === 0) return allShops;
    const filtered = data.filter(item => matchesArea(item) && matchesSupervisor(item) && matchesDealer(item) && matchesDistrictManager(item) && matchesMonthComparable(item) && matchesYearComparable(item));
    const set = new Set<string>();
    filtered.forEach(item => {
      getShopNames(item).forEach(s => { if (s) set.add(s); });
    });
    return Array.from(set).sort();
  }, [data, allShops, selectedAreas, selectedSupervisors, selectedDealers, selectedDistrictManagers, selectedMonthComparables, selectedYearComparables, getShopName]);

  // Toggle with linked cleanup
  const toggleArea = (area: string) => {
    setSelectedAreas(prev => {
      const next = prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area];
      // Clean up supervisors not in selected areas
      const validSups = new Set(
        next.length > 0 ? data.filter(item => next.includes(getArea?.(item) || '')).flatMap(item => getSupervisors(item)) : []
      );
      setSelectedSupervisors(sups => sups.filter(sup => validSups.has(sup)));
      // Clean up shops not in selected areas
      const validShops = new Set<string>();
      if (next.length > 0) {
        data.filter(item => next.includes(getArea?.(item) || '')).forEach(item => {
          getShopNames(item).forEach(s => validShops.add(s));
        });
      }
      setSelectedShops(shops => shops.filter(shop => validShops.has(shop)));
      // Clean up dealers not in selected areas
      const getDL = options.getDealer;
      if (getDL && next.length > 0) {
        const validDLs = new Set(data.filter(item => next.includes(getArea?.(item) || '')).map(item => getDL(item)).filter(Boolean) as string[]);
        setSelectedDealers(dls => dls.filter(d => validDLs.has(d)));
      }
      // Clean up warehouses not in selected areas
      const getWH = options.getWarehouseType;
      if (getWH && next.length > 0) {
        const validWHs = new Set(data.filter(item => next.includes(getArea?.(item) || '')).map(item => getWH(item)).filter(Boolean) as string[]);
        setSelectedWarehouses(whs => whs.filter(w => validWHs.has(w)));
      }
      // Clean up district managers not in selected areas
      const getDM = options.getDistrictManager;
      if (getDM && next.length > 0) {
        const validDMs = new Set(data.filter(item => next.includes(getArea?.(item) || '')).map(item => getDM(item)).filter(Boolean) as string[]);
        setSelectedDistrictManagers(dms => dms.filter(d => validDMs.has(d)));
      }
      // Clean up comparables not in selected areas
      if (next.length > 0) pruneComparables(data.filter(item => next.includes(getArea?.(item) || '')));
      return next;
    });
    onChange?.();
  };

  const toggleSupervisor = (sup: string) => {
    setSelectedSupervisors(prev => {
      const next = prev.includes(sup) ? prev.filter(s => s !== sup) : [...prev, sup];
      const validData = next.length > 0 ? data.filter(item => getSupervisors(item).some(s => next.includes(s))) : [];
      // Clean up shops not in selected supervisors
      const validShops = new Set<string>();
      validData.forEach(item => getShopNames(item).forEach(s => validShops.add(s)));
      setSelectedShops(shops => shops.filter(shop => validShops.has(shop)));
      // Clean up areas not in selected supervisors
      const validAreas = new Set(getArea ? validData.map(item => getArea(item)).filter(Boolean) as string[] : []);
      if (getArea) setSelectedAreas(areas => areas.filter(a => validAreas.has(a)));
      // Clean up dealers / warehouses / district managers
      const getDL = options.getDealer;
      if (getDL) { const validDLs = new Set(validData.map(item => getDL(item)).filter(Boolean) as string[]); setSelectedDealers(dls => dls.filter(d => validDLs.has(d))); }
      const getWH = options.getWarehouseType;
      if (getWH) { const validWHs = new Set(validData.map(item => getWH(item)).filter(Boolean) as string[]); setSelectedWarehouses(whs => whs.filter(w => validWHs.has(w))); }
      const getDM = options.getDistrictManager;
      if (getDM) { const validDMs = new Set(validData.map(item => getDM(item)).filter(Boolean) as string[]); setSelectedDistrictManagers(dms => dms.filter(d => validDMs.has(d))); }
      pruneComparables(validData);
      return next;
    });
    onChange?.();
  };

  const toggleShop = (shop: string) => {
    setSelectedShops(prev => {
      const next = prev.includes(shop) ? prev.filter(s => s !== shop) : [...prev, shop];
      const validData = next.length > 0 ? data.filter(item => getShopNames(item).some(s => next.includes(s))) : [];
      // Clean up supervisors not in selected shops
      const validSups = new Set(validData.flatMap(item => getSupervisors(item)));
      setSelectedSupervisors(sups => sups.filter(sup => validSups.has(sup)));
      // Clean up areas not in selected shops
      const validAreas = new Set(getArea ? validData.map(item => getArea(item)).filter(Boolean) as string[] : []);
      if (getArea) setSelectedAreas(areas => areas.filter(a => validAreas.has(a)));
      // Clean up dealers / warehouses / district managers
      const getDL = options.getDealer;
      if (getDL) { const validDLs = new Set(validData.map(item => getDL(item)).filter(Boolean) as string[]); setSelectedDealers(dls => dls.filter(d => validDLs.has(d))); }
      const getWH = options.getWarehouseType;
      if (getWH) { const validWHs = new Set(validData.map(item => getWH(item)).filter(Boolean) as string[]); setSelectedWarehouses(whs => whs.filter(w => validWHs.has(w))); }
      const getDM = options.getDistrictManager;
      if (getDM) { const validDMs = new Set(validData.map(item => getDM(item)).filter(Boolean) as string[]); setSelectedDistrictManagers(dms => dms.filter(d => validDMs.has(d))); }
      pruneComparables(validData);
      return next;
    });
    onChange?.();
  };

  const toggleMonthComparable = (v: string) => {
    setSelectedMonthComparables(prev => {
      const next = prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v];
      pruneDimsAfterComparable(next, selectedYearComparables);
      return next;
    });
    onChange?.();
  };

  const toggleYearComparable = (v: string) => {
    setSelectedYearComparables(prev => {
      const next = prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v];
      pruneDimsAfterComparable(selectedMonthComparables, next);
      return next;
    });
    onChange?.();
  };

  // 选定月可比/年可比后，将其他维度（区域/督导/店铺/仓库/区经/经销商）收敛到匹配可比性的结果，实现双向联动
  const pruneDimsAfterComparable = (selectedMC: string[], selectedYC: string[]) => {
    if (selectedMC.length === 0 && selectedYC.length === 0) return;
    const filter = (item: T) =>
      (selectedMC.length === 0 || selectedMC.includes(options.getMonthComparable?.(item) || '')) &&
      (selectedYC.length === 0 || selectedYC.includes(options.getYearComparable?.(item) || ''));
    const validData = data.filter(filter);
    if (getArea) setSelectedAreas(areas => areas.filter(a => validData.some(item => getArea(item) === a)));
    setSelectedSupervisors(sups => sups.filter(s => validData.some(item => getSupervisors(item).includes(s))));
    setSelectedShops(shops => shops.filter(s => validData.some(item => getShopNames(item).includes(s))));
    if (options.getWarehouseType) setSelectedWarehouses(whs => whs.filter(w => validData.some(item => options.getWarehouseType!(item) === w)));
    if (options.getDistrictManager) setSelectedDistrictManagers(dms => dms.filter(d => validData.some(item => options.getDistrictManager!(item) === d)));
    if (options.getDealer) setSelectedDealers(dls => dls.filter(d => validData.some(item => options.getDealer!(item) === d)));
  };

  // 选定其他维度后，将月/年可比性收敛到该维度下出现的取值（双向联动另一半）
  const pruneComparables = (validData: T[]) => {
    const getMC = options.getMonthComparable;
    if (getMC) {
      const validMC = new Set<string>();
      validData.forEach(it => { const v = getMC(it); if (v) validMC.add(v); });
      setSelectedMonthComparables(cs => cs.filter(c => validMC.has(c)));
    }
    const getYC = options.getYearComparable;
    if (getYC) {
      const validYC = new Set<string>();
      validData.forEach(it => { const v = getYC(it); if (v) validYC.add(v); });
      setSelectedYearComparables(cs => cs.filter(c => validYC.has(c)));
    }
  };

  const handleFilterAll = () => {
    setSelectedAreas([]);
    setSelectedSupervisors([]);
    setSelectedShops([]);
    setSelectedDealers([]);
    setSelectedDistrictManagers([]);
    setSelectedMonthComparables([]);
    setSelectedYearComparables([]);
    setShowAreaPanel(false);
    setShowSupervisorPanel(false);
    setShowShopPanel(false);
    setShowDealerPanel(false);
    setShowDistrictManagerPanel(false);
    setShowMonthComparablePanel(false);
    setShowYearComparablePanel(false);
    onChange?.();
  };

  const toggleDealer = (dl: string) => {
    setSelectedDealers(prev => {
      const next = prev.includes(dl) ? prev.filter(d => d !== dl) : [...prev, dl];
      if (next.length > 0) {
        // Cascade: clean up areas/supervisors/shops/warehouses not matching selected dealers
        const getDL = options.getDealer;
        if (getDL) {
          const validData = data.filter(item => next.includes(getDL(item) || ''));
          const validAreas = new Set(
            getArea ? validData.map(item => getArea(item)).filter(Boolean) as string[] : []
          );
          const validSups = new Set(validData.flatMap(item => getSupervisors(item)));
          const validShops = new Set(validData.flatMap(item => getShopNames(item)));
          const validWhs = new Set(
            options.getWarehouseType ? validData.map(item => options.getWarehouseType!(item)).filter(Boolean) as string[] : []
          );
          const validDMs = new Set(
            options.getDistrictManager ? validData.map(item => options.getDistrictManager!(item)).filter(Boolean) as string[] : []
          );
          if (getArea) setSelectedAreas(areas => areas.filter(a => validAreas.has(a)));
          setSelectedSupervisors(sups => sups.filter(s => validSups.has(s)));
          setSelectedShops(shops => shops.filter(s => validShops.has(s)));
          if (options.getWarehouseType) setSelectedWarehouses(whs => whs.filter(w => validWhs.has(w)));
          if (options.getDistrictManager) setSelectedDistrictManagers(dms => dms.filter(d => validDMs.has(d)));
          pruneComparables(validData);
        }
      }
      return next;
    });
    onChange?.();
  };

  const toggleDistrictManager = (dm: string) => {
    setSelectedDistrictManagers(prev => {
      const next = prev.includes(dm) ? prev.filter(d => d !== dm) : [...prev, dm];
      if (next.length > 0) {
        const getDM = options.getDistrictManager;
        if (getDM) {
          const validData = data.filter(item => next.includes(getDM(item) || ''));
          const validAreas = new Set(
            getArea ? validData.map(item => getArea(item)).filter(Boolean) as string[] : []
          );
          const validSups = new Set(validData.flatMap(item => getSupervisors(item)));
          const validShops = new Set(validData.flatMap(item => getShopNames(item)));
          const validWhs = new Set(
            options.getWarehouseType ? validData.map(item => options.getWarehouseType!(item)).filter(Boolean) as string[] : []
          );
          const validDLs = new Set(
            options.getDealer ? validData.map(item => options.getDealer!(item)).filter(Boolean) as string[] : []
          );
          if (getArea) setSelectedAreas(areas => areas.filter(a => validAreas.has(a)));
          setSelectedSupervisors(sups => sups.filter(s => validSups.has(s)));
          setSelectedShops(shops => shops.filter(s => validShops.has(s)));
          if (options.getWarehouseType) setSelectedWarehouses(whs => whs.filter(w => validWhs.has(w)));
          if (options.getDealer) setSelectedDealers(dls => dls.filter(d => validDLs.has(d)));
          pruneComparables(validData);
        }
      }
      return next;
    });
    onChange?.();
  };

  // Select all in a panel
  const selectAllAreas = () => {
    const next = [...availableAreas];
    const validSups = new Set(
      next.length > 0 && getArea ? data.filter(item => next.includes(getArea(item) || '')).flatMap(item => getSupervisors(item)) : []
    );
    setSelectedAreas(next);
    setSelectedSupervisors(sups => sups.filter(sup => validSups.has(sup)));
    const validShops = new Set<string>();
    if (next.length > 0 && getArea) {
      data.filter(item => next.includes(getArea(item) || '')).forEach(item => {
        getShopNames(item).forEach(s => validShops.add(s));
      });
    }
    setSelectedShops(shops => shops.filter(shop => validShops.has(shop)));
    onChange?.();
  };

  const selectAllSupervisors = () => {
    const next = [...availableSupervisors];
    const validShops = new Set<string>();
    data.filter(item => getSupervisors(item).some(s => next.includes(s))).forEach(item => {
      getShopNames(item).forEach(s => validShops.add(s));
    });
    setSelectedSupervisors(next);
    setSelectedShops(shops => shops.filter(shop => validShops.has(shop)));
    if (getArea) {
      const validAreas = new Set(
        data.filter(item => getSupervisors(item).some(s => next.includes(s))).map(item => getArea(item)).filter(Boolean) as string[]
      );
      setSelectedAreas(areas => areas.filter(a => validAreas.has(a)));
    }
    onChange?.();
  };

  const selectAllShops = () => {
    const next = [...availableShops];
    const validSups = new Set(
      data.filter(item => getShopNames(item).some(s => next.includes(s))).flatMap(item => getSupervisors(item))
    );
    setSelectedShops(next);
    setSelectedSupervisors(sups => sups.filter(sup => validSups.has(sup)));
    if (getArea) {
      const validAreas = new Set(
        data.filter(item => getShopNames(item).some(s => next.includes(s))).map(item => getArea(item)).filter(Boolean) as string[]
      );
      setSelectedAreas(areas => areas.filter(a => validAreas.has(a)));
    }
    onChange?.();
  };

  const clearAreas = () => {
    setSelectedAreas([]);
    setSelectedSupervisors([]);
    setSelectedShops([]);
    onChange?.();
  };

  const clearSupervisors = () => {
    setSelectedSupervisors([]);
    setSelectedShops([]);
    setSelectedAreas([]);
    onChange?.();
  };

  const clearShops = () => {
    setSelectedShops([]);
    setSelectedSupervisors([]);
    setSelectedAreas([]);
    onChange?.();
  };

  // Filtered data
  const filteredData = useMemo(() => {
    return data.filter(item => matchesArea(item) && matchesSupervisor(item) && matchesShop(item) && matchesWarehouse(item) && matchesDealer(item) && matchesDistrictManager(item) && matchesMonthComparable(item) && matchesYearComparable(item));
  }, [data, selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedDealers, selectedDistrictManagers, selectedMonthComparables, selectedYearComparables]);

  return {
    selectedAreas, selectedSupervisors, selectedShops, selectedWarehouses, selectedDealers, selectedDistrictManagers,
    showAreaPanel, showSupervisorPanel, showShopPanel, showWarehousePanel, showDealerPanel, showDistrictManagerPanel,
    setShowAreaPanel, setShowSupervisorPanel, setShowShopPanel, setShowWarehousePanel, setShowDealerPanel, setShowDistrictManagerPanel,
    setSelectedWarehouses, setSelectedDealers, setSelectedDistrictManagers,
    allAreas, allSupervisors, allShops, allWarehouses, allDealers, allDistrictManagers,
    availableAreas, availableSupervisors, availableShops, availableWarehouses, availableDealers, availableDistrictManagers,
    hasWarehouseType: !!options.getWarehouseType, hasDealer: !!options.getDealer, hasDistrictManager: !!options.getDistrictManager,
    toggleArea, toggleSupervisor, toggleShop, toggleDealer, toggleDistrictManager,
    handleFilterAll,
    filteredData,
    selectAllAreas, selectAllSupervisors, selectAllShops,
    clearAreas, clearSupervisors, clearShops,
    selectedMonthComparables, selectedYearComparables,
    showMonthComparablePanel, showYearComparablePanel,
    setShowMonthComparablePanel, setShowYearComparablePanel,
    setSelectedMonthComparables, setSelectedYearComparables,
    allMonthComparables, allYearComparables, availableMonthComparables, availableYearComparables,
    hasMonthComparable: !!options.getMonthComparable, hasYearComparable: !!options.getYearComparable,
    toggleMonthComparable, toggleYearComparable,
  };
}

export type FilterHookResult = ReturnType<typeof useAreaSupervisorShopFilter>;

// ========== Component ==========

interface AreaSupervisorShopFilterProps {
  filter: FilterHookResult;
}

export function AreaSupervisorShopFilter({ filter }: AreaSupervisorShopFilterProps) {
  const {
    selectedAreas, selectedSupervisors, selectedShops,
    showAreaPanel, showSupervisorPanel, showShopPanel,
    setShowAreaPanel, setShowSupervisorPanel, setShowShopPanel,
    availableAreas, availableSupervisors, availableShops, allWarehouses, availableWarehouses,
    toggleArea, toggleSupervisor, toggleShop,
    selectAllAreas, selectAllSupervisors, selectAllShops,
    clearAreas, clearSupervisors, clearShops,
    selectedWarehouses, setSelectedWarehouses, showWarehousePanel, setShowWarehousePanel,
    selectedDealers, setSelectedDealers, showDealerPanel, setShowDealerPanel,
    toggleDealer, availableDealers,
    selectedDistrictManagers, setSelectedDistrictManagers, showDistrictManagerPanel, setShowDistrictManagerPanel,
    toggleDistrictManager, availableDistrictManagers,
    allAreas, hasWarehouseType, hasDealer, hasDistrictManager,
    handleFilterAll,
    selectedMonthComparables, selectedYearComparables,
    showMonthComparablePanel, showYearComparablePanel,
    setShowMonthComparablePanel, setShowYearComparablePanel,
    setSelectedMonthComparables, setSelectedYearComparables,
    allMonthComparables, allYearComparables, availableMonthComparables, availableYearComparables,
    hasMonthComparable, hasYearComparable,
    toggleMonthComparable, toggleYearComparable,
  } = filter;

  const closeAllPanels = () => {
    setShowAreaPanel(false);
    setShowSupervisorPanel(false);
    setShowShopPanel(false);
    setShowWarehousePanel(false);
    setShowDealerPanel(false);
    setShowDistrictManagerPanel(false);
    setShowMonthComparablePanel(false);
    setShowYearComparablePanel(false);
  };

  // If no area data, hide the area button
  const hasArea = allAreas.length > 0;

  return (
    <div className="flex items-center gap-2 relative">
      <Filter className="w-5 h-5 text-gray-400" />
      <button
        onClick={() => {
          if (hasArea) {
            setShowAreaPanel(v => !v); setShowSupervisorPanel(false); setShowShopPanel(false);
          } else {
            handleFilterAll();
          }
        }}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedAreas.length > 0 ? 'bg-primary text-white' : selectedSupervisors.length === 0 && selectedShops.length === 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
      >
        {selectedAreas.length > 0 ? `区域(${selectedAreas.length})` : '全部'}
      </button>
      <button
        onClick={() => { setShowSupervisorPanel(v => !v); setShowAreaPanel(false); setShowShopPanel(false); }}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedSupervisors.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
      >
        本区{selectedSupervisors.length > 0 ? `(${selectedSupervisors.length})` : ''}
      </button>
      <button
        onClick={() => { setShowShopPanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); }}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedShops.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
      >
        本店{selectedShops.length > 0 ? `(${selectedShops.length})` : ''}
      </button>
      {hasWarehouseType && (
        <button
          onClick={() => { setShowWarehousePanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedWarehouses.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
        >
          仓库{selectedWarehouses.length > 0 ? `(${selectedWarehouses.length})` : ''}
        </button>
      )}
      {hasDistrictManager && (
        <button
          onClick={() => { setShowDistrictManagerPanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); setShowWarehousePanel(false); setShowDealerPanel(false); }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedDistrictManagers.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
        >
          区经{selectedDistrictManagers.length > 0 ? `(${selectedDistrictManagers.length})` : ''}
        </button>
      )}
      {hasDealer && (
        <button
          onClick={() => { setShowDealerPanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); setShowWarehousePanel(false); setShowDistrictManagerPanel(false); }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedDealers.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
        >
          经销商{selectedDealers.length > 0 ? `(${selectedDealers.length})` : ''}
        </button>
      )}
      {hasMonthComparable && (
        <button
          onClick={() => { setShowMonthComparablePanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); setShowWarehousePanel(false); setShowDistrictManagerPanel(false); setShowDealerPanel(false); setShowYearComparablePanel(false); }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedMonthComparables.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
        >
          月可比{selectedMonthComparables.length > 0 ? `(${selectedMonthComparables.length})` : ''}
        </button>
      )}
      {hasYearComparable && (
        <button
          onClick={() => { setShowYearComparablePanel(v => !v); setShowAreaPanel(false); setShowSupervisorPanel(false); setShowShopPanel(false); setShowWarehousePanel(false); setShowDistrictManagerPanel(false); setShowDealerPanel(false); setShowMonthComparablePanel(false); }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedYearComparables.length > 0 ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
        >
          年可比{selectedYearComparables.length > 0 ? `(${selectedYearComparables.length})` : ''}
        </button>
      )}

      {(showAreaPanel || showSupervisorPanel || showShopPanel || showWarehousePanel || showDealerPanel || showDistrictManagerPanel || showMonthComparablePanel || showYearComparablePanel) && (
        <div className="fixed inset-0 z-40" onClick={closeAllPanels} />
      )}

      {showAreaPanel && hasArea && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[220px] max-h-72 overflow-auto">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <span className="text-xs text-gray-500">选择区域（{availableAreas.length}）</span>
            <div className="flex gap-2">
              <button onClick={selectAllAreas} className="text-xs text-primary hover:underline">全选</button>
              <button onClick={clearAreas} className="text-xs text-gray-400 hover:underline">清空</button>
            </div>
          </div>
          {availableAreas.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">无可选区域</p>
          ) : (
            availableAreas.map(area => (
              <label key={area} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedAreas.includes(area)}
                  onChange={() => toggleArea(area)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-sm text-gray-700">{area}</span>
              </label>
            ))
          )}
        </div>
      )}

      {showSupervisorPanel && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[220px] max-h-72 overflow-auto">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <span className="text-xs text-gray-500">选择督导（{availableSupervisors.length}）</span>
            <div className="flex gap-2">
              <button onClick={selectAllSupervisors} className="text-xs text-primary hover:underline">全选</button>
              <button onClick={clearSupervisors} className="text-xs text-gray-400 hover:underline">清空</button>
            </div>
          </div>
          {availableSupervisors.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">无可选督导</p>
          ) : (
            availableSupervisors.map(sup => (
              <label key={sup} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSupervisors.includes(sup)}
                  onChange={() => toggleSupervisor(sup)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-sm text-gray-700">{sup}</span>
              </label>
            ))
          )}
        </div>
      )}

      {showShopPanel && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[220px] max-h-72 overflow-auto">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <span className="text-xs text-gray-500">选择店铺（{availableShops.length}）</span>
            <div className="flex gap-2">
              <button onClick={selectAllShops} className="text-xs text-primary hover:underline">全选</button>
              <button onClick={clearShops} className="text-xs text-gray-400 hover:underline">清空</button>
            </div>
          </div>
          {availableShops.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">无可选店铺</p>
          ) : (
            availableShops.map(shop => (
              <label key={shop} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedShops.includes(shop)}
                  onChange={() => toggleShop(shop)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-sm text-gray-700">{shop}</span>
              </label>
            ))
          )}
        </div>
      )}

      {showWarehousePanel && hasWarehouseType && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <span className="text-xs text-gray-500">仓库类别</span>
            <div className="flex gap-2">
              <button onClick={() => { setSelectedWarehouses([...availableWarehouses]); }} className="text-xs text-primary hover:underline">全选</button>
              <button onClick={() => { setSelectedWarehouses([]); }} className="text-xs text-gray-400 hover:underline">清空</button>
            </div>
          </div>
          {availableWarehouses.map(wh => (
            <label key={wh} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
              <input type="checkbox" checked={selectedWarehouses.includes(wh)}
                onChange={() => setSelectedWarehouses(prev => prev.includes(wh) ? prev.filter(w => w !== wh) : [...prev, wh])}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-gray-700">{wh}</span>
            </label>
          ))}
        </div>
      )}

      {showDistrictManagerPanel && hasDistrictManager && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <span className="text-xs text-gray-500">区经</span>
            <div className="flex gap-2">
              <button onClick={() => { setSelectedDistrictManagers([...availableDistrictManagers]); }} className="text-xs text-primary hover:underline">全选</button>
              <button onClick={() => { setSelectedDistrictManagers([]); }} className="text-xs text-gray-400 hover:underline">清空</button>
            </div>
          </div>
          {availableDistrictManagers.map(dm => (
            <label key={dm} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
              <input type="checkbox" checked={selectedDistrictManagers.includes(dm)}
                onChange={() => { toggleDistrictManager(dm); setShowDistrictManagerPanel(false); }}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-gray-700">{dm}</span>
            </label>
          ))}
        </div>
      )}

      {showDealerPanel && hasDealer && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <span className="text-xs text-gray-500">经销商</span>
            <div className="flex gap-2">
              <button onClick={() => { setSelectedDealers([...availableDealers]); }} className="text-xs text-primary hover:underline">全选</button>
              <button onClick={() => { setSelectedDealers([]); }} className="text-xs text-gray-400 hover:underline">清空</button>
            </div>
          </div>
          {availableDealers.map(dl => (
            <label key={dl} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
              <input type="checkbox" checked={selectedDealers.includes(dl)}
                onChange={() => { toggleDealer(dl); setShowDealerPanel(false); }}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-gray-700">{dl}</span>
            </label>
          ))}
        </div>
      )}

      {showMonthComparablePanel && hasMonthComparable && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <span className="text-xs text-gray-500">月可比性（{availableMonthComparables.length}）</span>
            <div className="flex gap-2">
              <button onClick={() => { setSelectedMonthComparables([...availableMonthComparables]); }} className="text-xs text-primary hover:underline">全选</button>
              <button onClick={() => { setSelectedMonthComparables([]); }} className="text-xs text-gray-400 hover:underline">清空</button>
            </div>
          </div>
          {availableMonthComparables.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">无可选</p>
          ) : availableMonthComparables.map(v => (
            <label key={v} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
              <input type="checkbox" checked={selectedMonthComparables.includes(v)}
                onChange={() => toggleMonthComparable(v)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-gray-700">{v}</span>
            </label>
          ))}
        </div>
      )}

      {showYearComparablePanel && hasYearComparable && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
            <span className="text-xs text-gray-500">年可比性（{availableYearComparables.length}）</span>
            <div className="flex gap-2">
              <button onClick={() => { setSelectedYearComparables([...availableYearComparables]); }} className="text-xs text-primary hover:underline">全选</button>
              <button onClick={() => { setSelectedYearComparables([]); }} className="text-xs text-gray-400 hover:underline">清空</button>
            </div>
          </div>
          {availableYearComparables.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">无可选</p>
          ) : availableYearComparables.map(v => (
            <label key={v} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
              <input type="checkbox" checked={selectedYearComparables.includes(v)}
                onChange={() => toggleYearComparable(v)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-gray-700">{v}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
