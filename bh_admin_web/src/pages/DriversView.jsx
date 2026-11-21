import React, { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  runTransaction,
  GeoPoint,
  query,
  where,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { auth, db, storage, secondaryAuth } from '../firebase';
import {
  calcDday,
  formatKstTime,
  todayKstStr,
  formatNumberWithCommas,
  parseNumberWithoutCommas,
} from '../utils/format';
import Pagination from '../components/Pagination';
import { syncDriverVehicleTx } from '../services/assignment';


const CHO_ROMAN = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp',
  's', 'ss', 'y', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
];

function getKoreanInitials(name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) return '';
  let out = '';
  for (const ch of cleaned) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = Math.floor((code - 0xac00) / 588);
      out += CHO_ROMAN[idx] || '';
    } else if (/[a-z0-9]/i.test(ch)) {
      out += ch.toLowerCase();
    }
  }
  return out;
}

function normalizeCode(raw) {
  return String(raw || '').trim().toLowerCase();
}

function isValidDriverCode(code) {
  return /^[a-z0-9._-]{2,32}$/.test(code);
}

function resolveDriverPin(phoneStr, customPin = '') {
  const trimmed = String(customPin || '').trim();
  if (trimmed.length >= 6) return trimmed;
  const digits = String(phoneStr || '').replace(/[^0-9]/g, '');
  if (digits.length >= 6) return digits.slice(-6);
  return '000000';
}

