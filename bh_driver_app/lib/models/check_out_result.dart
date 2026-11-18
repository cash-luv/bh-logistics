/// 퇴근 시 특이사항 종류
enum CheckOutNoteType {
  none, // 이상 없음
  repaired, // 수리했어요
  needsRepair, // 수리가 필요해요
}

/// 퇴근 / 빠른 보고 화면이 완료될 때 돌려주는 결과입니다.
/// 필드와 개념은 docs/firestore_schema.md의 DailyLogs 구조와 맞췄습니다.
class CheckOutResult {
  const CheckOutResult({
    required this.endOdometerKm,
    required this.dashboardPhotoPath,
    required this.noteType,
    required this.note,
    required this.drivenKm,
    this.latitude,
    this.longitude,
    this.accuracyM,
  });

  /// 퇴근 시점 계기판 주행거리 (km 정수)
  final int endOdometerKm;

  /// 촬영한 계기판 사진의 기기 내 임시 파일 경로
  final String dashboardPhotoPath;

  /// 퇴근 위치 위도 (위치를 못 가져왔으면 null)
  final double? latitude;

  /// 퇴근 위치 경도 (위치를 못 가져왔으면 null)
  final double? longitude;

  /// 위치 정확도 미터 단위 (없으면 null)
  final double? accuracyM;

  /// 기사님이 선택한 특이사항 종류 (이상 없음 / 수리했어요 / 수리가 필요해요)
  final CheckOutNoteType noteType;

  /// 직접 입력한 짧은 메모 (없으면 빈 문자열)
  final String note;

  /// 오늘 운행한 거리 (= 종료 주행거리 - 출근 주행거리)
  final int drivenKm;
}
