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


/* ============================================================================
 * [관리자 9] 차량 상세 화면 (검사 완료 처리, 주차 위치 이름 수정, 정비 이력 planned/done, 최근 운행 10건)
 * ========================================================================== */
export default function VehicleDetailView({ vehicleId, adminUid, onBack }) {
  const [vehicle, setVehicle] = useState(null);
  const [maintList, setMaintList] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [maintTab, setMaintTab] = useState('planned');
  const [placeNameInput, setPlaceNameInput] = useState('');
  const [extra, setExtra] = useState({});

  // 엑셀(차량기록)에서 가져온 차량 상세 항목
  const EXTRA_FIELDS = [
    { k: 'workplace', label: '근무처' },
    { k: 'model', label: '차명' },
    { k: 'tonnage', label: '적재정량' },
    { k: 'vehicleType', label: '형식' },
    { k: 'vinNo', label: '차대번호' },
    { k: 'emissionGrade', label: '배출가스 등급' },
    { k: 'vehicleClass', label: '차종(소형·중형·대형)' },
    { k: 'modelYear', label: '모델연도' },
    { k: 'insuranceCompany', label: '보험사' },
    { k: 'insuranceAge', label: '보험연령' },
    { k: 'insuranceCancel', label: '보험취소' },
    { k: 'insuranceStart', label: '보험 시작일', type: 'date' },
    { k: 'insuranceEnd', label: '보험 종료일', type: 'date' },
    { k: 'inspectionStartDate', label: '차검 만료일(시작)', type: 'date' },
    { k: 'inspectionDueDate', label: '차검 최종 만료일', type: 'date' },
    { k: 'lastInspectionDate', label: '마지막 검사일', type: 'date' },
    { k: 'ownerName', label: '현물출자자' },
    { k: 'employmentReportName', label: '취업보고' },
    { k: 'memoDriverName', label: '운전자(엑셀)' },
    { k: 'memoDriverPhone', label: '운전자 연락처' },
    { k: 'routeMemo', label: '운행코스' },
    { k: 'hipassCard', label: '하이패스(회사 카드)' },
  ];
  const CARGO_FLAGS = [
    { k: 'foodCargo', label: '식품' },
    { k: 'livestockCargo', label: '축산' },
    { k: 'eggCargo', label: '알' },
  ];

  // 검사 완료 모달
  const [lastInsp, setLastInsp] = useState(todayKstStr());
  const [nextInsp, setNextInsp] = useState('2027-12-25');

  // 정비 추가 폼
  const [category, setCategory] = useState('engine_oil');
  const [title, setTitle] = useState('');
  const [dueOdometerKm, setDueOdometerKm] = useState('');

  const loadDetail = async () => {
    const vSnap = await getDoc(doc(db, 'Vehicles', vehicleId));
    if (vSnap.exists()) {
      const data = { id: vSnap.id, ...vSnap.data() };
      setVehicle(data);
      setPlaceNameInput(data.parking?.placeName || '');
      setExtra({ ...data });
    }
    const mSnap = await getDocs(
      query(collection(db, 'Maintenance'), where('vehicleId', '==', vehicleId))
    );
    setMaintList(mSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

    const lSnap = await getDocs(
      query(collection(db, 'DailyLogs'), where('vehicleId', '==', vehicleId))
    );
    setRecentLogs(
      lSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.workDate || '').localeCompare(a.workDate || ''))
        .slice(0, 10)
    );
  };

  useEffect(() => {
    loadDetail();
  }, [vehicleId]);

  if (!vehicle) {
    return <div className="p-8 text-slate-500">차량 정보를 불러오는 중...</div>;
  }

  const handleUpdateInspection = async () => {
    await setDoc(
      doc(db, 'Vehicles', vehicleId),
      {
        lastInspectionDate: lastInsp,
        inspectionDueDate: nextInsp,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await loadDetail();
    alert('정기검사 일자가 갱신되었습니다.');
  };

  const handleSavePlaceName = async () => {
    await setDoc(
      doc(db, 'Vehicles', vehicleId),
      {
        parking: {
          ...(vehicle.parking || {}),
          placeName: placeNameInput.trim(),
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await loadDetail();
    alert('주차 위치 장소명이 저장되었습니다.');
  };

  const handleAddMaintenance = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const batch = writeBatch(db);
    const mRef = doc(collection(db, 'Maintenance'));
    batch.set(mRef, {
      vehicleId,
      plateNo: vehicle.plateNo,
      category,
      title: title.trim(),
      status: 'planned',
      yearMonth: todayKstStr().slice(0, 7),
      odometerKm: Number(vehicle.odometerKm) || 0,
      dueOdometerKm: dueOdometerKm ? parseNumberWithoutCommas(dueOdometerKm) : null,
      cost: 0,
      vendor: '',
      source: 'admin',
      reportedBy: adminUid,
      reportedByName: '관리자',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(db, 'Vehicles', vehicleId),
      {
        openMaintenanceCount: (Number(vehicle.openMaintenanceCount) || 0) + 1,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();
    setTitle('');
    setDueOdometerKm('');
    await loadDetail();
  };

  // planned -> done 완료 처리 (WriteBatch로 openMaintenanceCount 차감)
  const handleCompleteMaint = async (m) => {
    const costStr = window.prompt('수리 비용(원)을 입력해 주세요:', '150000');
    if (costStr === null) return;
    const vendorStr =
      window.prompt('정비소 이름을 입력해 주세요:', '대전 종합정비') || '';

    const batch = writeBatch(db);
    batch.set(
      doc(db, 'Maintenance', m.id),
      {
        status: 'done',
        performedDate: todayKstStr(),
        cost: Number(costStr) || 0,
        vendor: vendorStr,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    batch.set(
      doc(db, 'Vehicles', vehicleId),
      {
        openMaintenanceCount: Math.max(
          0,
          (Number(vehicle.openMaintenanceCount) || 1) - 1
        ),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();
    await loadDetail();
  };

  const dDay = calcDday(vehicle.inspectionDueDate);

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="px-4 py-2 rounded-xl bg-white border font-bold text-sm"
      >
        ← 차량 목록으로 돌아가기
      </button>

      {/* 기본 정보 + 정기검사 갱신 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-2">
          <div className="text-xs font-bold text-[#1E5EFF]">차량 상세 정보</div>
          <h1 className="text-2xl font-black">
            {vehicle.plateNo} ({vehicle.manufacturer} {vehicle.model} ·{' '}
            {vehicle.modelYear}년식)
          </h1>
          <div className="text-sm text-slate-600 flex flex-wrap items-center gap-2">
            <span>
              누적 주행거리:{' '}
              <b>{(Number(vehicle.odometerKm) || 0).toLocaleString()}km</b>
            </span>
            <button
              onClick={async () => {
                const next = window.prompt(
                  `[${vehicle.plateNo}] 차량의 누적 주행거리(km)를 입력해 주세요:`,
                  String(vehicle.odometerKm || 0)
                );
                if (next === null) return;
                const val = Number(next);
                if (Number.isNaN(val) || val < 0) return;
                await setDoc(
                  doc(db, 'Vehicles', vehicleId),
                  { odometerKm: val, updatedAt: serverTimestamp() },
                  { merge: true }
                );
                await loadDetail();
              }}
              className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 font-bold text-xs hover:bg-blue-100"
            >
              주행거리 수정 ✎
            </button>
            <span>
              · 배정 기사: <b>{vehicle.assignedDriverName || '공차(미배정)'}</b>
            </span>
          </div>
          <div className="text-sm">
            검사 만료일: <b>{vehicle.inspectionDueDate}</b>{' '}
            {dDay != null && (
              <span className="ml-2 px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-xs">
                {dDay < 0 ? `D+${Math.abs(dDay)} 초과` : `D-${dDay}`}
              </span>
            )}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border space-y-2 text-sm">
          <div className="font-bold">정기검사 완료 처리</div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={lastInsp}
              onChange={(e) => setLastInsp(e.target.value)}
              className="px-2 py-1.5 border rounded-lg bg-white"
            />
            <span>→ 차기 만료일:</span>
            <input
              type="date"
              value={nextInsp}
              onChange={(e) => setNextInsp(e.target.value)}
              className="px-2 py-1.5 border rounded-lg bg-white"
            />
            <button
              onClick={handleUpdateInspection}
              className="px-3 py-1.5 bg-[#1E5EFF] text-white font-bold rounded-lg"
            >
              갱신
            </button>
          </div>
        </div>
      </div>

      {/* 차량 상세 정보 (엑셀 차량기록 항목, 수정 가능) */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-lg">📋 차량 상세 정보 (차량기록)</h2>
          <button
            onClick={async () => {
              const payload = {};
              EXTRA_FIELDS.forEach(({ k }) => {
                const v = extra[k];
                payload[k] =
                  k === 'modelYear' ? Number(v) || 0 : v == null ? '' : v;
              });
              CARGO_FLAGS.forEach(({ k }) => {
                payload[k] = !!extra[k];
              });
              await setDoc(
                doc(db, 'Vehicles', vehicleId),
                { ...payload, updatedAt: serverTimestamp() },
                { merge: true }
              );
              await loadDetail();
              alert('차량 상세 정보가 저장되었습니다.');
            }}
            className="px-4 py-2 rounded-xl bg-[#1E5EFF] text-white font-bold text-sm"
          >
            상세 정보 저장
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          {EXTRA_FIELDS.map(({ k, label, type }) => (
            <div key={k}>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                {label}
              </label>
              <input
                type={type || 'text'}
                value={extra[k] ?? ''}
                onChange={(e) => setExtra({ ...extra, [k]: e.target.value })}
                className="w-full px-3 py-2 border rounded-xl bg-white"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">
              운송 품목
            </label>
            <div className="flex gap-4 py-2">
              {CARGO_FLAGS.map(({ k, label }) => (
                <label
                  key={k}
                  className="flex items-center gap-1.5 font-bold cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!!extra[k]}
                    onChange={(e) =>
                      setExtra({ ...extra, [k]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 주차 위치 (시·구·동 및 장소명 수정) */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-3">
        <h2 className="font-bold text-lg">📍 마지막 주차 위치</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <input
            value={placeNameInput}
            onChange={(e) => setPlaceNameInput(e.target.value)}
            placeholder="주차 장소 이름 (예: 대전 차고지 3번 라인)"
            className="flex-1 px-3 py-2 border rounded-xl"
          />
          <button
            onClick={handleSavePlaceName}
            className="px-4 py-2 bg-slate-900 text-white font-bold rounded-xl"
          >
            장소 이름 저장
          </button>
          {vehicle.parking?.location && (
            <a
              href={`https://www.google.com/maps?q=${vehicle.parking.location.latitude},${vehicle.parking.location.longitude}`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 bg-[#1E5EFF] text-white font-bold rounded-xl"
            >
              구글 지도에서 보기 ↗
            </a>
          )}
        </div>
      </div>

      {/* 정비 이력 (planned / done) */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg">🔧 차량 정비 이력</h2>
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setMaintTab('planned')}
              className={`px-3 py-1.5 rounded-xl font-bold ${
                maintTab === 'planned'
                  ? 'bg-[#1E5EFF] text-white'
                  : 'bg-slate-100'
              }`}
            >
              앞으로 할 정비 (planned)
            </button>
            <button
              onClick={() => setMaintTab('done')}
              className={`px-3 py-1.5 rounded-xl font-bold ${
                maintTab === 'done' ? 'bg-[#1E5EFF] text-white' : 'bg-slate-100'
              }`}
            >
              수리 완료 (done)
            </button>
          </div>
        </div>

        <form
          onSubmit={handleAddMaintenance}
          className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm bg-slate-50 p-3 rounded-xl"
        >
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-2 border rounded-xl bg-white"
          >
            <option value="engine_oil">엔진오일</option>
            <option value="tire">타이어</option>
            <option value="brake">브레이크</option>
            <option value="urea">요소수</option>
            <option value="battery">배터리</option>
            <option value="inspection">정기검사</option>
            <option value="other">기타</option>
          </select>
          <input
            placeholder="정비 제목 (예: 엔진오일·필터 교환)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="px-3 py-2 border rounded-xl bg-white"
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="다음 교체 주행거리 km (선택, 예: 130,000)"
            value={dueOdometerKm}
            onChange={(e) => setDueOdometerKm(formatNumberWithCommas(e.target.value))}
            className="px-3 py-2 border rounded-xl bg-white"
          />
          <button
            type="submit"
            className="bg-slate-900 text-white font-bold rounded-xl py-2"
          >
            + 예정 정비 추가
          </button>
        </form>

        <div className="space-y-2">
          {maintList
            .filter((m) => m.status === maintTab)
            .map((m) => {
              const remainKm =
                m.dueOdometerKm != null
                  ? Number(m.dueOdometerKm) - (Number(vehicle.odometerKm) || 0)
                  : null;
              return (
                <div
                  key={m.id}
                  className="p-3 rounded-xl border flex items-center justify-between text-sm"
                >
                  <div>
                    <div className="font-bold">
                      [{m.category}] {m.title}
                      {remainKm != null && remainKm <= 1000 && (
                        <span className="ml-2 px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-black">
                          소모품 교체 임박 ({remainKm}km 남음)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      보고자: {m.reportedByName || '-'} ({m.source}) · 비용:{' '}
                      {(Number(m.cost) || 0).toLocaleString()}원
                    </div>
                  </div>
                  {m.status === 'planned' && (
                    <button
                      onClick={() => handleCompleteMaint(m)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs"
                    >
                      완료 처리
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* 최근 운행 10건 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border">
        <h2 className="font-bold text-lg mb-3">최근 운행 이력 (최대 10건)</h2>
        <div className="space-y-1.5 text-sm">
          {recentLogs.map((l) => (
            <div
              key={l.id}
              className="flex justify-between py-2 border-b last:border-0"
            >
              <span>
                <b>{l.workDate}</b> · {l.driverName} 기사 ({l.routeName})
              </span>
              <span className="font-bold">{l.drivenKm ?? 0}km 운행</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
