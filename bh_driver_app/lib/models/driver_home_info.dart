/// 오늘의 근무 상태
enum WorkStatus {
  beforeWork, // 출근 전
  working, // 운행 중 (출근 완료, 퇴근 전)
  done, // 퇴근 완료
}

/// 메인 화면에 필요한 정보 묶음.
/// 다음 단계에서 Firestore(Users, Vehicles, DailyLogs)를 읽어 이 객체로 변환합니다.
class DriverHomeInfo {
  const DriverHomeInfo({
    required this.driverName,
    required this.status,
    this.plateNo,
    this.vehicleModel,
    this.routeName,
    this.checkInTime,
    this.startOdometerKm,
    this.drivenKm,
    this.todayFuelCost = 0,
  });

  final String driverName;
  final WorkStatus status;
  final String? plateNo; // null이면 배정된 차량 없음
  final String? vehicleModel;
  final String? routeName;
  final String? checkInTime; // 예: "07:52"
  final int? startOdometerKm;
  final int? drivenKm;
  final int todayFuelCost;

  bool get hasVehicle => plateNo != null;

  DriverHomeInfo copyWith({
    WorkStatus? status,
    String? checkInTime,
    int? startOdometerKm,
    int? drivenKm,
    int? todayFuelCost,
  }) {
    return DriverHomeInfo(
      driverName: driverName,
      status: status ?? this.status,
      plateNo: plateNo,
      vehicleModel: vehicleModel,
      routeName: routeName,
      checkInTime: checkInTime ?? this.checkInTime,
      startOdometerKm: startOdometerKm ?? this.startOdometerKm,
      drivenKm: drivenKm ?? this.drivenKm,
      todayFuelCost: todayFuelCost ?? this.todayFuelCost,
    );
  }
}
