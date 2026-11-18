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
import { RoutePolylineMap, LocationDetailModal } from '../components/MapParts';


/* ============================================================================
 * [관리자 8] 운행 기록 (DailyLogs)
 * - 필터: 월, 기사, 차량, 상태, 점검 이상만, 거리 이상만, 퇴근 누락만
 * - 오른쪽 상세 슬라이드 패널: 출근 사진 3장 + 퇴근 사진 + 체크리스트 + 퇴근 위치(시구동 + 상세 지도)
 * - 관리자 보정: 퇴근 누락 보정(completed 전환) + void(무효 처리 및 사유 기록)
 * ========================================================================== */
export default function DailyLogsView({ adminUid, presetDriverId, onClearPresetDriver }) {
  const now = new Date();
  const defaultYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}`;
  const [yearMonth, setYearMonth] = useState(defaultYm);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [driverFilter, setDriverFilter] = useState(presetDriverId || '');
  const [plateFilter, setPlateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [onlyIssue, setOnlyIssue] = useState(false);
  const [onlyKmWarn, setOnlyKmWarn] = useState(false);
  const [onlyMissingCheckout, setOnlyMissingCheckout] = useState(false);

  const [showAllGps, setShowAllGps] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [locationModal, setLocationModal] = useState(null);

  // 보정용 입력 상태
  const [fixEndKm, setFixEndKm] = useState('');
  const [voidReason, setVoidReason] = useState('');

  useEffect(() => {
    setShowAllGps(false);
  }, [selectedLog?.id]);

  useEffect(() => {
    if (presetDriverId) {
      setDriverFilter(presetDriverId);
    }
  }, [presetDriverId]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'DailyLogs'), where('yearMonth', '==', yearMonth))
      );
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.workDate || '').localeCompare(a.workDate || ''));
      setLogs(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [yearMonth]);

  // 상세 패널 열릴 때 Storage 사진 URL 로드
  useEffect(() => {
    if (!selectedLog) {
      setPhotoUrls({});
      return;
    }
    setFixEndKm(
      selectedLog.endOdometerKm
        ? String(selectedLog.endOdometerKm)
        : String((Number(selectedLog.startOdometerKm) || 0) + 300)
    );
    setVoidReason(selectedLog.adjustReason || '');

    const loadPhotos = async () => {
      const urls = {};
      const sp = selectedLog.startPhotos || {};
      for (const k of ['dashboard', 'exterior', 'interior']) {
        if (sp[k]) {
          try {
            urls[`start_${k}`] = await getDownloadURL(ref(storage, sp[k]));
          } catch (_) {}
        }
      }
      if (selectedLog.endPhotos?.dashboard) {
        try {
          urls.end_dashboard = await getDownloadURL(
            ref(storage, selectedLog.endPhotos.dashboard)
          );
        } catch (_) {}
      }
      if (Array.isArray(selectedLog.fuelReceipts)) {
        for (let i = 0; i < selectedLog.fuelReceipts.length; i++) {
          const r = selectedLog.fuelReceipts[i];
          if (r?.photoPath) {
            try {
              urls[`fuel_${i}`] = await getDownloadURL(
                ref(storage, r.photoPath)
              );
            } catch (_) {}
          }
        }
      }
      setPhotoUrls(urls);
    };
    loadPhotos();
  }, [selectedLog]);

  const today = todayKstStr();
  const filtered = logs.filter((l) => {
    if (
      driverFilter &&
      l.driverId !== driverFilter &&
      !(l.driverName || '').includes(driverFilter)
    ) {
      return false;
    }
    if (plateFilter && !(l.plateNo || '').includes(plateFilter)) return false;
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (onlyIssue && !l.hasIssue) return false;
    if (onlyKmWarn && (!l.kmCheck || l.kmCheck === 'ok')) return false;
    if (
      onlyMissingCheckout &&
      !(l.status === 'in_progress' && (l.workDate || '') < today)
    ) {
      return false;
    }
    return true;
  });

  // 퇴근 누락 건 관리자 보정
  const handleCompleteMissingCheckout = async () => {
    if (!selectedLog) return;
    const endKm = parseNumberWithoutCommas(fixEndKm);
    const startKm = Number(selectedLog.startOdometerKm) || 0;
    if (!endKm || endKm < startKm) {
      alert('종료 주행거리는 시작 주행거리 이상이어야 합니다.');
      return;
    }
    if (!window.confirm('이 운행 기록을 퇴근 완료(completed)로 보정하시겠습니까?')) {
      return;
    }
    const drivenKm = endKm - startKm;
    await setDoc(
      doc(db, 'DailyLogs', selectedLog.id),
      {
        endOdometerKm: endKm,
        drivenKm,
        status: 'completed',
        adjustedBy: adminUid,
        adjustedAt: serverTimestamp(),
        adjustReason: '관리자 퇴근 누락 보정',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // 차량(Vehicles) 정보도 퇴근 주행거리로 자동 갱신
    try {
      let targetVehId = selectedLog.vehicleId;
      if (!targetVehId && selectedLog.plateNo) {
        const vQuery = await getDocs(
          query(
            collection(db, 'Vehicles'),
            where('plateNo', '==', selectedLog.plateNo)
          )
        );
        if (!vQuery.empty) targetVehId = vQuery.docs[0].id;
      }
      if (targetVehId) {
        await setDoc(
          doc(db, 'Vehicles', targetVehId),
          {
            odometerKm: endKm,
            status: 'idle',
            odometerUpdatedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (_) {}

    await loadLogs();
    setSelectedLog(null);
  };

  // 잘못된 기록 void(무효) 처리
  const handleVoidLog = async () => {
    if (!selectedLog) return;
    if (!voidReason.trim()) {
      alert('무효 처리 사유를 입력해 주세요.');
      return;
    }
    if (
      !window.confirm(
        '이 기록을 무효(void) 처리하시겠습니까? 무효 처리하면 월 매출 집계에서 제외됩니다.'
      )
    ) {
      return;
    }
    await setDoc(
      doc(db, 'DailyLogs', selectedLog.id),
      {
        status: 'void',
        adjustedBy: adminUid,
        adjustedAt: serverTimestamp(),
        adjustReason: voidReason.trim(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await loadLogs();
    setSelectedLog(null);
  };

  // 모든 운행기록 초기화(삭제)
  const handleDeleteAllLogs = async () => {
    if (
      !window.confirm(
        '모든 운행기록(DailyLogs)을 완전히 삭제하고 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.'
      )
    ) {
      return;
    }
    if (!window.confirm('정말 모든 운행 기록을 초기화할까요?')) {
      return;
    }
    try {
      const snap = await getDocs(collection(db, 'DailyLogs'));
      let batch = writeBatch(db);
      let count = 0;
      for (const d of snap.docs) {
        batch.delete(d.ref);
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
      alert(`운행기록 ${snap.size}건이 모두 초기화되었습니다.`);
      await loadLogs();
      setSelectedLog(null);
    } catch (err) {
      alert('운행기록 초기화 실패: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">운행 기록 (DailyLogs)</h1>
          <p className="text-sm text-slate-500 mt-1">
            행을 클릭하면 오른쪽에서 사진·점검표·위치 상세 및 관리자 보정 패널이
            열립니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDeleteAllLogs}
            className="px-4 py-2 rounded-xl border border-red-300 text-red-600 hover:bg-red-50 font-bold text-sm whitespace-nowrap shadow-sm"
          >
            🗑 운행기록 전체 초기화
          </button>
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="px-4 py-2 rounded-xl border bg-white font-bold"
          />
        </div>
      </div>

      {/* 필터 바 */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border flex flex-wrap items-center gap-3 text-sm">
        <input
          placeholder="기사명 검색"
          value={driverFilter}
          onChange={(e) => {
            setDriverFilter(e.target.value);
            onClearPresetDriver?.();
          }}
          className="px-3 py-2 border rounded-xl"
        />
        <input
          placeholder="차량번호 검색"
          value={plateFilter}
          onChange={(e) => setPlateFilter(e.target.value)}
          className="px-3 py-2 border rounded-xl"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-xl font-semibold"
        >
          <option value="all">전체 상태</option>
          <option value="in_progress">운행 중 (in_progress)</option>
          <option value="completed">퇴근 완료 (completed)</option>
          <option value="void">무효 (void)</option>
        </select>

        <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={onlyIssue}
            onChange={(e) => setOnlyIssue(e.target.checked)}
          />
          점검 이상만
        </label>
        <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={onlyKmWarn}
            onChange={(e) => setOnlyKmWarn(e.target.checked)}
          />
          거리 이상만(low/high)
        </label>
        <label className="flex items-center gap-1.5 font-semibold cursor-pointer text-amber-700">
          <input
            type="checkbox"
            checked={onlyMissingCheckout}
            onChange={(e) => setOnlyMissingCheckout(e.target.checked)}
          />
          퇴근 누락만
        </label>
      </div>

      {/* 목록 표 */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            조건에 맞는 운행 기록이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm text-left">
              <thead className="bg-slate-50 border-b font-bold text-slate-600">
                <tr>
                  <th className="p-3 whitespace-nowrap">날짜</th>
                  <th className="p-3 whitespace-nowrap">기사 / 차량</th>
                  <th className="p-3 whitespace-nowrap">노선 / 단가</th>
                  <th className="p-3 whitespace-nowrap">출근 / 퇴근(KST)</th>
                  <th className="p-3 whitespace-nowrap">시작 / 종료 / 운행km</th>
                  <th className="p-3 whitespace-nowrap">실제GPS / 비업무km</th>
                  <th className="p-3 whitespace-nowrap">실제주유 / 예상주유비</th>
                  <th className="p-3 whitespace-nowrap">퇴근 위치 (시·구·동)</th>
                  <th className="p-3 whitespace-nowrap">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((l) => {
                  const loc = l.endLocation;
                  return (
                    <tr
                      key={l.id}
                      onClick={() => setSelectedLog(l)}
                      className={`cursor-pointer hover:bg-sky-50/60 ${
                        l.status === 'void' ? 'opacity-50 line-through' : ''
                      }`}
                    >
                      <td className="p-3 font-bold">{l.workDate}</td>
                      <td className="p-3">
                        <div className="font-bold">{l.driverName}</div>
                        <div className="text-xs text-slate-500">{l.plateNo}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold">{l.routeName}</div>
                        <div className="text-xs text-[#1E5EFF] font-bold">
                          {(Number(l.routePrice) || 0).toLocaleString()}원
                        </div>
                      </td>
                      <td className="p-3 text-xs">
                        <div>출근: {formatKstTime(l.checkInAt)}</div>
                        <div>퇴근: {formatKstTime(l.checkOutAt)}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-bold">
                          {l.drivenKm != null ? `${l.drivenKm}km` : '-'}
                        </div>
                        <div className="text-xs text-slate-400">
                          {Number(l.startOdometerKm || 0).toLocaleString()} →{' '}
                          {l.endOdometerKm
                            ? Number(l.endOdometerKm).toLocaleString()
                            : '-'}
                        </div>
                      </td>
                      <td
                        className="p-3"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLog(l);
                        }}
                      >
                        <button
                          type="button"
                          className="text-left group"
                        >
                          <div className="font-bold text-indigo-600 group-hover:underline">
                            GPS: {l.gpsDrivenKm ?? '-'}km 🔎
                          </div>
                          <div className="text-[11px] text-slate-400">
                            이동 타임라인 보기
                          </div>
                        </button>
                        {Number(l.offDutyKm) > 0 &&
                          Number(l.offDutyKm) <= 2000 && (
                            <div className="text-xs font-black text-red-600 mt-0.5">
                              비업무 +{l.offDutyKm}km
                            </div>
                          )}
                      </td>
                      <td className="p-3">
                        {Number(l.actualFuelCost) > 0 && (
                          <div className="font-black text-[#1E5EFF]">
                            카드: {Number(l.actualFuelCost).toLocaleString()}원
                          </div>
                        )}
                        <div className="font-semibold text-emerald-700 text-xs">
                          예상:{' '}
                          {l.estimatedFuelCost
                            ? `${Number(l.estimatedFuelCost).toLocaleString()}원`
                            : '-'}
                        </div>
                      </td>
                      <td
                        className="p-3"
                        onClick={(e) => {
                          if (loc || l.endAddress) {
                            e.stopPropagation();
                            setLocationModal({
                              subtitle: `${l.workDate} · ${l.driverName} (${l.plateNo})`,
                              title: '퇴근 주차 위치 상세',
                              address: l.endAddress,
                              lat: loc?.latitude,
                              lng: loc?.longitude,
                            });
                          }
                        }}
                      >
                        <div className="font-bold underline text-slate-800">
                          {l.endAddress || (loc ? '좌표 보기' : '-')}
                        </div>
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap inline-flex items-center justify-center shrink-0 ${
                            l.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-700'
                              : l.status === 'void'
                              ? 'bg-slate-200 text-slate-600'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {l.status === 'completed'
                            ? '완료'
                            : l.status === 'void'
                            ? '무효'
                            : '운행중'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* [관리자 8] 오른쪽 상세 슬라이드 패널 */}
      {selectedLog && (
        <div
          onClick={() => setSelectedLog(null)}
          className="fixed inset-0 bg-black/50 flex justify-end z-40"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-white h-full overflow-y-auto p-6 space-y-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <div className="text-xs font-bold text-[#1E5EFF]">
                  운행일지 상세 · 보정
                </div>
                <h2 className="text-xl font-black">
                  {selectedLog.workDate} · {selectedLog.driverName} 기사 (
                  {selectedLog.plateNo})
                </h2>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 font-bold text-sm"
              >
                닫기
              </button>
            </div>

            {/* 사진 4종 */}
            <div>
              <h3 className="font-bold text-sm text-slate-700 mb-2">
                촬영 사진 (클릭 시 원본 열기)
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'start_dashboard', label: '출근 계기판' },
                  { key: 'end_dashboard', label: '퇴근 계기판' },
                  { key: 'start_exterior', label: '출근 외부(선택)' },
                  { key: 'start_interior', label: '출근 내부(선택)' },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="border rounded-xl p-2 bg-slate-50 text-center"
                  >
                    <div className="text-xs font-bold mb-1">{item.label}</div>
                    {photoUrls[item.key] ? (
                      <a
                        href={photoUrls[item.key]}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={photoUrls[item.key]}
                          alt={item.label}
                          className="h-28 w-full object-cover rounded-lg"
                        />
                      </a>
                    ) : (
                      <div className="h-28 flex items-center justify-center text-xs text-slate-400">
                        사진 없음
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* GPS 이동 타임라인 (출근 출발 -> 경유지 -> 퇴근 도착) */}
            <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-indigo-950">
                  🧭 GPS 실제 이동 타임라인
                </span>
                <span className="font-black text-indigo-700 text-xs">
                  총 GPS 이동: {selectedLog.gpsDrivenKm ?? 0}km
                </span>
              </div>
              {(() => {
                const rawList = Array.isArray(selectedLog.gpsTimeline)
                  ? selectedLog.gpsTimeline
                  : [];
                const points =
                  rawList.length > 0
                    ? rawList
                    : [
                        ...(selectedLog.startAddress || selectedLog.startLocation
                          ? [
                              {
                                time: formatKstTime(selectedLog.checkInAt),
                                type: '출근 출발',
                                address:
                                  selectedLog.startAddress || '출근 위치',
                                lat: selectedLog.startLocation?.latitude,
                                lng: selectedLog.startLocation?.longitude,
                                cumKm: 0,
                              },
                            ]
                          : []),
                        ...(selectedLog.endAddress || selectedLog.endLocation
                          ? [
                              {
                                time: formatKstTime(selectedLog.checkOutAt),
                                type: '퇴근 도착',
                                address:
                                  selectedLog.endAddress || '퇴근 주차 위치',
                                lat: selectedLog.endLocation?.latitude,
                                lng: selectedLog.endLocation?.longitude,
                                cumKm:
                                  selectedLog.gpsDrivenKm ??
                                  selectedLog.drivenKm ??
                                  0,
                              },
                            ]
                          : []),
                      ];

                if (points.length === 0) {
                  return (
                    <div className="text-xs text-slate-500">
                      기록된 GPS 이동 지점이 없습니다.
                    </div>
                  );
                }

                const hasMapPoints = points.some(
                  (p) => p.lat != null && p.lng != null
                );

                return (
                  <div className="space-y-3">
                    {hasMapPoints && (
                      <div>
                        <RoutePolylineMap points={points} />
                        <div className="flex items-center gap-4 mt-1.5 text-[11px] font-bold text-slate-600">
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                            출근 출발
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                            이동 경로 (빨간 선)
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-[#1E5EFF] inline-block" />
                            퇴근 도착
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="relative pl-4 border-l-2 border-indigo-300 space-y-2.5 text-xs">
                      {(() => {
                        const LIMIT = 10;
                        const needFold = points.length > LIMIT && !showAllGps;
                        const rows = points.map((pt, idx) => ({ pt, idx }));
                        const shown = needFold
                          ? [...rows.slice(0, LIMIT - 1), rows[rows.length - 1]]
                          : rows;
                        return shown.map(({ pt, idx }, n) => (
                          <React.Fragment key={idx}>
                            {needFold && n === shown.length - 1 && (
                              <button
                                type="button"
                                onClick={() => setShowAllGps(true)}
                                className="w-full py-2 rounded-xl bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-black text-xs"
                              >
                                ▼ 중간 기록 {points.length - LIMIT}개 더보기
                              </button>
                            )}
                            <div className="bg-white p-2.5 rounded-xl border border-indigo-100 flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-black whitespace-nowrap">
                                    {pt.time || '-'} · {pt.type || '이동'}
                                  </span>
                                  {pt.cumKm != null && (
                                    <span className="text-slate-500 font-bold whitespace-nowrap">
                                      누적 {pt.cumKm}km
                                    </span>
                                  )}
                                </div>
                                <div className="font-bold text-slate-800 mt-1 truncate">
                                  📍 {pt.address || '위치 정보'}
                                </div>
                              </div>
                              {pt.lat != null && pt.lng != null && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLocationModal({
                                      subtitle: `${selectedLog.workDate} · ${pt.time || ''} (${pt.type || '경유'})`,
                                      title: '이동 타임라인 상세 지도',
                                      address: pt.address,
                                      lat: Number(pt.lat),
                                      lng: Number(pt.lng),
                                    })
                                  }
                                  className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold whitespace-nowrap shrink-0"
                                >
                                  지도 🔎
                                </button>
                              )}
                            </div>
                          </React.Fragment>
                        ));
                      })()}
                      {showAllGps && points.length > 10 && (
                        <button
                          type="button"
                          onClick={() => setShowAllGps(false)}
                          className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs"
                        >
                          ▲ 접기
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 주유 영수증 및 결제 금액 내역 */}
            {Array.isArray(selectedLog.fuelReceipts) &&
              selectedLog.fuelReceipts.length > 0 && (
                <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-900">
                      ⛽ 주유카드 영수증 ({selectedLog.fuelReceipts.length}건)
                    </span>
                    <span className="font-black text-[#1E5EFF] text-sm">
                      총 {Number(selectedLog.actualFuelCost || 0).toLocaleString()}
                      원
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedLog.fuelReceipts.map((r, idx) => (
                      <div
                        key={idx}
                        className="bg-white border rounded-xl p-2 text-xs space-y-1"
                      >
                        <div className="font-bold text-slate-800">
                          {Number(r.amount || 0).toLocaleString()}원
                          {r.liters ? ` (${r.liters}L)` : ''} ·{' '}
                          {r.recordedAtKst || ''}
                        </div>
                        {r.extraItemsSummary && (
                          <div className="inline-block px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold text-[11px]">
                            🛒 {r.extraItemsSummary}
                          </div>
                        )}
                        {photoUrls[`fuel_${idx}`] ? (
                          <a
                            href={photoUrls[`fuel_${idx}`]}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={photoUrls[`fuel_${idx}`]}
                              alt="주유 영수증"
                              className="h-24 w-full object-cover rounded-lg"
                            />
                          </a>
                        ) : (
                          <div className="h-24 flex items-center justify-center text-slate-400">
                            영수증 불러오는 중
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* 점검표 및 위치 */}
            <div className="p-4 rounded-xl bg-slate-50 border space-y-2 text-sm">
              <div className="font-bold">출발 전 차량 점검</div>
              <div className="flex gap-4">
                <span>
                  타이어:{' '}
                  <b>
                    {selectedLog.checklist?.tirePressure === 'warn'
                      ? '⚠️ 확인필요'
                      : '정상'}
                  </b>
                </span>
                <span>
                  요소수:{' '}
                  <b>
                    {selectedLog.checklist?.ureaLevel === 'warn'
                      ? '⚠️ 확인필요'
                      : '정상'}
                  </b>
                </span>
                <span>
                  연료:{' '}
                  <b>
                    {selectedLog.checklist?.fuelLevel === 'warn'
                      ? '⚠️ 확인필요'
                      : '정상'}
                  </b>
                </span>
              </div>
              <div className="pt-2 border-t">
                특이사항 메모: <b>{selectedLog.endNote || '없음'}</b>
              </div>
              <div>
                퇴근 위치(시·구·동): <b>{selectedLog.endAddress || '-'}</b>
                {selectedLog.endLocationAccuracyM > 100 && (
                  <span className="ml-2 text-xs text-amber-700 font-bold">
                    (⚠️ GPS 오차 {Math.round(selectedLog.endLocationAccuracyM)}m)
                  </span>
                )}
              </div>
            </div>

            {/* 비업무 주행거리(offDutyKm) 초기화 보정 */}
            {Number(selectedLog.offDutyKm) > 0 && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-3">
                <div className="text-sm font-bold text-amber-900">
                  비업무 주행 기록: +{Number(selectedLog.offDutyKm).toLocaleString()}km
                </div>
                <button
                  onClick={async () => {
                    await setDoc(
                      doc(db, 'DailyLogs', selectedLog.id),
                      { offDutyKm: 0, updatedAt: serverTimestamp() },
                      { merge: true }
                    );
                    await loadLogs();
                    setSelectedLog({ ...selectedLog, offDutyKm: 0 });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-xs whitespace-nowrap"
                >
                  비업무 0km로 초기화
                </button>
              </div>
            )}

            {/* 퇴근 누락 보정 */}
            {selectedLog.status === 'in_progress' && (
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 space-y-3">
                <div className="font-bold text-blue-900">
                  🛠️ 퇴근 누락 건 관리자 수동 완료 처리
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={fixEndKm}
                    onChange={(e) => setFixEndKm(formatNumberWithCommas(e.target.value))}
                    placeholder="종료 주행거리 km (예: 125,000)"
                    className="flex-1 px-3 py-2 border rounded-xl bg-white"
                  />
                  <button
                    onClick={handleCompleteMissingCheckout}
                    className="px-4 py-2 bg-[#1E5EFF] text-white font-bold rounded-xl text-sm"
                  >
                    퇴근 완료로 보정
                  </button>
                </div>
              </div>
            )}

            {/* 무효(void) 처리 */}
            {selectedLog.status !== 'void' && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 space-y-3">
                <div className="font-bold text-red-900">
                  🚫 기록 무효(void) 처리 (매출 집계에서 제외)
                </div>
                <input
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="무효 사유 입력 (예: 오입력 테스트)"
                  className="w-full px-3 py-2 border rounded-xl bg-white text-sm"
                />
                <button
                  onClick={handleVoidLog}
                  className="w-full py-2 bg-red-600 text-white font-bold rounded-xl text-sm"
                >
                  무효(void) 처리하기
                </button>
              </div>
            )}
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
