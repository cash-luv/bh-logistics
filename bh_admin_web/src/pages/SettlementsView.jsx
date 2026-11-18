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
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { auth, db, storage, secondaryAuth } from '../firebase';
import {
  calcDday,
  formatKstTime,
  todayKstStr,
  formatNumberWithCommas,
  parseNumberWithoutCommas,
} from '../utils/format';
const CHART_COLORS = ['#1E5EFF', '#00796B', '#F59E0B', '#6366F1', '#EC4899'];


/* ============================================================================
 * [관리자 10 & 11] 월 결산 + Recharts 시각화 차트 3종 + 마감(Settlements) + ExcelJS 다운로드
 * ========================================================================== */
export default function SettlementsView({ adminUid, onSelectDriverLogs }) {
  const now = new Date();
  const defaultYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}`;
  const [yearMonth, setYearMonth] = useState(defaultYm);
  const [logs, setLogs] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [dieselPrice, setDieselPrice] = useState(1550);

  const loadAll = async () => {
    const [lSnap, vSnap, mSnap, sSnap, cfgSnap] = await Promise.all([
      getDocs(
        query(collection(db, 'DailyLogs'), where('yearMonth', '==', yearMonth))
      ),
      getDocs(collection(db, 'Vehicles')),
      getDocs(collection(db, 'Maintenance')),
      getDocs(
        query(collection(db, 'Settlements'), where('yearMonth', '==', yearMonth))
      ),
      getDoc(doc(db, 'Settings', 'fuel')),
    ]);
    setLogs(lSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setVehicles(vSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setMaintenance(mSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setSettlements(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    if (cfgSnap.exists() && cfgSnap.data()?.dieselPricePerL) {
      setDieselPrice(Number(cfgSnap.data().dieselPricePerL) || 1550);
    }
  };

  useEffect(() => {
    loadAll();
  }, [yearMonth]);

  const validLogs = logs.filter(
    (l) => l.status === 'in_progress' || l.status === 'completed'
  );
  const missingCheckoutCount = logs.filter(
    (l) => l.status === 'in_progress'
  ).length;
  const voidCount = logs.filter((l) => l.status === 'void').length;

  // 기사별 집계
  const byDriverMap = {};
  const byDateMap = {};
  const byRouteMap = {};

  for (const l of validLogs) {
    const dId = l.driverId || l.driverName;
    if (!byDriverMap[dId]) {
      byDriverMap[dId] = {
        driverId: dId,
        driverName: l.driverName || '미상',
        workDays: 0,
        totalAmount: 0,
        totalKm: 0,
        fuelCost: 0,
      };
    }
    byDriverMap[dId].workDays += 1;
    byDriverMap[dId].totalAmount += Number(l.routePrice) || 0;
    byDriverMap[dId].totalKm += Number(l.drivenKm) || 0;
    byDriverMap[dId].fuelCost += Number(l.estimatedFuelCost) || 0;

    const dt = l.workDate || '';
    byDateMap[dt] = (byDateMap[dt] || 0) + (Number(l.routePrice) || 0);

    const rName = l.routeName || '기타';
    if (!byRouteMap[rName]) {
      byRouteMap[rName] = { amount: 0, count: 0, km: 0 };
    }
    byRouteMap[rName].amount += Number(l.routePrice) || 0;
    byRouteMap[rName].count += 1;
    byRouteMap[rName].km += Number(l.drivenKm) || 0;
  }

  const driverRows = Object.values(byDriverMap);
  const dateChartData = Object.entries(byDateMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({ date: date.slice(5), 매출: amount }));
  const routeChartData = Object.entries(byRouteMap).map(([name, info]) => ({
    name,
    // 단가가 0원(빽다방, 교촌 등 미정)이어도 도넛 차트에 비율이 보이도록 금액이 0이면 출근건수 기준으로도 표시 지원
    value: info.amount > 0 ? info.amount : info.count * 100000,
    actualAmount: info.amount,
    count: info.count,
    km: info.km,
  }));

  const totalAmount = driverRows.reduce((s, r) => s + r.totalAmount, 0);
  const totalDays = driverRows.reduce((s, r) => s + r.workDays, 0);
  const totalKm = driverRows.reduce((s, r) => s + r.totalKm, 0);

  const isClosed = settlements.some((s) => s.status === 'closed');

  const handleCloseMonth = async () => {
    if (
      !window.confirm(
        `${yearMonth}월 결산을 마감(closed)하시겠습니까? 기사별 확정 금액이 Settlements 컬렉션에 저장됩니다.`
      )
    ) {
      return;
    }
    const batch = writeBatch(db);
    for (const r of driverRows) {
      batch.set(doc(db, 'Settlements', `${yearMonth}_${r.driverId}`), {
        yearMonth,
        driverId: r.driverId,
        driverName: r.driverName,
        workDays: r.workDays,
        totalAmount: r.totalAmount,
        totalKm: r.totalKm,
        status: 'closed',
        closedAt: serverTimestamp(),
        closedBy: adminUid,
      });
    }
    await batch.commit();
    await loadAll();
    alert('이번 달 결산이 마감되었습니다.');
  };

  const handleReopenMonth = async () => {
    if (!window.confirm('마감을 취소하고 draft 상태로 되돌리시겠습니까?')) return;
    const batch = writeBatch(db);
    for (const s of settlements) {
      batch.set(
        doc(db, 'Settlements', s.id),
        { status: 'draft', updatedAt: serverTimestamp() },
        { merge: true }
      );
    }
    await batch.commit();
    await loadAll();
  };

  const handleExcel = async () => {
    setDownloading(true);
    try {
      const { exportMonthlySettlementExcel } = await import('../utils/excel');
      await exportMonthlySettlementExcel({
        yearMonth,
        logs,
        vehicles,
        maintenance,
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black">월 결산 · 시각화 · 엑셀 다운로드</h1>
            {isClosed && (
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black">
                ✓ 결산 마감됨
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            퇴근 누락 {missingCheckoutCount}건 · 무효(void) {voidCount}건
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="px-4 py-2 rounded-xl border bg-white font-bold"
          />
          <button
            onClick={handleExcel}
            disabled={downloading}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow"
          >
            {downloading ? '만드는 중...' : '📥 ExcelJS 월결산 엑셀 다운로드'}
          </button>
          {!isClosed ? (
            <button
              onClick={handleCloseMonth}
              className="px-5 py-2.5 rounded-xl bg-[#1E5EFF] text-white font-bold text-sm"
            >
              이번 달 결산 마감
            </button>
          ) : (
            <button
              onClick={handleReopenMonth}
              className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-sm"
            >
              마감 취소 (draft)
            </button>
          )}
        </div>
      </div>

      {missingCheckoutCount > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 font-bold text-sm">
          ⚠️ 퇴근 누락이 {missingCheckoutCount}건 있어요. 마감 전에 [운행 기록]
          메뉴에서 보정하세요.
        </div>
      )}

      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          title="월 총매출 (스냅샷 단가 합계)"
          value={`${totalAmount.toLocaleString()}원`}
          sub={`${yearMonth}월 기준`}
          color="text-[#1E5EFF]"
        />
        <KpiCard
          title="총 출근 일수"
          value={`${totalDays}일`}
          sub={`기사 ${driverRows.length}명`}
          color="text-slate-900"
        />
        <KpiCard
          title="총 운행 거리"
          value={`${totalKm.toLocaleString()}km`}
          sub="계기판 기준 누적"
          color="text-emerald-600"
        />
      </div>

      {/* [관리자 10] Recharts 차트 3종 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-2xl shadow-sm border h-72">
          <div className="font-bold text-sm mb-2">(1) 기사별 매출 비교</div>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={driverRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="driverName" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="totalAmount" name="매출(원)" fill="#1E5EFF" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border h-72">
          <div className="font-bold text-sm mb-2">(2) 일별 매출 추이</div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={dateChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="매출"
                stroke="#00796B"
                strokeWidth={3}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border flex flex-col overflow-hidden min-h-[288px]">
          <div className="font-bold text-sm mb-3">(3) 노선별 매출 · 운행 비율</div>
          <div className="flex-1 flex flex-col sm:flex-row items-center gap-4 min-w-0">
            <div className="w-36 h-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={routeChartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={36}
                    outerRadius={62}
                    paddingAngle={3}
                  >
                    {routeChartData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(_, __, item) => [
                      `${(item?.payload?.actualAmount || 0).toLocaleString()}원 (${
                        item?.payload?.count || 0
                      }회 · ${(item?.payload?.km || 0).toLocaleString()}km)`,
                      item?.payload?.name || '',
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="flex-1 min-w-0 w-full space-y-2 text-xs overflow-y-auto max-h-48 pr-1">
              {routeChartData.map((item, i) => {
                const pct =
                  totalAmount > 0 && item.actualAmount > 0
                    ? Math.round((item.actualAmount / totalAmount) * 100)
                    : Math.round((item.count / Math.max(1, totalDays)) * 100);
                return (
                  <div
                    key={item.name}
                    className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200/70"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            CHART_COLORS[i % CHART_COLORS.length],
                        }}
                      />
                      <span className="font-bold text-slate-800 truncate">
                        {item.name}
                      </span>
                    </div>
                    <div className="text-right shrink-0 whitespace-nowrap">
                      <span className="font-black text-slate-900">
                        {item.actualAmount > 0
                          ? `${item.actualAmount.toLocaleString()}원`
                          : `${item.count}회 (${item.km.toLocaleString()}km)`}
                      </span>
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-100 text-[#1E5EFF] font-black">
                        {pct}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 예상 주유비 산정 기준 안내 및 경유 단가 설정 바 */}
      <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-sm">
        <div className="space-y-0.5">
          <div className="font-black text-emerald-950">
            ⛽ 예상 주유비 자동 산출 공식: (일일 운행거리 km ÷ 차량별 연비 km/L) × 기준 경유 단가(원/L)
          </div>
          <div className="text-xs text-emerald-800">
            예: 380km 운행 ÷ 연비 5.5km/L = 약 69.1L 소모 × 리터당{' '}
            <b>{dieselPrice.toLocaleString()}원</b> ={' '}
            <b>
              {Math.round((380 / 5.5) * dieselPrice).toLocaleString()}원
            </b>{' '}
            (차량별 연비는 [3. 차량 관리]에서, 기준 경유값은 오른쪽에서 언제든 변경 가능)
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold text-emerald-900">
            기준 경유 단가(원/L):
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={formatNumberWithCommas(dieselPrice)}
            onChange={(e) => setDieselPrice(parseNumberWithoutCommas(e.target.value))}
            className="w-28 px-3 py-1.5 rounded-xl border border-emerald-300 bg-white font-black text-right"
          />
          <button
            onClick={async () => {
              await setDoc(
                doc(db, 'Settings', 'fuel'),
                { dieselPricePerL: dieselPrice, updatedAt: serverTimestamp() },
                { merge: true }
              );
              alert(
                `기준 경유 단가가 리터당 ${dieselPrice.toLocaleString()}원으로 저장되었습니다!`
              );
            }}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs whitespace-nowrap"
          >
            경유값 적용
          </button>
        </div>
      </div>

      {/* 기사별 정산 표 (맨 아래 합계 행 포함) */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <table className="w-full min-w-[820px] text-sm text-left">
          <thead className="bg-slate-50 border-b font-bold">
            <tr>
              <th className="p-3 whitespace-nowrap">기사 (클릭 시 운행기록 이동)</th>
              <th className="p-3 whitespace-nowrap">출근 일수</th>
              <th className="p-3 whitespace-nowrap">총 운행km</th>
              <th className="p-3 whitespace-nowrap">예상 주유비 합계</th>
              <th className="p-3 whitespace-nowrap">합계 금액 (원)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {driverRows.map((r) => (
              <tr key={r.driverId} className="hover:bg-slate-50">
                <td className="p-3">
                  <button
                    onClick={() => onSelectDriverLogs(r.driverId)}
                    className="font-bold text-[#1E5EFF] underline"
                  >
                    {r.driverName}
                  </button>
                </td>
                <td className="p-3 font-semibold">{r.workDays}일</td>
                <td className="p-3 font-semibold">
                  {r.totalKm.toLocaleString()}km
                </td>
                <td className="p-3 text-emerald-700 font-semibold">
                  {r.fuelCost.toLocaleString()}원
                </td>
                <td className="p-3 font-black">
                  {r.totalAmount.toLocaleString()}원
                </td>
              </tr>
            ))}
            <tr className="bg-slate-900 text-white font-black">
              <td className="p-3">합계</td>
              <td className="p-3">{totalDays}일</td>
              <td className="p-3">{totalKm.toLocaleString()}km</td>
              <td className="p-3">
                {driverRows
                  .reduce((s, r) => s + r.fuelCost, 0)
                  .toLocaleString()}
                원
              </td>
              <td className="p-3">{totalAmount.toLocaleString()}원</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
