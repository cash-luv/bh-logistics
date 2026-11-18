# BH로지스틱스 관리자 웹: AI 작업 규칙

## 프로젝트
- 본사 관리자가 PC 브라우저에서 쓰는 관리 페이지. 기사용 Flutter 앱(`~/dev/bh_driver_app`)과 같은 Firebase 프로젝트를 쓴다.
- 기술: React + Vite + TypeScript + Tailwind CSS, Firebase 웹 SDK(모듈식), React Router, 차트는 Recharts, 엑셀은 ExcelJS(브라우저에서 생성).
- 개발자는 1인이고 코딩 경험이 거의 없다. 설명은 쉬운 한국어로 하고, 명령어는 그대로 복사해서 실행할 수 있게 적는다.

## 작업 방식
- 한 번에 화면 하나 또는 기능 하나만 만든다.
- 작업이 끝나면 바뀐 파일 목록, 새로 설치할 패키지, "화면에서 무엇이 보여야 하는지"를 알려 준다.
- 패키지는 `npm install`로 추가하고 버전을 임의로 고정하지 않는다. Tailwind 등은 설치 전에 최신 공식 문서의 방법을 확인한다.
- 에러는 원인과 해결 방법을 쉬운 말로 먼저 설명한 뒤 코드를 고친다.
- `.env`, 서비스 계정 파일, 비밀키는 채팅과 GitHub에 올리지 않는다. `.gitignore`에 등록한다.

## UI 규칙
- 왼쪽 사이드바 + 오른쪽 메인 화면의 어드민 레이아웃. 화면 글은 모두 한국어.
- 깔끔하고 단순하게. 표에는 검색, 필터, 정렬을 넣고, 데이터를 불러오는 중 / 비어 있음 / 에러 상태를 항상 보여 준다.
- 삭제, 마감, 무효 처리처럼 되돌리기 어려운 동작은 확인 창을 띄운다. 삭제보다 비활성(`isActive: false`)을 우선한다.
- 금액은 `1,234,000원`처럼 천 단위 콤마, 거리는 `182,340km`로 표시한다.

## 데이터 규칙 (기준 문서: `docs/firestore_schema.md`, 기사앱과 완전히 같아야 한다)
- 컬렉션은 Users, Vehicles, Routes, DailyLogs, Maintenance, Settlements 6개이고 모두 최상위에 둔다.
- DailyLogs 문서 ID는 `{workDate}_{driverId}`이다. 문서 1개가 엑셀 1행이다.
- `workDate`는 한국 시간 기준 `YYYY-MM-DD`, `yearMonth`는 `YYYY-MM` 문자열이다.
- 출근 때 DailyLogs에 복사된 기사 이름, 번호판, 노선명, 노선 단가(`routePrice`)는 스냅샷이므로 나중에 Routes가 바뀌어도 고치지 않는다.
- 금액은 원 단위 정수, 거리는 km 정수. 사진은 URL이 아니라 Storage 경로가 저장돼 있으므로, 화면에 보일 때 `getDownloadURL`로 URL을 만든다.
- Timestamp는 UTC로 저장돼 있다. 화면과 엑셀에서는 한국 시간(KST)으로 바꿔 표시하고, 변환 함수는 `src/utils/` 한 곳에만 둔다.
- 기사와 차량의 배정은 `Users.assignedVehicleId`와 `Vehicles.assignedDriverId` 양쪽에 있다. 바꿀 때는 항상 트랜잭션으로 두 문서를 함께 수정한다.
- Firestore 읽기 비용을 아끼기 위해 월 단위 조건(`yearMonth`)으로 조회하고, 컬렉션 전체를 한꺼번에 읽지 않는다.
- 스키마를 바꿔야 하면 먼저 제안하고, `docs/firestore_schema.md`도 같이 수정한다. (기사앱 쪽 문서도 같이 고쳐야 함을 알려 준다.)

## 보안
- 관리자만 접근해야 한다. 로그인 후 `Users/{uid}.role === 'admin'`을 확인하고 아니면 로그아웃시킨다.
- 화면에서 메뉴를 숨기는 것만으로는 보안이 아니다. 진짜 방어는 Firestore/Storage 보안 규칙이므로 규칙 변경이 필요하면 알려 준다.

## 폴더 구조
```text
src/
  main.tsx, App.tsx      시작점과 라우팅
  lib/firebase.ts        Firebase 초기화 (설정값은 .env의 VITE_FIREBASE_* 에서 읽음)
  types/                 Users, Vehicles, Routes, DailyLogs, Maintenance, Settlements 타입
  services/              Firestore/Storage 읽기·쓰기 함수 (화면에서 직접 쓰지 않고 여기에 모음)
  pages/                 화면 (로그인, 대시보드, 운행기록, 차량, 기사, 노선, 월결산)
  components/            공통 부품 (사이드바, 표, 버튼, 상태 표시 등)
  utils/                 날짜(KST) 변환, 금액·거리 표시, 엑셀 생성
```
