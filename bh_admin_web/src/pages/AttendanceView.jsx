import React, { useEffect, useState, useMemo } from 'react';
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { todayKstStr, formatKstTime } from '../utils/format';

const WEEKDAYS = [
  { day: 0, label: '일' },
  { day: 1, label: '월' },
  { day: 2, label: '화' },
  { day: 3, label: '수' },
  { day: 4, label: '목' },
  { day: 5, label: '금' },
  { day: 6, label: '토' },
];

function getDayInfo(dateStr) {
  if (!dateStr) return { dayName: '', dayIndex: 0 };
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return { dayName: days[dt.getDay()], dayIndex: dt.getDay() };
}

function shiftDateStr(dateStr, offset) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + offset);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export default function AttendanceView() {
  const [selectedDate, setSelectedDate] = useState(todayKstStr());
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // 필터 & 검색 상태
  const [statusFilter, setStatusFilter] = useState('all'); // all, working, completed, off, absent
  const [deptFilter, setDeptFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 개별 기사 월간 출근 달력 모달
  const [monthlyModalDriver, setMonthlyModalDriver] = useState(null);
  const [monthlyLogs, setMonthlyLogs] = useState([]);
  const [loadingMonthly, setLoadingMonthly] = useState(false);

  // 1. 기본 데이터 로드 (Users, Vehicles, Routes)
  const loadMasterData = async () => {
    try {
      const [uSnap, vSnap, rSnap] = await Promise.all([
        getDocs(collection(db, 'Users')),
        getDocs(collection(db, 'Vehicles')),
        getDocs(collection(db, 'Routes')),
      ]);

      const driverList = uSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => (u.role !== 'admin' && u.role !== 'accounting') || u.driverCode === 'bh-ceo' || u.name === '김병훈')
        .sort((a, b) => {
          if (a.driverCode === 'bh-ceo') return -1;
          if (b.driverCode === 'bh-ceo') return 1;
          if (a.driverCode === 'bh-tk' || a.name === '정태광') return -1;
          if (b.driverCode === 'bh-tk' || b.name === '정태광') return 1;
          return (a.driverCode || '').localeCompare(b.driverCode || '', undefined, { numeric: true });
        });

      setDrivers(driverList);
      setVehicles(vSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setRoutes(rSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('기본 데이터 로드 실패:', err);
    }
  };

  // 2. 선택된 날짜의 DailyLogs 로드
  const loadDailyLogs = async (workDate) => {
    setLoading(true);
    try {
      const q = query(collection(db, 'DailyLogs'), where('workDate', '==', workDate));
      const snap = await getDocs(q);
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('DailyLogs 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMasterData();
  }, []);

  useEffect(() => {
    loadDailyLogs(selectedDate);
  }, [selectedDate]);

  // 맵 인덱싱
  const logsByDriverId = useMemo(() => {
    const map = new Map();
    logs.forEach((l) => {
      if (l.driverId) map.set(l.driverId, l);
    });
    return map;
  }, [logs]);

  const vehiclesById = useMemo(() => {
    const map = new Map();
    vehicles.forEach((v) => map.set(v.id, v));
    return map;
  }, [vehicles]);

  const routesById = useMemo(() => {
    const map = new Map();
    routes.forEach((r) => map.set(r.id, r));
    return map;
  }, [routes]);

  // 부서 목록 추출
  const deptList = useMemo(() => {
    const depts = new Set();
    drivers.forEach((d) => {
      if (d.dept) depts.add(d.dept);
    });
    return Array.from(depts);
  }, [drivers]);

  // 선택된 날짜의 요일 정보
  const dateInfo = useMemo(() => getDayInfo(selectedDate), [selectedDate]);

  // 기사별 출근/휴무 상태 판별
  const driverAttendanceList = useMemo(() => {
    return drivers.map((d) => {
      const log = logsByDriverId.get(d.id);
      const weeklyOffDays = Array.isArray(d.weeklyOffDays) ? d.weeklyOffDays : [];
      const offDates = Array.isArray(d.offDates) ? d.offDates : [];

      const isWeeklyOff = weeklyOffDays.includes(dateInfo.dayIndex);
      const isSpecificOff = offDates.includes(selectedDate);
      const isOffDay = isWeeklyOff || isSpecificOff;

      let status = 'absent'; // absent(미출근), working(운행중), completed(퇴근), off(휴무)
      if (log) {
        if (log.status === 'completed' || log.checkOutAt) {
          status = 'completed';
        } else {
          status = 'working';
        }
      } else if (isOffDay) {
        status = 'off';
      }

      // 차량 및 노선 정보
      const veh = vehiclesById.get(d.assignedVehicleId);
      const route = routesById.get(d.defaultRouteId);

      return {
        driver: d,
        log,
        status,
        isWeeklyOff,
        isSpecificOff,
        isOffDay,
        weeklyOffDays,
        offDates,
        vehiclePlate: veh?.plateNo || (d.assignedVehiclePlate || '-'),
        routeName: route?.name || (veh?.routeName || '-'),
      };
    });
  }, [drivers, logsByDriverId, vehiclesById, routesById, selectedDate, dateInfo]);

  // 요약 카운터 통계
  const stats = useMemo(() => {
    let working = 0;
    let completed = 0;
    let off = 0;
    let absent = 0;
    driverAttendanceList.forEach((item) => {
      if (item.status === 'working') working++;
      else if (item.status === 'completed') completed++;
      else if (item.status === 'off') off++;
      else absent++;
    });
    return {
      total: driverAttendanceList.length,
      working,
      completed,
      off,
      absent,
    };
  }, [driverAttendanceList]);

  // 필터링 적용
  const filteredList = useMemo(() => {
    return driverAttendanceList.filter((item) => {
      const d = item.driver;

      // 상태 필터
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }

      // 부서 필터
      if (deptFilter !== 'all' && d.dept !== deptFilter) {
        return false;
      }

      // 검색어 필터
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = (d.name || '').toLowerCase().includes(q);
        const matchCode = (d.driverCode || '').toLowerCase().includes(q);
        const matchDept = (d.dept || '').toLowerCase().includes(q);
        const matchPlate = (item.vehiclePlate || '').toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchDept && !matchPlate) {
          return false;
        }
      }

      return true;
    });
  }, [driverAttendanceList, statusFilter, deptFilter, searchQuery]);

  // 정기 요일 휴무 토글 (일, 월, 화, 수, 목, 금, 토)
  const handleToggleWeeklyOff = async (driver, dayIndex) => {
    const currentDays = Array.isArray(driver.weeklyOffDays) ? [...driver.weeklyOffDays] : [];
    const idx = currentDays.indexOf(dayIndex);
    if (idx >= 0) {
      currentDays.splice(idx, 1);
    } else {
      currentDays.push(dayIndex);
      currentDays.sort();
    }

    // 로컬 즉시 반영
    setDrivers((prev) =>
      prev.map((d) => (d.id === driver.id ? { ...d, weeklyOffDays: currentDays } : d))
    );

    // Firestore 저장
    try {
      await setDoc(
        doc(db, 'Users', driver.id),
        { weeklyOffDays: currentDays, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (err) {
      console.error('정기 휴무 저장 실패:', err);
      alert('정기 휴무 저장 실패: ' + err.message);
    }
  };

  // 특정 날짜 휴무 토글 (당일 휴무 지정 / 출근일 전환)
  const handleToggleSpecificOff = async (driver, dateStr) => {
    const currentOffDates = Array.isArray(driver.offDates) ? [...driver.offDates] : [];
    const idx = currentOffDates.indexOf(dateStr);
    let nextOffDates;

    if (idx >= 0) {
      nextOffDates = currentOffDates.filter((d) => d !== dateStr);
    } else {
      nextOffDates = [...currentOffDates, dateStr].sort();
    }

    // 로컬 즉시 반영
    setDrivers((prev) =>
      prev.map((d) => (d.id === driver.id ? { ...d, offDates: nextOffDates } : d))
    );

    // Firestore 저장
    try {
      await setDoc(
        doc(db, 'Users', driver.id),
        { offDates: nextOffDates, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (err) {
      console.error('휴무일 저장 실패:', err);
      alert('휴무일 저장 실패: ' + err.message);
    }
  };

  // 개별 기사 월간 출근 달력 모달 열기
  const openMonthlyCalendar = async (driver) => {
    setMonthlyModalDriver(driver);
    setLoadingMonthly(true);
    const ym = selectedDate.slice(0, 7);
    try {
      const q = query(
        collection(db, 'DailyLogs'),
        where('driverId', '==', driver.id),
        where('yearMonth', '==', ym)
      );
      const snap = await getDocs(q);
      setMonthlyLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('월간 로그 조회 실패:', err);
    } finally {
      setLoadingMonthly(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 헤더 및 날짜 선택 바 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <span>📅 기사별 출근표 & 일일 출근·휴무 관리</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            기사님이 휴대폰 앱에서 출근하면 자동으로 <b>[출근 완료]</b>로 반영되며, 기사별 정기 휴무 및 개별 휴무일을 간편하게 지정할 수 있습니다.
          </p>
        </div>

        {/* 날짜 컨트롤 (전날 / 오늘 / 다음날) */}
        <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border shadow-sm">
          <button
            onClick={() => setSelectedDate(shiftDateStr(selectedDate, -1))}
            className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-sm font-bold text-slate-700"
          >
            ◀ 전날
          </button>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-50 border rounded-xl">
            <span className="text-sm font-black text-slate-900">
              {selectedDate} ({dateInfo.dayName})
            </span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-6 opacity-0 absolute cursor-pointer"
            />
          </div>
          <button
            onClick={() => setSelectedDate(shiftDateStr(selectedDate, 1))}
            className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-sm font-bold text-slate-700"
          >
            다음날 ▶
          </button>
          {selectedDate !== todayKstStr() && (
            <button
              onClick={() => setSelectedDate(todayKstStr())}
              className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
            >
              오늘로
            </button>
          )}
        </div>
      </div>

      {/* 실시간 출근 현황 통계 카드 (5개) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <button
          onClick={() => setStatusFilter('all')}
          className={`p-4 rounded-2xl border text-left transition ${
            statusFilter === 'all'
              ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-slate-900'
              : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-sm'
          }`}
        >
          <div className="text-xs font-semibold opacity-70">👥 전체 기사</div>
          <div className="text-2xl font-black mt-1">{stats.total}명</div>
        </button>

        <button
          onClick={() => setStatusFilter('working')}
          className={`p-4 rounded-2xl border text-left transition ${
            statusFilter === 'working'
              ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-500'
              : 'bg-emerald-50 hover:bg-emerald-100/70 text-emerald-950 border-emerald-200 shadow-sm'
          }`}
        >
          <div className="text-xs font-bold text-emerald-700">🟢 출근 중 (운행 중)</div>
          <div className="text-2xl font-black text-emerald-800 mt-1">{stats.working}명</div>
        </button>

        <button
          onClick={() => setStatusFilter('completed')}
          className={`p-4 rounded-2xl border text-left transition ${
            statusFilter === 'completed'
              ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-500'
              : 'bg-blue-50 hover:bg-blue-100/70 text-blue-950 border-blue-200 shadow-sm'
          }`}
        >
          <div className="text-xs font-bold text-blue-700">🔵 퇴근 완료</div>
          <div className="text-2xl font-black text-blue-800 mt-1">{stats.completed}명</div>
        </button>

        <button
          onClick={() => setStatusFilter('off')}
          className={`p-4 rounded-2xl border text-left transition ${
            statusFilter === 'off'
              ? 'bg-amber-500 text-white border-amber-500 shadow-md ring-2 ring-amber-400'
              : 'bg-amber-50 hover:bg-amber-100/70 text-amber-950 border-amber-200 shadow-sm'
          }`}
        >
          <div className="text-xs font-bold text-amber-700">🟡 오늘 휴무 (쉬는 날)</div>
          <div className="text-2xl font-black text-amber-800 mt-1">{stats.off}명</div>
        </button>

        <button
          onClick={() => setStatusFilter('absent')}
          className={`p-4 rounded-2xl border text-left transition ${
            statusFilter === 'absent'
              ? 'bg-rose-600 text-white border-rose-600 shadow-md ring-2 ring-rose-500'
              : 'bg-rose-50 hover:bg-rose-100/70 text-rose-950 border-rose-200 shadow-sm'
          }`}
        >
          <div className="text-xs font-bold text-rose-700">⚪ 미출근 (출근 전)</div>
          <div className="text-2xl font-black text-rose-800 mt-1">{stats.absent}명</div>
        </button>
      </div>

      {/* 검색 및 부서 필터 */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="기사 이름 · 코드 · 부서 · 차량번호 검색"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-72 px-3.5 py-2 border rounded-xl text-sm bg-white"
          />

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-2 border rounded-xl text-sm bg-white font-bold text-slate-700"
          >
            <option value="all">전체 부서</option>
            {deptList.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>

          {statusFilter !== 'all' && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 flex items-center gap-1">
              상태 필터: <b>{statusFilter === 'working' ? '출근 중' : statusFilter === 'completed' ? '퇴근 완료' : statusFilter === 'off' ? '휴무' : '미출근'}</b>
              <button
                onClick={() => setStatusFilter('all')}
                className="ml-1 hover:text-black font-black"
              >
                ✕
              </button>
            </span>
          )}
        </div>

        <div className="text-xs text-slate-500 font-semibold">
          표시 인원: <b>{filteredList.length}명</b> / 전체 {drivers.length}명
        </div>
      </div>

      {/* 출근표 테이블 */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm text-left">
            <thead className="bg-slate-50 border-b font-bold text-slate-700">
              <tr>
                <th className="p-3 whitespace-nowrap">기사 코드</th>
                <th className="p-3 whitespace-nowrap">이름 / 부서</th>
                <th className="p-3 whitespace-nowrap">배정 차량 · 노선</th>
                <th className="p-3 whitespace-nowrap">오늘 ({selectedDate}) 출근 상태</th>
                <th className="p-3 whitespace-nowrap">출근 / 퇴근 시간 및 거리</th>
                <th className="p-3 whitespace-nowrap">정기 휴무 요일 설정 (주간)</th>
                <th className="p-3 whitespace-nowrap">당일 휴무 / 월간 출근부</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-12 text-center text-slate-400 font-bold">
                    해당 조건에 일치하는 기사님이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => {
                  const d = item.driver;
                  const log = item.log;

                  return (
                    <tr key={d.id} className="hover:bg-slate-50/80 transition">
                      {/* 기사 코드 */}
                      <td className="p-3 whitespace-nowrap">
                        {d.driverCode === 'bh-ceo' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-amber-500 text-white font-black text-xs shadow-sm">
                            👑 bh-ceo
                          </span>
                        ) : d.driverCode === 'bh-tk' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-indigo-600 text-white font-black text-xs shadow-sm">
                            ⭐ bh-tk
                          </span>
                        ) : (
                          <span className="font-bold text-[#1E5EFF]">
                            {d.driverCode || '-'}
                          </span>
                        )}
                      </td>

                      {/* 이름 / 부서 */}
                      <td className="p-3 whitespace-nowrap">
                        <div className="font-black text-slate-900 flex items-center gap-1.5">
                          {d.name}
                          {d.dept && (
                            <span className="px-2 py-0.5 text-[11px] rounded-md font-semibold bg-slate-100 text-slate-700">
                              {d.dept}
                            </span>
                          )}
                        </div>
                        {d.phone && (
                          <div className="text-xs text-slate-400 mt-0.5">{d.phone}</div>
                        )}
                      </td>

                      {/* 배정 차량 / 노선 */}
                      <td className="p-3 whitespace-nowrap">
                        <div className="font-bold text-slate-800">
                          {item.vehiclePlate !== '-' ? item.vehiclePlate : <span className="text-slate-400 font-normal">차량 미배정</span>}
                        </div>
                        <div className="text-xs text-slate-500 truncate max-w-[180px]">
                          {item.routeName}
                        </div>
                      </td>

                      {/* 오늘 상태 배지 */}
                      <td className="p-3 whitespace-nowrap">
                        {item.status === 'working' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            🟢 출근 완료 (운행 중)
                          </span>
                        ) : item.status === 'completed' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-blue-100 text-blue-800 border border-blue-300">
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                            🔵 퇴근 완료
                          </span>
                        ) : item.status === 'off' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 border border-amber-300">
                            🟡 휴무 ({item.isWeeklyOff ? '정기 휴무' : '지정 휴무'})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            ⚪ 미출근 (출근 전)
                          </span>
                        )}
                      </td>

                      {/* 출퇴근 세부 시간 및 거리 */}
                      <td className="p-3">
                        {log ? (
                          <div className="space-y-0.5 text-xs">
                            <div className="font-bold text-slate-800">
                              출근: {formatKstTime(log.checkInAt)}
                              {log.startOdometerKm ? ` (${Number(log.startOdometerKm).toLocaleString()}km)` : ''}
                              {log.checkOutAt && (
                                <span className="text-blue-700 ml-2">
                                  → 퇴근: {formatKstTime(log.checkOutAt)}
                                </span>
                              )}
                            </div>
                            {Number(log.drivenKm) > 0 && (
                              <div className="text-emerald-700 font-bold">
                                실운행: {Number(log.drivenKm).toLocaleString()} km
                              </div>
                            )}
                            {log.startAddress && (
                              <div className="text-slate-400 text-[11px] truncate max-w-[220px]">
                                📍 {log.startAddress}
                              </div>
                            )}
                            {log.hasIssue && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-700">
                                ⚠️ 일일점검 이상 보고
                              </span>
                            )}
                          </div>
                        ) : item.status === 'off' ? (
                          <span className="text-xs text-amber-700 font-semibold">
                            쉬는 날 (휴무 지정됨)
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>

                      {/* 정기 요일 휴무 설정 (7개 요일 칩) */}
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {WEEKDAYS.map((w) => {
                            const isOff = item.weeklyOffDays.includes(w.day);
                            return (
                              <button
                                key={w.day}
                                onClick={() => handleToggleWeeklyOff(d, w.day)}
                                title={`${w.label}요일 정기 휴무 토글`}
                                className={`w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center transition ${
                                  isOff
                                    ? 'bg-amber-400 text-amber-950 font-black shadow-sm'
                                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                }`}
                              >
                                {w.label}
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      {/* 당일 휴무 지정 / 월간 출근부 버튼 */}
                      <td className="p-3 whitespace-nowrap space-x-1.5">
                        {!log && (
                          <button
                            onClick={() => handleToggleSpecificOff(d, selectedDate)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition shadow-sm ${
                              item.isOffDay
                                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border'
                                : 'bg-amber-500 text-white hover:bg-amber-600'
                            }`}
                          >
                            {item.isOffDay ? '출근일로 전환' : '오늘 휴무 지정'}
                          </button>
                        )}
                        <button
                          onClick={() => openMonthlyCalendar(d)}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                        >
                          월간 출근부
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 개별 기사 월간 출근 달력 모달 */}
      {monthlyModalDriver && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <span>📅 {monthlyModalDriver.name} 기사님 월간 출근부</span>
                  <span className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-800 font-bold">
                    {selectedDate.slice(0, 7)}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  날짜를 클릭하면 해당 날짜를 <b>[휴무 ↔ 정상 출근일]</b>로 즉시 전환할 수 있습니다.
                </p>
              </div>
              <button
                onClick={() => setMonthlyModalDriver(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center font-bold text-slate-600"
              >
                ✕
              </button>
            </div>

            {loadingMonthly ? (
              <div className="p-12 text-center text-slate-400 font-bold">
                월간 운행 기록을 불러오는 중...
              </div>
            ) : (
              <div className="space-y-4">
                {/* 월간 달력 그리드 */}
                <div className="grid grid-cols-7 gap-2 text-center">
                  {['일', '월', '화', '수', '목', '금', '토'].map((day, idx) => (
                    <div
                      key={day}
                      className={`text-xs font-black py-1.5 ${
                        idx === 0 ? 'text-rose-600' : idx === 6 ? 'text-blue-600' : 'text-slate-600'
                      }`}
                    >
                      {day}
                    </div>
                  ))}

                  {/* 달력 날짜 렌더링 */}
                  {(() => {
                    const ym = selectedDate.slice(0, 7);
                    const [year, month] = ym.split('-').map(Number);
                    const firstDayIndex = new Date(year, month - 1, 1).getDay();
                    const lastDate = new Date(year, month, 0).getDate();

                    const cells = [];
                    // 앞쪽 빈칸
                    for (let i = 0; i < firstDayIndex; i++) {
                      cells.push(<div key={`empty-${i}`} className="h-16 rounded-xl bg-slate-50"></div>);
                    }

                    // 1일 ~ 말일
                    const logMap = new Map();
                    monthlyLogs.forEach((l) => {
                      if (l.workDate) logMap.set(l.workDate, l);
                    });

                    const driverWeeklyOff = Array.isArray(monthlyModalDriver.weeklyOffDays)
                      ? monthlyModalDriver.weeklyOffDays
                      : [];
                    const driverOffDates = Array.isArray(monthlyModalDriver.offDates)
                      ? monthlyModalDriver.offDates
                      : [];

                    for (let d = 1; d <= lastDate; d++) {
                      const curDateStr = `${ym}-${String(d).padStart(2, '0')}`;
                      const dayOfWeek = new Date(year, month - 1, d).getDay();
                      const log = logMap.get(curDateStr);

                      const isWeeklyOff = driverWeeklyOff.includes(dayOfWeek);
                      const isSpecificOff = driverOffDates.includes(curDateStr);
                      const isOff = isWeeklyOff || isSpecificOff;

                      let cellBg = 'bg-white hover:border-slate-400';
                      let statusText = '미출근';
                      let badgeColor = 'text-slate-400';

                      if (log) {
                        if (log.status === 'completed' || log.checkOutAt) {
                          cellBg = 'bg-blue-50 border-blue-200';
                          statusText = `퇴근 (${log.drivenKm || 0}km)`;
                          badgeColor = 'text-blue-700 font-bold';
                        } else {
                          cellBg = 'bg-emerald-50 border-emerald-200';
                          statusText = '운행 중';
                          badgeColor = 'text-emerald-700 font-bold';
                        }
                      } else if (isOff) {
                        cellBg = 'bg-amber-50 border-amber-200';
                        statusText = isWeeklyOff ? '정기휴무' : '지정휴무';
                        badgeColor = 'text-amber-700 font-bold';
                      }

                      cells.push(
                        <button
                          key={curDateStr}
                          onClick={() => handleToggleSpecificOff(monthlyModalDriver, curDateStr)}
                          className={`h-16 p-1.5 rounded-xl border flex flex-col justify-between text-left transition ${cellBg}`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-black ${
                                dayOfWeek === 0
                                  ? 'text-rose-600'
                                  : dayOfWeek === 6
                                  ? 'text-blue-600'
                                  : 'text-slate-700'
                              }`}
                            >
                              {d}
                            </span>
                            {curDateStr === todayKstStr() && (
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                            )}
                          </div>
                          <div className={`text-[10px] leading-tight truncate ${badgeColor}`}>
                            {statusText}
                          </div>
                        </button>
                      );
                    }

                    return cells;
                  })()}
                </div>

                {/* 하단 범례 */}
                <div className="flex items-center justify-center gap-4 text-xs font-semibold pt-3 border-t text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300"></span>
                    출근 완료 (운행 중)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-blue-100 border border-blue-300"></span>
                    퇴근 완료
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300"></span>
                    지정/정기 휴무
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-white border border-slate-300"></span>
                    미출근
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