function makeUniqueCode(base, usedSet, disambiguator = '') {
  if (!base) return '';
  const cleanBase = normalizeCode(base);
  if (!usedSet.has(cleanBase)) return cleanBase;
  if (disambiguator) {
    const withDisambig = `${cleanBase}${disambiguator}`;
    if (!usedSet.has(withDisambig)) return withDisambig;
  }
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${cleanBase}${n}`;
    if (!usedSet.has(candidate)) return candidate;
  }
  return cleanBase;
}

function buildSuggestedCodes({
  name,
  phone,
  assignedVehicleId,
  vehicles,
  drivers,
  currentDriverId,
}) {
  const veh = vehicles.find((v) => v.id === assignedVehicleId);
  const plateDigits = String(veh?.plateNo || '').replace(/[^0-9]/g, '');
  const plate4 = plateDigits.length >= 4 ? plateDigits.slice(-4) : plateDigits;
  const plate2 = plateDigits.length >= 2 ? plateDigits.slice(-2) : '';

  const phoneDigits = String(phone || '').replace(/[^0-9]/g, '');
  const phone4 = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : phoneDigits;
  const phone2 = phoneDigits.length >= 2 ? phoneDigits.slice(-2) : '';

  const initials = getKoreanInitials(name);
  const usedSet = new Set(
    drivers
      .filter((d) => d.id !== currentDriverId)
      .map((d) => normalizeCode(d.driverCode))
      .filter(Boolean)
  );

  const rawCandidates = [];
  if (plate4) {
    rawCandidates.push({
      key: 'vehicle4',
      label: '🚛 차량번호',
      code: makeUniqueCode(`bh-${plate4}`, usedSet, initials),
    });
  }
  if (initials) {
    rawCandidates.push({
      key: 'initials',
      label: '👤 성함초성',
      code: makeUniqueCode(`bh-${initials}`, usedSet, plate2 || phone2),
    });
  }
  if (phone4) {
    rawCandidates.push({
      key: 'phone4',
      label: '📱 연락처4자리',
      code: makeUniqueCode(`bh-${phone4}`, usedSet, initials),
    });
  }
  if (initials && (plate2 || phone2)) {
    rawCandidates.push({
      key: 'hybrid',
      label: '🔖 초성+차량2자리',
      code: makeUniqueCode(`bh-${initials}${plate2 || phone2}`, usedSet),
    });
  }

  const seen = new Set();
  return rawCandidates.filter((item) => {
    if (!item.code || seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  });
}

/* ============================================================================
 * [관리자 5] 기사 관리 (Users) - [+ 신규 기사 생성] 버튼 클릭 시 모달 창 오픈
 * ========================================================================== */
export default function DriversView() {
  const [drivers, setDrivers] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDriver, setEditingDriver] = useState(null);
  const [searchDriver, setSearchDriver] = useState('');
  const [page, setPage] = useState(1);

  const [driverCode, setDriverCode] = useState('');
  const [birthPin, setBirthPin] = useState('');
  const [driverName, setDriverName] = useState('');
  const [phone, setPhone] = useState('');
  const [hireDate, setHireDate] = useState(todayKstStr());
  const [defaultRouteId, setDefaultRouteId] = useState('');
  const [assignedVehicleId, setAssignedVehicleId] = useState('');
  const [msg, setMsg] = useState('');
  const [savingDriver, setSavingDriver] = useState(false);

  // 기사앱 버전 배포 알림 설정 상태 (Settings/appVersion)
  const [latestAppVersion, setLatestAppVersion] = useState('1.1.0');
  const [apkUrl, setApkUrl] = useState(
    'https://bh-logistics-f45d8.web.app/bh-driver.apk'
  );
  const [updateMsg, setUpdateMsg] = useState(
    '더 편리해진 새 버전이 나왔어요. 아래 버튼을 눌러 업데이트해 주세요.'
  );
  const [forceUpdate, setForceUpdate] = useState(false);

  const loadAll = async () => {
    const [uSnap, rSnap, vSnap, verSnap] = await Promise.all([
      getDocs(collection(db, 'Users')),
      getDocs(collection(db, 'Routes')),
      getDocs(collection(db, 'Vehicles')),
      getDoc(doc(db, 'Settings', 'appVersion')),
    ]);
    setDrivers(
      uSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => (u.role !== 'admin' && u.role !== 'accounting') || u.driverCode === 'bh-ceo' || u.name === '김병훈')
        .sort((a, b) => {
          if (a.driverCode === 'bh-ceo') return -1;
          if (b.driverCode === 'bh-ceo') return 1;
          if (a.driverCode === 'bh-tk' || a.name === '정태광') return -1;
          if (b.driverCode === 'bh-tk' || b.name === '정태광') return 1;
          return (a.driverCode || '').localeCompare(b.driverCode || '', undefined, { numeric: true });
        })
    );
    setRoutes(rSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setVehicles(
      vSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((v) => v.isActive !== false)
    );
    if (verSnap.exists()) {
      const vData = verSnap.data() || {};
      if (vData.latestVersion) setLatestAppVersion(vData.latestVersion);
      if (vData.apkUrl) setApkUrl(vData.apkUrl);
      if (vData.message) setUpdateMsg(vData.message);
      if (typeof vData.forceUpdate === 'boolean') {
        setForceUpdate(vData.forceUpdate);
      }
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const openCreateDriverModal = () => {
    setEditingDriver(null);
    setDriverCode('');
    setBirthPin('');
    setDriverName('');
    setPhone('');
    setHireDate(todayKstStr());
    setDefaultRouteId('');
    setAssignedVehicleId('');
    setMsg('');
    setShowCreateModal(true);
  };

  const openEditDriverModal = (d) => {
    setEditingDriver(d);
    setDriverCode(d.driverCode || '');
    setBirthPin('');
    setDriverName(d.name || '');
    setPhone(d.phone || '');
    setHireDate(d.hireDate || todayKstStr());
    setDefaultRouteId(d.defaultRouteId || '');
    setAssignedVehicleId(d.assignedVehicleId || '');
    setMsg('');
    setShowCreateModal(true);
  };

  const changeDriverAuthCode = async ({
    driver,
    newCode,
    newPin,
    updatedFields,
    vehicleIdToAssign,
  }) => {
    const cleanCode = normalizeCode(newCode);
    const oldCode = normalizeCode(driver.driverCode);
    const targetPin = resolveDriverPin(
      updatedFields.phone ?? driver.phone,
      newPin
    );

    if (cleanCode === oldCode) {
      await setDoc(
        doc(db, 'Users', driver.id),
        {
          ...updatedFields,
          driverCode: cleanCode,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await syncDriverVehicleTx({
        driverId: driver.id,
        vehicleId: vehicleIdToAssign || null,
      });
      return {
        newUid: driver.id,
        codeChanged: false,
        cleanCode,
        appliedPin: null,
      };
    }

    if (auth.currentUser && driver.id === auth.currentUser.uid) {
      throw new Error(
        '현재 로그인된 관리자 계정의 기사 코드는 여기서 변경할 수 없습니다.'
      );
    }

    const email = `${cleanCode}@bhlogistics.local`;
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        email,
        targetPin
      );
    } catch (authErr) {
      if (authErr.code === 'auth/email-already-in-use') {
        const oldPhoneDigits = String(driver.phone || '').replace(
          /[^0-9]/g,
          ''
        );
        const candidatePins = Array.from(
          new Set(
            [
              targetPin,
              oldPhoneDigits.length >= 6 ? oldPhoneDigits.slice(-6) : null,
              '000000',
              '123456',
            ].filter(Boolean)
          )
        );
        let signedIn = null;
        for (const pin of candidatePins) {
          try {
            signedIn = await signInWithEmailAndPassword(
              secondaryAuth,
              email,
              pin
            );
            break;
          } catch (_) {
            // 다음 후보 비밀번호 시도
          }
        }
        if (!signedIn) {
          throw new Error(
            `코드(${cleanCode})는 이미 인증 서버에 등록되어 있고 비밀번호가 다릅니다. 다른 코드를 선택해 주세요.`
          );
        }
        cred = signedIn;
        if (String(newPin || '').trim().length >= 6) {
          try {
            await updatePassword(cred.user, String(newPin).trim());
          } catch (_) {
            // 비밀번호 변경 불가 시 기존 인증 유지
          }
        }
      } else {
        throw authErr;
      }
    }

    const newUid = cred.user.uid;
    try {
      await signOut(secondaryAuth);
    } catch (_) {}

    const { id: _ignoredId, ...restDriverData } = driver;
    await setDoc(
      doc(db, 'Users', newUid),
      {
        ...restDriverData,
        ...updatedFields,
        role: restDriverData.role || 'driver',
        driverCode: cleanCode,
        isActive: restDriverData.isActive !== false,
        assignedVehicleId: restDriverData.assignedVehicleId || null,
        mustChangePassword:
          typeof restDriverData.mustChangePassword === 'boolean'
            ? restDriverData.mustChangePassword
            : true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await syncDriverVehicleTx({
      driverId: newUid,
      vehicleId: vehicleIdToAssign || null,
    });

    if (newUid !== driver.id) {
      if (
        driver.assignedVehicleId &&
        driver.assignedVehicleId !== (vehicleIdToAssign || null)
      ) {
        await setDoc(
          doc(db, 'Vehicles', driver.assignedVehicleId),
          {
            assignedDriverId: null,
            assignedDriverName: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      await deleteDoc(doc(db, 'Users', driver.id));
    }

    return {
      newUid,
      codeChanged: true,
      cleanCode,
      appliedPin: targetPin,
    };
  };

  const handleSaveDriver = async (e) => {
    e.preventDefault();
    if (savingDriver) return;
    setMsg('');

    const cleanCode = normalizeCode(driverCode);
    if (!cleanCode || !isValidDriverCode(cleanCode)) {
      setMsg(
        '기사 코드는 영문 소문자, 숫자, 하이픈(-), 밑줄(_)로 2자 이상 입력해 주세요. (예: bh-8805, bh-jtg)'
      );
      return;
    }

    const duplicated = drivers.find(
      (d) =>
        d.id !== editingDriver?.id &&
        normalizeCode(d.driverCode) === cleanCode
    );
    if (duplicated) {
      setMsg(
        `이미 [${duplicated.name}] 기사님이 사용 중인 코드(${cleanCode})입니다. 다른 코드를 입력해 주세요.`
      );
      return;
    }

    // 1) 기존 기사 정보 수정 모드
    if (editingDriver) {
      if (!driverName.trim()) {
        setMsg('기사 성함을 입력해 주세요.');
        return;
      }
      if (birthPin.trim() && birthPin.trim().length < 6) {
        setMsg('새 비밀번호는 6자리 이상이거나, 비워두셔야 합니다.');
        return;
      }
      setSavingDriver(true);
      try {
        const result = await changeDriverAuthCode({
          driver: editingDriver,
          newCode: cleanCode,
          newPin: birthPin.trim(),
          updatedFields: {
            name: driverName.trim(),
            phone: phone.trim(),
            hireDate,
            defaultRouteId: defaultRouteId || null,
          },
          vehicleIdToAssign: assignedVehicleId || null,
        });
        setShowCreateModal(false);
        setEditingDriver(null);
        setBirthPin('');
        await loadAll();
        if (result.codeChanged) {
          alert(
            `✅ [${driverName.trim()}] 기사 코드가 [${result.cleanCode}](으)로 변경되었습니다!\n` +
              `기사앱 로그인 비밀번호: ${result.appliedPin}\n` +
              `(기사님께 새 코드로 다시 로그인하도록 안내해 주세요.)`
          );
        }
      } catch (err) {
        setMsg(`❌ 오류: ${err.message}`);
      } finally {
        setSavingDriver(false);
      }
      return;
    }

    // 2) 신규 기사 생성 모드
    if (!cleanCode || birthPin.trim().length < 6 || !driverName.trim()) {
      setMsg('기사 코드, 초기 비밀번호 6자리, 성함을 모두 입력해 주세요.');
      return;
    }
    setSavingDriver(true);
    try {
      const email = `${cleanCode}@bhlogistics.local`;
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        email,
        birthPin.trim()
      );
      const uid = cred.user.uid;
      try {
        await signOut(secondaryAuth);
      } catch (_) {}

      await setDoc(doc(db, 'Users', uid), {
        role: 'driver',
        driverCode: cleanCode,
        name: driverName.trim(),
        phone: phone.trim(),
        hireDate,
        assignedVehicleId: null,
        defaultRouteId: defaultRouteId || null,
        mustChangePassword: true,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (assignedVehicleId) {
        await syncDriverVehicleTx({
          driverId: uid,
          vehicleId: assignedVehicleId,
        });
      }

      setDriverCode('');
      setBirthPin('');
      setDriverName('');
      setPhone('');
      setAssignedVehicleId('');
      setShowCreateModal(false);
      alert(`✅ 기사 등록 완료! (ID코드: ${cleanCode}, 초기비밀번호: ${birthPin.trim()})`);
      await loadAll();
    } catch (err) {
      setMsg(`❌ 오류: ${err.message}`);
    } finally {
      setSavingDriver(false);
    }
  };

  const toggleActive = async (d) => {
    const next = d.isActive === false;
    if (
      !next &&
      !window.confirm(`${d.name} 기사를 비활성 처리하시겠습니까?`)
    ) {
      return;
    }
    await setDoc(
      doc(db, 'Users', d.id),
      { isActive: next, updatedAt: serverTimestamp() },
      { merge: true }
    );
    loadAll();
  };

  const handleChangeRoute = async (driver, newRouteId) => {
    await setDoc(
      doc(db, 'Users', driver.id),
      { defaultRouteId: newRouteId || null, updatedAt: serverTimestamp() },
      { merge: true }
    );
    loadAll();
  };

  const handleChangeDriverVehicle = async (driver, newVehicleId) => {
    try {
      await syncDriverVehicleTx({
        driverId: driver.id,
        vehicleId: newVehicleId || null,
      });
      await loadAll();
    } catch (err) {
      alert('차량 배정 변경 실패: ' + err.message);
    }
  };

  const filteredDrivers = drivers.filter((d) => {
    if (!searchDriver.trim()) return true;
    const q = searchDriver.trim().toLowerCase();
    return (
      (d.name || '').toLowerCase().includes(q) ||
      (d.driverCode || '').toLowerCase().includes(q) ||
      (d.phone || '').includes(q)
    );
  });
  const totalPages = Math.max(1, Math.ceil(filteredDrivers.length / 10));
  const currentPage = Math.min(page, totalPages);
  const pagedDrivers = filteredDrivers.slice(
    (currentPage - 1) * 10,
    currentPage * 10
  );

  const suggestedCodes = showCreateModal
    ? buildSuggestedCodes({
        name: driverName,
        phone,
        assignedVehicleId,
        vehicles,
        drivers,
        currentDriverId: editingDriver?.id,
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">기사 관리 (Users)</h1>
          <p className="text-sm text-slate-500 mt-1">
            기사 코드를 클릭하거나 [정보 수정]을 눌러 로그인 코드·차량·노선·연락처를 바꿀 수 있습니다.
          </p>
        </div>
        <button
          onClick={openCreateDriverModal}
          className="px-5 py-2.5 bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold rounded-xl text-sm shadow whitespace-nowrap"
        >
          + 신규 기사 생성
        </button>
      </div>

      {/* 기사앱 새 버전 업데이트 알림 설정 카드 (Settings/appVersion) */}
      <div className="bg-blue-50/80 border border-blue-200 rounded-2xl p-4 space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-black text-blue-950">
              📲 기사앱 버전 & 원격 업데이트 알림 관리 (Settings/appVersion)
            </div>
            <div className="text-xs text-blue-800">
              최신 버전을 1.0.1처럼 올리고 저장하면, 기사님이 앱을 켰을 때
              자동으로 <b>&quot;새로운 버전이 나왔어요! [지금 업데이트하기]&quot;</b>{' '}
              창이 뜹니다.
            </div>
          </div>
          <button
            onClick={async () => {
              await setDoc(
                doc(db, 'Settings', 'appVersion'),
                {
                  latestVersion: latestAppVersion.trim(),
                  apkUrl: apkUrl.trim(),
                  message: updateMsg.trim(),
                  forceUpdate,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
              alert(
                `기사앱 최신 버전이 v${latestAppVersion}로 저장되었습니다!`
              );
            }}
            className="px-4 py-2 rounded-xl bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold text-xs whitespace-nowrap shadow"
          >
            버전 · 업데이트 알림 저장
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              최신 버전 번호 (예: 1.0.0 또는 1.0.1)
            </label>
            <input
              value={latestAppVersion}
              onChange={(e) => setLatestAppVersion(e.target.value)}
              className="w-full px-3 py-1.5 border rounded-xl bg-white font-black"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">
              설치파일(APK) 다운로드 주소
            </label>
            <input
              value={apkUrl}
              onChange={(e) => setApkUrl(e.target.value)}
              className="w-full px-3 py-1.5 border rounded-xl bg-white font-semibold"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              안내 문구 및 강제 여부
            </label>
            <div className="flex items-center gap-2">
              <input
                value={updateMsg}
                onChange={(e) => setUpdateMsg(e.target.value)}
                className="flex-1 min-w-0 px-3 py-1.5 border rounded-xl bg-white"
              />
              <label className="flex items-center gap-1 text-xs font-bold whitespace-nowrap cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceUpdate}
                  onChange={(e) => setForceUpdate(e.target.checked)}
                />
                필수
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 기사 검색 */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          placeholder="기사 이름 · 기사 코드 · 전화번호 검색"
          value={searchDriver}
          onChange={(e) => {
            setSearchDriver(e.target.value);
            setPage(1);
          }}
          className="w-full sm:w-80 px-3.5 py-2 border rounded-xl bg-white text-sm"
        />
        {searchDriver && (
          <button
            onClick={() => {
              setSearchDriver('');
              setPage(1);
            }}
            className="px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-800"
          >
            검색 초기화 ✕
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm text-left">
            <thead className="bg-slate-50 border-b font-bold">
              <tr>
                <th className="p-3 whitespace-nowrap">기사 코드</th>
                <th className="p-3 whitespace-nowrap">이름</th>
                <th className="p-3 whitespace-nowrap">전화번호</th>
                <th className="p-3 whitespace-nowrap">배정 차량 (양방향 변경)</th>
                <th className="p-3 whitespace-nowrap">담당 노선 (변경 가능)</th>
                <th className="p-3 whitespace-nowrap">입사일</th>
                <th className="p-3 whitespace-nowrap">관리 (수정 / 상태 / 삭제)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pagedDrivers.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-8 text-center text-slate-400 font-semibold">
                    등록된 기사가 없거나 조건에 맞는 기사가 없습니다.
                  </td>
                </tr>
              ) : (
                pagedDrivers.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="p-3 font-bold text-[#1E5EFF]">
                    <button
                      type="button"
                      onClick={() => openEditDriverModal(d)}
                      title="클릭하여 기사 코드 수정"
                      className="group inline-flex items-center gap-1.5 text-left hover:underline cursor-pointer"
                    >
                      {d.driverCode === 'bh-ceo' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-amber-500 text-white font-black text-xs shadow-sm">
                          👑 bh-ceo
                        </span>
                      ) : d.driverCode === 'bh-tk' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-indigo-600 text-white font-black text-xs shadow-sm">
                          ⭐ bh-tk
                        </span>
                      ) : (
                        <span>{d.driverCode || '-'}</span>
                      )}
                      <span className="text-[11px] text-slate-400 group-hover:text-[#1E5EFF]">
                        ✎
                      </span>
                    </button>
                  </td>
                  <td className="p-3 font-bold">
                    {d.name}
                    {d.driverCode === 'bh-ceo' && (
                      <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                        대표
                      </span>
                    )}
                    {(d.driverCode === 'bh-tk' || d.name === '정태광') && (
                      <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] font-black bg-indigo-100 text-indigo-800 border border-indigo-300">
                        간선
                      </span>
                    )}
                  </td>
                  <td className="p-3">{d.phone || '-'}</td>
                  <td className="p-3">
                    <select
                      value={d.assignedVehicleId || ''}
                      onChange={(e) =>
                        handleChangeDriverVehicle(d, e.target.value)
                      }
                      className={`px-2.5 py-1.5 border rounded-lg font-bold text-xs ${
                        d.assignedVehicleId
                          ? 'bg-white text-slate-800 border-slate-300'
                          : 'bg-amber-50 text-amber-700 border-amber-300'
                      }`}
                    >
                      <option value="">차량 미배정</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plateNo} ({v.manufacturer} {v.model}
                          {v.assignedDriverName && v.assignedDriverId !== d.id
                            ? ` · 현재:${v.assignedDriverName}`
                            : ''}
                          )
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <select
                      value={d.defaultRouteId || ''}
                      onChange={(e) => handleChangeRoute(d, e.target.value)}
                      className="px-2.5 py-1.5 border rounded-lg bg-white font-semibold text-xs"
                    >
                      <option value="">노선 미지정</option>
                      {routes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">{d.hireDate || '-'}</td>
                  <td className="p-3 space-x-1.5 whitespace-nowrap">
                    <button
                      onClick={() => openEditDriverModal(d)}
                      className="px-2.5 py-1 rounded bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                    >
                      정보 수정
                    </button>
                    <button
                      onClick={() => toggleActive(d)}
                      className={`px-2.5 py-1 rounded text-xs font-bold whitespace-nowrap inline-flex items-center justify-center shrink-0 ${
                        d.isActive !== false
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {d.isActive !== false ? '활성' : '비활성'}
                    </button>
                    <button
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `정말 [${d.name}] 기사를 삭제하시겠습니까? 배정된 차량이 있으면 자동으로 공차(미배정)로 전환됩니다.`
                          )
                        ) {
                          return;
                        }
                        if (d.assignedVehicleId) {
                          await setDoc(
                            doc(db, 'Vehicles', d.assignedVehicleId),
                            {
                              assignedDriverId: null,
                              assignedDriverName: null,
                              updatedAt: serverTimestamp(),
                            },
                            { merge: true }
                          );
                        }
                        await deleteDoc(doc(db, 'Users', d.id));
                        loadAll();
                      }}
                      className="px-2.5 py-1 rounded border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 whitespace-nowrap"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={filteredDrivers.length}
          pageSize={10}
          onPageChange={setPage}
        />
      </div>

      {/* 신규 기사 생성 / 기존 기사 수정 모달 창 */}
      {showCreateModal && (
        <div
          onClick={() => !savingDriver && setShowCreateModal(false)}
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 sm:p-6 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <div className="text-xs font-bold text-[#1E5EFF]">
                  기사 계정 · 차량 · 노선 관리
                </div>
                <h2 className="text-xl font-black">
                  {editingDriver
                    ? `${editingDriver.name} (${editingDriver.driverCode}) 정보 수정`
                    : '신규 기사 생성'}
                </h2>
              </div>
              <button
                type="button"
                disabled={savingDriver}
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-100 font-bold text-sm"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleSaveDriver} className="space-y-3 text-sm">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  1. 기사 코드 (로그인 아이디)
                </label>
                <input
                  placeholder="예: bh-8805 또는 bh-jtg"
                  value={driverCode}
                  onChange={(e) => setDriverCode(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-xl font-bold"
                />
                {suggestedCodes.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500 mr-0.5">
                      추천 코드 클릭 적용:
                    </span>
                    {suggestedCodes.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setDriverCode(s.code)}
                        className={`px-2 py-1 rounded-lg text-xs font-bold border transition ${
                          normalizeCode(driverCode) === s.code
                            ? 'bg-[#1E5EFF] text-white border-[#1E5EFF]'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-blue-50 hover:border-blue-300'
                        }`}
                      >
                        {s.label} ({s.code})
                      </button>
                    ))}
                  </div>
                )}
                {editingDriver &&
                  normalizeCode(driverCode) &&
                  normalizeCode(driverCode) !==
                    normalizeCode(editingDriver.driverCode) && (
                    <p className="mt-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      코드를 바꾸면 새 로그인 계정이 생성되어 기존 기사 정보와 배정 차량이 자동으로 연결됩니다.
                    </p>
                  )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {editingDriver
                    ? '2. 비밀번호 설정 (코드 변경 시 적용 · 선택)'
                    : '2. 초기 비밀번호 (생년월일 또는 연락처 6자리)'}
                </label>
                <input
                  placeholder={
                    editingDriver
                      ? '비워두면 연락처 뒤 6자리(또는 000000)로 자동 설정'
                      : '예: 700101 (첫 로그인 후 기사님이 직접 변경)'
                  }
                  value={birthPin}
                  onChange={(e) => setBirthPin(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-xl font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    3. 기사 성함
                  </label>
                  <input
                    placeholder="예: 최동훈"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    4. 연락처
                  </label>
                  <input
                    placeholder="예: 010-1234-5678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    5. 배정할 차량 (양방향 연동)
                  </label>
                  <select
                    value={assignedVehicleId}
                    onChange={(e) => setAssignedVehicleId(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl bg-white font-bold"
                  >
                    <option value="">차량 미배정</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plateNo} ({v.manufacturer} {v.model})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    6. 기본 담당 노선
                  </label>
                  <select
                    value={defaultRouteId}
                    onChange={(e) => setDefaultRouteId(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl bg-white font-semibold"
                  >
                    <option value="">노선 선택</option>
                    {routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  7. 입사일
                </label>
                <input
                  type="date"
                  value={hireDate}
                  onChange={(e) => setHireDate(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-xl"
                />
              </div>

              {msg && (
                <div className="p-3 rounded-xl bg-red-50 text-red-600 font-bold text-xs">
                  {msg}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  disabled={savingDriver}
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={savingDriver}
                  className="px-5 py-2.5 rounded-xl bg-[#1E5EFF] text-white font-bold disabled:opacity-60"
                >
                  {savingDriver
                    ? '저장 중...'
                    : editingDriver
                      ? '기사 정보 수정 저장'
                      : '기사 계정 생성하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
