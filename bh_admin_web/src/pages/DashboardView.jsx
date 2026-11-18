import React, { useEffect, useState } from 'react';
import KpiCard from '../components/KpiCard';
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
 * [관리자 7] 종합 KPI 대시보드
 * - 위쪽 카드 4개(총매출, 운행중, 공차/대기, 정비필요) + 주유비/비업무주행 카드
 * - 아래쪽: (1) 검사 임박·초과 차량 목록, (2) 오늘 출근 현황, (3) 오늘 아직 출근 안 한 기사 목록
 * ========================================================================== */
export default function DashboardView({
  onNavigateVehicles,
  onOpenVehicleDetail,
  onNavigateLogs,
}) {
  const now = new Date();
  const defaultYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}`;
  const [yearMonth, setYearMonth] = useState(defaultYm);
  const [logs, setLogs] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [logsSnap, vehSnap, userSnap, maintSnap] = await Promise.all([
        getDocs(
          query(collection(db, 'DailyLogs'), where('yearMonth', '==', yearMonth))
        ),
        getDocs(collection(db, 'Vehicles')),
        getDocs(collection(db, 'Users')),
        getDocs(
          query(collection(db, 'Maintenance'), where('status', '==', 'planned'))
        ),
      ]);

      setLogs(
        logsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.workDate || '').localeCompare(a.workDate || ''))
      );
      setVehicles(vehSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setDrivers(
        userSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => u.role === 'driver' && u.isActive !== false)
      );
      setMaintenance(maintSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [yearMonth]);

  const activeVehicles = vehicles.filter((v) => v.isActive !== false);
  const totalRevenue = logs
    .filter((l) => l.status === 'in_progress' || l.status === 'completed')
    .reduce((sum, l) => sum + (Number(l.routePrice) || 0), 0);
  const totalFuelCost = logs.reduce(
    (sum, l) => sum + (Number(l.estimatedFuelCost) || 0),
    0
  );

  const drivingCount = activeVehicles.filter(
    (v) => v.status === 'driving'
  ).length;
  const unassignedCount = activeVehicles.filter(
    (v) => !v.assignedDriverId
  ).length;
  const idleAssignedCount = activeVehicles.filter(
    (v) => v.status === 'idle' && v.assignedDriverId
  ).length;

  const inspectionDueVehicles = activeVehicles
    .map((v) => ({ ...v, dDay: calcDday(v.inspectionDueDate) }))
    .filter((v) => v.dDay != null && v.dDay <= 30)
    .sort((a, b) => (a.dDay ?? 999) - (b.dDay ?? 999));

  const todayStr = todayKstStr();
  const todayLogs = logs.filter((l) => l.workDate === todayStr);
  const checkedInDriverIds = new Set(todayLogs.map((l) => l.driverId));
  const notCheckedInDrivers = drivers.filter(
    (d) => !checkedInDriverIds.has(d.id)
  );
  const offDutyAlerts = logs.filter((l) => {
    const off = Number(l.offDutyKm) || 0;
    return off > 5 && off <= 2000;
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">종합 KPI 대시보드</h1>
          <p className="text-sm text-slate-500 mt-1">
            카드를 누르면 해당 상세 목록으로 바로 이동합니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="px-4 py-2 rounded-xl border border-slate-300 bg-white font-bold"
          />
          <button
            onClick={loadData}
            className="px-4 py-2 rounded-xl bg-slate-800 text-white font-bold"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* [관리자 7] 위쪽 KPI 카드 5개 (클릭 이동 연동) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <KpiCard
          title="1. 이달 총매출 (출근 기준)"
          value={`${totalRevenue.toLocaleString()}원`}
          sub={`유효 운행 ${
            logs.filter((l) => l.status !== 'void').length
          }건 · 클릭 시 운행기록`}
          color="text-[#1E5EFF]"
          onClick={onNavigateLogs}
        />
        <KpiCard
          title="2. 운행 중 차량 수"
          value={`${drivingCount}대`}
          sub="클릭 시 운행 중 차량 보기"
          color="text-sky-600"
          onClick={() => onNavigateVehicles('driving')}
        />
        <KpiCard
          title="3. 공차 (미배정 차량)"
          value={`${unassignedCount}대`}
          sub={`차고지 대기(배정됨): ${idleAssignedCount}대`}
          color="text-slate-800"
          onClick={() => onNavigateVehicles('unassigned')}
        />
        <KpiCard
          title="4. 정비 필요 · 검사 임박"
          value={`${inspectionDueVehicles.length + maintenance.length}건`}
          sub={`검사 임박 ${inspectionDueVehicles.length}대 · 예정 정비 ${maintenance.length}건`}
          color="text-amber-600"
          onClick={() => onNavigateVehicles('inspectionDue')}
        />
        <KpiCard
          title="5. 예상 주유비 · 사적운행 감지"
          value={`${totalFuelCost.toLocaleString()}원`}
          sub={`비업무 주행 감지 ${offDutyAlerts.length}건`}
          color="text-emerald-600"
          onClick={onNavigateLogs}
        />
      </div>

      {/* 비업무(사적) 주행 감지 배너 */}
      {offDutyAlerts.length > 0 && (
        <div className="p-5 rounded-2xl bg-amber-50 border-2 border-amber-300">
          <div className="font-black text-amber-900 text-base">
            ⚠️ 퇴근 후 ~ 다음 출근 사이 비업무(개인 용도) 주행 감지 (
            {offDutyAlerts.length}건)
          </div>
          <div className="mt-2 space-y-1 text-sm text-amber-900">
            {offDutyAlerts.map((a) => (
              <div key={a.id} className="font-semibold">
                • [{a.workDate}] {a.driverName} 기사 ({a.plateNo}): 직전 퇴근{' '}
                {Number(a.prevEndOdometerKm).toLocaleString()}km → 당일 출근{' '}
                {Number(a.startOdometerKm).toLocaleString()}km (비업무{' '}
                <span className="text-red-600 font-black">
                  +{Number(a.offDutyKm).toLocaleString()}km
                </span>{' '}
                / 출근 위치: {a.startAddress || '-'})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* [관리자 7] 아래쪽 3단 패널: (1) 검사 임박·초과 차량, (2) 오늘 출근 현황, (3) 오늘 미출근 기사 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* (1) 검사 임박 · 초과 차량 목록 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h2 className="font-bold text-base mb-3.5">
            🚨 정기검사 임박 · 초과 차량 (30일 이내)
          </h2>
          {loading ? (
            <div className="text-sm text-slate-400">불러오는 중...</div>
          ) : inspectionDueVehicles.length === 0 ? (
            <div className="text-sm text-slate-400">
              30일 이내 검사 만료 차량이 없습니다.
            </div>
          ) : (
            <FoldableList items={inspectionDueVehicles} limit={20}>
              {(v) => (
                <button
                  key={v.id}
                  onClick={() => onOpenVehicleDetail(v.id)}
                  className="w-full flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200/70 text-left transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 truncate">
                      {v.plateNo}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">
                      만료일: {v.inspectionDueDate}
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-black whitespace-nowrap inline-flex items-center justify-center shrink-0 ${
                      v.dDay < 0
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {v.dDay < 0 ? `D+${Math.abs(v.dDay)} 초과` : `D-${v.dDay}`}
                  </span>
                </button>
              )}
            </FoldableList>
          )}
        </div>

        {/* (2) 오늘 출근 현황 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h2 className="font-bold text-base mb-3.5">
            🚛 오늘 출근 현황 ({todayStr})
          </h2>
          {loading ? (
            <div className="text-sm text-slate-400">불러오는 중...</div>
          ) : todayLogs.length === 0 ? (
            <div className="text-sm text-slate-400">
              오늘 출근한 기록이 아직 없습니다.
            </div>
          ) : (
            <FoldableList items={todayLogs} limit={20}>
              {(l) => (
                <div
                  key={l.id}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 truncate">
                        {l.driverName} · {l.plateNo}
                      </span>
                      {l.hasIssue && (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-black whitespace-nowrap inline-flex items-center shrink-0">
                          점검 이상
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 truncate">
                      {l.routeName || '노선 미정'} · {formatKstTime(l.checkInAt)}{' '}
                      출근
                    </div>
                  </div>
                  <span
                    className={`text-xs font-extrabold px-3 py-1.5 rounded-full whitespace-nowrap inline-flex items-center justify-center shrink-0 ${
                      l.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        : 'bg-blue-100 text-[#1E5EFF] border border-blue-200'
                    }`}
                  >
                    {l.status === 'completed' ? '퇴근 완료' : '운행 중'}
                  </span>
                </div>
              )}
            </FoldableList>
          )}
        </div>

        {/* (3) 오늘 아직 출근 안 한 활성 기사 목록 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <h2 className="font-bold text-base mb-3.5">
            ⏳ 오늘 아직 출근 안 한 기사 ({notCheckedInDrivers.length}명)
          </h2>
          {loading ? (
            <div className="text-sm text-slate-400">불러오는 중...</div>
          ) : notCheckedInDrivers.length === 0 ? (
            <div className="text-sm text-emerald-600 font-bold">
              모든 활성 기사님이 출근했습니다!
            </div>
          ) : (
            <FoldableList items={notCheckedInDrivers} limit={20}>
              {(d) => (
                <div
                  key={d.id}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 truncate">
                      {d.name} 기사
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">
                      연락처: {d.phone || '-'}
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-slate-200/80 text-xs font-bold text-slate-600 whitespace-nowrap inline-flex items-center justify-center shrink-0">
                    출근 전
                  </span>
                </div>
              )}
            </FoldableList>
          )}
        </div>
      </div>
    </div>
  );
}

/* 목록이 길 때 limit개만 보여주고 [더보기 ▼] / [접기 ▲]로 펼치는 공용 컴포넌트 */
function FoldableList({ items, limit = 20, children }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, limit);
  return (
    <div className="space-y-2.5">
      {shown.map((it) => children(it))}
      {items.length > limit && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs"
        >
          {open ? '▲ 접기' : `▼ ${items.length - limit}개 더보기`}
        </button>
      )}
    </div>
  );
}
