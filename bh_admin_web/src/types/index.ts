export interface UserProfile {
  id: string;
  role: 'driver' | 'admin';
  driverCode?: string;
  name: string;
  phone: string;
  assignedVehicleId: string | null;
  defaultRouteId: string | null;
  hireDate?: string;
  mustChangePassword?: boolean;
  isActive: boolean;
}

export interface Vehicle {
  id: string;
  plateNo: string;
  manufacturer: string;
  model: string;
  modelYear: number;
  odometerKm: number;
  fuelEfficiencyKmPerL?: number;
  status: 'driving' | 'idle' | 'maintenance';
  assignedDriverId: string | null;
  assignedDriverName: string | null;
  lastInspectionDate?: string;
  inspectionDueDate: string;
  parking?: {
    placeName?: string;
    location?: { latitude: number; longitude: number } | null;
    photoPath?: string;
    recordedAt?: unknown;
    recordedBy?: string;
  };
  openMaintenanceCount: number;
  isActive: boolean;
}

export interface RouteItem {
  id: string;
  name: string;
  stops: string[];
  price: number;
  expectedKm: number;
  kmTolerancePct: number;
  isActive: boolean;
  sortOrder: number;
}

export interface DailyLog {
  id: string;
  workDate: string;
  yearMonth: string;
  status: 'in_progress' | 'completed' | 'void';
  driverId: string;
  driverName: string;
  vehicleId: string;
  plateNo: string;
  routeId: string;
  routeName: string;
  routePrice: number;
  expectedKm: number;
  startOdometerKm: number;
  endOdometerKm?: number;
  prevEndOdometerKm?: number;
  offDutyKm?: number;
  drivenKm?: number;
  gpsDrivenKm?: number;
  workDurationMinutes?: number;
  estimatedFuelLiters?: number;
  estimatedFuelCost?: number;
  startAddress?: string;
  endAddress?: string;
  kmCheck?: 'ok' | 'low' | 'high';
  hasIssue: boolean;
  startNote?: string;
  endNote?: string;
  adjustedBy?: string;
  adjustedAt?: unknown;
  adjustReason?: string;
}
