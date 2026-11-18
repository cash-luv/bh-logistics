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
import {
  parseVehicleExcel,
  importVehicles,
  importDriversFromRows,
  deleteAllVehicles,
} from '../services/vehicleImport';
import { LocationDetailModal } from '../components/MapParts';
import Pagination from '../components/Pagination';
import { syncVehicleDriverTx } from '../services/assignment';


export default function VehiclesView({ presetFilter, onSelectVehicle }) {
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [searchPlate, setSearchPlate] = useState('');
  const [filterMode, setFilterMode] = useState(presetFilter || 'all');
  const [assignModalVehicle, setAssignModalVehicle] = useState(null);
  const [targetDriverId, setTargetDriverId] = useState('');
  const [locationModal, setLocationModal] = useState(null);
  const [page, setPage] = useState(1);

  // 차량 등록 / 수정 모달 상태
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState(null);
  const [plateNo, setPlateNo] = useState('');
  const [manufacturer, setManufacturer] = useState('현대');
  const [model, setModel] = useState('마이티');
  const [modelYear, setModelYear] = useState('2023');
  const [odometerKm, setOdometerKm] = useState('0');
  const [fuelEfficiencyKmPerL, setFuelEfficiencyKmPerL] = useState('5.5');
  const [inspectionDueDate, setInspectionDueDate] = useState('2026-12-25');
  const [modalDriverId, setModalDriverId] = useState('');

  useEffect(() => {
    if (presetFilter) setFilterMode(presetFilter);
  }, [presetFilter]);

  useEffect(() => {
    setPage(1);
  }, [searchPlate, filterMode]);

  const [syncingLogs, setSyncingLogs] = useState(false);

  const loadAll = async () => {
    const [vSnap, uSnap] = await Promise.all([
      getDocs(collection(db, 'Vehicles')),
      getDocs(collection(db, 'Users')),
    ]);
    setVehicles(vSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setDrivers(
      uSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => u.role === 'driver' && u.isActive !== false)
    );
  };

  // 실시간 동기화: 기사들이 출근/퇴근 시 차량 상태와 주행거리가 화면에 즉시 자동 반영됨
  useEffect(() => {
    loadAll();
    const unsub = onSnapshot(collection(db, 'Vehicles'), (vSnap) => {
      setVehicles(vSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // 기사들이 작성한 출·퇴근 운행일지(DailyLogs)를 전수 분석하여 각 차량의 주행거리를 최신값으로 일괄 동기화
  const handleSyncVehiclesFromLogs = async () => {
    if (
      !window.confirm(
        '기사들이 앱에서 작성한 출·퇴근 운행일지(DailyLogs)의 주행거리로 최근 90일 운행일지 기준으로 전체 차량의 누적 주행거리(odometerKm)를 일괄 최신화하시겠습니까?'
      )
    ) {
      return;
    }
    setSyncingLogs(true);
    try {
      // 최근 90일 운행일지만 읽어 읽기 비용을 줄입니다.
      const sinceDate = new Date(Date.now() + 9 * 3600 * 1000 - 90 * 86400000)
        .toISOString()
        .slice(0, 10);
      const [lSnap, vSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'DailyLogs'),
            where('workDate', '>=', sinceDate)
          )
        ),
        getDocs(collection(db, 'Vehicles')),
      ]);

      const vehList = vSnap.docs.map((d) => ({
        id: d.id,
        ref: d.ref,
        ...d.data(),
      }));
      const vehByPlate = new Map();
      const vehById = new Map();
      vehList.forEach((v) => {
        vehById.set(v.id, v);
        const p = String(v.plateNo || '').replace(/\s+/g, '');
        if (p) vehByPlate.set(p, v);
      });

      // DailyLogs에서 각 차량/번호판별 최고 주행거리 집계
      const maxKmByVehId = new Map();
      lSnap.docs.forEach((docSnap) => {
        const l = docSnap.data();
        const endKm = Number(l.endOdometerKm) || 0;
        const startKm = Number(l.startOdometerKm) || 0;
        const highestLogKm = Math.max(endKm, startKm);
        if (highestLogKm <= 0) return;

        let targetId = l.vehicleId;
        if (!targetId || !vehById.has(targetId)) {
          const p = String(l.plateNo || '').replace(/\s+/g, '');
          if (p && vehByPlate.has(p)) {
            targetId = vehByPlate.get(p).id;
          }
        }

        if (targetId) {
          const prev = maxKmByVehId.get(targetId) || 0;
          if (highestLogKm > prev) {
            maxKmByVehId.set(targetId, highestLogKm);
          }
        }
      });

      let updatedCount = 0;
      const batch = writeBatch(db);
      for (const [vehId, newKm] of maxKmByVehId.entries()) {
        const v = vehById.get(vehId);
        const currentKm = Number(v?.odometerKm) || 0;
        if (newKm > currentKm) {
          batch.set(
            doc(db, 'Vehicles', vehId),
            {
              odometerKm: newKm,
              odometerUpdatedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        await batch.commit();
        alert(`총 ${updatedCount}대의 차량 주행거리가 최근 운행기록으로 최신화되었습니다!`);
      } else {
        alert('모든 차량의 주행거리가 이미 운행일지와 동일하게 최신 상태입니다.');
      }
    } catch (err) {
      alert('동기화 실패: ' + err.message);
    } finally {
      setSyncingLogs(false);
    }
  };

  const openCreateVehicleModal = () => {
    setEditingVehicleId(null);
    setPlateNo('');
    setManufacturer('현대');
    setModel('마이티');
    setModelYear('2023');
    setOdometerKm('0');
    setFuelEfficiencyKmPerL('5.5');
    setInspectionDueDate('2026-12-25');
    setModalDriverId('');
    setShowVehicleModal(true);
  };

  const openEditVehicleModal = (v) => {
    setEditingVehicleId(v.id);
    setPlateNo(v.plateNo || '');
    setManufacturer(v.manufacturer || '현대');
    setModel(v.model || '');
    setModelYear(String(v.modelYear || 2023));
    setOdometerKm(formatNumberWithCommas(v.odometerKm ?? 0));
    setFuelEfficiencyKmPerL(String(v.fuelEfficiencyKmPerL || 5.5));
    setInspectionDueDate(v.inspectionDueDate || todayKstStr());
    setModalDriverId(v.assignedDriverId || '');
    setShowVehicleModal(true);
  };

  const handleSaveVehicleModal = async (e) => {
    e.preventDefault();
    const clean = plateNo.trim();
    if (!clean) {
      alert('차량 번호판을 입력해 주세요.');
      return;
    }
    if (
      vehicles.some((v) => v.plateNo === clean && v.id !== editingVehicleId)
    ) {
      alert('이미 등록된 번호판입니다!');
      return;
    }

    try {
      let targetVehId = editingVehicleId;
      if (!editingVehicleId) {
        const docRef = await addDoc(collection(db, 'Vehicles'), {
          plateNo: clean,
          manufacturer: manufacturer.trim() || '현대',
          model: model.trim() || '카고',
          modelYear: Number(modelYear) || 2023,
          odometerKm: Math.max(0, parseNumberWithoutCommas(odometerKm)),
          fuelEfficiencyKmPerL: Number(fuelEfficiencyKmPerL) || 5.5,
          status: 'idle',
          assignedDriverId: null,
          assignedDriverName: null,
          lastInspectionDate: todayKstStr(),
          inspectionDueDate: inspectionDueDate || todayKstStr(),
          openMaintenanceCount: 0,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        targetVehId = docRef.id;
      } else {
        await setDoc(
          doc(db, 'Vehicles', editingVehicleId),
          {
            plateNo: clean,
            manufacturer: manufacturer.trim() || '현대',
            model: model.trim() || '카고',
            modelYear: Number(modelYear) || 2023,
            odometerKm: Math.max(0, parseNumberWithoutCommas(odometerKm)),
            fuelEfficiencyKmPerL: Number(fuelEfficiencyKmPerL) || 5.5,
            inspectionDueDate: inspectionDueDate || todayKstStr(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // 담당 기사 양방향 배정 동기화
      await syncVehicleDriverTx({
        vehicleId: targetVehId,
        driverId: modalDriverId || null,
      });

      setShowVehicleModal(false);
      await loadAll();
    } catch (err) {
      alert('차량 저장 실패: ' + err.message);
    }
  };

  // [관리자 6] Firestore runTransaction으로 기사 ↔ 차량 양방향 배정 동시 변경
  const handleConfirmAssign = async () => {
    const veh = assignModalVehicle;
    if (!veh) return;
    if (veh.status === 'driving') {
      alert('현재 운행 중(driving)인 차량은 배정을 바꿀 수 없어요. 퇴근 후 변경해 주세요.');
      return;
    }

    try {
      await syncVehicleDriverTx({
        vehicleId: veh.id,
        driverId: targetDriverId || null,
      });
      setAssignModalVehicle(null);
      await loadAll();
    } catch (err) {
      alert('배정 변경 실패: ' + err.message);
    }
  };

  const filtered = vehicles
    .filter((v) => v.isActive !== false)
    .map((v) => ({ ...v, dDay: calcDday(v.inspectionDueDate) }))
    .filter((v) => {
      if (searchPlate && !(v.plateNo || '').includes(searchPlate)) return false;
      if (filterMode === 'driving') return v.status === 'driving';
      if (filterMode === 'unassigned') return !v.assignedDriverId;
      if (filterMode === 'inspectionDue')
        return v.dDay != null && v.dDay <= 30;
      return true;
    })
    .sort((a, b) => (a.dDay ?? 9999) - (b.dDay ?? 9999));

  const totalPages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, totalPages);
  const pagedVehicles = filtered.slice((currentPage - 1) * 10, currentPage * 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">차량 등록 · 공차 · 배정 관리</h1>
          <p className="text-sm text-slate-500 mt-1">
            우측 상단 [+ 신규 차량 등록] 또는 각 차량의 [정보 수정] 버튼으로 주행거리·연비·담당 기사를 양방향으로 관리할 수 있습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => loadAll()}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm whitespace-nowrap flex items-center gap-1.5"
            title="차량 목록 새로고침"
          >
            <span>🔄 새로고침</span>
          </button>
          <button
            onClick={handleSyncVehiclesFromLogs}
            disabled={syncingLogs}
            className="px-4 py-2.5 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-black rounded-xl text-sm whitespace-nowrap flex items-center gap-1.5 shadow-sm"
            title="기사들이 작성한 출·퇴근 운행일지(DailyLogs)의 최고 주행거리로 전체 차량의 주행거리를 즉시 맞춥니다"
          >
            <span>{syncingLogs ? '⏳ 동기화 중...' : '⚡ 운행일지 주행거리로 일괄 최신화'}</span>
          </button>
          <button
            onClick={async () => {
              if (
                !window.confirm(
                  '등록된 차량 데이터를 전부 삭제합니다. (기사들의 배정 차량도 비워집니다)\n과거 운행기록은 그대로 남습니다.\n정말 삭제할까요?'
                )
              )
                return;
              if (!window.confirm('되돌릴 수 없어요. 한 번 더 확인합니다. 전부 삭제할까요?'))
                return;
              try {
                const n = await deleteAllVehicles();
                alert(`차량 ${n}대를 모두 삭제했습니다.`);
                await loadAll();
              } catch (err) {
                alert('삭제 실패: ' + err.message);
              }
            }}
            className="px-4 py-2.5 border border-red-300 text-red-600 hover:bg-red-50 font-bold rounded-xl text-sm whitespace-nowrap"
          >
            🗑 차량 전체 삭제
          </button>
          <label className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm shadow whitespace-nowrap cursor-pointer">
            📥 엑셀로 차량 일괄 등록
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const rows = await parseVehicleExcel(await file.arrayBuffer());
                  if (rows.length === 0) {
                    alert('엑셀에서 차량 번호를 찾지 못했어요. 4행부터 D열에 차량등록번호가 있어야 합니다.');
                    return;
                  }
                  if (
                    !window.confirm(
                      `엑셀에서 차량 ${rows.length}대를 찾았어요.\n새 차량은 등록하고, 이미 있는 번호판은 정보만 갱신합니다.\n진행할까요?`
                    )
                  ) {
                    return;
                  }
                  const { created, updated, idByPlate } = await importVehicles(
                    rows
                  );
                  let msg = `차량 등록 완료! 새로 등록 ${created}대 / 정보 갱신 ${updated}대`;
                  if (
                    window.confirm(
                      `${msg}\n\n엑셀의 '운전자' 이름으로 기사 계정도 함께 만들고 차량에 배정할까요?\n(기사 코드 bh01부터 자동 부여, 초기 비밀번호는 연락처 마지막 6자리 / 연락처 없으면 000000)`
                    )
                  ) {
                    const res = await importDriversFromRows(rows, idByPlate);
                    msg += `\n\n기사 ${res.created.length}명 생성`;
                    if (res.skipped.length)
                      msg += `\n이미 있어서 건너뜀: ${res.skipped.join(', ')}`;
                    if (res.failed.length)
                      msg += `\n실패: ${res.failed.join(', ')}`;
                    const multi = res.created.filter(
                      (c) => c.extraPlates.length
                    );
                    if (multi.length)
                      msg += `\n(차량이 여러 대인 기사는 첫 차량만 배정: ${multi
                        .map((c) => c.name)
                        .join(', ')})`;
                  }
                  alert(msg);
                  await loadAll();
                } catch (err) {
                  alert('엑셀 등록 실패: ' + err.message);
                }
              }}
            />
          </label>
          <button
            onClick={openCreateVehicleModal}
            className="px-5 py-2.5 bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold rounded-xl text-sm shadow whitespace-nowrap"
          >
            + 신규 차량 등록
          </button>
        </div>
      </div>

      {/* 검색 및 필터 */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          placeholder="번호판 검색"
          value={searchPlate}
          onChange={(e) => setSearchPlate(e.target.value)}
          className="px-3 py-2 border rounded-xl bg-white"
        />
        {[
          { k: 'all', label: '전체 차량' },
          { k: 'driving', label: '운행 중만' },
          { k: 'unassigned', label: '공차(미배정)만' },
          { k: 'inspectionDue', label: '검사 임박·초과만' },
        ].map((f) => (
          <button
            key={f.k}
            onClick={() => setFilterMode(f.k)}
            className={`px-3.5 py-2 rounded-xl font-bold ${
              filterMode === f.k
                ? 'bg-slate-900 text-white'
                : 'bg-white border text-slate-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 차량 목록 표 */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm text-left">
          <thead className="bg-slate-50 border-b font-bold">
            <tr>
              <th className="p-3 whitespace-nowrap">번호판 / 차종</th>
              <th className="p-3 whitespace-nowrap">누적 주행거리 (클릭 수정)</th>
              <th className="p-3 whitespace-nowrap">연비 (클릭 수정)</th>
              <th className="p-3 whitespace-nowrap">상태</th>
              <th className="p-3 whitespace-nowrap">배정 기사 (양방향 변경)</th>
              <th className="p-3 whitespace-nowrap">검사 만료일 (D-Day)</th>
              <th className="p-3 whitespace-nowrap">주차 위치 (시·구·동)</th>
              <th className="p-3 whitespace-nowrap">예정 정비</th>
              <th className="p-3 whitespace-nowrap sticky right-0 bg-slate-50 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">
                관리
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {pagedVehicles.length === 0 ? (
              <tr>
                <td colSpan="9" className="p-8 text-center text-slate-400 font-semibold">
                  등록된 차량이 없거나 조건에 맞는 차량이 없습니다.
                </td>
              </tr>
            ) : (
              pagedVehicles.map((v) => {
              const loc = v.parking?.location;
              const placeName = v.parking?.placeName;
              return (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="p-3">
                    <button
                      onClick={() => onSelectVehicle(v.id)}
                      className="font-black text-[#1E5EFF] underline text-left"
                    >
                      {v.plateNo}
                    </button>
                    <div className="text-xs text-slate-500">
                      {v.manufacturer} {v.model}
                      {v.modelYear ? ` (${v.modelYear}년식)` : ''}
                      {v.workplace ? ` · ${v.workplace}` : ''}
                    </div>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => openEditVehicleModal(v)}
                      title="클릭하여 주행거리 및 차량 정보 수정"
                      className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 font-black text-xs hover:bg-blue-100 whitespace-nowrap"
                    >
                      {(Number(v.odometerKm) || 0).toLocaleString()}km ✎
                    </button>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={async () => {
                        const next = window.prompt(
                          `[${v.plateNo}] 차량의 실제 연비(km/L)를 입력해 주세요:`,
                          String(v.fuelEfficiencyKmPerL || 5.5)
                        );
                        if (!next) return;
                        const val = Number(next);
                        if (!val || val <= 0) return;
                        await setDoc(
                          doc(db, 'Vehicles', v.id),
                          {
                            fuelEfficiencyKmPerL: val,
                            updatedAt: serverTimestamp(),
                          },
                          { merge: true }
                        );
                        loadAll();
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-xs hover:bg-emerald-100 whitespace-nowrap"
                    >
                      {v.fuelEfficiencyKmPerL || 5.5} km/L ✎
                    </button>
                  </td>
                  <td className="p-3 font-bold">
                    {v.status === 'driving' ? (
                      <span className="text-sky-600">운행중</span>
                    ) : (
                      <span className="text-slate-600">대기</span>
                    )}
                  </td>
                  <td className="p-3">
                    <select
                      value={v.assignedDriverId || ''}
                      onChange={async (e) => {
                        const nextDriverId = e.target.value;
                        if (v.status === 'driving') {
                          alert(
                            '현재 운행 중(driving)인 차량은 배정을 바꿀 수 없어요. 퇴근 후 변경해 주세요.'
                          );
                          return;
                        }
                        try {
                          await syncVehicleDriverTx({
                            vehicleId: v.id,
                            driverId: nextDriverId || null,
                          });
                          await loadAll();
                        } catch (err) {
                          alert('기사 배정 변경 실패: ' + err.message);
                        }
                      }}
                      className={`px-2.5 py-1.5 border rounded-lg font-bold text-xs ${
                        v.assignedDriverId
                          ? 'bg-white text-slate-800 border-slate-300'
                          : 'bg-amber-50 text-amber-700 border-amber-300'
                      }`}
                    >
                      <option value="">공차 (기사 미배정)</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.driverCode || d.phone})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <div>{v.inspectionDueDate || '-'}</div>
                    {v.dDay != null && (
                      <span
                        className={`inline-block mt-0.5 px-2 py-0.5 rounded text-xs font-black whitespace-nowrap inline-flex items-center justify-center shrink-0 ${
                          v.dDay < 0
                            ? 'bg-red-100 text-red-700'
                            : v.dDay <= 30
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {v.dDay < 0
                          ? `D+${Math.abs(v.dDay)} 초과`
                          : `D-${v.dDay}`}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {loc || placeName ? (
                      <button
                        onClick={() =>
                          setLocationModal({
                            subtitle: `${v.plateNo} (${v.manufacturer} ${v.model})`,
                            title: '차량 마지막 주차 위치 상세',
                            address: placeName,
                            lat: loc?.latitude,
                            lng: loc?.longitude,
                          })
                        }
                        className="text-left underline font-semibold text-slate-800 hover:text-[#1E5EFF]"
                      >
                        {placeName || '지도 보기'}
                      </button>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="p-3 font-bold">
                    {v.openMaintenanceCount || 0}건
                  </td>
                  <td className="p-3 sticky right-0 bg-white shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">
                    <div className="flex flex-col gap-1 w-[84px]">
                      <button
                        onClick={() => onSelectVehicle(v.id)}
                        className="px-2 py-1.5 rounded-lg bg-[#1E5EFF] text-white font-bold text-xs hover:bg-blue-700"
                      >
                        상세 보기
                      </button>
                      <button
                        onClick={() => openEditVehicleModal(v)}
                        className="px-2 py-1.5 rounded-lg bg-slate-900 text-white font-bold text-xs hover:bg-slate-800"
                      >
                        정보 수정
                      </button>
                      <button
                        onClick={() => {
                          setAssignModalVehicle(v);
                          setTargetDriverId(v.assignedDriverId || '');
                        }}
                        className="px-2 py-1.5 rounded-lg border font-bold text-xs hover:bg-slate-100"
                      >
                        배정 변경
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `정말 [${v.plateNo}] 차량을 삭제하시겠습니까?`
                            )
                          ) {
                            return;
                          }
                          if (v.assignedDriverId) {
                            await setDoc(
                              doc(db, 'Users', v.assignedDriverId),
                              {
                                assignedVehicleId: null,
                                updatedAt: serverTimestamp(),
                              },
                              { merge: true }
                            );
                          }
                          await deleteDoc(doc(db, 'Vehicles', v.id));
                          loadAll();
                        }}
                        className="px-2 py-1.5 rounded-lg border border-red-200 text-red-600 font-bold text-xs hover:bg-red-50"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={filtered.length}
          pageSize={10}
          onPageChange={setPage}
        />
      </div>

      {/* 신규 차량 등록 / 차량 정보·주행거리·담당기사 수정 모달 */}
      {showVehicleModal && (
        <div
          onClick={() => setShowVehicleModal(false)}
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-6 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <div className="text-xs font-bold text-[#1E5EFF]">
                  차량 제원 · 주행거리 · 기사 배정 관리
                </div>
                <h2 className="text-xl font-black">
                  {editingVehicleId ? '차량 정보 및 주행거리 수정' : '신규 차량 등록'}
                </h2>
              </div>
              <button
                onClick={() => setShowVehicleModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-100 font-bold text-sm"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleSaveVehicleModal} className="space-y-3 text-sm">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  1. 차량 번호판 (필수)
                </label>
                <input
                  placeholder="예: 84바 3021"
                  value={plateNo}
                  onChange={(e) => setPlateNo(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-xl font-black text-base"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    2. 제조사
                  </label>
                  <input
                    placeholder="예: 현대"
                    value={manufacturer}
                    onChange={(e) => setManufacturer(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    3. 차종 (모델명)
                  </label>
                  <input
                    placeholder="예: 마이티"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    4. 연식 (년식)
                  </label>
                  <input
                    type="number"
                    placeholder="예: 2023"
                    value={modelYear}
                    onChange={(e) => setModelYear(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    5. 현재 누적 주행거리 (km)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="예: 125,000"
                    value={odometerKm}
                    onChange={(e) => setOdometerKm(formatNumberWithCommas(e.target.value))}
                    className="w-full px-3 py-2.5 border rounded-xl font-black text-[#1E5EFF]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    6. 기준 연비 (km/L)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="예: 5.5"
                    value={fuelEfficiencyKmPerL}
                    onChange={(e) => setFuelEfficiencyKmPerL(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    7. 정기검사 만료일
                  </label>
                  <input
                    type="date"
                    value={inspectionDueDate}
                    onChange={(e) => setInspectionDueDate(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    8. 배정할 담당 기사 (양방향 연동)
                  </label>
                  <select
                    value={modalDriverId}
                    onChange={(e) => setModalDriverId(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl bg-white font-bold"
                  >
                    <option value="">공차 (기사 미배정)</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.driverCode || d.phone})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowVehicleModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#1E5EFF] text-white font-bold"
                >
                  {editingVehicleId ? '차량 수정 저장' : '차량 등록하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* [관리자 6] 기사 ↔ 차량 트랜잭션 배정 모달 */}
      {assignModalVehicle && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-black">
              {assignModalVehicle.plateNo} 차량 배정 변경
            </h3>
            <p className="text-xs text-slate-500">
              Firestore 트랜잭션으로 기존 기사/차량의 배정을 자동으로 함께
              정리합니다. (과거 운행기록 스냅샷은 변경되지 않습니다.)
            </p>
            <select
              value={targetDriverId}
              onChange={(e) => setTargetDriverId(e.target.value)}
              className="w-full px-3 py-2.5 border rounded-xl font-bold"
            >
              <option value="">공차로 만들기 (배정 해제)</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.driverCode || d.phone})
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAssignModalVehicle(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 font-bold text-sm"
              >
                취소
              </button>
              <button
                onClick={handleConfirmAssign}
                className="px-4 py-2 rounded-xl bg-[#1E5EFF] text-white font-bold text-sm"
              >
                배정 저장
              </button>
            </div>
          </div>
        </div>
      )}

      <LocationDetailModal
        info={locationModal}
        onClose={() => setLocationModal(null)}
      />
    </div>
  );
}
