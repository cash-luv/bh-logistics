import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { db, secondaryAuth } from '../firebase';

/**
 * 15개 사업소 표준 노선 정의 (차량기록 엑셀 및 비에이치로지스틱스 근무지 기준)
 */
export const STANDARD_ROUTES = [
  {
    id: 'route_emart_ambient',
    name: '이마트 세종 상온',
    workplaces: ['이마트상온', '이마트 세종 상온', '세종상온'],
    stops: ['물류센터', '이마트 세종 상온 가맹점', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 1,
  },
  {
    id: 'route_emart_cold',
    name: '이마트 세종 저온',
    workplaces: ['이마트저온', '이마트 세종 저온', '세종저온'],
    stops: ['물류센터', '이마트 세종 저온 가맹점', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 2,
  },
  {
    id: 'route_gs_cold',
    name: 'GS리테일 익산 저온',
    workplaces: ['GS저온', 'GS리테일', '익산저온', 'GS익산'],
    stops: ['익산 센터', 'GS 가맹점 납품', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 3,
  },
  {
    id: 'route_cu_ambient',
    name: 'CU 대전 상온',
    workplaces: ['CU-BGF', 'CU상온', 'CU 대전 상온', 'BGF', 'CU'],
    stops: ['대전 물류센터', 'CU 가맹점 납품', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 4,
  },
  {
    id: 'route_kyochon_dj',
    name: '교촌 - 대전',
    workplaces: ['교촌-대전', '교촌 대전', '교촌대전'],
    stops: ['대전 물류센터', '교촌 가맹점 납품', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 5,
  },
  {
    id: 'route_kyochon_jb',
    name: '교촌 - 전북',
    workplaces: ['교촌-전북', '교촌 전북', '교촌전북'],
    stops: ['전북 물류센터', '교촌 가맹점 납품', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 6,
  },
  {
    id: 'route_paikdabang',
    name: '빽다방',
    workplaces: ['빽다방', '빽다방외', '빽다방外'],
    stops: ['센터 상차', '빽다방 가맹점 납품', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 7,
  },
  {
    id: 'route_b2b_dj',
    name: 'B2B (대전 가게 납품)',
    workplaces: ['B2B', 'B2B 대전', 'B2B대전', 'B3B', 'B4B'],
    stops: ['물류센터', '거래처 매장 납품', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 8,
  },
  {
    id: 'route_choin_egg',
    name: '조인 (알운반)',
    workplaces: ['조인', '조 인', '알운반'],
    stops: ['조인 센터', '거래처 납품', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 9,
  },
  {
    id: 'route_hazardous',
    name: '유해화학물 운반',
    workplaces: ['유해화학물', '화학물'],
    stops: ['지정 사업장', '안전 운반', '차고지 복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 10,
  },
  {
    id: 'route_coupang',
    name: '쿠팡 간선·배송',
    workplaces: ['쿠팡'],
    stops: ['쿠팡 캠프/센터', '간선 이동', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 11,
  },
  {
    id: 'route_dj_zipbae',
    name: '대전집배점',
    workplaces: ['대전집배점', '집배점'],
    stops: ['대전 집배센터', '관내 배송', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 12,
  },
  {
    id: 'route_gansen',
    name: '간선 운송',
    workplaces: ['간선', '외부용차', '용차'],
    stops: ['거점 터미널', '목적지 터미널', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 13,
  },
  {
    id: 'route_corp_cold',
    name: '기업물류 대전 저온',
    workplaces: ['기업물류 대전 저온', '기업물류'],
    stops: ['대전 저온센터', '가맹점 납품', '복귀'],
    price: 0,
    expectedKm: 0,
    isVariableKm: true,
    kmTolerancePct: 100,
    sortOrder: 14,
  },
  {
    id: 'route_dj_yi_gj',
    name: '대전–용인–곤지암–용인–대전 (대형 고정)',
    workplaces: ['대형 고정', '대형고정', '용인~곤지암', '용인-곤지암'],
    stops: ['대전', '용인', '곤지암', '용인', '대전'],
    price: 530000,
    expectedKm: 380,
    isVariableKm: false,
    kmTolerancePct: 15,
    sortOrder: 15,
  },
];

/**
 * 44명 현장 기사 마스터 명단 (부서, 성함, 알려진 연락처, 주 탑승 차량번호판)
 */
export const MASTER_DRIVERS = [
  // 1. 대전집배점 (12명)
  { dept: '대전집배점', name: '서정호', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '강준석', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '이영석', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '이문구', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '김원일', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '김태열', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '박우진', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '나동균', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '김천용', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '이혜민', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '이주헌', phone: '', defaultRoute: 'route_dj_zipbae' },
  { dept: '대전집배점', name: '김병득', phone: '', defaultRoute: 'route_dj_zipbae' },

  // 2. 교촌-대전 (4명)
  { dept: '교촌-대전', name: '이진무', phone: '010-8808-6784', plateNo: '대전89아4337', defaultRoute: 'route_kyochon_dj' },
  { dept: '교촌-대전', name: '최영두', phone: '', plateNo: '충북88사4660', defaultRoute: 'route_kyochon_dj' },
  { dept: '교촌-대전', name: '방기택', phone: '', plateNo: '대전89아3854', defaultRoute: 'route_kyochon_dj' },
  { dept: '교촌-대전', name: '최현준', phone: '010-8809-1239', plateNo: '서울83자3973', defaultRoute: 'route_kyochon_dj' },

  // 3. 교촌-전북 (5명)
  { dept: '교촌-전북', name: '오종민', phone: '', plateNo: '충북84아5137', defaultRoute: 'route_kyochon_jb' },
  { dept: '교촌-전북', name: '김영창', phone: '010-5927-3364', plateNo: '경기94자8811', defaultRoute: 'route_kyochon_jb' },
  { dept: '교촌-전북', name: '최진영', phone: '', plateNo: '충북84아1194', defaultRoute: 'route_kyochon_jb' },
  { dept: '교촌-전북', name: '양한석', phone: '', plateNo: '충북82아5411', defaultRoute: 'route_kyochon_jb' },
  { dept: '교촌-전북', name: '임석채', phone: '', defaultRoute: 'route_kyochon_jb' },

  // 4. 빽다방외 (3명)
  { dept: '빽다방외', name: '김태성', phone: '010-2017-6027', plateNo: '전북80사4404', defaultRoute: 'route_paikdabang' },
  { dept: '빽다방외', name: '남상준', phone: '', plateNo: '경기92자5403', defaultRoute: 'route_paikdabang' },
  { dept: '빽다방외', name: '강병태', phone: '', defaultRoute: 'route_paikdabang' },

  // 5. GS저온 (3명)
  { dept: 'GS저온', name: '강유신', phone: '', plateNo: '경기94자8863', defaultRoute: 'route_gs_cold' },
  { dept: 'GS저온', name: '전병인', phone: '', plateNo: '전북80사4438', defaultRoute: 'route_gs_cold' },
  { dept: 'GS저온', name: '모영일', phone: '', plateNo: '충북81아4001', defaultRoute: 'route_gs_cold' },

  // 6. 조 인 (2명)
  { dept: '조 인', name: '문규호', phone: '', plateNo: '대전89아7202', defaultRoute: 'route_choin_egg' },
  { dept: '조 인', name: '임윤수', phone: '', defaultRoute: 'route_choin_egg' },

  // 7. 유해화학물 (1명)
  { dept: '유해화학물', name: '임종식', phone: '', plateNo: '충북82아1560', defaultRoute: 'route_hazardous' },

  // 8. 이마트저온 (3명)
  { dept: '이마트저온', name: '임근조', phone: '010-9240-8972', plateNo: '대전88아3308', defaultRoute: 'route_emart_cold' },
  { dept: '이마트저온', name: '이천복', phone: '', plateNo: '광주88바2290', defaultRoute: 'route_emart_cold' },
  { dept: '이마트저온', name: '이운혁', phone: '', plateNo: '충북82아6652', defaultRoute: 'route_emart_cold' },

  // 9. 이마트상온 (7명)
  { dept: '이마트상온', name: '김광태', phone: '010-6570-1155', plateNo: '대전89아3521', defaultRoute: 'route_emart_ambient' },
  { dept: '이마트상온', name: '박상현', phone: '010-9283-4010', plateNo: '대전87아9131', defaultRoute: 'route_emart_ambient' },
  { dept: '이마트상온', name: '김창훈', phone: '010-7113-4571', plateNo: '충남80아3531', defaultRoute: 'route_emart_ambient' },
  { dept: '이마트상온', name: '정창수', phone: '010-3255-1610', plateNo: '충북82아1539', defaultRoute: 'route_emart_ambient' },
  { dept: '이마트상온', name: '이재영', phone: '010-5000-4614', plateNo: '대구81자3067', defaultRoute: 'route_emart_ambient' },
  { dept: '이마트상온', name: '최원영', phone: '010-4000-3642', plateNo: '대전88아8532', defaultRoute: 'route_emart_ambient' },
  { dept: '이마트상온', name: '박민철', phone: '010-4075-8663', plateNo: '경기91자5593', defaultRoute: 'route_emart_ambient' },

  // 10. 간선 (2명)
  { dept: '간선', name: '정태광', phone: '', plateNo: '경기94자8805', defaultRoute: 'route_gansen' },
  { dept: '간선', name: '김유빈', phone: '', defaultRoute: 'route_gansen' },

  // 11. CU-BGF (1명)
  { dept: 'CU-BGF', name: '곽만호', phone: '', plateNo: '충북82아6415', defaultRoute: 'route_cu_ambient' },

  // 12. 엑셀 운전자 추가 인원 (4명)
  { dept: 'B2B/기타', name: '송영한', phone: '', plateNo: '89러3439', defaultRoute: 'route_b2b_dj' },
  { dept: '교촌/조인', name: '이용구', phone: '', plateNo: '전북80아8288', defaultRoute: 'route_kyochon_dj' },
  { dept: '교촌', name: '김충호', phone: '', plateNo: '충북80아2010', defaultRoute: 'route_kyochon_dj' },
  { dept: '조인', name: '권태형', phone: '', plateNo: '대전89아3869', defaultRoute: 'route_choin_egg' },
];

function normPlate(p) {
  return String(p || '').replace(/\s+/g, '');
}

/**
 * 1. 표준 노선 15개 등록 및 최신화
 * 2. 김병훈 대표님 코드를 bh-ceo로 변경
 * 3. 기사 명단에 순차적으로 중복 없이 bh01, bh02... 코드 재부여 및 중복 계정 정리
 * 4. 차량리스트를 스캔하여 근무처/운행코스에 맞는 노선(routeId, routeName)을 차량에 자동 부여
 * 5. 기사와 차량을 양방향 자동 연결
 */
export async function syncMasterDataAndRoutes() {
  const [rSnap, vSnap, uSnap] = await Promise.all([
    getDocs(collection(db, 'Routes')),
    getDocs(collection(db, 'Vehicles')),
    getDocs(collection(db, 'Users')),
  ]);

  // 1. 노선(Routes) 동기화
  const routeBatch = writeBatch(db);
  for (const r of STANDARD_ROUTES) {
    const rRef = doc(db, 'Routes', r.id);
    routeBatch.set(
      rRef,
      {
        id: r.id,
        name: r.name,
        stops: r.stops,
        price: r.price,
        expectedKm: r.expectedKm,
        isVariableKm: r.isVariableKm,
        kmTolerancePct: r.kmTolerancePct,
        sortOrder: r.sortOrder,
        isActive: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
  await routeBatch.commit();

  // 노선 매핑 헬퍼 (차량의 workplace, routeMemo를 보고 노선 자동 찾기)
  const routeNameMap = new Map(STANDARD_ROUTES.map((r) => [r.id, r.name]));
  const findRouteForVehicle = (workplace = '', routeMemo = '') => {
    const text = `${workplace} ${routeMemo}`.replace(/\s+/g, '');
    
    // 세부 구분 먼저 매칭 (교촌-전북 vs 교촌-대전)
    if (text.includes('교촌-전북') || text.includes('교촌전북')) {
      return { routeId: 'route_kyochon_jb', routeName: routeNameMap.get('route_kyochon_jb') };
    }
    if (text.includes('교촌-대전') || text.includes('교촌대전') || text.includes('교촌')) {
      return { routeId: 'route_kyochon_dj', routeName: routeNameMap.get('route_kyochon_dj') };
    }

    for (const r of STANDARD_ROUTES) {
      if (r.id === 'route_kyochon_dj' || r.id === 'route_kyochon_jb') continue;
      for (const w of r.workplaces) {
        if (text.includes(w.replace(/\s+/g, ''))) {
          return { routeId: r.id, routeName: r.name };
        }
      }
    }
    // 기본 B2B 매칭
    return { routeId: 'route_b2b_dj', routeName: routeNameMap.get('route_b2b_dj') };
  };

  // 2. 차량 Map 준비
  const vehiclesByPlate = new Map();
  vSnap.docs.forEach((d) => {
    const v = { id: d.id, ...d.data() };
    const p = normPlate(v.plateNo);
    if (p) vehiclesByPlate.set(p, v);
  });

  // 3. 사용자(Users) 그룹화 & 김병훈 대표님 bh-ceo 코드 갱신
  const usersByNameGroup = new Map();
  let cleanedDuplicatesCount = 0;

  for (const d of uSnap.docs) {
    const u = { id: d.id, ...d.data() };
    const n = String(u.name || '').trim();

    // 김병훈 대표님 코드를 'bh-ceo'로 갱신
    if (n === '김병훈' || (u.role === 'admin' && (!u.name || u.name === '김병훈'))) {
      await setDoc(
        d.ref,
        {
          name: u.name || '김병훈',
          driverCode: 'bh-ceo',
          role: 'admin',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      continue;
    }

    if (n) {
      if (!usersByNameGroup.has(n)) usersByNameGroup.set(n, []);
      usersByNameGroup.get(n).push({ docRef: d.ref, data: u });
    }
  }

  // 4. 기사 순차 코드 재부여 (bh01 ~ bh48) & 중복 문서 정리
  let currentNum = 1;
  const driverResults = [];
  const processedNames = new Set(['김병훈']);

  for (const item of MASTER_DRIVERS) {
    if (item.name === '김병훈') continue;
    if (processedNames.has(item.name)) continue; // 이미 처리된 기사 건너뜀 (중복 방지)
    processedNames.add(item.name);

    let code;
    if (item.name === '정태광') {
      code = 'bh-tk';
    } else {
      code = `bh${String(currentNum).padStart(2, '0')}`;
      currentNum++;
    }

    const group = usersByNameGroup.get(item.name) || [];
    let primaryUser = null;
    if (group.length > 0) {
      primaryUser = group[0].data;
      // 동명이인 중복 문서가 있으면 중복 제거
      if (group.length > 1) {
        for (let i = 1; i < group.length; i++) {
          await deleteDoc(group[i].docRef);
          cleanedDuplicatesCount++;
        }
      }
    }

    let targetVehicle = null;
    if (item.plateNo) {
      targetVehicle = vehiclesByPlate.get(normPlate(item.plateNo));
    }

    const assignedVehId = targetVehicle?.id || primaryUser?.assignedVehicleId || null;
    const defaultRouteId = item.defaultRoute || primaryUser?.defaultRouteId || null;
    const defaultRouteName = routeNameMap.get(defaultRouteId) || null;

    if (primaryUser) {
      // 기존 기사는 코드와 노선 깔끔하게 갱신
      await setDoc(
        doc(db, 'Users', primaryUser.id),
        {
          driverCode: code,
          dept: item.dept,
          phone: item.phone || primaryUser.phone || '',
          defaultRouteId,
          assignedVehicleId: assignedVehId,
          isActive: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      driverResults.push({ name: item.name, code, status: 'updated' });
    } else {
      // 신규 기사 계정 Firebase Auth 생성 (초기비밀번호: 연락처 뒤 6자리 또는 000000)
      const digits = (item.phone || '').replace(/\D/g, '');
      const pin = digits.length >= 6 ? digits.slice(-6) : '000000';
      const email = `${code}@bhlogistics.local`;

      try {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pin);
        const uid = cred.user.uid;
        await signOut(secondaryAuth);

        await setDoc(doc(db, 'Users', uid), {
          role: 'driver',
          driverCode: code,
          name: item.name,
          dept: item.dept,
          phone: item.phone || '',
          hireDate: new Date().toISOString().slice(0, 10),
          assignedVehicleId: assignedVehId,
          defaultRouteId,
          mustChangePassword: true,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        driverResults.push({ name: item.name, code, status: 'created' });
      } catch (err) {
        // 이미 Auth 계정이 있거나 에러가 난 경우 Firestore 문서만 생성/연결
        const dummyUid = `driver_${code}`;
        await setDoc(
          doc(db, 'Users', dummyUid),
          {
            role: 'driver',
            driverCode: code,
            name: item.name,
            dept: item.dept,
            phone: item.phone || '',
            hireDate: new Date().toISOString().slice(0, 10),
            assignedVehicleId: assignedVehId,
            defaultRouteId,
            mustChangePassword: true,
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        driverResults.push({ name: item.name, code, status: 'fallback_doc' });
      }
    }

    // 만약 해당 차량이 있으면 차량에 기사 배정 및 노선 부여
    if (targetVehicle) {
      await setDoc(
        doc(db, 'Vehicles', targetVehicle.id),
        {
          assignedDriverName: item.name,
          routeId: defaultRouteId,
          routeName: defaultRouteName,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  // 5. 명단 외에 기존 DB에 남아있는 다른 기사들도 중복 없이 순차 코드(bh49~) 부여
  for (const [n, group] of usersByNameGroup.entries()) {
    if (processedNames.has(n)) continue;
    for (const item of group) {
      if (item.data.role === 'admin') continue;
      const extraCode = `bh${String(currentNum).padStart(2, '0')}`;
      currentNum++;
      await setDoc(
        item.docRef,
        {
          driverCode: extraCode,
          isActive: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      driverResults.push({ name: n, code: extraCode, status: 'extra_driver' });
    }
  }

  // 6. 전체 차량(Vehicles)을 검사하여 노선(routeId, routeName)이 없는 차량에 근무처 기반 자동 부여
  const vSnapFresh = await getDocs(collection(db, 'Vehicles'));
  const vehBatch = writeBatch(db);
  let vCount = 0;

  for (const d of vSnapFresh.docs) {
    const v = d.data();
    const routeInfo = findRouteForVehicle(v.workplace, v.routeMemo);
    vehBatch.set(
      d.ref,
      {
        routeId: v.routeId || routeInfo.routeId,
        routeName: v.routeName || routeInfo.routeName,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    vCount++;
    if (vCount >= 400) {
      await vehBatch.commit();
      vCount = 0;
    }
  }
  if (vCount > 0) await vehBatch.commit();

  return {
    routesCount: STANDARD_ROUTES.length,
    driversProcessed: driverResults.length,
    vehiclesProcessed: vSnapFresh.size,
    cleanedDuplicatesCount,
  };
}
