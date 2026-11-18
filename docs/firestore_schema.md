# BH로지스틱스 Firestore 데이터베이스 스키마 명세서

비에이치로지스틱스(BH Logistics) 기사용 모바일 앱과 본사 관리자 웹 콘솔이 공유하는 Firestore 최상위 컬렉션 구조 및 데이터 스키마 정의서입니다.

---

## 1. 개요 및 설계 원칙
- **리전**: 서울 리전 (`asia-northeast3`)
- **컬렉션 구조**: 모든 컬렉션은 최상위(Root)에 두어 쿼리 속도 최적화 및 엑셀 변환 용이성 확보
- **단위 원칙**: 금액은 원 단위 정수, 거리는 km 정수
- **사진 저장**: 다운로드 URL 대신 Firebase Storage 내부 상대 경로 저장
- **일일 운행 기록 (DailyLogs)**: 
  - 문서 ID: `{workDate}_{driverId}` (예: `2026-11-17_bh01`)
  - 문서 1개가 엑셀 1행과 1:1로 매핑되는 정규화 구조

---

## 2. 컬렉션별 스키마 상세

### 1) `Users` (기사 및 관리자 계정)
- **문서 ID**: Firebase Auth `uid`
- **주요 필드**:
  ```json
  {
    "driverCode": "bh01",          // 고유 기사 코드 (대표: bh-ceo, 간선총괄: bh-tk, 기사: bh01~)
    "name": "홍길동",              // 기사 성함
    "role": "driver",             // driver | admin
    "dept": "교촌-대전",           // 소속 부서 / 사업소
    "phone": "010-1234-5678",     // 연락처
    "hireDate": "2026-01-01",     // 입사일 (YYYY-MM-DD)
    "assignedVehicleId": "veh_01",// 배정 차량 문서 ID
    "defaultRouteId": "route_01", // 기본 담당 노선 ID
    "weeklyOffDays": [0],         // 주간 정기 휴무 요일 (0: 일요일 ~ 6: 토요일)
    "offDates": ["2026-11-20"],   // 지정 휴무일 목록 (YYYY-MM-DD)
    "isActive": true,             // 계정 활성 여부
    "createdAt": "Timestamp",
    "updatedAt": "Timestamp"
  }
  ```

### 2) `Vehicles` (차량 관리 및 실시간 상태)
- **문서 ID**: 자동 생성 ID 또는 고유 ID
- **주요 필드**:
  ```json
  {
    "plateNo": "대전89아4337",      // 차량 번호판
    "manufacturer": "현대",        // 제조사
    "model": "마이티 3.5톤",        // 모델명
    "fuelType": "디젤",            // 연료 종류
    "workplace": "교촌-대전",       // 근무처
    "routeMemo": "대전 물류센터",   // 운행코스 메모
    "routeId": "route_kyochon_dj",// 매칭된 표준 노선 ID
    "routeName": "교촌 - 대전",     // 매칭된 표준 노선명
    "odometerKm": 125430,         // 최종 계기판 누적 주행거리 (km)
    "status": "idle",             // idle(대기/공차) | running(운행중) | maintenance(정비중)
    "assignedDriverName": "이진무", // 배정 기사명
    "fuelEfficiencyKmPerL": 5.5,  // 기준 연비 (km/L)
    "parking": {
      "location": "GeoPoint",     // 최종 주차 위경도
      "address": "대전광역시 유성구...",
      "recordedAt": "Timestamp"
    },
    "openMaintenanceCount": 0,    // 미해결 정비 이슈 건수
    "updatedAt": "Timestamp"
  }
  ```

### 3) `Routes` (표준 운행 노선 및 기준 단가)
- **문서 ID**: 고유 노선 코드 (예: `route_emart_ambient`, `route_dj_yi_gj`)
- **주요 필드**:
  ```json
  {
    "id": "route_kyochon_dj",
    "name": "교촌 - 대전",
    "stops": ["대전 물류센터", "가맹점 납품", "복귀"],
    "price": 0,                   // 1회 운행 단가 (원, 0은 실비산정)
    "expectedKm": 0,              // 기준 거리 (km, 0은 실제 운행거리로 자동 산정)
    "isVariableKm": true,         // 실제 운행거리 기반 자동 정산 여부
    "kmTolerancePct": 100,        // 거리 허용 오차율
    "sortOrder": 5,               // 정렬 순서
    "isActive": true
  }
  ```

### 4) `DailyLogs` (일일 출퇴근 운행일지 & 정산 원장)
- **문서 ID**: `{workDate}_{driverId}`
- **주요 필드**:
  ```json
  {
    "workDate": "2026-11-17",     // 운행 일자 (KST YYYY-MM-DD)
    "yearMonth": "2026-11",       // 정산 집계용 월 (YYYY-MM)
    "status": "completed",        // in_progress(운행중) | completed(퇴근완료)
    "driverId": "driver_uid",
    "driverName": "이진무",
    "driverCode": "bh01",
    "vehicleId": "veh_01",
    "plateNo": "대전89아4337",
    "routeId": "route_kyochon_dj",
    "routeName": "교촌 - 대전",
    "routePrice": 0,              // 출근 시점의 스냅샷 단가
    "checkInAt": "Timestamp",     // 출근 시각
    "checkOutAt": "Timestamp",    // 퇴근 시각
    "startOdometerKm": 125430,    // 출발 계기판
    "endOdometerKm": 125645,      // 도착 계기판
    "drivenKm": 215,              // 당일 실운행거리 (km)
    "offDutyKm": 0,               // 전일 퇴근과 금일 출근 사이 사적 이동거리
    "startLocation": "GeoPoint",  // 출근 위치
    "startAddress": "대전 대덕구 신일동 물류센터",
    "endLocation": "GeoPoint",    // 퇴근 위치
    "endAddress": "대전 유성구 차고지",
    "gpsTimeline": [              // 백그라운드 이동 동선 트래킹 (포어그라운드 서비스)
      { "lat": 36.35, "lng": 127.38, "t": "08:30" }
    ],
    "fuelCost": 45000,            // 당일 주유비 (영수증 촬영 등록)
    "hasIssue": false,            // 출발 전 8종 일일점검 이상 여부
    "startPhotos": {
      "odometer": "photos/2026-11-17_odometer.jpg",
      "front": "photos/2026-11-17_front.jpg"
    }
  }
  ```

### 5) `Maintenance` (정비 및 결함 보고)
- **문서 ID**: 자동 생성 ID
- **주요 필드**: `vehicleId`, `reportedBy`, `category`(타이어/엔진오일/요소수 등), `status`(pending/in_progress/resolved), `cost`, `description`, `photoPath`

### 6) `Settlements` (월별 마감 정산서)
- **문서 ID**: `{yearMonth}_{driverId}`
- **주요 필드**: `driverId`, `yearMonth`, `workDays`, `totalDrivenKm`, `totalFare`, `totalFuel`, `netPay`, `isClosed`, `closedAt`

### 7) `Settings` (시스템 설정 및 원격 업데이트)
- **문서 ID**: `appVersion`, `fuel`
- **주요 필드 (`appVersion`)**:
  ```json
  {
    "latestVersion": "1.0.1",
    "apkUrl": "https://bh-logistics-f45d8.web.app/bh-driver.apk",
    "message": "더 편리해진 새 버전이 나왔어요. 아래 버튼을 눌러 업데이트해 주세요.",
    "forceUpdate": false
  }
  ```
