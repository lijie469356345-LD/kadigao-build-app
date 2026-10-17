export interface User {
  id?: number;
  userCode: string;
  userName: string;
  phone: string;
  password?: string;
  isAdmin?: string;
  lastLogin?: Date | null;
  groupId?: number;
  groupName?: string;
  createdAt?: Date;
  updatedAt?: Date;
  status?: string;
  roleId?: number | null;
  roleCode?: string | null;
  roleName?: string | null;
  roleIds?: number[] | null;
  roleCodes?: string[] | null;
  roleNames?: string[] | null;
  orgId?: number | null;
  orgName?: string | null;
  orgIds?: number[] | null;
  dataScope?: number | null;
  token?: string;
  [key: string]: any;
}

export interface UserGroup {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Shop {
  id?: number;
  shopCode?: string;
  shopName: string;
  warehouseType?: string;
  area?: string;
  districtManager?: string;
  supervisor?: string;
  product?: string;
  productLeader?: string;
  contactPerson?: string;
  phone?: string;
  dealer?: string;
  openDate?: string;
  monthComparable?: string;
  yearComparable?: string;
}

export interface Permission {
  groupId: number;
  shopId: number;
}

export interface SalesReport {
  shopName: string;
  area?: string;
  districtManager: string;
  supervisor: string;
  target: number;
  amount: number;
  sameAmount?: number;
  achievement: number;
  timeProgress?: number;
  quantity: number;
  orderCount?: number;
  avgOrderValue: number;
  avgItemPrice: number;
  attachmentRate: number;
  giftPackageCount: number;
  giftPackageAmount: number;
  date?: string;
  warehouseType?: string;
  dealer?: string;
  newMemberCount?: number;
  mainProductCount?: number;
  oldMemberAmount?: number;
  birthMemberAmount?: number;
  monthComparable?: string;
  yearComparable?: string;
}

export interface CompareReport {
  shopName: string;
  area?: string;
  districtManager: string;
  supervisor: string;
  today: SalesReport;
  yesterday: SalesReport;
  lastWeek: SalesReport;
  currentAmount?: number;
  lastAmount?: number;
  todayDayOfWeek?: string;
  lastWeekDayOfWeek?: string;
}

export interface LogItem {
  id: number;
  supervisor: string;
  date: string;
  departure: string;
  destination: string;
  area?: string;
  arrivalTime: string;
  departureTime: string;
  content?: LogContent;
  remarks: string;
  signature: string;
  userId: number;
  userName: string;
  status?: 'draft' | 'submitted' | 'voided';
  createdAt: Date;
  shareToAll?: boolean;
  checkInPhoto?: string | null;
  checkOutPhoto?: string | null;
}

export interface LogContent {
  coreItems: LogModule[];
  shopIssues: LogModule[];
  competitorInfo: LogModule[];
  marketChanges: LogModule[];
  marketResearch: LogModule[];
  staffCollection: LogModule[];
  teachingTraining: LogModule[];
}

export interface LogModule {
  items: LogSubItem[];
}

export interface LogSubItem {
  item: string;
  result: string;
  photo: string | null;
  photoName: string | null;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isLoggedIn: boolean;
}

export interface InspectionTask {
  id?: number;
  title: string;
  description?: string;
  assignedTo: string;
  assignedToName: string;
  shops: string[];
  shopNames: string[];
  deadline: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdBy?: number | string;
  createdByName?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DailyScore {
  id?: number;
  userId: string;
  userName: string;
  date: string;
  salesGrowthScore: number;
  quantityGrowthScore: number;
  orderCountGrowthScore: number;
  avgOrderValueGrowthScore: number;
  avgItemPriceGrowthScore: number;
  attachmentRateGrowthScore: number;
  giftPackageCountGrowthScore: number;
  giftPackageAmountGrowthScore: number;
  totalScore: number;
  finalScore: number;
  createdAt?: Date;
}

export interface DayComparison {
  date: string;
  dayOfWeek: string;
  shopName: string;
  districtManager: string;
  supervisor: string;
  amount: number;
  quantity: number;
  orderCount: number;
  avgOrderValue: number;
  avgItemPrice: number;
  attachmentRate: number;
  giftPackageCount: number;
  giftPackageAmount: number;
  target: number;
  achievement: number;
  score: number;
  amountGrowth?: number;
  quantityGrowth?: number;
  scoreGrowth?: number;
  amountWeekGrowth?: number;
  quantityWeekGrowth?: number;
}

export interface ShopDiagnosis {
  supervisor: string;
  districtManager: string;
  dealer: string;
  shopName: string;
  area?: string;
  warehouseType?: string;
  // 业绩金额
  currentAmount: number; momAmount: number; yearAmount: number;
  // 销量
  currentQuantity: number; momQuantity: number; yearQuantity: number;
  // 连带率
  currentAttachmentRate: number; momAttachmentRate: number; yearAttachmentRate: number;
  // 开单数
  currentOrderCount: number; momOrderCount: number; yearOrderCount: number;
  // 件单价
  currentAvgItemPrice: number; momAvgItemPrice: number; yearAvgItemPrice: number;
  // 客单价
  currentAvgOrderValue: number; momAvgOrderValue: number; yearAvgOrderValue: number;
  // 礼包数
  currentGiftCount: number; momGiftCount: number; yearGiftCount: number;
  // 礼包额
  currentGiftAmount: number; momGiftAmount: number; yearGiftAmount: number;
  // 礼包占比
  currentGiftRatio: number; momGiftRatio: number; yearGiftRatio: number;
  // 新增会员
  currentNewMember: number; momNewMember: number; yearNewMember: number;
  // 会员贡献（老会员贡献金额）
  currentMemberContribution: number; momMemberContribution: number; yearMemberContribution: number;
  // 会员贡献占比（会员贡献/业绩）
  currentMemberContributionRatio: number; momMemberContributionRatio: number; yearMemberContributionRatio: number;
  monthComparable?: string;
  yearComparable?: string;
}

export interface StaffSalesTarget {
  shopName: string;
  staffName: string;
  districtManager: string;
  supervisor: string;
  area?: string;
  target: number;
  achieved: number;
  achievement?: number;
  quantity: number;
  orderCount: number;
  avgOrderValue: number;
  avgItemPrice: number;
  attachmentRate: number;
  giftPackageCount: number;
  giftPackageAmount: number;
  timeProgress?: number;
  warehouseType?: string;
  dealer?: string;
  monthComparable?: string;
  yearComparable?: string;
}

export interface FeedbackItem {
  id: string;
  type: 'text' | 'choice' | 'tf'; // 问答题 | 选择题 | 判断题
  question: string;
  options?: string[];              // 选择题选项（如 ["A.xxx", "B.xxx"]）或判断题 ["正确","错误"]
  requiredAnswer?: string;
}

export interface FeedbackAnswerItem {
  itemId: string;
  question: string;
  answer: string;
}

export interface FeedbackTask {
  id?: number;
  taskNo: string;
  title: string;
  remark: string;
  startTime: string;
  endTime: string;
  items: FeedbackItem[];
  status: 'draft' | 'running' | 'submitted' | 'closed';
  hideDefaultDetail?: boolean;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FeedbackDetail {
  id?: number;
  detailNo: string;
  taskId: number;
  taskNo: string;
  taskTitle: string;
  userName: string;
  shopName: string;
  phone: string;
  answers: FeedbackAnswerItem[];
  signature: string;
  remark?: string;
  isDefault?: boolean;
  status: 'draft' | 'submitted';
  startTime?: string;
  endTime?: string;
  createdAt?: string;
  updatedAt?: string;
}
