/// 출근 / 차량 점검 화면이 완료될 때 돌려주는 결과입니다.
/// 필드와 키 이름은 docs/firestore_schema.md의 DailyLogs 구조와 맞췄습니다.
class CheckInResult {
  const CheckInResult({
    required this.startOdometerKm,
    required this.photoPaths,
    required this.checklist,
  });

  /// 출근 시점 계기판 주행거리 (km 정수)
  final int startOdometerKm;

  /// 촬영한 사진의 기기 내 임시 파일 경로
  /// 키: 'exterior'(차량 외부), 'interior'(차량 내부), 'dashboard'(계기판)
  final Map<String, String> photoPaths;

  /// 차량 점검 결과
  /// 키: 'tirePressure'(타이어 공기압), 'ureaLevel'(요소수), 'fuelLevel'(연료)
  /// 값: 'ok'(정상) 또는 'warn'(확인 필요)
  final Map<String, String> checklist;

  /// 점검 항목 중 하나라도 'warn'(확인 필요)이 있으면 true
  bool get hasIssue => checklist.values.any((v) => v == 'warn');
}
