# BH로지스틱스 기사앱: AI 작업 규칙

## 프로젝트
- 기사용 Flutter 앱 (Android, iOS). 백엔드는 Firebase (Firestore, Storage, Auth, 서울 리전).
- 개발자는 1인이고 코딩 경험이 거의 없다. 설명은 쉬운 한국어로 하고, 명령어는 그대로 복사해서 실행할 수 있게 적는다.
- 관리자 웹(React + Vite + Tailwind)은 기사앱이 끝난 뒤 별도 폴더에서 만든다.

## 작업 방식
- 한 번에 화면 하나 또는 기능 하나만 만든다.
- 작업이 끝나면 바뀐 파일 목록과 "실행하면 무엇이 보여야 하는지"를 알려 준다.
- 패키지는 `flutter pub add`로 추가하고 버전을 임의로 고정하지 않는다.
- 에러는 원인과 해결 방법을 쉬운 말로 먼저 설명한 뒤 코드를 고친다.
- 비밀키, 서비스 계정 파일, `google-services.json` 같은 설정 파일 내용을 채팅이나 공개 저장소에 올리지 않는다.

## 기사앱 UI 규칙
- 모든 글씨는 20 이상이다. `lib/theme/app_theme.dart`의 `AppText`를 쓴다.
- 출근 / 차량 점검은 파랑(`AppColors.primary`), 퇴근 / 빠른 보고는 청록(`AppColors.teal`)이다.
- 글자 입력은 최소로 하고 사진 촬영과 큰 버튼 중심으로 만든다.
- 휴대폰 글자 크기를 키워도 화면이 깨지지 않고 스크롤되게 한다.
- 어르신도 알 수 있게 용어는 쉽게 쓴다. (예: "주행거리", "계기판")

## 데이터 규칙 (기준 문서: `docs/firestore_schema.md`)
- 컬렉션은 Users, Vehicles, Routes, DailyLogs, Maintenance, Settlements 6개이고 모두 최상위에 둔다.
- DailyLogs 문서 ID는 `{workDate}_{driverId}`이다. 문서 1개가 엑셀 1행이다.
- `workDate`는 한국 시간 기준 `YYYY-MM-DD`, `yearMonth`는 `YYYY-MM` 문자열로 저장한다.
- 출근할 때 기사 이름, 번호판, 노선명, 노선 단가(`routePrice`)를 DailyLogs에 복사해 저장한다.
- 금액은 원 단위 정수, 거리는 km 정수로 저장한다.
- 사진은 다운로드 URL이 아니라 Storage 경로를 저장한다.
- 퇴근할 때는 `WriteBatch` 하나로 DailyLogs와 Vehicles(`odometerKm`, `status: idle`, `parking.location`)를 함께 갱신한다.
- 스키마를 바꿔야 하면 먼저 제안하고, `docs/firestore_schema.md`도 같이 수정한다.

## 폴더 구조
```text
lib/
  main.dart
  theme/        색상과 글씨 스타일
  models/       데이터 모델
  screens/      화면
  services/     firestore, storage, location
```
