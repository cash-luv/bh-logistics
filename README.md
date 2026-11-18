# 🚛 BH로지스틱스 (BH Logistics)
> **현장 기사용 모바일 앱과 본사 통합 관제·배차·정산 웹 콘솔을 아우르는 풀스택 물류 DX 솔루션**

<div align="center">

![Flutter](https://img.shields.io/badge/Flutter-3.x-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Dart](https://img.shields.io/badge/Dart-3.x-0175C2?style=for-the-badge&logo=dart&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.x-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Firestore_%7C_Storage_%7C_Auth_%7C_Hosting-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![Android](https://img.shields.io/badge/Android-APK_OTA_Update-3DDC84?style=for-the-badge&logo=android&logoColor=white)

</div>

---

## 📌 1. 프로젝트 개요 (Overview)

물류 운송 현장에서 발생하는 **수기 운행일지 작성의 불편함, 계기판 오입력, 차량 결함 방치, 복잡한 월말 엑셀 수기 정산** 문제를 해결하기 위해 구축된 엔터프라이즈 물류 솔루션입니다.

현장 운전 기사님을 위한 **고시인성 모바일 앱(Flutter)**과 본사 관리자를 위한 **실시간 관제·배차·출근·정산 웹 콘솔(React)**이 Firebase 단일 백엔드를 통해 실시간으로 동기화됩니다.

- 🌐 **본사 통합 관제 웹 콘솔 (라이브)**: [https://bh-logistics-f45d8.web.app](https://bh-logistics-f45d8.web.app)
- 📲 **기사용 안드로이드 앱 최신 APK 다운로드**: [https://bh-logistics-f45d8.web.app/bh-driver.apk](https://bh-logistics-f45d8.web.app/bh-driver.apk)

---

## 🏗️ 2. 시스템 아키텍처 (System Architecture)

```mermaid
flowchart LR
    classDef client fill:#EBF4FF,stroke:#3B82F6,stroke-width:2px,color:#1E3A8A;
    classDef cloud fill:#FEF3C7,stroke:#F59E0B,stroke-width:2px,color:#78350F;
    classDef admin fill:#F0FDF4,stroke:#10B981,stroke-width:2px,color:#064E3B;

    subgraph Mobile ["📱 기사용 모바일 앱 (Flutter)"]
        direction TB
        M1["출퇴근 & 8종 차량점검"]:::client
        M2["백그라운드 GPS 동선 트래킹"]:::client
        M3["주유비 영수증 즉시 촬영"]:::client
        M4["OTA 원격 앱 자동 업데이트"]:::client
    end

    subgraph Cloud ["☁️ Firebase Serverless Cloud (서울)"]
        direction TB
        Auth["Firebase Auth<br/>(기사코드 / 관리자 인증)"]:::cloud
        DB[("Cloud Firestore<br/>• DailyLogs (운행 원장)<br/>• Vehicles (차량 대장)<br/>• Users (기사 프로필)<br/>• Routes (15개 노선)")]:::cloud
        Storage[("Cloud Storage<br/>(계기판 / 점검 / 영수증 사진)")]:::cloud
        Hosting["Firebase Hosting<br/>(웹 배포 & 최신 APK 제공)"]:::cloud
    end

    subgraph Admin ["🖥️ 본사 관리자 웹 콘솔 (React)"]
        direction TB
        W1["종합 KPI 대시보드 (Recharts)"]:::admin
        W2["기사별 실시간 출근표 & 휴무 스케줄러"]:::admin
        W3["차량 대장 (22개 스펙 & 엑셀 연동)"]:::admin
        W4["15개 표준 노선 & 자동 단가 정산"]:::admin
        W5["ExcelJS 월간 정산서 원클릭 출력"]:::admin
    end

    Mobile -->|"출퇴근/운행일지/GPS 동선"| DB
    Mobile -->|"점검/영수증 사진 업로드"| Storage
    Mobile <-->|"기사 로그인 & 버전 체크"| Auth

    Admin <-->|"실시간 관제 & 배차/휴무 변경"| DB
    Admin -->|"점검 사진 / 영수증 열람"| Storage
    Admin <-->|"관리자 보안 로그인"| Auth
    Hosting -->|"웹 콘솔 서빙"| Admin
    Hosting -.->|"OTA 앱 자동 업데이트"| Mobile
```

> **아키텍처 설계 포인트**
> 1. **Client (Flutter)**: 시니어 기사용 특대형 UI, 포어그라운드 백그라운드 GPS 트래킹, 인앱 OTA 자동 배포
> 2. **Backend (Firebase)**: 서울 리전(`asia-northeast3`) 기반 초저지연 Firestore, Storage 사진 버킷, 세분화된 보안 규칙(RBAC)
> 3. **Backoffice (React)**: 실시간 KPI 대시보드, 기사별 실시간 출근표 및 휴무 스케줄러, 15개 사업소 노선 매칭 및 엑셀 정산서 자동 출력

---

## ✨ 3. 핵심 기능 (Key Features)

### 📱 A. 기사용 모바일 앱 (`bh_driver_app`)
- **시니어 친화적 직관적 UI**: 
  - 모든 텍스트 20pt 이상, 고대비 색상(`AppColors.primary`, `AppColors.teal`) 적용
  - 스마트폰 글자 크기 확대 시에도 깨지지 않는 반응형 스크롤 레이아웃
- **원클릭 출퇴근 & 일일 안전 점검**:
  - 출근 시 계기판 사진 촬영 및 8종 차량 안전 체크리스트(타이어 공기압, 요소수, 연료 등) 점검
  - 전일 퇴근 계기판과 금일 출근 계기판의 차이를 자동 계산하여 사적 운행거리(`offDutyKm`) 자동 감지
- **무중단 백그라운드 GPS 동선 트래킹**:
  - Android Foreground Service(`AndroidSettings`, `ForegroundNotificationConfig`) 탑재
  - 화면이 꺼지거나 앱이 백그라운드로 전환되어도 퇴근 시점까지 정밀한 운행 타임라인 수집
- **주유비 영수증 촬영 등록**:
  - 운행 중 주유소 결제 영수증을 즉시 촬영하여 당일 일지에 누적 저장
- **인앱 원격 무중단 자동 업데이트 (OTA)**:
  - 앱 실행 및 재진입(Lifecycle Resume) 시 서버 버전(`Settings/appVersion`)을 자동 검사
  - 구버전 감지 시 원클릭으로 백그라운드 다운로드 후 설치 화면으로 즉시 전환

---

### 💻 B. 본사 관리자 웹 콘솔 (`bh_admin_web`)
- **실시간 종합 KPI 대시보드**:
  - 당일 총 운행 건수, 실운행거리(km), 운송료 매출, 주유비 집계, 공차율, 미해결 정비 이슈 실시간 모니터링
  - 일별 운행 추이 및 비용 분석 차트(Recharts) 시각화
- **기사별 실시간 출근표 & 휴무 스케줄러**:
  - 기사별 오늘 출근 상태 실시간 추적: `🟢 출근 완료(운행중)` / `🔵 퇴근 완료` / `🟡 휴무` / `⚪ 미출근`
  - 출근 시각, 출발 계기판(km), 출발지 주소, 차량 이상 유무 한눈에 파악
  - 주간 정기 휴무 요일(`[일]~[토]`) 클릭 토글 및 당일 휴무/출근 원클릭 전환
  - 기사별 월간 1일~말일 출근/휴무 달력 팝업 모달 제공
- **차량 대장 & 엑셀 일괄 등록**:
  - 엑셀 파일 업로드로 50대 이상의 차량 제원(제조사, 차종, 적재량, 연식, 정기검사일 등 22개 항목) 원클릭 등록
  - 각 차량의 현재 차고지 위치, 최종 주차 위경도, 배정 기사, 실시간 공차 여부 확인
- **기사 관리 & 양방향 스마트 배차**:
  - 김병훈 대표님(`👑 bh-ceo`), 간선총괄 정태광 기사님(`⭐ bh-tk`), 현장 기사님(`bh01`~`bh48`) 고유 코드 부여
  - 기사 변경 시 차량 배정 및 차량 변경 시 기사 배정이 상호 동기화되는 양방향 바인딩
- **15개 사업소 표준 노선 관리**:
  - 이마트(상온/저온), GS리테일, CU, 교촌(대전/전북), 빽다방, B2B, 조인(알운반), 쿠팡, 대전집배점, 간선 등 15개 표준 노선 등록
  - 차량의 근무처/운행코스를 분석하여 노선 자동 매칭 및 실제 출퇴근 운행거리 기반 자동 단가 정산
- **월간 정산 & 엑셀 원장 다운로드**:
  - 월별 기사별 총 운행일수, 실운행거리, 운송료, 유류비 공제액, 최종 지급액 자동 연산
  - `ExcelJS`를 활용하여 관공서/세무 제출 규격의 스타일링된 엑셀 정산서 원클릭 생성

---

## 🗄️ 4. 데이터베이스 설계 (Firestore Schema)

모든 컬렉션은 최상위(Root) 정규화 컬렉션으로 설계되어 빠른 인덱싱 및 엑셀 출력을 지원합니다.

| 컬렉션명 | 문서 ID 규칙 | 설명 |
| :--- | :--- | :--- |
| **`Users`** | `{uid}` | 기사 및 본사 관리자 프로필, 고유 코드(`driverCode`), 정기/지정 휴무일 |
| **`Vehicles`** | `{vehicleId}` | 차량 22종 스펙, 최종 주행거리, 주차 위치, 배정 기사, 표준 노선 |
| **`Routes`** | `{routeId}` | 15개 사업소 노선명, 경유지, 1회 단가, 기준 거리(실비산정 지원) |
| **`DailyLogs`** | `{workDate}_{driverId}` | **핵심 원장**: 엑셀 1행과 1:1 매칭되는 당일 출퇴근, 계기판, GPS 동선, 주유비 |
| **`Maintenance`** | `{autoId}` | 타이어/요소수 등 8종 점검 결함 및 정비 수리 이력 |
| **`Settlements`** | `{yearMonth}_{driverId}` | 월별 기사 정산 마감 데이터 |
| **`Settings`** | `appVersion`, `fuel` | 기사앱 최신 버전(OTA 링크) 및 유가 기준 설정 |

> 상세 필드 명세는 [docs/firestore_schema.md](docs/firestore_schema.md)를 참고하세요.

---

## 📂 5. 프로젝트 디렉토리 구조 (Monorepo)

```text
bh-logistics/
├── bh_driver_app/               # [모바일] 현장 기사용 Flutter 앱
│   ├── android/                 # 안드로이드 네이티브 빌드 & 포어그라운드 서비스 설정
│   ├── ios/                     # iOS 네이티브 빌드 설정
│   ├── assets/                  # 고해상도 앱 아이콘 및 스플래시 로고
│   ├── lib/
│   │   ├── main.dart            # 앱 진입점, 테마 초기화, 라이프사이클 감지
│   │   ├── theme/               # 특대형 폰트(AppText) 및 브랜드 컬러(AppColors)
│   │   ├── models/              # 출퇴근 결과, 차량점검 결과 모델
│   │   ├── screens/             # 출근/차량점검, 퇴근/주유보고, 공차상태 화면
│   │   └── services/            # Firestore, 백그라운드 GPS, OTA 업데이트 서비스
│   ├── pubspec.yaml             # Flutter 패키지 의존성 정의
│   └── firestore.rules          # Firestore 보안 규칙 (RBAC)
│
├── bh_admin_web/                # [웹] 본사 통합 관제·배차·정산 웹 콘솔
│   ├── src/
│   │   ├── main.jsx             # React 진입점
│   │   ├── App.jsx              # 전체 네비게이션, 대시보드, 기사/차량/노선 관리
│   │   ├── pages/
│   │   │   └── AttendanceView.jsx # 기사별 실시간 출근표 & 휴무 스케줄러
│   │   ├── services/
│   │   │   ├── masterDataService.js # 15개 표준 노선 및 기사 마스터 동기화
│   │   │   └── vehicleImport.js     # 엑셀 차량 대장 파싱 및 일괄 등록
│   │   ├── utils/               # ExcelJS 정산서 내보내기, KST 날짜 포맷팅
│   │   └── firebase.js          # Firebase SDK 초기화 및 멀티 세션 Auth
│   ├── package.json             # Vite, React, Recharts, ExcelJS 의존성
│   └── tailwind.config.js       # 반응형 Tailwind 스타일링 설정
│
├── docs/
│   └── firestore_schema.md      # Firestore 7대 컬렉션 스키마 명세서
├── .gitignore                   # API 키 및 보안 파일 제외 설정
└── README.md                    # 통합 프로젝트 포트폴리오 문서
```

---

## 🛠️ 6. 기술 스택 (Tech Stack)

### Client (Mobile App)
- **Framework**: Flutter 3.x (Dart 3.x)
- **State Management & Async**: Flutter Native State & Streams
- **Device Features**: `geolocator` (Foreground GPS), `image_picker` (계기판/영수증 촬영), `ota_update` (무중단 자가 업데이트)
- **Local Storage**: `shared_preferences`

### Client (Admin Web)
- **Framework**: React 18, Vite 5
- **Styling**: Tailwind CSS 3
- **Visualization & Export**: `recharts` (KPI 차트), `exceljs` (정산 원장 엑셀 생성)

### Backend & Cloud Infrastructure
- **BaaS**: Google Firebase
  - **Firestore**: NoSQL 실시간 데이터베이스 (서울 리전 `asia-northeast3`)
  - **Cloud Storage**: 차량 점검 및 주유 영수증 사진 저장
  - **Firebase Authentication**: 이메일/비밀번호 기반 인증 (관리자 및 기사 전용 PIN)
  - **Firebase Hosting**: 전 세계 CDN을 통한 초고속 웹 및 APK 배포

---

## 🚀 7. 시작하기 (Getting Started)

### 환경 요구사항
- Flutter SDK `>= 3.19.0`
- Node.js `>= 20.0.0`
- Firebase CLI

### 1) 기사용 모바일 앱 (`bh_driver_app`)
```bash
cd bh_driver_app

# 1. 의존성 패키지 설치
flutter pub get

# 2. Firebase 설정 파일 배치 (비공개 키)
# android/app/google-services.json 위치에 파일 추가

# 3. 앱 실행 또는 APK 빌드
flutter run
flutter build apk --release
```

### 2) 본사 관리자 웹 (`bh_admin_web`)
```bash
cd bh_admin_web

# 1. 의존성 패키지 설치
npm install

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일에 본인 Firebase 프로젝트 키 입력

# 3. 로컬 개발 서버 실행
npm run dev

# 4. 프로덕션 빌드 및 배포
npm run build
firebase deploy --only hosting
```

---

## 🔒 8. 보안 및 규정 준수 (Security)
- **Firebase Security Rules**: 관리자(`admin`)와 기사(`driver`)의 권한을 엄격히 분리하여 본인의 운행일지만 수정할 수 있도록 접근 제어 구현
- **개인정보 및 키 보호**: `google-services.json`, `.env`, 개인 비밀키 등 민감한 자격 증명은 `.gitignore`에 등록되어 원격 저장소에 노출되지 않도록 철저히 차단되어 있습니다.

---

## 📅 개발 일지 (Daily Changelog)

- **2026-11-18**:
  - **주유 등록 화면 전면 개편 및 기타 품목(요소수·워셔액·연료첨가제) 복합 결제 등록 (기사앱 v1.0.3)**:
    - 주유 시 주유소에서 함께 결제하는 요소수, 워셔액, 연료첨가제, 기타 소모품을 체크박스를 통해 직관적으로 선택하고 수량(통) 및 금액 등록 기능 추가
    - 어르신 기사님도 쉽게 누를 수 있는 대형 `[-]` / `[+]` 원터치 수량 조절 버튼과 실시간 요약 배지 UI 구현
    - 본사 관리자 웹 일별 운행 상세에서 주유 카드 영수증과 함께 기타 소모품 내역(`🛒 요소수 2통, 워셔액 1통`) 실시간 확인 연동
  - **기사앱 & 관리자 웹 전반 천단위 콤마(`,`) 자동 서식화 적용**:
    - 기사앱: 계기판 주행거리, 퇴근거리, 주유금액, 기타 소모품비 입력 시 `1,000`처럼 3자리마다 콤마가 자동으로 찍히는 포맷터 적용
    - 관리자 웹: 노선 단가/예상거리, 차량 누적거리, 퇴근거리 수동 보정, 소모품 예정거리, 기준 경유 단가에 천단위 콤마 서식화 및 자동 파싱 적용
  - **백그라운드 GPS 동선 트래커 전면 고도화**:
    - 장거리 화물 운송(세종↔청주↔용인↔대전)에 최적화된 **5분 주기 시간 기반 체크포인트 기록** 도입
    - 기존 40개 지점 제한 해제 및 **최대 300개 지점(24시간+ 풀타임 커버)**으로 대폭 확대
    - 물류센터(쿠팡 등) **상하차 대기 시간('정차 / 대기')**과 고속도로 주행('운행 중') 자동 판별 기록
    - 안드로이드 배터리 절전 킬 방지(`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, Foreground Service + WakeLock)
  - **본사 관리자 콘솔 신규 기능**: 기사별 실시간 출근표 및 주간/당일 휴무 스케줄러(`AttendanceView`) 구축
  - **시스템 아키텍처 다이어그램**: GitHub 렌더링 최적화 및 가로형(`flowchart LR`) 디자인 전면 개선

---

## 👤 개발자 (Author)
- **1인 풀스택 개발 (Full-Stack Solo Developer)**
- **GitHub**: [https://github.com/cash-luv](https://github.com/cash-luv)
- **Email**: [cash-luv GitHub Profile](https://github.com/cash-luv)
