import { create } from 'zustand';

export type ModuleType = 'system' | 'baseInfo' | 'attendance' | 'payroll' | 'dashboard' | 'inspection' | 'sales' | 'purchase' | 'staffChannel' | 'automation' | 'coaching' | 'directSales' | 'reimbursement' | 'pk' | 'financial' | 'score' | 'warehouse' | 'xixie' | 'douyin' | 'asset' | 'growthClassroom' | null;

interface ModuleStore {
  currentModule: ModuleType;
  setModule: (module: ModuleType) => void;
  clearModule: () => void;
}

export const useModuleStore = create<ModuleStore>((set) => ({
  currentModule: null,
  
  setModule: (module) => set({ currentModule: module }),
  
  clearModule: () => set({ currentModule: null }),
}));
