import {
  collection,
  doc,
  getDocs,
  writeBatch,
  GeoPoint,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { todayKstStr } from '../utils/format';

export async function seedSampleData(yearMonth) {
  const batch = writeBatch(db);
  const today = todayKstStr();

  const existingRoutesSnap = await getDocs(collection(db, 'Routes'));
  existingRoutesSnap.docs.forEach((d) => {
    if (
      ![
        'route_dj_yi_gj',
        'route_paikdabang',
        'route_kyochon',
        'route_b2b',
      ].includes(d.id)
    ) {
      batch.delete(doc(db, 'Routes', d.id));
    }
  });

  const sampleRoutes = [
    {
      id: 'route_dj_yi_gj',
      name: '대전–용인–곤지암–용인–대전 (대형 고정)',
      stops: ['대전', '용인', '곤지암', '용인', '대전'],
      price: 530000,
      expectedKm: 380,
      isVariableKm: false,
      kmTolerancePct: 15,
      sortOrder: 1,
    },
    {
      id: 'route_paikdabang',
      name: '빽다방',
      stops: ['센터 상차', '가맹점 납품', '복귀'],
      price: 0,
      expectedKm: 0,
      isVariableKm: true,
      kmTolerancePct: 100,
      sortOrder: 2,
    },
    {
      id: 'route_kyochon',
      name: '교촌',
      stops: ['센터 상차', '가맹점 납품', '복귀'],
      price: 0,
      expectedKm: 0,
      isVariableKm: true,
      kmTolerancePct: 100,
      sortOrder: 3,
    },
    {
      id: 'route_b2b',
      name: 'B2B (가게 납품)',
      stops: ['물류센터', '거래처 매장 납품', '복귀'],
      price: 0,
      expectedKm: 0,
      isVariableKm: true,
      kmTolerancePct: 100,
      sortOrder: 4,
    },
  ];
  for (const r of sampleRoutes) {
    batch.set(
      doc(db, 'Routes', r.id),
      { ...r, isActive: true, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  const sampleVehicles = [
    {
      id: 'veh_001',
      plateNo: '84바 3021',
      manufacturer: '현대',
      model: '마이티',
      modelYear: 2021,
      odometerKm: 183420,
      fuelEfficiencyKmPerL: 5.5,
      status: 'idle',
      assignedDriverId: 'driver_kim',
      assignedDriverName: '김민수',
      lastInspectionDate: '2025-12-20',
      inspectionDueDate: '2026-12-05',
      openMaintenanceCount: 1,
      parking: {
        placeName: '대전광역시 대덕구 신탄진동',
        location: new GeoPoint(36.4465, 127.4284),
        recordedAt: serverTimestamp(),
        recordedBy: 'driver_kim',
      },
    },
    {
      id: 'veh_002',
      plateNo: '82가 7781',
      manufacturer: '현대',
      model: '메가트럭',
      modelYear: 2022,
      odometerKm: 142890,
      fuelEfficiencyKmPerL: 4.8,
      status: 'driving',
      assignedDriverId: 'driver_park',
      assignedDriverName: '박철수',
      lastInspectionDate: '2026-02-10',
      inspectionDueDate: '2027-02-10',
      openMaintenanceCount: 0,
      parking: {
        placeName: '경기도 용인시 처인구 양지면',
        location: new GeoPoint(37.2345, 127.2872),
        recordedAt: serverTimestamp(),
        recordedBy: 'driver_park',
      },
    },
    {
      id: 'veh_003',
      plateNo: '91나 4510',
      manufacturer: '타타대우',
      model: '더쎈',
      modelYear: 2023,
      odometerKm: 88320,
      fuelEfficiencyKmPerL: 5.2,
      status: 'idle',
      assignedDriverId: 'driver_lee',
      assignedDriverName: '이영호',
      lastInspectionDate: '2025-11-28',
      inspectionDueDate: '2026-11-28',
      openMaintenanceCount: 1,
      parking: {
        placeName: '대전광역시 유성구 관평동',
        location: new GeoPoint(36.4231, 127.3921),
        recordedAt: serverTimestamp(),
        recordedBy: 'driver_lee',
      },
    },
    {
      id: 'veh_004',
      plateNo: '88다 1190',
      manufacturer: '현대',
      model: '파비스',
      modelYear: 2023,
      odometerKm: 64100,
      fuelEfficiencyKmPerL: 5.0,
      status: 'idle',
      assignedDriverId: null,
      assignedDriverName: null,
      lastInspectionDate: '2026-05-15',
      inspectionDueDate: '2027-05-15',
      openMaintenanceCount: 0,
      parking: {
        placeName: '대전광역시 대덕구 대화동',
        location: new GeoPoint(36.3698, 127.4125),
        recordedAt: serverTimestamp(),
        recordedBy: 'admin',
      },
    },
  ];
  for (const v of sampleVehicles) {
    batch.set(
      doc(db, 'Vehicles', v.id),
      { ...v, isActive: true, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  const sampleDrivers = [
    {
      id: 'driver_kim',
      driverCode: 'bh01',
      name: '김민수',
      phone: '010-1234-5678',
      hireDate: '2024-03-01',
      assignedVehicleId: 'veh_001',
      defaultRouteId: 'route_dj_yi_gj',
      mustChangePassword: false,
    },
    {
      id: 'driver_park',
      driverCode: 'bh02',
      name: '박철수',
      phone: '010-2345-6789',
      hireDate: '2024-06-15',
      assignedVehicleId: 'veh_002',
      defaultRouteId: 'route_paikdabang',
      mustChangePassword: true,
    },
    {
      id: 'driver_lee',
      driverCode: 'bh03',
      name: '이영호',
      phone: '010-3456-7890',
      hireDate: '2025-01-10',
      assignedVehicleId: 'veh_003',
      defaultRouteId: 'route_kyochon',
      mustChangePassword: false,
    },
  ];
  for (const d of sampleDrivers) {
    batch.set(
      doc(db, 'Users', d.id),
      { ...d, role: 'driver', isActive: true, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  const sampleLogs = [
    {
      workDate: `${yearMonth}-14`,
      driverId: 'driver_kim',
      driverName: '김민수',
      vehicleId: 'veh_001',
      plateNo: '84바 3021',
      routeId: 'route_dj_yi_gj',
      routeName: '대전–용인–곤지암–용인–대전',
      routePrice: 530000,
      expectedKm: 380,
      prevEndOdometerKm: 182200,
      startOdometerKm: 182200,
      endOdometerKm: 182585,
      drivenKm: 385,
      gpsDrivenKm: 383,
      offDutyKm: 0,
      workDurationMinutes: 510,
      estimatedFuelLiters: 70.0,
      estimatedFuelCost: 108500,
      startAddress: '대전광역시 대덕구 신탄진동',
      endAddress: '대전광역시 대덕구 신탄진동',
      endLocation: new GeoPoint(36.4465, 127.4284),
      gpsTimeline: [
        {
          time: '07:50',
          type: '출근 출발',
          address: '대전광역시 대덕구 신탄진동',
          lat: 36.4465,
          lng: 127.4284,
          cumKm: 0,
        },
        {
          time: '09:30',
          type: '운행 경유',
          address: '경기도 용인시 처인구 양지면',
          lat: 37.2345,
          lng: 127.2872,
          cumKm: 112,
        },
        {
          time: '11:15',
          type: '운행 경유',
          address: '경기도 광주시 곤지암읍',
          lat: 37.3514,
          lng: 127.3401,
          cumKm: 192,
        },
        {
          time: '14:20',
          type: '운행 경유',
          address: '경기도 용인시 기흥구 고매동',
          lat: 37.2218,
          lng: 127.1052,
          cumKm: 265,
        },
        {
          time: '16:40',
          type: '퇴근 도착',
          address: '대전광역시 대덕구 신탄진동',
          lat: 36.4465,
          lng: 127.4284,
          cumKm: 383,
        },
      ],
      checklist: { tirePressure: 'ok', ureaLevel: 'ok', fuelLevel: 'ok' },
      kmCheck: 'ok',
      hasIssue: false,
      endNote: '',
      status: 'completed',
    },
    {
      workDate: `${yearMonth}-15`,
      driverId: 'driver_kim',
      driverName: '김민수',
      vehicleId: 'veh_001',
      plateNo: '84바 3021',
      routeId: 'route_dj_yi_gj',
      routeName: '대전–용인–곤지암–용인–대전',
      routePrice: 530000,
      expectedKm: 380,
      prevEndOdometerKm: 182585,
      startOdometerKm: 182660,
      endOdometerKm: 183042,
      drivenKm: 382,
      gpsDrivenKm: 380,
      offDutyKm: 75,
      workDurationMinutes: 495,
      estimatedFuelLiters: 69.5,
      estimatedFuelCost: 107725,
      startAddress: '충청남도 공주시 반포면',
      endAddress: '대전광역시 대덕구 신탄진동',
      endLocation: new GeoPoint(36.4465, 127.4284),
      checklist: { tirePressure: 'ok', ureaLevel: 'warn', fuelLevel: 'ok' },
      kmCheck: 'ok',
      hasIssue: true,
      endNote: '[수리 필요] 우측 후미등 깜빡거림',
      status: 'completed',
    },
    {
      workDate: today,
      driverId: 'driver_park',
      driverName: '박철수',
      vehicleId: 'veh_002',
      plateNo: '82가 7781',
      routeId: 'route_paikdabang',
      routeName: '빽다방',
      routePrice: 0,
      expectedKm: 0,
      prevEndOdometerKm: 142595,
      startOdometerKm: 142595,
      offDutyKm: 0,
      startAddress: '대전광역시 대덕구 대화동',
      checklist: { tirePressure: 'ok', ureaLevel: 'ok', fuelLevel: 'ok' },
      kmCheck: 'ok',
      hasIssue: false,
      endNote: '',
      status: 'in_progress',
    },
    {
      workDate: `${yearMonth}-16`,
      driverId: 'driver_lee',
      driverName: '이영호',
      vehicleId: 'veh_003',
      plateNo: '91나 4510',
      routeId: 'route_kyochon',
      routeName: '교촌',
      routePrice: 0,
      expectedKm: 168,
      prevEndOdometerKm: 88110,
      startOdometerKm: 88152,
      endOdometerKm: 88320,
      drivenKm: 168,
      gpsDrivenKm: 165,
      offDutyKm: 42,
      workDurationMinutes: 420,
      estimatedFuelLiters: 32.3,
      estimatedFuelCost: 50065,
      startAddress: '대전광역시 서구 둔산동',
      endAddress: '대전광역시 유성구 관평동',
      endLocation: new GeoPoint(36.4231, 127.3921),
      checklist: { tirePressure: 'warn', ureaLevel: 'ok', fuelLevel: 'ok' },
      kmCheck: 'ok',
      hasIssue: true,
      endNote: '[수리 완료] 요소수 20L 보충 완료',
      status: 'completed',
    },
  ];

  for (const l of sampleLogs) {
    const docId = `${l.workDate}_${l.driverId}`;
    batch.set(
      doc(db, 'DailyLogs', docId),
      {
        ...l,
        yearMonth: l.workDate.slice(0, 7),
        checkInAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  batch.set(doc(db, 'Maintenance', 'sample_maint_1'), {
    vehicleId: 'veh_001',
    plateNo: '84바 3021',
    category: 'other',
    title: '우측 후미등 깜빡거림 점검',
    status: 'planned',
    yearMonth,
    odometerKm: 183042,
    dueOdometerKm: 184000,
    cost: 0,
    source: 'driver_checkout',
    reportedByName: '김민수',
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'Maintenance', 'sample_maint_2'), {
    vehicleId: 'veh_003',
    plateNo: '91나 4510',
    category: 'tire',
    title: '타이어 공기압 점검 필요',
    status: 'planned',
    yearMonth,
    odometerKm: 88320,
    dueOdometerKm: 89000,
    cost: 0,
    source: 'checklist_auto',
    reportedByName: '이영호',
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}
