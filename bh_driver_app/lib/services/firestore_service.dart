import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/check_in_result.dart';
import '../models/check_out_result.dart';
import '../models/driver_home_info.dart';
import 'gps_tracker_service.dart';
import 'storage_service.dart';

/// Firestore 읽기·쓰기 전담 서비스 (기준: docs/firestore_schema.md)
class FirestoreService {
  FirestoreService._();

  static final FirebaseFirestore _db = FirebaseFirestore.instance;

  /// 한국 시간(KST, UTC+9) 기준 현재 시각을 돌려줍니다.
  static DateTime nowKst() {
    return DateTime.now().toUtc().add(const Duration(hours: 9));
  }

  /// 한국 시간 기준 YYYY-MM-DD 문자열
  static String todayWorkDate() {
    final kst = nowKst();
    final y = kst.year.toString().padLeft(4, '0');
    final m = kst.month.toString().padLeft(2, '0');
    final d = kst.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  /// 한국 시간 기준 YYYY-MM 문자열
  static String todayYearMonth() {
    final kst = nowKst();
    final y = kst.year.toString().padLeft(4, '0');
    final m = kst.month.toString().padLeft(2, '0');
    return '$y-$m';
  }

  /// DailyLogs 문서 ID: {workDate}_{driverId}
  static String todayDailyLogId(String driverId) {
    return '${todayWorkDate()}_$driverId';
  }

  /// Timestamp를 한국 시간 HH:MM 문자열로 변환합니다.
  static String formatKstHm(Timestamp? ts) {
    if (ts == null) return '';
    final kst = ts.toDate().toUtc().add(const Duration(hours: 9));
    final hh = kst.hour.toString().padLeft(2, '0');
    final mm = kst.minute.toString().padLeft(2, '0');
    return '$hh:$mm';
  }

  /// 앱을 껐다 켜도 오늘의 근무 상태(출근 전 / 운행 중 / 퇴근 완료)를
  /// DailyLogs/{workDate}_{driverId}에서 읽어 복원합니다.
  /// 운행 중 상태라면 백그라운드 GPS 누적 추적도 자동으로 다시 이어갑니다.
  static Future<DriverHomeInfo> restoreTodayStatus({
    required String driverId,
    required DriverHomeInfo baseInfo,
  }) async {
    final workDate = todayWorkDate();
    final docId = '${workDate}_$driverId';
    final doc = await _db.collection('DailyLogs').doc(docId).get();

    if (!doc.exists) {
      return baseInfo.copyWith(status: WorkStatus.beforeWork);
    }

    final data = doc.data() ?? {};
    final statusStr = (data['status'] as String?) ?? 'in_progress';
    final startKm = (data['startOdometerKm'] as num?)?.toInt();
    final drivenKm = (data['drivenKm'] as num?)?.toInt();
    final actualFuelCost = (data['actualFuelCost'] as num?)?.toInt() ?? 0;
    final checkInAt = data['checkInAt'] as Timestamp?;
    final checkInTime = formatKstHm(checkInAt);

    if (statusStr == 'completed') {
      return baseInfo.copyWith(
        status: WorkStatus.done,
        checkInTime: checkInTime.isEmpty ? null : checkInTime,
        startOdometerKm: startKm,
        drivenKm: drivenKm ?? 0,
        todayFuelCost: actualFuelCost,
      );
    }

    // 운행 중이면 GPS 이동거리 누적을 계속 이어갑니다.
    await GpsTrackerService.startTrackingForToday(workDate);

    return baseInfo.copyWith(
      status: WorkStatus.working,
      checkInTime: checkInTime.isEmpty ? null : checkInTime,
      startOdometerKm: startKm,
      todayFuelCost: actualFuelCost,
    );
  }

  /// 출근 점검 완료 시 저장 (WriteBatch)
  /// 관리자 분석용(기사님 화면엔 안 보임):
  /// - prevEndOdometerKm: 직전 퇴근 시 차량 계기판 km
  /// - offDutyKm: 직전 퇴근 ~ 오늘 출근 사이에 비업무(개인 용도)로 늘어난 km
  /// - startLocation / startLocationAccuracyM: 출근 버튼 누른 시점의 GPS 위치
  static Future<DriverHomeInfo> saveCheckIn({
    required String driverId,
    required CheckInResult result,
    required DriverHomeInfo currentHomeInfo,
    void Function(String stepMessage)? onProgress,
  }) async {
    final workDate = todayWorkDate();
    final yearMonth = todayYearMonth();
    final docId = '${workDate}_$driverId';

    final dailyLogRef = _db.collection('DailyLogs').doc(docId);

    final existing = await dailyLogRef.get();
    if (existing.exists) {
      return restoreTodayStatus(
        driverId: driverId,
        baseInfo: currentHomeInfo,
      );
    }

    onProgress?.call('차량·노선 정보를 확인하는 중...');

    final userSnap = await _db.collection('Users').doc(driverId).get();
    final userData = userSnap.data() ?? {};
    final driverName =
        (userData['name'] as String?) ?? currentHomeInfo.driverName;
    final vehicleId = (userData['assignedVehicleId'] as String?) ?? '';
    final routeId = (userData['defaultRouteId'] as String?) ?? '';

    String plateNo = currentHomeInfo.plateNo ?? '';
    int openMaintenanceCount = 0;
    int? prevEndOdometerKm;
    bool hasRealPreviousCheckOut = false;
    double fuelEfficiencyKmPerL = 5.5; // 화물차 기본 연비(km/L), 차량 문서에 있으면 그 값 사용

    if (vehicleId.isNotEmpty) {
      final vehSnap = await _db.collection('Vehicles').doc(vehicleId).get();
      final vehData = vehSnap.data() ?? {};
      plateNo = (vehData['plateNo'] as String?) ?? plateNo;
      openMaintenanceCount =
          (vehData['openMaintenanceCount'] as num?)?.toInt() ?? 0;
      prevEndOdometerKm = (vehData['odometerKm'] as num?)?.toInt();
      // 실제 퇴근(parking.recordedAt)으로 기록된 적이 있는 주행거리인지 확인
      final parking = vehData['parking'] as Map<String, dynamic>?;
      hasRealPreviousCheckOut = parking != null && parking['recordedAt'] != null;
      final customEff = (vehData['fuelEfficiencyKmPerL'] as num?)?.toDouble();
      if (customEff != null && customEff > 0) {
        fuelEfficiencyKmPerL = customEff;
      }
    }

    // 직전 퇴근 후 오늘 출근 전까지 비업무로 이동한 거리(offDutyKm) 계산
    // 단, 첫 차량 등록 초기값과의 큰 차이(2,000km 초과 점프)나 이전 퇴근 기록이 없는 경우는 0km로 처리
    int offDutyKm = 0;
    if (hasRealPreviousCheckOut &&
        prevEndOdometerKm != null &&
        prevEndOdometerKm > 0 &&
        result.startOdometerKm > prevEndOdometerKm) {
      final diff = result.startOdometerKm - prevEndOdometerKm;
      if (diff <= 2000) {
        offDutyKm = diff;
      }
    }

    String routeName = currentHomeInfo.routeName ?? '';
    int routePrice = 0;
    int expectedKm = 0;
    if (routeId.isNotEmpty) {
      final routeSnap = await _db.collection('Routes').doc(routeId).get();
      final routeData = routeSnap.data() ?? {};
      routeName = (routeData['name'] as String?) ?? routeName;
      routePrice = (routeData['price'] as num?)?.toInt() ?? 0;
      expectedKm = (routeData['expectedKm'] as num?)?.toInt() ?? 0;
    }

    // 출근 시점 GPS 위치를 조용히 1회 측정 (실패해도 출근은 그대로 진행)
    final startPos = await GpsTrackerService.tryGetSilentCurrentPosition();
    final GeoPoint? startGeoPoint = startPos != null
        ? GeoPoint(startPos.latitude, startPos.longitude)
        : null;
    final String startAddress = await GpsTrackerService.resolveKoreanAddress(
      latitude: startPos?.latitude,
      longitude: startPos?.longitude,
    );

    final startPhotos = await StorageService.uploadCheckInPhotos(
      yearMonth: yearMonth,
      dailyLogId: docId,
      localPhotoPaths: result.photoPaths,
      onProgress: (completed, total) {
        onProgress?.call('사진 올리는 중 ($completed/$total장)...');
      },
    );

    onProgress?.call('출근 기록을 저장하는 중...');

    final batch = _db.batch();

    batch.set(dailyLogRef, {
      'workDate': workDate,
      'yearMonth': yearMonth,
      'status': 'in_progress',
      'driverId': driverId,
      'driverName': driverName,
      'vehicleId': vehicleId,
      'plateNo': plateNo,
      'routeId': routeId,
      'routeName': routeName,
      'routePrice': routePrice,
      'expectedKm': expectedKm,
      'fuelEfficiencyKmPerL': fuelEfficiencyKmPerL,
      'checkInAt': FieldValue.serverTimestamp(),
      'startOdometerKm': result.startOdometerKm,
      'prevEndOdometerKm': prevEndOdometerKm,
      'offDutyKm': offDutyKm,
      'startLocation': startGeoPoint,
      'startAddress': startAddress,
      'startLocationAccuracyM': startPos?.accuracy,
      'startPhotos': startPhotos,
      'checklist': result.checklist,
      'hasIssue': result.hasIssue,
      'startNote': '',
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    int addedMaintenanceCount = 0;
    for (final entry in result.checklist.entries) {
      if (entry.value != 'warn') continue;
      addedMaintenanceCount += 1;

      final (category, title) = switch (entry.key) {
        'tirePressure' => ('tire', '타이어 공기압 점검 필요'),
        'ureaLevel' => ('urea', '요소수 보충·점검 필요'),
        'fuelLevel' => ('other', '연료 상태 확인 필요'),
        _ => ('other', '${entry.key} 점검 필요'),
      };

      final maintRef = _db.collection('Maintenance').doc();
      batch.set(maintRef, {
        'vehicleId': vehicleId,
        'plateNo': plateNo,
        'category': category,
        'title': title,
        'status': 'planned',
        'performedDate': null,
        'yearMonth': yearMonth,
        'odometerKm': result.startOdometerKm,
        'cost': 0,
        'vendor': '',
        'dueDate': null,
        'dueOdometerKm': null,
        'photoPaths': <String>[],
        'source': 'checklist_auto',
        'dailyLogId': docId,
        'reportedBy': driverId,
        'reportedByName': driverName,
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }

    if (vehicleId.isNotEmpty) {
      final vehRef = _db.collection('Vehicles').doc(vehicleId);
      final Map<String, Object?> vehUpdates = {
        'status': 'driving',
        'odometerKm': result.startOdometerKm,
        'odometerUpdatedAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      };
      if (addedMaintenanceCount > 0) {
        vehUpdates['openMaintenanceCount'] =
            openMaintenanceCount + addedMaintenanceCount;
      }
      batch.set(vehRef, vehUpdates, SetOptions(merge: true));
    }

    await batch.commit();

    // 출근 완료 직후부터 휴대폰 내부에서 조용히 GPS 이동거리와 타임라인을 누적합니다 (서버 전송 없음).
    await GpsTrackerService.startTrackingForToday(
      workDate,
      initialLat: startPos?.latitude,
      initialLng: startPos?.longitude,
      initialAddress: startAddress,
      reset: true,
    );

    final kst = nowKst();
    final hh = kst.hour.toString().padLeft(2, '0');
    final mm = kst.minute.toString().padLeft(2, '0');

    return currentHomeInfo.copyWith(
      status: WorkStatus.working,
      checkInTime: '$hh:$mm',
      startOdometerKm: result.startOdometerKm,
    );
  }

  static String _computeKmCheck({
    required int drivenKm,
    required int expectedKm,
    required int tolerancePct,
  }) {
    if (expectedKm <= 0) return 'ok';
    final minKm = expectedKm * (100 - tolerancePct) / 100.0;
    final maxKm = expectedKm * (100 + tolerancePct) / 100.0;
    if (drivenKm < minKm) return 'low';
    if (drivenKm > maxKm) return 'high';
    return 'ok';
  }

  /// 퇴근 완료 시 WriteBatch 하나로 함께 처리 + 관리자용 운행시간·주유량·주유비·GPS 이동거리 자동 산출
  static Future<DriverHomeInfo> saveCheckOut({
    required String driverId,
    required CheckOutResult result,
    required DriverHomeInfo currentHomeInfo,
    bool skipPhotoUpload = false,
    void Function(String stepMessage)? onProgress,
  }) async {
    final workDate = todayWorkDate();
    final yearMonth = todayYearMonth();
    final docId = '${workDate}_$driverId';

    final dailyLogRef = _db.collection('DailyLogs').doc(docId);
    final dailySnap = await dailyLogRef.get();
    final dailyData = dailySnap.data() ?? {};

    String driverName =
        (dailyData['driverName'] as String?) ?? currentHomeInfo.driverName;
    String vehicleId = (dailyData['vehicleId'] as String?) ?? '';
    String plateNo =
        (dailyData['plateNo'] as String?) ?? (currentHomeInfo.plateNo ?? '');
    String routeId = (dailyData['routeId'] as String?) ?? '';
    int expectedKm = (dailyData['expectedKm'] as num?)?.toInt() ?? 0;
    double fuelEfficiencyKmPerL =
        (dailyData['fuelEfficiencyKmPerL'] as num?)?.toDouble() ?? 5.5;
    final Timestamp? checkInTs = dailyData['checkInAt'] as Timestamp?;

    if (vehicleId.isEmpty || routeId.isEmpty) {
      final userSnap = await _db.collection('Users').doc(driverId).get();
      final u = userSnap.data() ?? {};
      if (vehicleId.isEmpty) {
        vehicleId = (u['assignedVehicleId'] as String?) ?? '';
      }
      if (routeId.isEmpty) {
        routeId = (u['defaultRouteId'] as String?) ?? '';
      }
      driverName = (u['name'] as String?) ?? driverName;
    }

    int tolerancePct = 15;
    int dieselPricePerL = 1550; // 기본 경유 단가(원/L), 노선이나 설정에서 덮어쓸 수 있음
    if (routeId.isNotEmpty) {
      final routeSnap = await _db.collection('Routes').doc(routeId).get();
      final r = routeSnap.data() ?? {};
      if (expectedKm <= 0) {
        expectedKm = (r['expectedKm'] as num?)?.toInt() ?? 0;
      }
      tolerancePct = (r['kmTolerancePct'] as num?)?.toInt() ?? 15;
      final customFuelPrice = (r['dieselPricePerL'] as num?)?.toInt();
      if (customFuelPrice != null && customFuelPrice > 0) {
        dieselPricePerL = customFuelPrice;
      }
    }

    int openMaintenanceCount = 0;
    if (vehicleId.isNotEmpty) {
      final vehSnap = await _db.collection('Vehicles').doc(vehicleId).get();
      final v = vehSnap.data() ?? {};
      if (plateNo.isEmpty) {
        plateNo = (v['plateNo'] as String?) ?? '';
      }
      openMaintenanceCount = (v['openMaintenanceCount'] as num?)?.toInt() ?? 0;
    }

    String dashboardStoragePath = '';
    if (!skipPhotoUpload) {
      onProgress?.call('계기판 사진을 올리는 중...');
      dashboardStoragePath = await StorageService.uploadCheckOutDashboardPhoto(
        yearMonth: yearMonth,
        dailyLogId: docId,
        localPhotoPath: result.dashboardPhotoPath,
      );
    }

    onProgress?.call('퇴근 기록을 저장하는 중...');

    final GeoPoint? endGeoPoint =
        (result.latitude != null && result.longitude != null)
            ? GeoPoint(result.latitude!, result.longitude!)
            : null;
    final String endAddress = await GpsTrackerService.resolveKoreanAddress(
      latitude: result.latitude,
      longitude: result.longitude,
    );

    // 1) 휴대폰에서 누적한 실제 GPS 이동거리(km) 및 이동 타임라인 가져오기
    final GeoPoint? savedStartGeo = dailyData['startLocation'] as GeoPoint?;
    final String? savedStartAddr = dailyData['startAddress'] as String?;
    final (int gpsDrivenKm, List<Map<String, dynamic>> gpsTimeline) =
        await GpsTrackerService.stopAndConsumeGpsSession(
      startLat: savedStartGeo?.latitude,
      startLng: savedStartGeo?.longitude,
      startAddress: savedStartAddr,
      startTimeHm: formatKstHm(checkInTs),
      endLat: result.latitude,
      endLng: result.longitude,
      endAddress: endAddress,
    );

    // 2) 실제 총 근무·이동 시간(분) 계산 (checkInAt ~ 현재)
    int workDurationMinutes = 0;
    if (checkInTs != null) {
      final diff = DateTime.now().difference(checkInTs.toDate()).inMinutes;
      if (diff > 0) {
        workDurationMinutes = diff;
      }
    }

    // 3) 예상 주유량(L) 및 예상 주유비(원) 자동 산출
    final double estimatedFuelLiters = fuelEfficiencyKmPerL > 0
        ? double.parse(
            (result.drivenKm / fuelEfficiencyKmPerL).toStringAsFixed(1),
          )
        : 0.0;
    final int estimatedFuelCost =
        (estimatedFuelLiters * dieselPricePerL).round();

    final kmCheck = _computeKmCheck(
      drivenKm: result.drivenKm,
      expectedKm: expectedKm,
      tolerancePct: tolerancePct,
    );

    final String composedNote = switch (result.noteType) {
      CheckOutNoteType.none => result.note,
      CheckOutNoteType.repaired =>
        result.note.isEmpty ? '수리 완료' : '[수리 완료] ${result.note}',
      CheckOutNoteType.needsRepair =>
        result.note.isEmpty ? '수리 필요' : '[수리 필요] ${result.note}',
    };

    final batch = _db.batch();

    // 1. DailyLogs 갱신 (관리자 전용 분석 지표 + GPS 이동 타임라인 포함)
    batch.set(
      dailyLogRef,
      {
        'workDate': workDate,
        'yearMonth': yearMonth,
        'driverId': driverId,
        'driverName': driverName,
        'vehicleId': vehicleId,
        'plateNo': plateNo,
        'checkOutAt': FieldValue.serverTimestamp(),
        'endOdometerKm': result.endOdometerKm,
        'endPhotos': {'dashboard': dashboardStoragePath},
        'endLocation': endGeoPoint,
        'endAddress': endAddress,
        'endLocationAccuracyM': result.accuracyM,
        'endNote': composedNote,
        'drivenKm': result.drivenKm,
        'gpsDrivenKm': gpsDrivenKm,
        'gpsTimeline': gpsTimeline,
        'workDurationMinutes': workDurationMinutes,
        'estimatedFuelLiters': estimatedFuelLiters,
        'estimatedFuelCost': estimatedFuelCost,
        'kmCheck': kmCheck,
        'status': 'completed',
        'updatedAt': FieldValue.serverTimestamp(),
      },
      SetOptions(merge: true),
    );

    // 2. 특이사항에 따른 Maintenance 문서 추가
    int addedPlannedCount = 0;
    if (result.noteType == CheckOutNoteType.needsRepair ||
        result.noteType == CheckOutNoteType.repaired) {
      final isPlanned = result.noteType == CheckOutNoteType.needsRepair;
      if (isPlanned) {
        addedPlannedCount = 1;
      }
      final defaultTitle = isPlanned ? '퇴근 보고: 수리 필요' : '퇴근 보고: 수리 완료';
      final title = result.note.isNotEmpty ? result.note : defaultTitle;

      final maintRef = _db.collection('Maintenance').doc();
      batch.set(maintRef, {
        'vehicleId': vehicleId,
        'plateNo': plateNo,
        'category': 'other',
        'title': title,
        'status': isPlanned ? 'planned' : 'done',
        'performedDate': isPlanned ? null : workDate,
        'yearMonth': yearMonth,
        'odometerKm': result.endOdometerKm,
        'cost': 0,
        'vendor': '',
        'dueDate': null,
        'dueOdometerKm': null,
        'photoPaths': <String>[],
        'source': 'driver_checkout',
        'dailyLogId': docId,
        'reportedBy': driverId,
        'reportedByName': driverName,
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }

    // 3. Vehicles 및 Routes 갱신
    // - Vehicles: odometerKm, odometerUpdatedAt, status: idle, parking
    // - Routes: 빽다방, 교촌, B2B 등 가변 납품 노선은 출퇴근 후 찍힌 실제 운행거리(drivenKm)로 노선 거리(expectedKm)를 자동 산정·갱신합니다.
    if (routeId.isNotEmpty && result.drivenKm > 0 && routeId != 'route_dj_yi_gj') {
      final routeRef = _db.collection('Routes').doc(routeId);
      batch.set(
        routeRef,
        {
          'expectedKm': result.drivenKm,
          'lastActualKm': result.drivenKm,
          'updatedAt': FieldValue.serverTimestamp(),
        },
        SetOptions(merge: true),
      );
    }

    if (vehicleId.isNotEmpty) {
      final vehRef = _db.collection('Vehicles').doc(vehicleId);
      final Map<String, Object?> vehUpdates = {
        'odometerKm': result.endOdometerKm,
        'odometerUpdatedAt': FieldValue.serverTimestamp(),
        'status': 'idle',
        'parking': {
          'placeName': endAddress,
          'location': endGeoPoint,
          'recordedAt': FieldValue.serverTimestamp(),
          'recordedBy': driverId,
        },
        'updatedAt': FieldValue.serverTimestamp(),
      };
      if (addedPlannedCount > 0) {
        vehUpdates['openMaintenanceCount'] =
            openMaintenanceCount + addedPlannedCount;
      }
      batch.set(vehRef, vehUpdates, SetOptions(merge: true));
    }

    await batch.commit();

    return currentHomeInfo.copyWith(
      status: WorkStatus.done,
      drivenKm: result.drivenKm,
    );
  }

  /// 운행 중 주유 영수증 첨부 및 주유카드 결제 금액(기타 품목 포함)을 오늘 DailyLogs에 누적 기록합니다.
  static Future<DriverHomeInfo> saveFuelReceipt({
    required String driverId,
    required String localPhotoPath,
    required int fuelCostWon,
    double? fuelLiters,
    List<Map<String, dynamic>>? extraItems,
    String? extraItemsSummary,
    required DriverHomeInfo currentHomeInfo,
    void Function(String stepMessage)? onProgress,
  }) async {
    final workDate = todayWorkDate();
    final yearMonth = todayYearMonth();
    final docId = '${workDate}_$driverId';

    onProgress?.call('주유 영수증 사진을 올리는 중...');
    final storagePath = await StorageService.uploadFuelReceiptPhoto(
      yearMonth: yearMonth,
      dailyLogId: docId,
      localPhotoPath: localPhotoPath,
    );

    onProgress?.call('주유 내역 및 품목을 기록하는 중...');
    final dailyLogRef = _db.collection('DailyLogs').doc(docId);
    final snap = await dailyLogRef.get();
    final data = snap.data() ?? {};

    final prevCost = (data['actualFuelCost'] as num?)?.toInt() ?? 0;
    final prevLiters = (data['actualFuelLiters'] as num?)?.toDouble() ?? 0.0;
    final newTotalCost = prevCost + fuelCostWon;
    final newTotalLiters = double.parse(
      (prevLiters + (fuelLiters ?? 0.0)).toStringAsFixed(1),
    );

    final kst = nowKst();
    final hh = kst.hour.toString().padLeft(2, '0');
    final mm = kst.minute.toString().padLeft(2, '0');

    final receiptEntry = <String, dynamic>{
      'photoPath': storagePath,
      'amount': fuelCostWon,
      'liters': fuelLiters,
      'recordedAtKst': '$hh:$mm',
      if (extraItems != null && extraItems.isNotEmpty) 'extraItems': extraItems,
      if (extraItemsSummary != null && extraItemsSummary.isNotEmpty)
        'extraItemsSummary': extraItemsSummary,
    };

    await dailyLogRef.set(
      {
        'actualFuelCost': newTotalCost,
        'actualFuelLiters': newTotalLiters,
        'fuelReceipts': FieldValue.arrayUnion([receiptEntry]),
        'updatedAt': FieldValue.serverTimestamp(),
      },
      SetOptions(merge: true),
    );

    return currentHomeInfo.copyWith(todayFuelCost: newTotalCost);
  }
}
