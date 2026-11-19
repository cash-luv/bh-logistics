import React, { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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

  // 기사앱 버전 배포 알림 설정 상태 (Settings/appVersion)
  const [latestAppVersion, setLatestAppVersion] = useState('1.0.8');
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
        .filter((u) => u.role !== 'admin' || u.driverCode === 'bh-ceo' || u.name === '김병훈')
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

  const handleSaveDriver = async (e) => {
    e.preventDefault();
    setMsg('');

    // 1) 기존 기사 정보 수정 모드
    if (editingDriver) {
      if (!driverName.trim()) {
        setMsg('기사 성함을 입력해 주세요.');
        return;
      }
      try {
        await setDoc(
          doc(db, 'Users', editingDriver.id),
          {
            name: driverName.trim(),
            phone: phone.trim(),
            hireDate,
            defaultRouteId: defaultRouteId || null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        await syncDriverVehicleTx({
          driverId: editingDriver.id,
          vehicleId: assignedVehicleId || null,
        });
        setShowCreateModal(false);
        setEditingDriver(null);
        await loadAll();
      } catch (err) {
        setMsg(`❌ 오류: ${err.message}`);
      }
      return;
    }

    // 2) 신규 기사 생성 모드
    if (!driverCode || birthPin.length < 6 || !driverName) {
      setMsg('기사 코드, 초기 생년월일 6자리, 성함을 모두 입력해 주세요.');
      return;
    }
    try {
      const code = driverCode.trim().toLowerCase();
      const email = `${code}@bhlogistics.local`;
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        email,
        birthPin.trim()
      );
      const uid = cred.user.uid;
      await signOut(secondaryAuth);

      await setDoc(doc(db, 'Users', uid), {
        role: 'driver',
        driverCode: code,
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
      alert(`✅ 기사 등록 완료! (ID코드: ${code}, 초기비밀번호: ${birthPin})`);
      loadAll();
    } catch (err) {
      setMsg(`❌ 오류: ${err.message}`);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">기사 관리 (Users)</h1>
          <p className="text-sm text-slate-500 mt-1">
            우측 상단 [+ 신규 기사 생성] 또는 각 기사의 [정보 수정] 버튼으로 차량·노선·연락처를 양방향으로 관리할 수 있습니다.
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
                    {d.driverCode === 'bh-ceo' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-amber-500 text-white font-black text-xs shadow-sm">
                        👑 bh-ceo
                      </span>
                    ) : d.driverCode === 'bh-tk' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-indigo-600 text-white font-black text-xs shadow-sm">
                        ⭐ bh-tk
                      </span>
                    ) : (
                      d.driverCode || '-'
                    )}
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
          onClick={() => setShowCreateModal(false)}
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-6 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl"
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
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-100 font-bold text-sm"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleSaveDriver} className="space-y-3 text-sm">
              {!editingDriver && (
                <>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      1. 부여할 기사 코드 (로그인 아이디)
                    </label>
                    <input
                      placeholder="예: bh04"
                      value={driverCode}
                      onChange={(e) => setDriverCode(e.target.value)}
                      className="w-full px-3 py-2.5 border rounded-xl font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      2. 초기 비밀번호 (생년월일 6자리)
                    </label>
                    <input
                      placeholder="예: 700101 (첫 로그인 후 기사님이 직접 변경)"
                      value={birthPin}
                      onChange={(e) => setBirthPin(e.target.value)}
                      className="w-full px-3 py-2.5 border rounded-xl font-bold"
                    />
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {editingDriver ? '1. 기사 성함' : '3. 기사 성함'}
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
                    {editingDriver ? '2. 연락처' : '4. 연락처'}
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
                    {editingDriver
                      ? '3. 배정할 차량 (양방향 연동)'
                      : '5. 배정할 차량 (양방향 연동)'}
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
                    {editingDriver ? '4. 기본 담당 노선' : '6. 기본 담당 노선'}
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
                  {editingDriver ? '5. 입사일' : '7. 입사일'}
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
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#1E5EFF] text-white font-bold"
                >
                  {editingDriver ? '기사 정보 수정 저장' : '기사 계정 생성하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
