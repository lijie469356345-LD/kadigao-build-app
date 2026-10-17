import { create } from 'zustand';

interface StaffSalesFilter {
  dateRange: string;
  filterType: string;
  selectedSupervisor: string;
  selectedShop: string;
}

interface FilterStore {
  staffSalesFilter: StaffSalesFilter;
  setStaffSalesFilter: (filter: Partial<StaffSalesFilter>) => void;
  resetStaffSalesFilter: () => void;
}

export const useFilterStore = create<FilterStore>((set) => ({
  staffSalesFilter: {
    dateRange: 'month',
    filterType: 'all',
    selectedSupervisor: 'all',
    selectedShop: 'all',
  },
  
  setStaffSalesFilter: (filter) => set((state) => ({
    staffSalesFilter: {
      ...state.staffSalesFilter,
      ...filter,
    },
  })),
  
  resetStaffSalesFilter: () => set({
    staffSalesFilter: {
      dateRange: 'month',
      filterType: 'all',
      selectedSupervisor: 'all',
      selectedShop: 'all',
    },
  }),
}));