import React, { useEffect, useMemo, useState } from 'react';
import KpiCard from '../components/KpiCard';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
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
} from 'recharts';
import { db, secondaryAuth } from '../firebase';
import {
  todayKstStr,
  formatNumberWithCommas,
  parseNumberWithoutCommas,
} from '../utils/format';
import {
  parseKakaoAndExcelDispatch,
  applyClientAndCategoryToGroups,
  buildTripFromUnmatchedMilkrun,
  SAMPLE_KAKAO_DISPATCH_TEXT,
} from '../utils/dispatchParser';
import {
  fileToImagePart,
  analyzeDispatchWithAI,
} from '../services/aiDispatchService';

const CHART_COLORS = [
  '#1E5EFF',
  '#00796B',
  '#F59E0B',
  '#6366F1',
  '#EC4899',
  '#0EA5E9',
  '#10B981',
];

function kstOffsetDateStr(offsetDays = 0) {
  const kstMs = Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

function getRouteBillingType(route) {
  if (!route) return 'monthly';
  if (route.billingType === 'variable' || route.billingType === 'monthly') {
    return route.billingType;
  }
  const id = String(route.id || '');
  const name = String(route.name || '');
  if (
    id === 'route_gansen' ||
    id === 'route_dj_yi_gj' ||
    id === 'route_coupang' ||
    /간선|용차|대형\s*고정/.test(name)
  ) {
    return 'variable';
  }
  return 'monthly';
}

function calcVat(supplyAmount) {
  const s = Math.max(0, Math.round(Number(supplyAmount) || 0));
  return Math.round(s * 0.1);
}

function formatBillingDayLabel(billingDay) {
  const d = Number(billingDay) || 31;
  return d >= 31 ? '말일' : `매월 ${d}일`;
}

function getDaysInMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

function countPlannedOffDays(driver, yearMonth) {
  const daysInMonth = getDaysInMonth(yearMonth);
  const weekly = Array.isArray(driver?.weeklyOffDays)
    ? driver.weeklyOffDays
    : [];
  const offDatesSet = new Set(
    (Array.isArray(driver?.offDates) ? driver.offDates : []).filter((d) =>
      String(d).startsWith(yearMonth)
    )
  );
  let count = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${yearMonth}-${String(day).padStart(2, '0')}`;
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (offDatesSet.has(dateStr) || weekly.includes(dow)) {
      count += 1;
    }
  }
  return count;
}

function normalizeStop(s) {
  return {
    stopType: s?.stopType === '하차' ? '하차' : '상차',
    time: String(s?.time || '').trim(),
    placeName: String(s?.placeName || '').trim(),
    tempBadge: String(s?.tempBadge || '').trim(),
    palletBadge: String(s?.palletBadge || '').trim(),
    address: String(s?.address || '').trim(),
    addressNote: String(s?.addressNote || '').trim(),
    contactName: String(s?.contactName || '').trim(),
    contactPhone: String(s?.contactPhone || '').trim(),
    tempNotice: String(s?.tempNotice || '').trim(),
  };
}

function makeEmptyTrip(tripNo = 1, defaults = {}) {
  const supply = Math.max(0, Number(defaults.supplyAmount) || 0);
  const vat = calcVat(supply);
  const invoiceType =
    defaults.invoiceType === 'bundled' ||
    defaults.dispatchCategory === 'fixed_gansen'
      ? defaults.invoiceType || 'bundled'
      : 'per_trip';
  const dispatchCategory =
    defaults.dispatchCategory === 'fixed_gansen' ||
    defaults.dispatchCategory === 'spot_charter'
      ? defaults.dispatchCategory
      : invoiceType === 'bundled'
        ? 'fixed_gansen'
        : 'spot_charter';
  return {
    tripNo,
    dispatchCategory,
    clientName: defaults.clientName || '',
    bizNo: defaults.bizNo || '',
    courseName: defaults.courseName || '',
    supplyAmount: supply,
    vatAmount: vat,
    totalAmount: supply + vat,
    invoiceType,
    invoiceStatus: defaults.invoiceStatus || 'pending',
    invoiceIssuedAt: defaults.invoiceIssuedAt || '',
    invoiceMemo: defaults.invoiceMemo || '',
    milkrunNo: defaults.milkrunNo || '',
    dispatchTag: defaults.dispatchTag || '',
    cargoInfo: defaults.cargoInfo || '',
    tempInfo: defaults.tempInfo || '',
    loadTime: defaults.loadTime || '',
    unloadTime: defaults.unloadTime || '',
    stops: Array.isArray(defaults.stops) ? defaults.stops.map(normalizeStop) : [],
  };
}

function normalizeTrip(t, idx) {
  const supply = Math.max(0, Math.round(Number(t?.supplyAmount) || 0));
  const vat = calcVat(supply);
  const invoiceType = t?.invoiceType === 'bundled' ? 'bundled' : 'per_trip';
  const dispatchCategory =
    t?.dispatchCategory === 'fixed_gansen' ||
    t?.dispatchCategory === 'spot_charter'
      ? t.dispatchCategory
      : invoiceType === 'bundled'
        ? 'fixed_gansen'
        : 'spot_charter';
  return {
    tripNo: Number(t?.tripNo) || idx + 1,
    dispatchCategory,
    clientName: String(t?.clientName || '').trim(),
    bizNo: String(t?.bizNo || '').trim(),
    courseName: String(t?.courseName || '').trim(),
    supplyAmount: supply,
    vatAmount: vat,
    totalAmount: supply + vat,
    invoiceType,
    invoiceStatus: t?.invoiceStatus || 'pending',
    invoiceIssuedAt: t?.invoiceIssuedAt || '',
    invoiceMemo: t?.invoiceMemo || '',
    milkrunNo: String(t?.milkrunNo || '').trim(),
    dispatchTag: String(t?.dispatchTag || '').trim(),
    cargoInfo: String(t?.cargoInfo || '').trim(),
    tempInfo: String(t?.tempInfo || '').trim(),
    loadTime: String(t?.loadTime || '').trim(),
    unloadTime: String(t?.unloadTime || '').trim(),
    stops: Array.isArray(t?.stops) ? t.stops.map(normalizeStop) : [],
  };
}

function TripCardEditor({
  trip,
  idx,
  totalTrips,
  onUpdateTrip,
  onDeleteTrip,
  stopsExpanded,
  onToggleStops,
  showBizNo = false,
}) {
  const stops = Array.isArray(trip.stops) ? trip.stops : [];
  const isFixedGansen =
    trip.dispatchCategory === 'fixed_gansen' ||
    (trip.dispatchCategory !== 'spot_charter' && trip.invoiceType === 'bundled');

  const updateField = (patch) => {
    onUpdateTrip({ ...trip, ...patch });
  };

  const updateStopField = (sIdx, patch) => {
    const nextStops = stops.map((st, i) => (i === sIdx ? { ...st, ...patch } : st));
    updateField({ stops: nextStops });
  };

  const handleAddStop = () => {
    updateField({
      stops: [
        ...stops,
        {
          stopType: stops.length === 0 ? '상차' : '하차',
          time: '',
          placeName: '',
          address: '',
          addressNote: '',
          contactName: '',
          contactPhone: '',
          tempBadge: '',
          palletBadge: '',
        },
      ],
    });
    if (!stopsExpanded && onToggleStops) onToggleStops();
  };

  const handleDeleteStop = (sIdx) => {
    updateField({ stops: stops.filter((_, i) => i !== sIdx) });
  };

  return (
    <div
      className={`p-3 rounded-xl border space-y-2.5 text-xs shadow-sm transition ${
        isFixedGansen
          ? 'bg-white border-slate-200'
          : 'bg-amber-50/50 border-amber-300 ring-1 ring-amber-200'
      }`}
    >
      {/* 상단 바: 코스 번호 + 고정간선/외부용차 전환 + 경유지 편집 + 코스 삭제 */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[11px] font-black">
            {idx + 1}코스
          </span>
          {trip.dispatchTag && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">
              {trip.dispatchTag}
            </span>
          )}
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[10px] font-bold">
            <button
              type="button"
              onClick={() =>
                updateField({
                  dispatchCategory: 'fixed_gansen',
                  invoiceType: 'bundled',
                })
              }
              className={`px-2 py-0.5 rounded-md transition ${
                isFixedGansen
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🏢 고정간선 묶음
            </button>
            <button
              type="button"
              onClick={() =>
                updateField({
                  dispatchCategory: 'spot_charter',
                  invoiceType: 'per_trip',
                })
              }
              className={`px-2 py-0.5 rounded-md transition ${
                !isFixedGansen
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🚛 외부용차 1장
            </button>
          </div>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
              isFixedGansen
                ? 'bg-indigo-50 text-indigo-700'
                : 'bg-amber-100 text-amber-900'
            }`}
          >
            {isFixedGansen
              ? '📅 월말 일괄집계 (일별 발행 X)'
              : '🧾 이 코스만 별도 세금계산서 1장 발행'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleStops}
            className={`px-2 py-0.5 rounded-lg border font-bold text-[11px] ${
              stopsExpanded
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {stopsExpanded
              ? '▲ 경유지 닫기'
              : `✎ 경유지 (${stops.length})`}
          </button>
          {totalTrips > 1 && onDeleteTrip && (
            <button
              type="button"
              onClick={onDeleteTrip}
              className="px-2 py-0.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-bold text-[11px]"
            >
              🗑️ 코스 삭제
            </button>
          )}
        </div>
      </div>

      {/* 1행: 운행 코스 · 상차 시간 · 하차 시간 */}
      <div className="grid grid-cols-12 gap-1.5">
        <div className="col-span-12 sm:col-span-6">
          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
            운행 코스 (상·하차 구간)
          </label>
          <input
            placeholder="예: 청주·증평 → 용인"
            value={trip.courseName}
            onChange={(e) => updateField({ courseName: e.target.value })}
            className="w-full px-2.5 py-1.5 border rounded-lg font-bold text-slate-900"
          />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
            상차 시간
          </label>
          <input
            placeholder="예: 09:00"
            value={trip.loadTime}
            onChange={(e) => updateField({ loadTime: e.target.value })}
            className="w-full px-2.5 py-1.5 border rounded-lg font-semibold"
          />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
            하차 시간
          </label>
          <input
            placeholder="예: 11:30"
            value={trip.unloadTime}
            onChange={(e) => updateField({ unloadTime: e.target.value })}
            className="w-full px-2.5 py-1.5 border rounded-lg font-semibold"
          />
        </div>
      </div>

      {/* 2행: 청구 거래처명 · 공급가액 · 계산서 발행방식 */}
      <div className="grid grid-cols-12 gap-1.5 items-end">
        <div className={showBizNo ? 'col-span-12 sm:col-span-4' : 'col-span-12 sm:col-span-5'}>
          <label
            className={`block text-[10px] font-bold mb-0.5 ${
              isFixedGansen ? 'text-slate-500' : 'text-amber-800'
            }`}
          >
            {isFixedGansen
              ? '고정간선 원청 (월말 일괄 합산처)'
              : '⚠️ 외부용차 청구 거래처 (별도 1장 발행처)'}
          </label>
          <input
            list="bh-contractor-datalist"
            placeholder={
              isFixedGansen
                ? '고정간선 원청 거래처명'
                : '용차 청구 업체명 입력 (예: OO물류)'
            }
            value={trip.clientName}
            onChange={(e) => updateField({ clientName: e.target.value })}
            className={`w-full px-2.5 py-1.5 border rounded-lg font-bold ${
              isFixedGansen ? 'bg-white' : 'bg-white border-amber-400'
            }`}
          />
        </div>
        <div className="col-span-6 sm:col-span-4">
          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
            공급가액 (VAT별도 · 원)
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="공급가액"
            value={formatNumberWithCommas(trip.supplyAmount)}
            onChange={(e) => {
              const supply = parseNumberWithoutCommas(e.target.value);
              const vat = calcVat(supply);
              updateField({
                supplyAmount: supply,
                vatAmount: vat,
                totalAmount: supply + vat,
              });
            }}
            className="w-full px-2.5 py-1.5 border rounded-lg text-right font-black text-[#1E5EFF]"
          />
        </div>
        <div className={showBizNo ? 'col-span-6 sm:col-span-2' : 'col-span-6 sm:col-span-3'}>
          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
            계산서 방식
          </label>
          <select
            value={trip.invoiceType}
            onChange={(e) => {
              const val = e.target.value;
              updateField({
                invoiceType: val,
                dispatchCategory:
                  val === 'bundled' ? 'fixed_gansen' : 'spot_charter',
              });
            }}
            className="w-full px-1.5 py-1.5 border rounded-lg font-bold bg-white"
          >
            <option value="bundled">묶음 합산</option>
            <option value="per_trip">건별 1장</option>
          </select>
        </div>
        {showBizNo && (
          <div className="col-span-12 sm:col-span-2">
            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
              사업자번호(선택)
            </label>
            <input
              placeholder="000-00-00000"
              value={trip.bizNo}
              onChange={(e) => updateField({ bizNo: e.target.value })}
              className="w-full px-2 py-1.5 border rounded-lg"
            />
          </div>
        )}
      </div>

      {/* 3행: 경유지 미리보기 or 편집기 */}
      {!stopsExpanded && stops.length > 0 && (
        <div className="bg-slate-50 rounded-lg p-2 space-y-1 text-[11px] text-slate-600">
          {stops.map((st, sIdx) => (
            <div key={sIdx}>
              <b
                className={
                  st.stopType === '상차' ? 'text-blue-700' : 'text-teal-700'
                }
              >
                [{st.stopType} {st.time}]
              </b>{' '}
              <b className="text-slate-800">{st.placeName}</b>
              {st.tempBadge && ` · ${st.tempBadge}`}
              {st.palletBadge && ` · ${st.palletBadge}`}
              {st.address && (
                <div className="text-slate-500 pl-2">
                  📍 {st.address}
                  {st.addressNote ? ` (${st.addressNote})` : ''}
                  {st.contactPhone
                    ? ` · 👤 ${st.contactName} ${st.contactPhone}`
                    : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {stopsExpanded && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black text-slate-700">
              상·하차지 상세 편집 (기사앱 노선표에 그대로 표시됨)
            </span>
            <button
              type="button"
              onClick={handleAddStop}
              className="px-2 py-0.5 rounded-lg bg-blue-50 text-[#1E5EFF] hover:bg-blue-100 text-[11px] font-bold"
            >
              + 경유지 추가
            </button>
          </div>
          {stops.length === 0 ? (
            <div className="text-[11px] text-slate-400 py-2 text-center">
              등록된 경유지가 없습니다. [+ 경유지 추가]를 눌러 상·하차지 주소/연락처를 넣을 수 있습니다.
            </div>
          ) : (
            stops.map((st, sIdx) => (
              <div
                key={sIdx}
                className="p-2 rounded-lg bg-white border border-slate-200 space-y-1.5 text-[11px]"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={st.stopType}
                    onChange={(e) =>
                      updateStopField(sIdx, { stopType: e.target.value })
                    }
                    className="px-1.5 py-1 border rounded font-bold bg-white"
                  >
                    <option value="상차">상차</option>
                    <option value="하차">하차</option>
                  </select>
                  <input
                    placeholder="시간(09:00)"
                    value={st.time}
                    onChange={(e) =>
                      updateStopField(sIdx, { time: e.target.value })
                    }
                    className="w-20 px-2 py-1 border rounded font-semibold"
                  />
                  <input
                    placeholder="업체/센터명 (예: 용인3센터)"
                    value={st.placeName}
                    onChange={(e) =>
                      updateStopField(sIdx, { placeName: e.target.value })
                    }
                    className="flex-1 min-w-[120px] px-2 py-1 border rounded font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => handleDeleteStop(sIdx)}
                    className="px-2 py-1 rounded bg-red-50 text-red-600 font-bold"
                  >
                    삭제
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <input
                    placeholder="주소 (기사님이 원터치 복사하는 주소)"
                    value={st.address}
                    onChange={(e) =>
                      updateStopField(sIdx, { address: e.target.value })
                    }
                    className="px-2 py-1 border rounded"
                  />
                  <input
                    placeholder="진입/층 안내 (예: 지하 1층)"
                    value={st.addressNote}
                    onChange={(e) =>
                      updateStopField(sIdx, { addressNote: e.target.value })
                    }
                    className="px-2 py-1 border rounded"
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <input
                    placeholder="담당자명"
                    value={st.contactName}
                    onChange={(e) =>
                      updateStopField(sIdx, { contactName: e.target.value })
                    }
                    className="px-2 py-1 border rounded"
                  />
                  <input
                    placeholder="담당자 연락처"
                    value={st.contactPhone}
                    onChange={(e) =>
                      updateStopField(sIdx, { contactPhone: e.target.value })
                    }
                    className="px-2 py-1 border rounded"
                  />
                  <input
                    placeholder="온도 (예: 냉장 1도)"
                    value={st.tempBadge}
                    onChange={(e) =>
                      updateStopField(sIdx, { tempBadge: e.target.value })
                    }
                    className="px-2 py-1 border rounded"
                  />
                  <input
                    placeholder="파렛트 (예: 5파렛)"
                    value={st.palletBadge}
                    onChange={(e) =>
                      updateStopField(sIdx, { palletBadge: e.target.value })
                    }
                    className="px-2 py-1 border rounded"
                  />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * [관리자 7 & 경리 전용] 매출 집계 · 간선 다회차 배차 · 세금계산서 대기함 · 급여 정산
 * ========================================================================== */
export default function SettlementsView({
  adminUid,
  userRole = 'admin',
  userName = '관리자',
  onNavigateRoutes,
  onSelectDriverLogs,
}) {
  const isAccountingOnly = userRole === 'accounting';
  const defaultYm = kstOffsetDateStr(0).slice(0, 7);

  const [yearMonth, setYearMonth] = useState(defaultYm);
  const [activeSubTab, setActiveSubTab] = useState('invoices'); // invoices | variable | payroll_summary

  const [logs, setLogs] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [users, setUsers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [dieselPrice, setDieselPrice] = useState(1550);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // 세금계산서 필터: pending | issued | all
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('all');

  // 간선 다회차 배차 / 코스·운임 등록 모달
  const [dispatchModal, setDispatchModal] = useState(false);
  const [dispWorkDate, setDispWorkDate] = useState(todayKstStr());
  const [dispDriverId, setDispDriverId] = useState('');
  const [dispTrips, setDispTrips] = useState([makeEmptyTrip(1)]);
  const [savingDispatch, setSavingDispatch] = useState(false);

  // 카톡·엑셀 자동 붙여넣기 배차 등록 모달
  const [pasteModal, setPasteModal] = useState(false);
  const [pasteDefaultDate, setPasteDefaultDate] = useState(todayKstStr());
  const [pasteRawText, setPasteRawText] = useState('');
  const [pasteGroups, setPasteGroups] = useState([]);
  const [pasteUnmatchedMilkruns, setPasteUnmatchedMilkruns] = useState([]);
  const [pasteMergeMode, setPasteMergeMode] = useState(true);
  const [savingPaste, setSavingPaste] = useState(false);
  const [pasteCategory, setPasteCategory] = useState('fixed_gansen');
  const [pasteContractor, setPasteContractor] = useState('고정 간선 원청');
  const [pasteImages, setPasteImages] = useState([]);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiStatusMsg, setAiStatusMsg] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [showAiKeyBox, setShowAiKeyBox] = useState(false);
  const [savingAiKey, setSavingAiKey] = useState(false);
  const [expandedStopKeys, setExpandedStopKeys] = useState({});
  const [expandedBundledClients, setExpandedBundledClients] = useState({});

  // 기사별 급여 정산 입력 편집 상태
  const [payrollEdits, setPayrollEdits] = useState({});
  const [savingPayrollKey, setSavingPayrollKey] = useState('');

  // 경리 전용 계정 생성 폼 상태 (admin만 표시)
  const [accCode, setAccCode] = useState('bh-acc');
  const [accPassword, setAccPassword] = useState('');
  const [accName, setAccName] = useState('');
  const [accPhone, setAccPhone] = useState('');
  const [creatingAcc, setCreatingAcc] = useState(false);
  const [accMsg, setAccMsg] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [lSnap, rSnap, uSnap, vSnap, mSnap, sSnap, cfgSnap, aiCfgSnap] =
        await Promise.all([
          getDocs(
            query(collection(db, 'DailyLogs'), where('yearMonth', '==', yearMonth))
          ),
          getDocs(collection(db, 'Routes')),
          getDocs(collection(db, 'Users')),
          getDocs(collection(db, 'Vehicles')),
          getDocs(collection(db, 'Maintenance')),
          getDocs(
            query(
              collection(db, 'Settlements'),
              where('yearMonth', '==', yearMonth)
            )
          ),
          getDoc(doc(db, 'Settings', 'fuel')),
          getDoc(doc(db, 'Settings', 'aiConfig')).catch(() => null),
        ]);

      const routeList = rSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));

      const sList = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      setLogs(lSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setRoutes(routeList);
      setUsers(uSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setVehicles(vSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setMaintenance(mSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setSettlements(sList);

      if (cfgSnap.exists() && cfgSnap.data()?.dieselPricePerL) {
        setDieselPrice(Number(cfgSnap.data().dieselPricePerL) || 1550);
      }
      if (aiCfgSnap?.exists?.() && aiCfgSnap.data()?.geminiApiKey) {
        setAiApiKey(String(aiCfgSnap.data().geminiApiKey).trim());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [yearMonth]);

  // 파생 마스터 맵
  const routeMap = useMemo(() => {
    const m = {};
    routes.forEach((r) => {
      m[r.id] = r;
    });
    return m;
  }, [routes]);

  const userMap = useMemo(() => {
    const m = {};
    users.forEach((u) => {
      m[u.id] = u;
    });
    return m;
  }, [users]);

  const vehicleMap = useMemo(() => {
    const m = {};
    vehicles.forEach((v) => {
      m[v.id] = v;
    });
    return m;
  }, [vehicles]);

  const activeDrivers = useMemo(() => {
    return users
      .filter(
        (u) =>
          (u.role === 'driver' || u.driverCode === 'bh-ceo' || u.name === '김병훈') &&
          u.isActive !== false
      )
      .sort((a, b) => {
        const aRouteVar = getRouteBillingType(routeMap[a.defaultRouteId]) === 'variable';
        const bRouteVar = getRouteBillingType(routeMap[b.defaultRouteId]) === 'variable';
        if (aRouteVar !== bRouteVar) return aRouteVar ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '', 'ko');
      });
  }, [users, routeMap]);

  const accountingUsers = useMemo(
    () =>
      users
        .filter((u) => u.role === 'accounting')
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')),
    [users]
  );

  // Settlements 컬렉션 3종 분리
  const { dispatchMap, monthlyInvoiceMap, driverSettlementMap, isClosed } =
    useMemo(() => {
      const disp = {};
      const monInv = {};
      const drvSettle = {};
      let closedFlag = false;

      settlements.forEach((s) => {
        if (s.docType === 'dispatch' || String(s.id).startsWith('dispatch_')) {
          const key = `${s.workDate}_${s.driverId}`;
          disp[key] = s;
        } else if (
          s.docType === 'monthly_invoice' ||
          String(s.id).startsWith('invoice_monthly_')
        ) {
          if (s.routeId) monInv[s.routeId] = s;
        } else {
          if (s.driverId) drvSettle[s.driverId] = s;
          if (s.status === 'closed') closedFlag = true;
        }
      });

      return {
        dispatchMap: disp,
        monthlyInvoiceMap: monInv,
        driverSettlementMap: drvSettle,
        isClosed: closedFlag,
      };
    }, [settlements]);

  // DailyLogs + 선배차 원장 통합 (변동형/월정액 분리)
  const {
    variableRecords,
    perTripInvoices,
    bundledClientGroups,
    monthlyRouteSummaries,
    variableSummary,
    monthlyTotalRevenue,
    driverPayrollBaseRows,
  } = useMemo(() => {
    const logMap = {};
    logs.forEach((l) => {
      logMap[`${l.workDate}_${l.driverId}`] = l;
    });

    const allKeys = Array.from(
      new Set([...Object.keys(logMap), ...Object.keys(dispatchMap)])
    ).sort((a, b) => b.localeCompare(a));

    const varRecs = [];
    const perTrips = [];
    const bundledByClient = {};
    const monthlyLogCountByRoute = {};
    const payrollAcc = {};

    const ensurePayrollDriver = (driverId, fallbackName = '') => {
      if (!payrollAcc[driverId]) {
        const drv = userMap[driverId];
        payrollAcc[driverId] = {
          driverId,
          driverName: drv?.name || fallbackName || '미상',
          driverCode: drv?.driverCode || '',
          routeName:
            routeMap[drv?.defaultRouteId]?.name ||
            drv?.dept ||
            '노선 미지정',
          workDays: 0,
          totalKm: 0,
          fuelCost: 0,
          variableRevenue: 0,
          plannedOffDays: drv ? countPlannedOffDays(drv, yearMonth) : 0,
        };
      }
      return payrollAcc[driverId];
    };

    // 활성 기사는 출근 0건이어도 급여 정산 표에 표시
    activeDrivers.forEach((d) => {
      ensurePayrollDriver(d.id, d.name);
    });

    allKeys.forEach((recordKey) => {
      const log = logMap[recordKey] || null;
      const disp = dispatchMap[recordKey] || null;
      if (log && log.status === 'void' && !disp) return;

      const workDate = log?.workDate || disp?.workDate || recordKey.split('_')[0];
      const driverId =
        log?.driverId || disp?.driverId || recordKey.slice(workDate.length + 1);
      const drv = userMap[driverId];
      const veh = drv?.assignedVehicleId
        ? vehicleMap[drv.assignedVehicleId]
        : null;
      const driverName =
        log?.driverName || disp?.driverName || drv?.name || '미상';
      const plateNo = log?.plateNo || disp?.plateNo || veh?.plateNo || '-';

      const routeId = log?.routeId || disp?.routeId || drv?.defaultRouteId || '';
      const route = routeMap[routeId];
      const routeName = log?.routeName || route?.name || '기타';
      const billingType = disp ? 'variable' : getRouteBillingType(route);

      const pRow = ensurePayrollDriver(driverId, driverName);
      if (log && (log.status === 'in_progress' || log.status === 'completed')) {
        pRow.workDays += 1;
        pRow.totalKm += Number(log.drivenKm) || 0;
        pRow.fuelCost += Number(log.estimatedFuelCost) || 0;
      }

      if (routeId && billingType === 'monthly' && log && log.status !== 'void') {
        monthlyLogCountByRoute[routeId] =
          (monthlyLogCountByRoute[routeId] || 0) + 1;
      }

      // trips 추출: dispatch 원장 우선, 없으면 DailyLog.trips, 없으면 routePrice 합성
      let trips = [];
      if (Array.isArray(disp?.trips) && disp.trips.length > 0) {
        trips = disp.trips.map(normalizeTrip);
      } else if (Array.isArray(log?.trips) && log.trips.length > 0) {
        trips = log.trips.map(normalizeTrip);
      } else if (billingType === 'variable') {
        const legacyPrice = Number(log?.routePrice) || Number(route?.price) || 0;
        if (legacyPrice > 0) {
          trips = [
            makeEmptyTrip(1, {
              clientName: route?.clientName || routeName || '간선 거래처',
              bizNo: route?.bizNo || '',
              courseName: routeName || '간선 기본 코스',
              supplyAmount: legacyPrice,
              invoiceType:
                route?.invoiceMode === 'bundled' ? 'bundled' : 'per_trip',
            }),
          ];
        }
      }

      const isVariable =
        billingType === 'variable' || Boolean(disp) || trips.length > 0;
      const daySupplyTotal = trips.reduce((s, t) => s + t.supplyAmount, 0);

      if (isVariable) {
        pRow.variableRevenue += daySupplyTotal;
        const rec = {
          recordKey,
          workDate,
          driverId,
          driverName,
          plateNo,
          routeId,
          routeName,
          log,
          disp,
          trips,
          totalSupply: daySupplyTotal,
          totalVat: trips.reduce((s, t) => s + t.vatAmount, 0),
          totalAmount: trips.reduce((s, t) => s + t.totalAmount, 0),
          drivenKm: Number(log?.drivenKm) || 0,
          fuelCost: Number(log?.estimatedFuelCost) || 0,
          statusLabel: log
            ? log.status === 'completed'
              ? '운행완료'
              : '운행중'
            : '선배차(미출근)',
        };
        varRecs.push(rec);

        trips.forEach((t, idx) => {
          if (t.supplyAmount <= 0) return;
          if (t.invoiceType === 'per_trip') {
            perTrips.push({
              recordKey,
              workDate,
              driverId,
              driverName,
              plateNo,
              tripIdx: idx,
              trip: t,
              allTrips: trips,
              log,
              disp,
            });
          } else {
            const clientKey = t.clientName || '고정 간선 거래처(미지정)';
            if (!bundledByClient[clientKey]) {
              bundledByClient[clientKey] = {
                clientName: clientKey,
                bizNo: t.bizNo || '',
                items: [],
                supplyAmount: 0,
                vatAmount: 0,
                totalAmount: 0,
                issuedCount: 0,
                excludedCount: 0,
                pendingCount: 0,
                minDate: workDate,
                maxDate: workDate,
                latestIssuedAt: '',
              };
            }
            const grp = bundledByClient[clientKey];
            if (!grp.bizNo && t.bizNo) grp.bizNo = t.bizNo;
            grp.items.push({
              recordKey,
              workDate,
              driverId,
              driverName,
              plateNo,
              tripIdx: idx,
              trip: t,
              allTrips: trips,
              log,
              disp,
            });
            if (t.invoiceStatus !== 'excluded') {
              grp.supplyAmount += t.supplyAmount;
              grp.vatAmount += t.vatAmount;
              grp.totalAmount += t.totalAmount;
            }
            if (t.invoiceStatus === 'issued') grp.issuedCount += 1;
            else if (t.invoiceStatus === 'excluded') grp.excludedCount += 1;
            else grp.pendingCount += 1;
            if (workDate < grp.minDate) grp.minDate = workDate;
            if (workDate > grp.maxDate) grp.maxDate = workDate;
            if (t.invoiceIssuedAt > grp.latestIssuedAt) {
              grp.latestIssuedAt = t.invoiceIssuedAt;
            }
          }
        });
      }
    });

    // 간선 전용 집계 (일별 · 기사별)
    const varByDriver = {};
    const varByDate = {};
    let varTotalSupply = 0;
    let varTripCount = 0;
    let varTotalKm = 0;

    varRecs.forEach((rec) => {
      varTotalSupply += rec.totalSupply;
      varTripCount += rec.trips.length;
      varTotalKm += rec.drivenKm;

      if (!varByDriver[rec.driverId]) {
        varByDriver[rec.driverId] = {
          driverId: rec.driverId,
          driverName: rec.driverName,
          days: 0,
          tripsCount: 0,
          supplyAmount: 0,
          km: 0,
        };
      }
      varByDriver[rec.driverId].days += 1;
      varByDriver[rec.driverId].tripsCount += rec.trips.length;
      varByDriver[rec.driverId].supplyAmount += rec.totalSupply;
      varByDriver[rec.driverId].km += rec.drivenKm;

      varByDate[rec.workDate] =
        (varByDate[rec.workDate] || 0) + rec.totalSupply;
    });

    const todayKst = todayKstStr();
    const todayYm = todayKst.slice(0, 7);
    const todayDayNum = Number(todayKst.slice(8, 10));
    const daysInTargetMonth = getDaysInMonth(yearMonth);

    // 월정액 거래처 요약
    const monthlyRoutesList = routes
      .filter((r) => getRouteBillingType(r) === 'monthly')
      .map((r) => {
        const contract = Number(r.monthlyContractAmount) || 0;
        const vat = calcVat(contract);
        const total = contract + vat;
        const billingDay = Number(r.billingDay) || 31;
        const effectiveDay = Math.min(billingDay, daysInTargetMonth);
        const invDoc = monthlyInvoiceMap[r.id];
        const status = invDoc?.invoiceStatus || 'pending';
        const isDueSoon =
          yearMonth < todayYm ||
          (yearMonth === todayYm && todayDayNum >= Math.max(1, effectiveDay - 3));
        return {
          route: r,
          clientName: r.clientName || r.name,
          bizNo: r.bizNo || '',
          billingDay,
          runCount: monthlyLogCountByRoute[r.id] || 0,
          supplyAmount: contract,
          vatAmount: vat,
          totalAmount: total,
          invoiceStatus: status,
          invoiceIssuedAt: invDoc?.invoiceIssuedAt || '',
          isDueSoon: isDueSoon && status === 'pending',
        };
      });

    const monthlyRevTotal = monthlyRoutesList.reduce(
      (s, m) => s + m.supplyAmount,
      0
    );

    const payrollRows = Object.values(payrollAcc).sort((a, b) => {
      if (a.workDays !== b.workDays) return b.workDays - a.workDays;
      return (a.driverName || '').localeCompare(b.driverName || '', 'ko');
    });

    return {
      variableRecords: varRecs,
      perTripInvoices: perTrips,
      bundledClientGroups: Object.values(bundledByClient),
      monthlyRouteSummaries: monthlyRoutesList,
      variableSummary: {
        totalSupply: varTotalSupply,
        recordCount: varRecs.length,
        tripCount: varTripCount,
        totalKm: varTotalKm,
        driverChart: Object.values(varByDriver).sort(
          (a, b) => b.supplyAmount - a.supplyAmount
        ),
        dateChart: Object.entries(varByDate)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, amount]) => ({ date: date.slice(5), 매출: amount })),
      },
      monthlyTotalRevenue: monthlyRevTotal,
      driverPayrollBaseRows: payrollRows,
    };
  }, [
    logs,
    dispatchMap,
    routes,
    userMap,
    vehicleMap,
    activeDrivers,
    yearMonth,
    monthlyInvoiceMap,
  ]);

  // 급여 편집 상태 동기화
  useEffect(() => {
    const next = {};
    driverPayrollBaseRows.forEach((r) => {
      const saved = driverSettlementMap[r.driverId];
      next[r.driverId] = {
        baseSalary: Number(saved?.baseSalary) || 0,
        extraTripsCount: Number(saved?.extraTripsCount) || 0,
        extraTripPay: Number(saved?.extraTripPay) || 0,
        offDaysCount:
          saved?.offDaysCount !== undefined
            ? Number(saved.offDaysCount)
            : r.plannedOffDays,
        offDayDeduction: Number(saved?.offDayDeduction) || 0,
        memo: saved?.memo || '',
      };
    });
    setPayrollEdits(next);
  }, [driverPayrollBaseRows, driverSettlementMap]);

  // =========================================================================
  // Firestore 저장 액션들
  // =========================================================================

  // 간선 코스 목록 저장 (Settlements/dispatch_* 및 존재 시 DailyLogs/* 동기화)
  const saveRecordTrips = async ({
    workDate,
    driverId,
    driverName,
    plateNo,
    routeId,
    routeName,
    trips,
    dailyLogExists,
  }) => {
    const cleanTrips = trips.map((t, i) => normalizeTrip(t, i));
    const totalSupply = cleanTrips.reduce((s, t) => s + t.supplyAmount, 0);
    const targetYm = workDate.slice(0, 7);

    const batch = writeBatch(db);
    const dispId = `dispatch_${workDate}_${driverId}`;
    batch.set(
      doc(db, 'Settlements', dispId),
      {
        docType: 'dispatch',
        yearMonth: targetYm,
        workDate,
        driverId,
        driverName: driverName || '',
        plateNo: plateNo || '',
        routeId: routeId || '',
        routeName: routeName || '간선 운송',
        trips: cleanTrips,
        totalSupplyAmount: totalSupply,
        updatedBy: adminUid,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (dailyLogExists) {
      batch.set(
        doc(db, 'DailyLogs', `${workDate}_${driverId}`),
        {
          trips: cleanTrips,
          routePrice: totalSupply,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
  };

  // 세금계산서 건별 상태 변경
  const handleTogglePerTripInvoice = async (row, nextStatus) => {
    const nowStr = new Date(Date.now() + 9 * 3600 * 1000)
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');
    const updatedTrips = row.allTrips.map((t, idx) =>
      idx === row.tripIdx
        ? {
            ...t,
            invoiceStatus: nextStatus,
            invoiceIssuedAt: nextStatus === 'issued' ? nowStr : '',
          }
        : t
    );
    await saveRecordTrips({
      workDate: row.workDate,
      driverId: row.driverId,
      driverName: row.driverName,
      plateNo: row.plateNo,
      routeId: row.log?.routeId || row.disp?.routeId || 'route_gansen',
      routeName: row.log?.routeName || row.disp?.routeName || '간선 운송',
      trips: updatedTrips,
      dailyLogExists: Boolean(row.log),
    });
    await loadAll();
  };

  // 고정 간선 묶음 일괄 발행 상태 변경
  const handleToggleBundledGroupInvoice = async (group, nextStatus) => {
    const nowStr = new Date(Date.now() + 9 * 3600 * 1000)
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');

    // 같은 (workDate, driverId)에 여러 묶음 코스가 있을 수 있어 레코드별로 합쳐 저장
    const byRecordKey = {};
    group.items.forEach((it) => {
      if (!byRecordKey[it.recordKey]) {
        byRecordKey[it.recordKey] = {
          base: it,
          indices: new Set(),
        };
      }
      byRecordKey[it.recordKey].indices.add(it.tripIdx);
    });

    for (const recGroup of Object.values(byRecordKey)) {
      const { base, indices } = recGroup;
      const updatedTrips = base.allTrips.map((t, idx) =>
        indices.has(idx) && t.invoiceStatus !== 'excluded'
          ? {
              ...t,
              invoiceStatus: nextStatus,
              invoiceIssuedAt: nextStatus === 'issued' ? nowStr : '',
            }
          : t
      );
      await saveRecordTrips({
        workDate: base.workDate,
        driverId: base.driverId,
        driverName: base.driverName,
        plateNo: base.plateNo,
        routeId: base.log?.routeId || base.disp?.routeId || 'route_gansen',
        routeName: base.log?.routeName || base.disp?.routeName || '간선 운송',
        trips: updatedTrips,
        dailyLogExists: Boolean(base.log),
      });
    }
    await loadAll();
  };

  // 월정액 거래처 세금계산서 상태 변경
  const handleToggleMonthlyInvoice = async (mItem, nextStatus) => {
    const nowStr = new Date(Date.now() + 9 * 3600 * 1000)
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');
    const docId = `invoice_monthly_${yearMonth}_${mItem.route.id}`;
    await setDoc(
      doc(db, 'Settlements', docId),
      {
        docType: 'monthly_invoice',
        yearMonth,
        routeId: mItem.route.id,
        clientName: mItem.clientName,
        bizNo: mItem.bizNo,
        billingDay: mItem.billingDay,
        supplyAmount: mItem.supplyAmount,
        vatAmount: mItem.vatAmount,
        totalAmount: mItem.totalAmount,
        invoiceStatus: nextStatus,
        invoiceIssuedAt: nextStatus === 'issued' ? nowStr : '',
        issuedBy: nextStatus === 'issued' ? userName : '',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await loadAll();
  };

  const contractorSuggestions = useMemo(() => {
    const names = new Set(['고정 간선 원청']);
    routes.forEach((r) => {
      if (r?.clientName && String(r.clientName).trim()) {
        names.add(String(r.clientName).trim());
      }
    });
    return Array.from(names);
  }, [routes]);

  const toggleStopEditor = (key) => {
    setExpandedStopKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 이날 배차(코스·경유지) 전체 삭제
  const handleDeleteRecordDispatch = async ({
    workDate,
    driverId,
    driverName,
  }) => {
    if (!workDate || !driverId) return;
    const ok = window.confirm(
      `[${workDate}] ${driverName || '기사'}님의 이날 배차(전체 코스·경유지)를 삭제할까요?\n\n※ 테스트 배차를 정리하거나 잘못 올린 배차를 지울 때 사용합니다.`
    );
    if (!ok) return;
    setSavingDispatch(true);
    try {
      const recordKey = `${workDate}_${driverId}`;
      const dispRef = doc(db, 'Settlements', `dispatch_${recordKey}`);
      const logRef = doc(db, 'DailyLogs', recordKey);
      const logSnap = await getDoc(logRef);
      if (logSnap.exists()) {
        const batch = writeBatch(db);
        batch.delete(dispRef);
        batch.set(
          logRef,
          { trips: [], routePrice: 0, updatedAt: serverTimestamp() },
          { merge: true }
        );
        await batch.commit();
      } else {
        await deleteDoc(dispRef);
      }
      setDispatchModal(false);
      await loadAll();
      alert(`[${workDate}] ${driverName || ''}님 배차가 삭제되었습니다.`);
    } catch (err) {
      alert('배차 삭제 중 오류가 발생했습니다: ' + (err?.message || err));
    } finally {
      setSavingDispatch(false);
    }
  };

  // 배차 등록/수정 모달 열기
  const openDispatchModal = ({ workDate, driverId, trips } = {}) => {
    const dateVal = workDate || todayKstStr();
    const drvId = driverId || activeDrivers[0]?.id || '';
    const existingRec = variableRecords.find(
      (r) => r.workDate === dateVal && r.driverId === drvId
    );
    setDispWorkDate(dateVal);
    setDispDriverId(drvId);
    setExpandedStopKeys({});
    if (Array.isArray(trips) && trips.length > 0) {
      setDispTrips(trips.map(normalizeTrip));
    } else if (existingRec && existingRec.trips.length > 0) {
      setDispTrips(existingRec.trips.map(normalizeTrip));
    } else {
      setDispTrips([makeEmptyTrip(1)]);
    }
    setDispatchModal(true);
  };

  const handleSaveDispatchModal = async (e) => {
    e.preventDefault();
    if (!dispWorkDate || !dispDriverId) {
      alert('운행일자와 기사를 선택해 주세요.');
      return;
    }
    const validTrips = dispTrips.filter(
      (t) => t.clientName.trim() || t.courseName.trim() || t.supplyAmount > 0
    );
    if (validTrips.length === 0) {
      alert('최소 1개 코스의 거래처, 코스명 또는 금액을 입력해 주세요.');
      return;
    }
    setSavingDispatch(true);
    try {
      const drv = userMap[dispDriverId];
      const veh = drv?.assignedVehicleId
        ? vehicleMap[drv.assignedVehicleId]
        : null;
      const recordKey = `${dispWorkDate}_${dispDriverId}`;
      let dailyLogExists = logs.some((l) => l.id === recordKey);
      if (!dailyLogExists && dispWorkDate.slice(0, 7) !== yearMonth) {
        const remoteSnap = await getDoc(doc(db, 'DailyLogs', recordKey));
        dailyLogExists = remoteSnap.exists();
      }

      await saveRecordTrips({
        workDate: dispWorkDate,
        driverId: dispDriverId,
        driverName: drv?.name || '',
        plateNo: veh?.plateNo || '',
        routeId: drv?.defaultRouteId || 'route_gansen',
        routeName: routeMap[drv?.defaultRouteId]?.name || '간선 운송',
        trips: validTrips,
        dailyLogExists,
      });

      setDispatchModal(false);
      // 다른 월로 등록한 경우 그 월로 자동 전환하지 않고 알림
      if (dispWorkDate.slice(0, 7) !== yearMonth) {
        setYearMonth(dispWorkDate.slice(0, 7));
      } else {
        await loadAll();
      }
      alert(
        `✅ [${dispWorkDate}] ${drv?.name || ''} 기사님 ${validTrips.length}코스 배차·운임이 저장되었습니다.`
      );
    } catch (err) {
      alert(`저장 오류: ${err.message}`);
    } finally {
      setSavingDispatch(false);
    }
  };

  // 카톡 · 엑셀 붙여넣기 실시간 파싱 (사진이 첨부되지 않았을 때만 자동 텍스트 파싱)
  useEffect(() => {
    if (!pasteModal || pasteImages.length > 0) return;
    if (!pasteRawText.trim()) {
      setPasteGroups([]);
      setPasteUnmatchedMilkruns([]);
      return;
    }
    const res = parseKakaoAndExcelDispatch({
      rawText: pasteRawText,
      defaultWorkDate: pasteDefaultDate || todayKstStr(),
      drivers: activeDrivers,
      vehicles,
      defaultClientName: pasteContractor,
      defaultDispatchCategory: pasteCategory,
    });
    setPasteGroups(res.groups);
    setPasteUnmatchedMilkruns(res.unmatchedMilkruns);
  }, [
    pasteRawText,
    pasteDefaultDate,
    pasteModal,
    pasteImages.length,
    pasteContractor,
    pasteCategory,
    activeDrivers,
    vehicles,
  ]);

  const openPasteModal = () => {
    setPasteDefaultDate(todayKstStr());
    setPasteRawText('');
    setPasteGroups([]);
    setPasteUnmatchedMilkruns([]);
    setPasteImages([]);
    setAiStatusMsg('');
    setShowAiKeyBox(false);
    setExpandedStopKeys({});
    setPasteModal(true);
  };

  const handlePasteCategoryChange = (nextCategory) => {
    setPasteCategory(nextCategory);
    setPasteGroups((prev) =>
      applyClientAndCategoryToGroups(prev, {
        clientName: pasteContractor,
        dispatchCategory: nextCategory,
      })
    );
  };

  const handlePasteContractorChange = (nextContractor) => {
    setPasteContractor(nextContractor);
    setPasteGroups((prev) =>
      applyClientAndCategoryToGroups(prev, {
        clientName: nextContractor,
        dispatchCategory: pasteCategory,
      })
    );
  };

  const handleAddPasteImageFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(
      (f) => f && f.type && f.type.startsWith('image/')
    );
    if (files.length === 0) return;
    try {
      const converted = await Promise.all(files.map((f) => fileToImagePart(f)));
      setPasteImages((prev) => [...prev, ...converted].slice(0, 6));
      setAiStatusMsg(
        `사진 ${converted.length}장 첨부됨 · [🤖 AI로 사진 + 텍스트 비교 분석하기]를 누르세요.`
      );
    } catch (err) {
      setAiStatusMsg('⚠️ 이미지 읽기 실패: ' + (err?.message || err));
    }
  };

  const handleRemovePasteImage = (idx) => {
    setPasteImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleClipboardPaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgFiles = items
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (imgFiles.length > 0) {
      e.preventDefault();
      handleAddPasteImageFiles(imgFiles);
    }
  };

  const handleRunAiAnalysis = async () => {
    if (aiAnalyzing) return;
    if (pasteImages.length === 0 && !pasteRawText.trim()) {
      alert('사진을 올리거나 카톡·엑셀 글을 먼저 붙여넣어 주세요.');
      return;
    }
    setAiAnalyzing(true);
    setAiStatusMsg(
      '🤖 AI가 첨부된 사진과 배차 글을 대조 분석해 기사별 1·2·3코스를 정리하고 있습니다...'
    );
    try {
      const res = await analyzeDispatchWithAI({
        images: pasteImages,
        rawText: pasteRawText,
        defaultWorkDate: pasteDefaultDate || todayKstStr(),
        defaultClientName: pasteContractor,
        defaultDispatchCategory: pasteCategory,
        drivers: activeDrivers,
        vehicles,
        customApiKey: aiApiKey,
      });
      setPasteGroups(res.groups);
      setPasteUnmatchedMilkruns([]);
      setExpandedStopKeys({});
      setAiStatusMsg(
        `✅ AI 비교 분석 완료: ${res.groups.length}명 · 총 ${res.rawTripsCount}코스 정리됨 (오른쪽 미리보기에서 확인·수정 후 저장하세요)`
      );
    } catch (err) {
      const msg = err?.message || 'AI 분석 중 오류가 발생했습니다.';
      setAiStatusMsg(`⚠️ ${msg}`);
      if (
        /API 키|AI Logic|시작하기|초기화|크레딧|App Check|무료/.test(msg)
      ) {
        setShowAiKeyBox(true);
      }
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleSaveAiApiKey = async () => {
    if (savingAiKey) return;
    setSavingAiKey(true);
    try {
      const trimmed = aiApiKey.trim();
      await setDoc(
        doc(db, 'Settings', 'aiConfig'),
        {
          geminiApiKey: trimmed,
          updatedBy: adminUid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setAiApiKey(trimmed);
      setAiStatusMsg(
        trimmed
          ? '✅ AI API 키가 안전하게 저장되었습니다. 이제 AI 분석 버튼을 눌러 보세요.'
          : 'AI API 키가 비워졌습니다. (Firebase AI 기본 연결 사용)'
      );
      setShowAiKeyBox(false);
    } catch (err) {
      alert('AI 키 저장 오류: ' + (err?.message || err));
    } finally {
      setSavingAiKey(false);
    }
  };

  const handleAssignUnmatchedMilkrun = (detail, driverId) => {
    if (!driverId) return;
    const drv = userMap[driverId];
    if (!drv) return;
    const veh = drv.assignedVehicleId
      ? vehicleMap[drv.assignedVehicleId]
      : null;
    const newTrip = buildTripFromUnmatchedMilkrun(detail, {
      clientName: pasteContractor,
      dispatchCategory: pasteCategory,
    });
    const workDate = pasteDefaultDate || todayKstStr();
    const key = `${workDate}__${drv.id}`;

    setPasteGroups((prev) => {
      const idx = prev.findIndex((g) => g.key === key);
      if (idx >= 0) {
        return prev.map((g, gi) => {
          if (gi !== idx) return g;
          const merged = [...g.trips, newTrip]
            .sort((a, b) => (a.loadTime || '99:99').localeCompare(b.loadTime || '99:99'))
            .map((t, ti) => ({ ...t, tripNo: ti + 1 }));
          return { ...g, trips: merged };
        });
      }
      return [
        ...prev,
        {
          key,
          workDate,
          driverId: drv.id,
          isDriverMatched: true,
          driverName: drv.name || '',
          plateNo: veh?.plateNo || '-',
          defaultRouteId: drv.defaultRouteId || 'route_gansen',
          trips: [{ ...newTrip, tripNo: 1 }],
        },
      ];
    });
    setPasteUnmatchedMilkruns((prev) =>
      prev.filter((d) => d.milkrunNo !== detail.milkrunNo)
    );
  };

  const handleSavePasteGroups = async () => {
    if (savingPaste) return;
    const unmatchedDriverGroup = pasteGroups.find(
      (g) => !g.driverId || String(g.driverId).startsWith('unmatched_')
    );
    if (unmatchedDriverGroup) {
      alert(
        `[${unmatchedDriverGroup.driverName}] 기사가 목록에서 선택되지 않았습니다. 기사 드롭다운에서 매칭해 주세요.`
      );
      return;
    }
    if (pasteGroups.length === 0) {
      alert('저장할 배차 내역이 없습니다.');
      return;
    }

    setSavingPaste(true);
    try {
      let totalCoursesSaved = 0;
      for (const grp of pasteGroups) {
        const recordKey = `${grp.workDate}_${grp.driverId}`;
        const drv = userMap[grp.driverId];
        const veh = drv?.assignedVehicleId
          ? vehicleMap[drv.assignedVehicleId]
          : null;

        let finalTrips = grp.trips;
        if (pasteMergeMode) {
          const existingDispSnap = await getDoc(
            doc(db, 'Settlements', `dispatch_${recordKey}`)
          );
          if (existingDispSnap.exists()) {
            const oldTrips = (existingDispSnap.data()?.trips || []).map(
              normalizeTrip
            );
            const mapBySig = new Map();
            const sigOf = (t) =>
              t.milkrunNo
                ? `milk_${t.milkrunNo}`
                : t.dispatchTag
                  ? `tag_${t.dispatchTag}`
                  : `${t.courseName}__${t.loadTime}`;
            oldTrips.forEach((t) => mapBySig.set(sigOf(t), t));
            grp.trips.forEach((t) => {
              const s = sigOf(t);
              const prevT = mapBySig.get(s);
              mapBySig.set(
                s,
                prevT && prevT.invoiceStatus === 'issued'
                  ? { ...t, invoiceStatus: 'issued', invoiceIssuedAt: prevT.invoiceIssuedAt || '' }
                  : t
              );
            });
            finalTrips = Array.from(mapBySig.values())
              .sort((a, b) =>
                (a.loadTime || '99:99').localeCompare(b.loadTime || '99:99')
              )
              .map((t, idx) => ({ ...t, tripNo: idx + 1 }));
          }
        }

        const existingLogSnap = await getDoc(doc(db, 'DailyLogs', recordKey));
        await saveRecordTrips({
          workDate: grp.workDate,
          driverId: grp.driverId,
          driverName: drv?.name || grp.driverName,
          plateNo: veh?.plateNo || grp.plateNo,
          routeId: grp.defaultRouteId || 'route_gansen',
          routeName: routeMap[grp.defaultRouteId]?.name || '간선 운송',
          trips: finalTrips,
          dailyLogExists: existingLogSnap.exists(),
        });
        totalCoursesSaved += grp.trips.length;
      }

      const firstYm = pasteGroups[0]?.workDate?.slice(0, 7);
      setPasteModal(false);
      if (firstYm && firstYm !== yearMonth) {
        setYearMonth(firstYm);
      } else {
        await loadAll();
      }
      alert(
        `✅ ${pasteGroups.length}명 기사님 · 총 ${totalCoursesSaved}코스가 자동 등록되었습니다!\n(운임은 관리자웹에만 저장되고, 기사앱에는 금액 없이 노선표·주소·담당자만 표시됩니다.)`
      );
    } catch (err) {
      alert(`일괄 등록 오류: ${err.message}`);
    } finally {
      setSavingPaste(false);
    }
  };

  // 기사별 급여 정산 저장
  const handleSaveDriverPayroll = async (row) => {
    const edit = payrollEdits[row.driverId] || {};
    const finalPay =
      (Number(edit.baseSalary) || 0) +
      (Number(edit.extraTripPay) || 0) -
      (Number(edit.offDayDeduction) || 0);
    setSavingPayrollKey(row.driverId);
    try {
      await setDoc(
        doc(db, 'Settlements', `${yearMonth}_${row.driverId}`),
        {
          docType: 'driver_payroll',
          yearMonth,
          driverId: row.driverId,
          driverName: row.driverName,
          workDays: row.workDays,
          totalKm: row.totalKm,
          totalAmount: row.variableRevenue,
          baseSalary: Number(edit.baseSalary) || 0,
          extraTripsCount: Number(edit.extraTripsCount) || 0,
          extraTripPay: Number(edit.extraTripPay) || 0,
          offDaysCount: Number(edit.offDaysCount) || 0,
          offDayDeduction: Number(edit.offDayDeduction) || 0,
          finalPay,
          memo: String(edit.memo || '').trim(),
          updatedAt: serverTimestamp(),
          updatedBy: adminUid,
        },
        { merge: true }
      );
      await loadAll();
    } catch (err) {
      alert(`급여 정산 저장 오류: ${err.message}`);
    } finally {
      setSavingPayrollKey('');
    }
  };

  const handleSaveAllPayroll = async () => {
    setSavingPayrollKey('__ALL__');
    try {
      const batch = writeBatch(db);
      driverPayrollBaseRows.forEach((row) => {
        const edit = payrollEdits[row.driverId] || {};
        const finalPay =
          (Number(edit.baseSalary) || 0) +
          (Number(edit.extraTripPay) || 0) -
          (Number(edit.offDayDeduction) || 0);
        batch.set(
          doc(db, 'Settlements', `${yearMonth}_${row.driverId}`),
          {
            docType: 'driver_payroll',
            yearMonth,
            driverId: row.driverId,
            driverName: row.driverName,
            workDays: row.workDays,
            totalKm: row.totalKm,
            totalAmount: row.variableRevenue,
            baseSalary: Number(edit.baseSalary) || 0,
            extraTripsCount: Number(edit.extraTripsCount) || 0,
            extraTripPay: Number(edit.extraTripPay) || 0,
            offDaysCount: Number(edit.offDaysCount) || 0,
            offDayDeduction: Number(edit.offDayDeduction) || 0,
            finalPay,
            memo: String(edit.memo || '').trim(),
            updatedAt: serverTimestamp(),
            updatedBy: adminUid,
          },
          { merge: true }
        );
      });
      await batch.commit();
      await loadAll();
      alert(`✅ ${driverPayrollBaseRows.length}명의 급여 정산이 일괄 저장되었습니다.`);
    } catch (err) {
      alert(`일괄 저장 오류: ${err.message}`);
    } finally {
      setSavingPayrollKey('');
    }
  };

  // 세금계산서 엑셀 다운로드
  const handleDownloadInvoiceExcel = async () => {
    setDownloading(true);
    try {
      const exportItems = [];
      perTripInvoices.forEach((it) => {
        exportItems.push({
          categoryLabel: '간선 건별(용차/콜)',
          refDate: it.workDate,
          clientName: it.trip.clientName || '-',
          bizNo: it.trip.bizNo || '',
          courseOrItem: it.trip.courseName || '-',
          driverOrVehicle: `${it.driverName} (${it.plateNo})`,
          supplyAmount: it.trip.supplyAmount,
          vatAmount: it.trip.vatAmount,
          totalAmount: it.trip.totalAmount,
          statusLabel:
            it.trip.invoiceStatus === 'issued'
              ? '발행완료'
              : it.trip.invoiceStatus === 'excluded'
                ? '제외'
                : '발행대기',
          issuedAtLabel: it.trip.invoiceIssuedAt || '',
          memo: it.trip.invoiceMemo || '',
        });
      });
      bundledClientGroups.forEach((g) => {
        const isAllIssued = g.pendingCount === 0 && g.issuedCount > 0;
        exportItems.push({
          categoryLabel: '고정 간선(묶음)',
          refDate: `${g.minDate} ~ ${g.maxDate}`,
          clientName: g.clientName,
          bizNo: g.bizNo || '',
          courseOrItem: `${g.items.length}건 묶음 합산`,
          driverOrVehicle: Array.from(
            new Set(g.items.map((x) => x.driverName))
          ).join(', '),
          supplyAmount: g.supplyAmount,
          vatAmount: g.vatAmount,
          totalAmount: g.totalAmount,
          statusLabel: isAllIssued ? '발행완료' : '발행대기',
          issuedAtLabel: g.latestIssuedAt || '',
          memo: '',
        });
      });
      monthlyRouteSummaries.forEach((m) => {
        exportItems.push({
          categoryLabel: '월정액 거래처',
          refDate: `${yearMonth} (${formatBillingDayLabel(m.billingDay)})`,
          clientName: m.clientName,
          bizNo: m.bizNo || '',
          courseOrItem: `${m.route.name} (운행 ${m.runCount}회)`,
          driverOrVehicle: '월정액 전체',
          supplyAmount: m.supplyAmount,
          vatAmount: m.vatAmount,
          totalAmount: m.totalAmount,
          statusLabel:
            m.invoiceStatus === 'issued'
              ? '발행완료'
              : m.invoiceStatus === 'excluded'
                ? '제외'
                : '발행대기',
          issuedAtLabel: m.invoiceIssuedAt || '',
          memo: '',
        });
      });

      const { exportTaxInvoiceExcel } = await import('../utils/excel');
      await exportTaxInvoiceExcel({ yearMonth, items: exportItems });
    } finally {
      setDownloading(false);
    }
  };

  // 월 종합 엑셀 & 결산 마감
  const handleMonthlyExcel = async () => {
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

  const handleCloseMonth = async () => {
    if (
      !window.confirm(
        `${yearMonth}월 결산을 마감(closed)하시겠습니까? 기사별 정산 문서가 마감 상태로 저장됩니다.`
      )
    ) {
      return;
    }
    const batch = writeBatch(db);
    driverPayrollBaseRows.forEach((r) => {
      const edit = payrollEdits[r.driverId] || {};
      const finalPay =
        (Number(edit.baseSalary) || 0) +
        (Number(edit.extraTripPay) || 0) -
        (Number(edit.offDayDeduction) || 0);
      batch.set(
        doc(db, 'Settlements', `${yearMonth}_${r.driverId}`),
        {
          docType: 'driver_payroll',
          yearMonth,
          driverId: r.driverId,
          driverName: r.driverName,
          workDays: r.workDays,
          totalAmount: r.variableRevenue,
          totalKm: r.totalKm,
          baseSalary: Number(edit.baseSalary) || 0,
          extraTripsCount: Number(edit.extraTripsCount) || 0,
          extraTripPay: Number(edit.extraTripPay) || 0,
          offDaysCount: Number(edit.offDaysCount) || 0,
          offDayDeduction: Number(edit.offDayDeduction) || 0,
          finalPay,
          status: 'closed',
          closedAt: serverTimestamp(),
          closedBy: adminUid,
        },
        { merge: true }
      );
    });
    await batch.commit();
    await loadAll();
    alert('이번 달 결산이 마감되었습니다.');
  };

  const handleReopenMonth = async () => {
    if (!window.confirm('마감을 취소하고 수정 가능(draft) 상태로 되돌리시겠습니까?')) {
      return;
    }
    const batch = writeBatch(db);
    settlements
      .filter((s) => !s.docType || s.docType === 'driver_payroll')
      .forEach((s) => {
        batch.set(
          doc(db, 'Settlements', s.id),
          { status: 'draft', updatedAt: serverTimestamp() },
          { merge: true }
        );
      });
    await batch.commit();
    await loadAll();
  };

  // 경리 계정 생성 (관리자 전용)
  const handleCreateAccountingUser = async (e) => {
    e.preventDefault();
    setAccMsg('');
    const cleanCode = accCode.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,32}$/.test(cleanCode)) {
      setAccMsg('아이디는 영문 소문자·숫자·하이픈(-) 2자 이상으로 입력해 주세요.');
      return;
    }
    if (accPassword.trim().length < 6 || !accName.trim()) {
      setAccMsg('비밀번호 6자리 이상과 직원 성함을 입력해 주세요.');
      return;
    }
    setCreatingAcc(true);
    try {
      const email = cleanCode.includes('@')
        ? cleanCode
        : `${cleanCode}@bhlogistics.local`;
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        email,
        accPassword.trim()
      );
      const uid = cred.user.uid;
      try {
        await signOut(secondaryAuth);
      } catch (_) {}

      await setDoc(doc(db, 'Users', uid), {
        role: 'accounting',
        driverCode: cleanCode,
        name: accName.trim(),
        phone: accPhone.trim(),
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setAccCode('');
      setAccPassword('');
      setAccName('');
      setAccPhone('');
      await loadAll();
      alert(
        `✅ 경리 전용 계정이 생성되었습니다!\n아이디: ${cleanCode}\n(이 계정으로 로그인하면 매출·세금계산서·정산 화면만 보입니다.)`
      );
    } catch (err) {
      setAccMsg(`❌ 생성 오류: ${err.message}`);
    } finally {
      setCreatingAcc(false);
    }
  };

  // 필터링된 세금계산서 항목
  const matchStatusFilter = (status) => {
    if (invoiceStatusFilter === 'all') return true;
    if (invoiceStatusFilter === 'pending') return status === 'pending';
    return status === 'issued';
  };

  const filteredPerTrips = perTripInvoices.filter((x) =>
    matchStatusFilter(x.trip.invoiceStatus)
  );
  const filteredBundled = bundledClientGroups.filter((g) => {
    const status = g.pendingCount > 0 ? 'pending' : 'issued';
    return matchStatusFilter(status);
  });
  const filteredMonthlyInvoices = monthlyRouteSummaries.filter((m) =>
    matchStatusFilter(m.invoiceStatus)
  );

  // 대기 건수 및 금액 KPI
  const pendingPerTripCount = perTripInvoices.filter(
    (x) => x.trip.invoiceStatus === 'pending'
  ).length;
  const pendingPerTripSum = perTripInvoices
    .filter((x) => x.trip.invoiceStatus === 'pending')
    .reduce((s, x) => s + x.trip.totalAmount, 0);

  const pendingBundledGroups = bundledClientGroups.filter(
    (g) => g.pendingCount > 0
  );
  const pendingBundledSum = pendingBundledGroups.reduce(
    (s, g) =>
      s +
      g.items
        .filter((x) => x.trip.invoiceStatus === 'pending')
        .reduce((acc, x) => acc + x.trip.totalAmount, 0),
    0
  );

  const pendingMonthlyList = monthlyRouteSummaries.filter(
    (m) => m.invoiceStatus === 'pending' && m.supplyAmount > 0
  );
  const pendingMonthlySum = pendingMonthlyList.reduce(
    (s, m) => s + m.totalAmount,
    0
  );

  // 종합 손익 계산
  const validLogs = logs.filter(
    (l) => l.status === 'in_progress' || l.status === 'completed'
  );
  const missingCheckoutCount = logs.filter(
    (l) => l.status === 'in_progress'
  ).length;
  const totalFuelCost = validLogs.reduce(
    (s, l) => s + (Number(l.estimatedFuelCost) || 0),
    0
  );
  const monthMaintCost = maintenance
    .filter((m) => !m.yearMonth || m.yearMonth === yearMonth)
    .reduce((s, m) => s + (Number(m.cost) || 0), 0);
  const combinedTotalRevenue = variableSummary.totalSupply + monthlyTotalRevenue;
  const estimatedOperatingProfit =
    combinedTotalRevenue - totalFuelCost - monthMaintCost;

  const pieCompositionData = [
    { name: '간선(변동·용차)', value: variableSummary.totalSupply },
    ...monthlyRouteSummaries
      .filter((m) => m.supplyAmount > 0)
      .map((m) => ({ name: m.clientName, value: m.supplyAmount })),
  ].filter((x) => x.value > 0);

  return (
    <div className="space-y-6">
      {/* 상단 헤더 & 공통 월 선택 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black">
              매출 집계 · 세금계산서 · 급여 정산
            </h1>
            {isAccountingOnly && (
              <span className="px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-800 border border-teal-300 text-xs font-black">
                👩‍💼 경리 전용 모드
              </span>
            )}
            {isClosed && (
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black">
                ✓ 결산 마감됨
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            간선(1~3코스 변동형)과 월정액 거래처를 분리 집계하고, 아침 세금계산서 발행 목록과 급여 정산을 관리합니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="px-3.5 py-2 rounded-xl border bg-white font-bold text-sm"
          />
          <button
            onClick={openPasteModal}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow whitespace-nowrap"
          >
            📋 카톡 · 엑셀 · 사진 배차 등록
          </button>
          <button
            onClick={handleDownloadInvoiceExcel}
            disabled={downloading}
            className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm shadow whitespace-nowrap"
          >
            {downloading ? '생성 중...' : '📥 세금계산서 엑셀'}
          </button>
        </div>
      </div>

      {/* 3개 핵심 실무 서브 탭 바 */}
      <div className="flex flex-wrap gap-2 bg-white p-1.5 rounded-2xl border shadow-sm">
        {[
          {
            id: 'invoices',
            label: `🧾 오늘 발행할 세금계산서 (대기 ${
              pendingPerTripCount +
              pendingBundledGroups.length +
              pendingMonthlyList.length
            })`,
          },
          {
            id: 'variable',
            label: `🚛 간선(변동형) 배차 · 매출 비교 (${variableRecords.length}건)`,
          },
          {
            id: 'payroll_summary',
            label: `💰 기사 급여 정산 · 전사 손익 · 마감`,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              activeSubTab === tab.id
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border p-12 text-center text-slate-400 font-bold">
          {yearMonth} 매출 및 세금계산서 데이터를 불러오는 중입니다...
        </div>
      ) : (
        <>
          {/* ================================================================
              TAB 1: 오늘 발행할 세금계산서 (경리 아침 확인용)
          ================================================================= */}
          {activeSubTab === 'invoices' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <KpiCard
                  title="① 용차·콜 건별 발행 대기 (1건=1장)"
                  value={`${pendingPerTripCount}건`}
                  sub={`합계(VAT포함) ${pendingPerTripSum.toLocaleString()}원`}
                  color="text-[#1E5EFF]"
                />
                <KpiCard
                  title="② 고정 간선 거래처 묶음 대기"
                  value={`${pendingBundledGroups.length}곳`}
                  sub={`합계(VAT포함) ${pendingBundledSum.toLocaleString()}원`}
                  color="text-indigo-600"
                />
                <KpiCard
                  title="③ 월정액 거래처 정기 발행 대기"
                  value={`${pendingMonthlyList.length}곳`}
                  sub={`합계(VAT포함) ${pendingMonthlySum.toLocaleString()}원`}
                  color="text-teal-700"
                />
              </div>

              {/* 상태 필터 바 */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border">
                <div className="flex items-center gap-2 text-xs font-bold">
                  <span className="text-slate-500 mr-1">상태 보기:</span>
                  {[
                    { k: 'all', label: '전체 보기' },
                    { k: 'pending', label: '⏳ 발행 대기만' },
                    { k: 'issued', label: '✅ 발행 완료만' },
                  ].map((f) => (
                    <button
                      key={f.k}
                      onClick={() => setInvoiceStatusFilter(f.k)}
                      className={`px-3 py-1.5 rounded-xl border ${
                        invoiceStatusFilter === f.k
                          ? 'bg-[#1E5EFF] text-white border-[#1E5EFF]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-slate-500">
                  홈택스에서 세금계산서를 발행한 뒤 우측 <b>[발행 완료]</b> 버튼을 눌러 중복 발행을 방지하세요.
                </div>
              </div>

              {/* Section 1: 건별 발행 대기 (용차 / 단발 콜) */}
              <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="p-4 border-b bg-amber-50/70 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-black text-slate-900">
                      ① 외부 용차 · 단발 콜 세금계산서 (코스별 1건당 1장 즉시 발행)
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      고정간선 기사가 1·2·3코스 중 <b>2코스만 외부 용차</b>로 운행한 경우에도 그 용차 코스만 여기에 따로 분리되어 바로 세금계산서를 발행·확인할 수 있습니다.
                    </p>
                  </div>
                  <button
                    onClick={openPasteModal}
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
                  >
                    📋 배차 · 용차 등록
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-sm text-left">
                    <thead className="bg-slate-50 border-b font-bold text-xs">
                      <tr>
                        <th className="p-3">운행일</th>
                        <th className="p-3">기사 · 차량</th>
                        <th className="p-3">거래처명 (사업자번호)</th>
                        <th className="p-3">운행 코스</th>
                        <th className="p-3 text-right">공급가액</th>
                        <th className="p-3 text-right">부가세(10%)</th>
                        <th className="p-3 text-right">합계금액</th>
                        <th className="p-3">상태</th>
                        <th className="p-3">발행 처리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredPerTrips.length === 0 ? (
                        <tr>
                          <td
                            colSpan="9"
                            className="p-8 text-center text-slate-400 font-semibold"
                          >
                            표시할 건별 세금계산서 항목이 없습니다.
                          </td>
                        </tr>
                      ) : (
                        filteredPerTrips.map((row) => {
                          const isIssued = row.trip.invoiceStatus === 'issued';
                          const isExcluded = row.trip.invoiceStatus === 'excluded';
                          return (
                            <tr
                              key={`${row.recordKey}_${row.tripIdx}`}
                              className="hover:bg-slate-50"
                            >
                              <td className="p-3 font-bold whitespace-nowrap">
                                {row.workDate}
                                <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-black">
                                  {row.trip.tripNo}코스 · 외부용차
                                </span>
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                <span className="font-bold">{row.driverName}</span>
                                <span className="text-xs text-slate-500 ml-1">
                                  ({row.plateNo})
                                </span>
                              </td>
                              <td className="p-3">
                                <div className="font-bold text-slate-900">
                                  {row.trip.clientName || '-'}
                                </div>
                                {row.trip.bizNo && (
                                  <div className="text-[11px] text-slate-500">
                                    {row.trip.bizNo}
                                  </div>
                                )}
                              </td>
                              <td className="p-3 font-semibold text-slate-700">
                                {row.trip.courseName || '-'}
                              </td>
                              <td className="p-3 text-right font-bold">
                                {row.trip.supplyAmount.toLocaleString()}원
                              </td>
                              <td className="p-3 text-right text-slate-500">
                                {row.trip.vatAmount.toLocaleString()}원
                              </td>
                              <td className="p-3 text-right font-black text-[#1E5EFF]">
                                {row.trip.totalAmount.toLocaleString()}원
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                {isIssued ? (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-black">
                                    ✓ 발행완료
                                  </span>
                                ) : isExcluded ? (
                                  <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-xs font-bold">
                                    제외됨
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-black">
                                    발행 대기
                                  </span>
                                )}
                                {row.trip.invoiceIssuedAt && (
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    {row.trip.invoiceIssuedAt}
                                  </div>
                                )}
                              </td>
                              <td className="p-3 whitespace-nowrap space-x-1">
                                {!isIssued ? (
                                  <button
                                    onClick={() =>
                                      handleTogglePerTripInvoice(row, 'issued')
                                    }
                                    className="px-2.5 py-1 rounded-lg bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold text-xs"
                                  >
                                    발행 완료
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleTogglePerTripInvoice(row, 'pending')
                                    }
                                    className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 font-bold text-xs hover:bg-slate-100"
                                  >
                                    대기 복원
                                  </button>
                                )}
                                {!isExcluded && !isIssued && (
                                  <button
                                    onClick={() =>
                                      handleTogglePerTripInvoice(row, 'excluded')
                                    }
                                    className="px-2 py-1 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-slate-100"
                                  >
                                    제외
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 2: 고정 간선 거래처 묶음 발행 */}
              <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="p-4 border-b bg-indigo-50/60">
                  <h2 className="font-black text-slate-900">
                    ② 고정 간선 원청 월간 일괄 집계 (일일이 발행 X · 월 1회 합산 세금계산서)
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    고정 간선 코스는 매일 세금계산서를 끊지 않고, 한 달 동안 운행한 코스를 원청별로 모두 집계하여 월말에 한 번만 합산 발행합니다.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm text-left">
                    <thead className="bg-slate-50 border-b font-bold text-xs">
                      <tr>
                        <th className="p-3">거래처명</th>
                        <th className="p-3">이번 달 집계 기간 · 코스 내역</th>
                        <th className="p-3 text-right">월 합산 공급가액</th>
                        <th className="p-3 text-right">부가세(10%)</th>
                        <th className="p-3 text-right">총 합계금액</th>
                        <th className="p-3">발행 상태</th>
                        <th className="p-3">월 일괄 처리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredBundled.length === 0 ? (
                        <tr>
                          <td
                            colSpan="7"
                            className="p-6 text-center text-slate-400 font-semibold"
                          >
                            표시할 고정 간선 월간 집계 내역이 없습니다.
                          </td>
                        </tr>
                      ) : (
                        filteredBundled.map((g) => {
                          const allIssued = g.pendingCount === 0 && g.issuedCount > 0;
                          const isExpanded = Boolean(
                            expandedBundledClients[g.clientName]
                          );
                          return (
                            <React.Fragment key={g.clientName}>
                              <tr className="hover:bg-slate-50">
                                <td className="p-3 font-black text-slate-900">
                                  {g.clientName}
                                  {g.bizNo && (
                                    <div className="text-[11px] font-normal text-slate-500">
                                      {g.bizNo}
                                    </div>
                                  )}
                                </td>
                                <td className="p-3 text-xs text-slate-600">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-bold text-slate-800">
                                      이번 달 총 {g.items.length}코스 ({g.minDate.slice(5)} ~{' '}
                                      {g.maxDate.slice(5)})
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedBundledClients((prev) => ({
                                          ...prev,
                                          [g.clientName]: !prev[g.clientName],
                                        }))
                                      }
                                      className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-[11px]"
                                    >
                                      {isExpanded
                                        ? '▲ 코스 내역 접기'
                                        : `▼ 집계된 ${g.items.length}코스 내역 보기`}
                                    </button>
                                  </div>
                                  <div className="truncate max-w-xs mt-0.5 text-slate-500">
                                    {g.items
                                      .slice(0, 3)
                                      .map((x) => x.trip.courseName || x.driverName)
                                      .join(', ')}
                                    {g.items.length > 3 ? ' 외' : ''}
                                  </div>
                                </td>
                                <td className="p-3 text-right font-bold">
                                  {g.supplyAmount.toLocaleString()}원
                                </td>
                                <td className="p-3 text-right text-slate-500">
                                  {g.vatAmount.toLocaleString()}원
                                </td>
                                <td className="p-3 text-right font-black text-indigo-600">
                                  {g.totalAmount.toLocaleString()}원
                                </td>
                                <td className="p-3">
                                  {allIssued ? (
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-black">
                                      ✓ 월간 묶음 발행완료
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-xs font-black">
                                      월말 합산 대기 ({g.pendingCount}코스)
                                    </span>
                                  )}
                                </td>
                                <td className="p-3">
                                  {!allIssued ? (
                                    <button
                                      onClick={() =>
                                        handleToggleBundledGroupInvoice(g, 'issued')
                                      }
                                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
                                    >
                                      ✓ 이번 달 묶음 일괄 발행 완료
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() =>
                                        handleToggleBundledGroupInvoice(g, 'pending')
                                      }
                                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold text-xs"
                                    >
                                      대기 복원
                                    </button>
                                  )}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr className="bg-indigo-50/30">
                                  <td colSpan="7" className="p-3">
                                    <div className="rounded-xl bg-white border border-indigo-100 p-3 space-y-1.5 text-xs">
                                      <div className="font-black text-indigo-900 mb-1">
                                        📋 [{g.clientName}] {yearMonth} 고정간선 월간 운행 코스 집계 내역 ({g.items.length}코스)
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                        {g.items.map((it, idx) => (
                                          <div
                                            key={`${it.recordKey}_${it.tripIdx}_${idx}`}
                                            className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2"
                                          >
                                            <div className="truncate">
                                              <span className="font-black text-slate-800 mr-1">
                                                {it.workDate.slice(5)}
                                              </span>
                                              <span className="font-bold text-indigo-700 mr-1">
                                                {it.driverName}({it.trip.tripNo}코스)
                                              </span>
                                              <span className="text-slate-600">
                                                {it.trip.courseName || '-'}
                                              </span>
                                            </div>
                                            <span className="font-black text-slate-900 shrink-0">
                                              {it.trip.supplyAmount.toLocaleString()}원
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 3: 월정액 거래처 정기 발행 */}
              <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="p-4 border-b bg-teal-50/70 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-black text-slate-900">
                      ③ 월정액 거래처 정기 세금계산서 (25일 · 말일 등 거래처 전체 합계)
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      계약금액과 청구 기준일은 [6. 거래처 · 노선 · 계약] 기준표에서 관리됩니다.
                    </p>
                  </div>
                  {onNavigateRoutes ? (
                    <button
                      onClick={onNavigateRoutes}
                      className="px-3 py-1.5 rounded-xl bg-white border border-teal-300 text-teal-800 font-bold text-xs hover:bg-teal-50"
                    >
                      6. 거래처·계약 설정 바로가기 →
                    </button>
                  ) : (
                    <span className="text-[11px] font-bold text-teal-800 bg-white/80 px-2.5 py-1 rounded-lg border border-teal-200">
                      계약금 변경은 관리자에게 요청
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[840px] text-sm text-left">
                    <thead className="bg-slate-50 border-b font-bold text-xs">
                      <tr>
                        <th className="p-3">거래처 · 노선명</th>
                        <th className="p-3">청구 기준일</th>
                        <th className="p-3">당월 운행 건수</th>
                        <th className="p-3 text-right">월 계약 공급가액</th>
                        <th className="p-3 text-right">부가세(10%)</th>
                        <th className="p-3 text-right">총 청구 합계</th>
                        <th className="p-3">상태</th>
                        <th className="p-3">발행 처리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredMonthlyInvoices.length === 0 ? (
                        <tr>
                          <td
                            colSpan="8"
                            className="p-6 text-center text-slate-400 font-semibold"
                          >
                            표시할 월정액 거래처 항목이 없습니다.
                          </td>
                        </tr>
                      ) : (
                        filteredMonthlyInvoices.map((m) => {
                          const isIssued = m.invoiceStatus === 'issued';
                          return (
                            <tr key={m.route.id} className="hover:bg-slate-50">
                              <td className="p-3">
                                <div className="font-bold text-slate-900">
                                  {m.clientName}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  노선: {m.route.name}
                                  {m.bizNo ? ` · ${m.bizNo}` : ''}
                                </div>
                              </td>
                              <td className="p-3 font-bold whitespace-nowrap">
                                {formatBillingDayLabel(m.billingDay)}
                                {m.isDueSoon && (
                                  <span className="ml-1.5 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-black">
                                    🔔 발행일 도래
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-slate-600 font-semibold">
                                {m.runCount}회 출근
                              </td>
                              <td className="p-3 text-right font-bold">
                                {m.supplyAmount > 0 ? (
                                  `${m.supplyAmount.toLocaleString()}원`
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    금액 미입력
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-right text-slate-500">
                                {m.vatAmount.toLocaleString()}원
                              </td>
                              <td className="p-3 text-right font-black text-teal-700">
                                {m.totalAmount.toLocaleString()}원
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                {isIssued ? (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-black">
                                    ✓ 발행완료
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-black">
                                    발행 대기
                                  </span>
                                )}
                                {m.invoiceIssuedAt && (
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    {m.invoiceIssuedAt}
                                  </div>
                                )}
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                {!isIssued ? (
                                  <button
                                    onClick={() =>
                                      handleToggleMonthlyInvoice(m, 'issued')
                                    }
                                    className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs"
                                  >
                                    ✓ 발행 완료
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleToggleMonthlyInvoice(m, 'pending')
                                    }
                                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold text-xs"
                                  >
                                    대기 복원
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 2: 간선(변동형) 배차운임 · 매출 비교 (1~3코스)
          ================================================================= */}
          {activeSubTab === 'variable' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  title="간선(변동형) 월 매출 합계"
                  value={`${variableSummary.totalSupply.toLocaleString()}원`}
                  sub="공급가액 기준 (VAT 별도)"
                  color="text-[#1E5EFF]"
                />
                <KpiCard
                  title="간선 배차일 · 총 코스(탕)"
                  value={`${variableSummary.recordCount}일 (${variableSummary.tripCount}탕)`}
                  sub="다회차 코스 합계"
                  color="text-slate-900"
                />
                <KpiCard
                  title="코스(탕)당 평균 단가"
                  value={`${
                    variableSummary.tripCount > 0
                      ? Math.round(
                          variableSummary.totalSupply / variableSummary.tripCount
                        ).toLocaleString()
                      : 0
                  }원`}
                  sub="변동형 콜 평균 운임"
                  color="text-indigo-600"
                />
                <KpiCard
                  title="간선 총 주행거리"
                  value={`${variableSummary.totalKm.toLocaleString()}km`}
                  sub="계기판 기준"
                  color="text-emerald-600"
                />
              </div>

              {/* 간선 전용 차트 2종 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-5 rounded-2xl shadow-sm border h-72 flex flex-col">
                  <div className="font-bold text-sm mb-2">
                    (1) 간선 기사별 매출 비교 (월정액 기사 제외)
                  </div>
                  {variableSummary.driverChart.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-xs text-slate-400 font-semibold">
                      이번 달 간선 매출 데이터가 없습니다.
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={variableSummary.driverChart}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="driverName" tick={{ fontSize: 12 }} />
                          <YAxis
                            width={52}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(v) =>
                              v >= 10000 ? `${Math.round(v / 10000)}만` : v
                            }
                          />
                          <Tooltip
                            formatter={(v) => [`${Number(v).toLocaleString()}원`, '매출']}
                          />
                          <Bar
                            dataKey="supplyAmount"
                            name="공급가액(원)"
                            fill="#1E5EFF"
                            radius={[6, 6, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border h-72 flex flex-col">
                  <div className="font-bold text-sm mb-2">
                    (2) 간선 일별 매출 추이
                  </div>
                  {variableSummary.dateChart.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-xs text-slate-400 font-semibold">
                      이번 달 일별 간선 추이 데이터가 없습니다.
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={variableSummary.dateChart}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis
                            width={52}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(v) =>
                              v >= 10000 ? `${Math.round(v / 10000)}만` : v
                            }
                          />
                          <Tooltip
                            formatter={(v) => [`${Number(v).toLocaleString()}원`, '매출']}
                          />
                          <Line
                            type="monotone"
                            dataKey="매출"
                            stroke="#00796B"
                            strokeWidth={3}
                            dot={{ r: 3 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>

              {/* 간선 일자별 다회차(1~3코스) 상세 테이블 */}
              <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="p-4 border-b flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-black text-slate-900">
                      간선 일별 배차 · 다회차 코스(1~3탕) 내역
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      고정간선 코스는 월말 원청 일괄집계로 자동 합산되고, 중간에 낀 <b>외부용차 코스(예: 2코스 용차)</b>는 여기서 바로 건별 세금계산서를 발행·확인할 수 있습니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={openPasteModal}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm"
                    >
                      📋 카톡 · 엑셀 · 사진 배차 등록
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm text-left">
                    <thead className="bg-slate-50 border-b font-bold text-xs">
                      <tr>
                        <th className="p-3">운행일</th>
                        <th className="p-3">기사 · 차량</th>
                        <th className="p-3">출근 상태</th>
                        <th className="p-3">1~3코스 (고정간선 월합산 vs 외부용차 건별 세금계산서)</th>
                        <th className="p-3 text-right">일 공급가 합계</th>
                        <th className="p-3">수정 · 삭제</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {variableRecords.length === 0 ? (
                        <tr>
                          <td
                            colSpan="6"
                            className="p-8 text-center text-slate-400 font-semibold"
                          >
                            이번 달 간선(변동형) 운행 또는 배차 기록이 없습니다. 우측 상단 버튼으로 카톡 배차를 등록해 보세요.
                          </td>
                        </tr>
                      ) : (
                        variableRecords.map((rec) => {
                          const spotSupplySum = rec.trips
                            .filter((t) => t.invoiceType === 'per_trip')
                            .reduce((s, t) => s + (Number(t.supplyAmount) || 0), 0);
                          const fixedSupplySum = rec.totalSupply - spotSupplySum;
                          return (
                          <tr key={rec.recordKey} className="hover:bg-slate-50 align-top">
                            <td className="p-3 font-bold whitespace-nowrap">
                              {rec.workDate}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectDriverLogs &&
                                  onSelectDriverLogs(rec.driverId)
                                }
                                className={`font-bold ${
                                  onSelectDriverLogs
                                    ? 'text-[#1E5EFF] underline cursor-pointer'
                                    : 'text-slate-900'
                                }`}
                              >
                                {rec.driverName}
                              </button>
                              <div className="text-xs text-slate-500">
                                {rec.plateNo} · {rec.drivenKm}km
                              </div>
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                  rec.statusLabel === '운행완료'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : rec.statusLabel === '운행중'
                                      ? 'bg-blue-100 text-[#1E5EFF]'
                                      : 'bg-indigo-100 text-indigo-700'
                                }`}
                              >
                                {rec.statusLabel}
                              </span>
                            </td>
                            <td className="p-3 space-y-1.5">
                              {rec.trips.length === 0 ? (
                                <span className="text-xs text-amber-700 font-semibold">
                                  단가/코스 미입력 ([코스·운임 수정]을 눌러 입력하세요)
                                </span>
                              ) : (
                                rec.trips.map((t, i) => {
                                  const isFixed =
                                    t.dispatchCategory === 'fixed_gansen' ||
                                    (t.dispatchCategory !== 'spot_charter' &&
                                      t.invoiceType === 'bundled');
                                  const isSpotTrip = !isFixed;
                                  const isSpotIssued = t.invoiceStatus === 'issued';
                                  return (
                                  <div
                                    key={i}
                                    className={`px-2.5 py-2 rounded-xl border text-xs space-y-1.5 ${
                                      isSpotTrip
                                        ? 'bg-amber-50/70 border-amber-300'
                                        : 'bg-slate-50 border-slate-200'
                                    }`}
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>
                                        <span className="font-black text-slate-800 mr-1.5">
                                          {t.tripNo}코스
                                        </span>
                                        <span
                                          className={`mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-black ${
                                            isFixed
                                              ? 'bg-indigo-100 text-indigo-800'
                                              : 'bg-amber-200 text-amber-900'
                                          }`}
                                        >
                                          {isFixed
                                            ? '🏢 고정간선'
                                            : '🚛 외부용차 (별도 계산서)'}
                                        </span>
                                        {t.dispatchTag && (
                                          <span className="mr-1.5 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold">
                                            {t.dispatchTag}
                                          </span>
                                        )}
                                        <span
                                          className={`font-bold ${
                                            isSpotTrip
                                              ? 'text-amber-900'
                                              : 'text-[#1E5EFF]'
                                          }`}
                                        >
                                          [{t.clientName || '거래처 미입력'}]
                                        </span>{' '}
                                        <span className="text-slate-700 font-semibold">
                                          {t.courseName || '코스 미입력'}
                                        </span>
                                        {(t.cargoInfo || t.tempInfo) && (
                                          <span className="ml-1.5 text-[11px] text-slate-500">
                                            ({[t.cargoInfo, t.tempInfo].filter(Boolean).join(' · ')})
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                        {isFixed ? (
                                          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                                            📅 월말 원청 일괄집계
                                          </span>
                                        ) : (
                                          <>
                                            <span
                                              className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                                isSpotIssued
                                                  ? 'bg-emerald-100 text-emerald-700'
                                                  : 'bg-amber-100 text-amber-800'
                                              }`}
                                            >
                                              {isSpotIssued
                                                ? '✓ 계산서 발행완료'
                                                : '⏳ 계산서 미발행'}
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleTogglePerTripInvoice(
                                                  {
                                                    recordKey: rec.recordKey,
                                                    workDate: rec.workDate,
                                                    driverId: rec.driverId,
                                                    driverName: rec.driverName,
                                                    plateNo: rec.plateNo,
                                                    tripIdx: i,
                                                    trip: t,
                                                    allTrips: rec.trips,
                                                    log: rec.log,
                                                    disp: rec.disp,
                                                  },
                                                  isSpotIssued ? 'pending' : 'issued'
                                                )
                                              }
                                              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition ${
                                                isSpotIssued
                                                  ? 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'
                                                  : 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm'
                                              }`}
                                            >
                                              {isSpotIssued
                                                ? '대기 복원'
                                                : '🧾 계산서 발행완료'}
                                            </button>
                                          </>
                                        )}
                                        <span className="font-black text-slate-900 tabular-nums ml-1">
                                          {t.supplyAmount.toLocaleString()}원
                                        </span>
                                      </div>
                                    </div>
                                    {Array.isArray(t.stops) && t.stops.length > 0 && (
                                      <div className="pl-2 border-l-2 border-blue-200 space-y-0.5 text-[11px] text-slate-600">
                                        {t.stops.map((st, sIdx) => (
                                          <div key={sIdx} className="flex flex-wrap items-center gap-1.5">
                                            <span
                                              className={`px-1.5 py-0.2 rounded font-bold text-[10px] ${
                                                st.stopType === '상차'
                                                  ? 'bg-blue-50 text-blue-700'
                                                  : 'bg-teal-50 text-teal-700'
                                              }`}
                                            >
                                              {st.stopType} {st.time}
                                            </span>
                                            <span className="font-bold text-slate-800">
                                              {st.placeName}
                                            </span>
                                            {st.tempBadge && (
                                              <span className="text-sky-700 font-semibold">
                                                {st.tempBadge}
                                              </span>
                                            )}
                                            {st.palletBadge && (
                                              <span>· {st.palletBadge}</span>
                                            )}
                                            {st.address && (
                                              <span className="text-slate-500">
                                                · {st.address}
                                              </span>
                                            )}
                                            {st.contactPhone && (
                                              <span className="text-slate-500">
                                                ({st.contactName} {st.contactPhone})
                                              </span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  );
                                })
                              )}
                            </td>
                            <td className="p-3 text-right whitespace-nowrap">
                              <div className="font-black text-[#1E5EFF]">
                                {rec.totalSupply.toLocaleString()}원
                              </div>
                              {spotSupplySum > 0 && (
                                <div className="mt-1 space-y-0.5 text-[11px]">
                                  {fixedSupplySum > 0 && (
                                    <div className="text-indigo-700 font-bold">
                                      고정(월집계): {fixedSupplySum.toLocaleString()}원
                                    </div>
                                  )}
                                  <div className="text-amber-800 font-black">
                                    용차(별도1장): {spotSupplySum.toLocaleString()}원
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openDispatchModal({
                                      workDate: rec.workDate,
                                      driverId: rec.driverId,
                                      trips: rec.trips,
                                    })
                                  }
                                  className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                                >
                                  코스·운임 수정
                                </button>
                                <button
                                  type="button"
                                  disabled={savingDispatch}
                                  onClick={() =>
                                    handleDeleteRecordDispatch({
                                      workDate: rec.workDate,
                                      driverId: rec.driverId,
                                      driverName: rec.driverName,
                                    })
                                  }
                                  className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 text-xs font-bold hover:bg-red-100"
                                >
                                  🗑️ 삭제
                                </button>
                              </div>
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 3: 기사 급여 정산 · 전사 종합 손익 · 마감 · 경리계정
          ================================================================= */}
          {activeSubTab === 'payroll_summary' && (
            <div className="space-y-6">
              {missingCheckoutCount > 0 && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 font-bold text-sm">
                  ⚠️ 퇴근 누락이 {missingCheckoutCount}건 있어요. 마감 전에 확인해 주세요.
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  title="전사 월 총매출 (공급가 합계)"
                  value={`${combinedTotalRevenue.toLocaleString()}원`}
                  sub={`${yearMonth} 간선 + 월정액`}
                  color="text-[#1E5EFF]"
                />
                <KpiCard
                  title="간선(변동형) 매출 합계"
                  value={`${variableSummary.totalSupply.toLocaleString()}원`}
                  sub={`${variableSummary.recordCount}일 · ${variableSummary.tripCount}탕`}
                  color="text-indigo-600"
                />
                <KpiCard
                  title="월정액(고정형) 계약 매출"
                  value={`${monthlyTotalRevenue.toLocaleString()}원`}
                  sub={`월정액 거래처 ${monthlyRouteSummaries.length}곳`}
                  color="text-teal-700"
                />
                <KpiCard
                  title="예상 운행 손익 (주유·정비 차감)"
                  value={`${estimatedOperatingProfit.toLocaleString()}원`}
                  sub={`주유 ${totalFuelCost.toLocaleString()}원 · 정비 ${monthMaintCost.toLocaleString()}원`}
                  color="text-emerald-600"
                />
              </div>

              {/* 기사별 월 급여 정산 (출근·휴무 + 추가 탕 수당 / 휴무 차감) */}
              <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-black text-slate-900">
                      기사별 월 급여 정산 (출근 · 휴무일수 + 추가 탕 수당 / 휴무 차감)
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      출근 일수와 앱에 등록된 휴무일수를 바탕으로 기본급·추가 탕 수당(+)·휴무 차감(-)을 입력해 최종 급여를 확정합니다.
                    </p>
                  </div>
                  <button
                    onClick={handleSaveAllPayroll}
                    disabled={savingPayrollKey === '__ALL__'}
                    className="px-4 py-2 rounded-xl bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold text-xs shadow whitespace-nowrap"
                  >
                    {savingPayrollKey === '__ALL__'
                      ? '저장 중...'
                      : '💾 전체 기사 급여 일괄 저장'}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] text-sm text-left">
                    <thead className="bg-slate-50 border-b font-bold text-xs">
                      <tr>
                        <th className="p-3">기사 · 담당노선</th>
                        <th className="p-3">출근 / 주행km</th>
                        <th className="p-3">기본급 (원)</th>
                        <th className="p-3">추가 탕 횟수 · 수당(+)</th>
                        <th className="p-3">휴무 일수 · 차감(-)</th>
                        <th className="p-3 text-right">최종 지급 급여</th>
                        <th className="p-3">메모</th>
                        <th className="p-3">저장</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {driverPayrollBaseRows.map((row) => {
                        const edit = payrollEdits[row.driverId] || {
                          baseSalary: 0,
                          extraTripsCount: 0,
                          extraTripPay: 0,
                          offDaysCount: row.plannedOffDays,
                          offDayDeduction: 0,
                          memo: '',
                        };
                        const finalPay =
                          (Number(edit.baseSalary) || 0) +
                          (Number(edit.extraTripPay) || 0) -
                          (Number(edit.offDayDeduction) || 0);
                        return (
                          <tr key={row.driverId} className="hover:bg-slate-50">
                            <td className="p-3 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectDriverLogs &&
                                  onSelectDriverLogs(row.driverId)
                                }
                                className={`font-bold ${
                                  onSelectDriverLogs
                                    ? 'text-[#1E5EFF] underline cursor-pointer'
                                    : 'text-slate-900'
                                }`}
                              >
                                {row.driverName}
                              </button>
                              <div className="text-[11px] text-slate-500">
                                {row.routeName}
                              </div>
                            </td>
                            <td className="p-3 whitespace-nowrap text-xs">
                              <div className="font-bold">{row.workDays}일 출근</div>
                              <div className="text-slate-500">
                                {row.totalKm.toLocaleString()}km · 주유{' '}
                                {row.fuelCost.toLocaleString()}원
                              </div>
                            </td>
                            <td className="p-3">
                              <input
                                type="text"
                                inputMode="numeric"
                                value={formatNumberWithCommas(edit.baseSalary)}
                                onChange={(e) =>
                                  setPayrollEdits((prev) => ({
                                    ...prev,
                                    [row.driverId]: {
                                      ...edit,
                                      baseSalary: parseNumberWithoutCommas(
                                        e.target.value
                                      ),
                                    },
                                  }))
                                }
                                className="w-28 px-2 py-1.5 rounded-lg border text-right font-bold text-xs"
                              />
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  value={edit.extraTripsCount}
                                  onChange={(e) =>
                                    setPayrollEdits((prev) => ({
                                      ...prev,
                                      [row.driverId]: {
                                        ...edit,
                                        extraTripsCount: Number(e.target.value) || 0,
                                      },
                                    }))
                                  }
                                  className="w-12 px-1.5 py-1.5 rounded-lg border text-center text-xs font-bold"
                                  title="추가 탕 횟수"
                                />
                                <span className="text-xs text-slate-500">탕</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={formatNumberWithCommas(edit.extraTripPay)}
                                  onChange={(e) =>
                                    setPayrollEdits((prev) => ({
                                      ...prev,
                                      [row.driverId]: {
                                        ...edit,
                                        extraTripPay: parseNumberWithoutCommas(
                                          e.target.value
                                        ),
                                      },
                                    }))
                                  }
                                  className="w-24 px-2 py-1.5 rounded-lg border text-right text-xs font-bold text-blue-700"
                                />
                              </div>
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  value={edit.offDaysCount}
                                  onChange={(e) =>
                                    setPayrollEdits((prev) => ({
                                      ...prev,
                                      [row.driverId]: {
                                        ...edit,
                                        offDaysCount: Number(e.target.value) || 0,
                                      },
                                    }))
                                  }
                                  className="w-12 px-1.5 py-1.5 rounded-lg border text-center text-xs font-bold"
                                  title="휴무 일수"
                                />
                                <span className="text-xs text-slate-500">일</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={formatNumberWithCommas(
                                    edit.offDayDeduction
                                  )}
                                  onChange={(e) =>
                                    setPayrollEdits((prev) => ({
                                      ...prev,
                                      [row.driverId]: {
                                        ...edit,
                                        offDayDeduction: parseNumberWithoutCommas(
                                          e.target.value
                                        ),
                                      },
                                    }))
                                  }
                                  className="w-24 px-2 py-1.5 rounded-lg border text-right text-xs font-bold text-rose-600"
                                />
                              </div>
                            </td>
                            <td className="p-3 text-right font-black text-slate-900 whitespace-nowrap">
                              {finalPay.toLocaleString()}원
                            </td>
                            <td className="p-3">
                              <input
                                placeholder="비고"
                                value={edit.memo}
                                onChange={(e) =>
                                  setPayrollEdits((prev) => ({
                                    ...prev,
                                    [row.driverId]: {
                                      ...edit,
                                      memo: e.target.value,
                                    },
                                  }))
                                }
                                className="w-28 px-2 py-1.5 rounded-lg border text-xs"
                              />
                            </td>
                            <td className="p-3">
                              <button
                                onClick={() => handleSaveDriverPayroll(row)}
                                disabled={savingPayrollKey === row.driverId}
                                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs whitespace-nowrap"
                              >
                                {savingPayrollKey === row.driverId
                                  ? '...'
                                  : '저장'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 마감 & 종합 엑셀 바 */}
              <div className="bg-white rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-bold text-slate-700">
                  {yearMonth}월 종합 결산 마감 및 ExcelJS 4개 시트 통합 다운로드
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleMonthlyExcel}
                    disabled={downloading}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow"
                  >
                    📥 ExcelJS 월결산 종합 엑셀 다운로드
                  </button>
                  {!isClosed ? (
                    <button
                      onClick={handleCloseMonth}
                      className="px-4 py-2 rounded-xl bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold text-xs shadow"
                    >
                      이번 달 결산 마감
                    </button>
                  ) : (
                    <button
                      onClick={handleReopenMonth}
                      className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-xs"
                    >
                      마감 취소 (draft)
                    </button>
                  )}
                </div>
              </div>

              {/* 매출 구성 비중 차트 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border">
                <div className="font-bold text-sm mb-3">
                  전사 매출 비중 (간선 변동형 vs 월정액 거래처별)
                </div>
                {pieCompositionData.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-400">
                    등록된 매출 금액이 아직 없습니다. 간선 배차 운임 또는 월정액 거래처 계약금액을 입력해 주세요.
                  </div>
                ) : (
                  <div className="flex flex-col md:flex-row items-center gap-6">
                    <div className="w-48 h-48 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieCompositionData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={44}
                            outerRadius={76}
                            paddingAngle={3}
                          >
                            {pieCompositionData.map((_, i) => (
                              <Cell
                                key={i}
                                fill={CHART_COLORS[i % CHART_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(v) => [
                              `${Number(v).toLocaleString()}원`,
                              '매출',
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {pieCompositionData.map((item, i) => {
                        const pct =
                          combinedTotalRevenue > 0
                            ? Math.round((item.value / combinedTotalRevenue) * 100)
                            : 0;
                        return (
                          <div
                            key={item.name}
                            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    CHART_COLORS[i % CHART_COLORS.length],
                                }}
                              />
                              <span className="font-bold truncate">
                                {item.name}
                              </span>
                            </div>
                            <span className="font-black text-slate-900 ml-2 whitespace-nowrap">
                              {item.value.toLocaleString()}원 ({pct}%)
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* 예상 주유비 기준 경유 단가 설정 바 */}
              <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-sm">
                <div className="space-y-0.5">
                  <div className="font-black text-emerald-950">
                    ⛽ 예상 주유비 자동 산출 공식: (일일 운행거리 km ÷ 차량별 연비 km/L) × 기준 경유 단가(원/L)
                  </div>
                  <div className="text-xs text-emerald-800">
                    현재 기준 경유값: 리터당 <b>{dieselPrice.toLocaleString()}원</b>
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
                    onChange={(e) =>
                      setDieselPrice(parseNumberWithoutCommas(e.target.value))
                    }
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

              {/* 관리자(admin) 전용: 경리 직원 로그인 계정 생성 및 권한 관리 */}
              {!isAccountingOnly && (
                <div className="bg-white rounded-2xl border p-5 space-y-4">
                  <div>
                    <h2 className="text-lg font-black text-slate-900">
                      👩‍💼 경리 직원 전용 로그인 계정 관리
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      경리 계정(`role: &apos;accounting&apos;`)으로 로그인하면 오직{' '}
                      <b>[매출 집계 · 세금계산서 · 급여 정산]</b> 화면만 보이고 차량·기사 관리 메뉴는 숨겨집니다.
                    </p>
                  </div>

                  {accountingUsers.length > 0 && (
                    <div className="divide-y border rounded-xl overflow-hidden text-sm">
                      {accountingUsers.map((u) => (
                        <div
                          key={u.id}
                          className="p-3 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60"
                        >
                          <div>
                            <span className="font-black text-slate-900">
                              {u.name}
                            </span>
                            <span className="ml-2 px-2 py-0.5 rounded bg-teal-100 text-teal-800 text-xs font-bold">
                              아이디: {u.driverCode || '-'}
                            </span>
                            {u.phone && (
                              <span className="ml-2 text-xs text-slate-500">
                                {u.phone}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={async () => {
                              const nextActive = u.isActive === false;
                              await setDoc(
                                doc(db, 'Users', u.id),
                                {
                                  isActive: nextActive,
                                  updatedAt: serverTimestamp(),
                                },
                                { merge: true }
                              );
                              await loadAll();
                            }}
                            className={`px-3 py-1 rounded-lg text-xs font-bold ${
                              u.isActive !== false
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {u.isActive !== false ? '로그인 허용 중' : '정지됨'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <form
                    onSubmit={handleCreateAccountingUser}
                    className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 items-end text-sm pt-2"
                  >
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        경리 로그인 아이디
                      </label>
                      <input
                        placeholder="예: bh-acc"
                        value={accCode}
                        onChange={(e) => setAccCode(e.target.value)}
                        className="w-full px-3 py-2 border rounded-xl font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        초기 비밀번호 (6자리 이상)
                      </label>
                      <input
                        type="password"
                        placeholder="6자리 이상"
                        value={accPassword}
                        onChange={(e) => setAccPassword(e.target.value)}
                        className="w-full px-3 py-2 border rounded-xl font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        경리 직원 성함
                      </label>
                      <input
                        placeholder="예: 김경리"
                        value={accName}
                        onChange={(e) => setAccName(e.target.value)}
                        className="w-full px-3 py-2 border rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        연락처 (선택)
                      </label>
                      <input
                        placeholder="010-0000-0000"
                        value={accPhone}
                        onChange={(e) => setAccPhone(e.target.value)}
                        className="w-full px-3 py-2 border rounded-xl"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={creatingAcc}
                      className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow whitespace-nowrap"
                    >
                      {creatingAcc ? '생성 중...' : '+ 경리 계정 만들기'}
                    </button>
                  </form>
                  {accMsg && (
                    <div className="p-2.5 rounded-xl bg-red-50 text-red-600 text-xs font-bold">
                      {accMsg}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <datalist id="bh-contractor-datalist">
        {contractorSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {/* ====================================================================
          모달: 전날 카톡 배차 / 간선 다회차(1~3코스) 운임 등록 · 수정
      ===================================================================== */}
      {dispatchModal && (
        <div
          onClick={() => !savingDispatch && setDispatchModal(false)}
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <div className="text-xs font-bold text-[#1E5EFF]">
                  카카오톡 단톡방 배차 · 다회차(1~3탕) 매출 등록 · 수정
                </div>
                <h2 className="text-xl font-black">
                  간선 코스 · 운임 · 경유지 · 세금계산서 수정
                </h2>
              </div>
              <button
                type="button"
                disabled={savingDispatch}
                onClick={() => setDispatchModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-100 font-bold text-sm"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleSaveDispatchModal} className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold text-slate-700">운행일자</label>
                    <div className="flex gap-1 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setDispWorkDate(kstOffsetDateStr(0))}
                        className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 font-bold"
                      >
                        오늘
                      </button>
                      <button
                        type="button"
                        onClick={() => setDispWorkDate(kstOffsetDateStr(1))}
                        className="px-2 py-0.5 rounded bg-blue-50 text-[#1E5EFF] hover:bg-blue-100 font-bold"
                      >
                        내일(전날배차)
                      </button>
                    </div>
                  </div>
                  <input
                    type="date"
                    value={dispWorkDate}
                    onChange={(e) => setDispWorkDate(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    담당 기사 선택
                  </label>
                  <select
                    value={dispDriverId}
                    onChange={(e) => setDispDriverId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl bg-white font-bold"
                  >
                    {activeDrivers.map((d) => {
                      const plate =
                        vehicleMap[d.assignedVehicleId]?.plateNo || '미배정';
                      const rName = routeMap[d.defaultRouteId]?.name || '';
                      return (
                        <option key={d.id} value={d.id}>
                          {d.name} ({plate}) {rName ? `· ${rName}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-black text-slate-800">
                    운행 코스 목록 ({dispTrips.length}코스)
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDispTrips((prev) => {
                        const first = prev[0] || {};
                        return [
                          ...prev,
                          makeEmptyTrip(prev.length + 1, {
                            clientName: first.clientName || '',
                            dispatchCategory:
                              first.dispatchCategory || 'spot_charter',
                            invoiceType:
                              first.dispatchCategory === 'fixed_gansen'
                                ? 'bundled'
                                : first.invoiceType || 'per_trip',
                            bizNo: first.bizNo || '',
                          }),
                        ];
                      })
                    }
                    className="px-3 py-1.5 rounded-xl bg-blue-50 text-[#1E5EFF] hover:bg-blue-100 font-bold text-xs"
                  >
                    + 코스 추가 (2탕/3탕)
                  </button>
                </div>

                {dispTrips.map((trip, idx) => (
                  <TripCardEditor
                    key={idx}
                    trip={trip}
                    idx={idx}
                    totalTrips={dispTrips.length}
                    showBizNo
                    stopsExpanded={Boolean(expandedStopKeys[`disp_${idx}`])}
                    onToggleStops={() => toggleStopEditor(`disp_${idx}`)}
                    onUpdateTrip={(nextTrip) =>
                      setDispTrips((prev) =>
                        prev.map((t, i) => (i === idx ? nextTrip : t))
                      )
                    }
                    onDeleteTrip={() => {
                      setDispTrips((prev) =>
                        prev
                          .filter((_, i) => i !== idx)
                          .map((t, n) => ({ ...t, tripNo: n + 1 }))
                      );
                      setExpandedStopKeys({});
                    }}
                  />
                ))}
              </div>

              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-between text-xs font-bold">
                <span>
                  이날 총 운임 합계 (공급가):{' '}
                  <b className="text-[#1E5EFF] text-sm">
                    {dispTrips
                      .reduce((s, t) => s + (Number(t.supplyAmount) || 0), 0)
                      .toLocaleString()}
                    원
                  </b>
                </span>
                <span className="text-slate-600">
                  VAT포함:{' '}
                  {dispTrips
                    .reduce((s, t) => s + (Number(t.totalAmount) || 0), 0)
                    .toLocaleString()}
                  원
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                <div>
                  {(dispatchMap[`${dispWorkDate}_${dispDriverId}`] ||
                    logs.some(
                      (l) =>
                        l.id === `${dispWorkDate}_${dispDriverId}` &&
                        Array.isArray(l.trips) &&
                        l.trips.length > 0
                    )) && (
                    <button
                      type="button"
                      disabled={savingDispatch}
                      onClick={() =>
                        handleDeleteRecordDispatch({
                          workDate: dispWorkDate,
                          driverId: dispDriverId,
                          driverName: userMap[dispDriverId]?.name || '',
                        })
                      }
                      className="px-3.5 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 font-bold text-xs"
                    >
                      🗑️ 이날 배차 전체 삭제
                    </button>
                  )}
                </div>
                <div className="flex gap-2 ml-auto">
                  <button
                    type="button"
                    disabled={savingDispatch}
                    onClick={() => setDispatchModal(false)}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 font-bold"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={savingDispatch}
                    className="px-5 py-2.5 rounded-xl bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold"
                  >
                    {savingDispatch ? '저장 중...' : '배차 · 코스 운임 저장'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ====================================================================
          모달 2: 카톡 단톡방 · 밀크런 상세 · 엑셀 사진/텍스트 배차 자동 등록
      ===================================================================== */}
      {pasteModal && (
        <div
          onClick={() => !savingPaste && setPasteModal(false)}
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-6 max-w-5xl w-full max-h-[92vh] flex flex-col space-y-3.5 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <div className="text-xs font-bold text-indigo-600">
                  AI 사진 비교 · 카톡 요약 · 밀크런 주소 · 엑셀 복사 일괄 인식
                </div>
                <h2 className="text-xl font-black text-slate-900">
                  📋 카톡 · 엑셀 · 사진 배차 자동등록
                </h2>
              </div>
              <button
                type="button"
                disabled={savingPaste}
                onClick={() => setPasteModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-100 font-bold text-sm"
              >
                닫기
              </button>
            </div>

            {/* 상단: 고정간선 원청 묶음 vs 외부용차 건별 1장 설정 바 */}
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-black text-slate-700 mr-1">
                    배차 성격:
                  </span>
                  <button
                    type="button"
                    onClick={() => handlePasteCategoryChange('fixed_gansen')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition border ${
                      pasteCategory === 'fixed_gansen'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    🏢 고정 간선 (한 업체 묶음 발행)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePasteCategoryChange('spot_charter')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition border ${
                      pasteCategory === 'spot_charter'
                        ? 'bg-[#1E5EFF] text-white border-[#1E5EFF] shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    🚛 외부 용차 / 단발 콜 (건별 1장)
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-black text-slate-700">
                    {pasteCategory === 'fixed_gansen'
                      ? '청구 원청 거래처:'
                      : '기본 거래처명:'}
                  </span>
                  <input
                    list="bh-contractor-datalist"
                    placeholder={
                      pasteCategory === 'fixed_gansen'
                        ? '예: (주)OOO물류 (1곳으로 묶임)'
                        : '예: 외부 용차 / 화주명'
                    }
                    value={pasteContractor}
                    onChange={(e) => handlePasteContractorChange(e.target.value)}
                    className="px-3 py-1.5 border rounded-xl bg-white font-bold text-slate-900 min-w-[200px]"
                  />
                </div>
              </div>
              <div className="text-[11px] text-slate-500 font-semibold">
                {pasteCategory === 'fixed_gansen'
                  ? '💡 밀크런(1코스)과 센터간선(2·3코스)이 모두 위 청구 원청 거래처 1곳으로 묶음 합산됩니다. (용인3센터·에르코스 등은 기사앱 경유지로만 표시)'
                  : '💡 고정 거래처가 아닌 단발성 콜·외부 용차로 분류되어 코스별로 세금계산서 1장씩 발행 대기함에 들어갑니다.'}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0 overflow-y-auto pr-1">
              {/* 왼쪽: 날짜 + 사진 첨부/AI 분석 + 텍스트 붙여넣기 */}
              <div className="space-y-3 flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-700">기본 날짜:</span>
                    <input
                      type="date"
                      value={pasteDefaultDate}
                      onChange={(e) => setPasteDefaultDate(e.target.value)}
                      className="px-2.5 py-1 border rounded-lg font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => setPasteDefaultDate(kstOffsetDateStr(0))}
                      className="px-2 py-1 rounded bg-slate-100 font-bold"
                    >
                      오늘
                    </button>
                    <button
                      type="button"
                      onClick={() => setPasteDefaultDate(kstOffsetDateStr(1))}
                      className="px-2 py-1 rounded bg-blue-50 text-[#1E5EFF] font-bold"
                    >
                      내일
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPasteRawText(SAMPLE_KAKAO_DISPATCH_TEXT)}
                    className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold hover:bg-indigo-100"
                  >
                    예시 데이터 채우기
                  </button>
                </div>

                {/* AI 사진 업로드 / Ctrl+V 붙여넣기 박스 */}
                <div
                  onPaste={handleClipboardPaste}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleAddPasteImageFiles(e.dataTransfer?.files);
                  }}
                  className="p-3 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-black text-indigo-900">
                        📸 엑셀·밀크런 사진 첨부 (사진 복사 후 Ctrl+V 가능)
                      </div>
                      <div className="text-[11px] text-slate-600">
                        캡처 사진과 아래 카톡 글을 함께 넣고 AI 분석을 누르면 서로 대조해 자동 정리합니다.
                      </div>
                    </div>
                    <label className="px-3 py-1.5 rounded-xl bg-white border border-indigo-300 text-indigo-700 font-bold cursor-pointer hover:bg-indigo-50 shrink-0">
                      🖼️ 사진 올리기
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          handleAddPasteImageFiles(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {pasteImages.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {pasteImages.map((img, i) => (
                        <div
                          key={i}
                          className="relative border rounded-lg overflow-hidden bg-white shadow-sm w-20 h-16"
                        >
                          <img
                            src={img.previewUrl}
                            alt={img.name}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemovePasteImage(i)}
                            title="사진 제거"
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white text-[11px] font-black flex items-center justify-center hover:bg-red-600"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={
                        aiAnalyzing ||
                        (pasteImages.length === 0 && !pasteRawText.trim())
                      }
                      onClick={handleRunAiAnalysis}
                      className="flex-1 min-w-[200px] px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-[#1E5EFF] hover:from-indigo-700 hover:to-blue-700 text-white font-black shadow-sm disabled:opacity-50"
                    >
                      {aiAnalyzing
                        ? '🤖 AI가 사진과 글을 대조 분석하는 중...'
                        : `🤖 AI로 사진(${pasteImages.length}장) + 텍스트 비교 분석하기`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAiKeyBox((prev) => !prev)}
                      className="px-2.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-100"
                    >
                      ⚙️ AI 키 설정
                    </button>
                  </div>

                  {aiStatusMsg && (
                    <div
                      className={`p-2 rounded-lg text-[11px] font-bold whitespace-pre-line ${
                        aiStatusMsg.startsWith('⚠️')
                          ? 'bg-red-50 text-red-700 border border-red-200'
                          : aiStatusMsg.startsWith('✅')
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-white text-indigo-800 border border-indigo-200'
                      }`}
                    >
                      {aiStatusMsg}
                    </div>
                  )}

                  {showAiKeyBox && (
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200 space-y-2 text-[11px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-bold text-slate-800">
                          Gemini API 키 설정 (관리자·경리만 접근 가능)
                        </div>
                        <a
                          href="https://aistudio.google.com/apikey"
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold hover:bg-indigo-100"
                        >
                          🔑 무료 API 키 발급 바로가기 ↗
                        </a>
                      </div>
                      <p className="text-slate-600 leading-relaxed">
                        <b>Google AI Studio → [Create API key] → [Create API key in new project(새 프로젝트)]</b>로 발급받으면 결제/App Check 없이 무료로 즉시 작동합니다. 발급된 <code>AIza...</code> 키를 아래에 1번만 저장해 주세요.
                      </p>
                      <div className="flex gap-1.5">
                        <input
                          type="password"
                          placeholder="AIza... (비우고 저장하면 Firebase AI 기본 사용)"
                          value={aiApiKey}
                          onChange={(e) => setAiApiKey(e.target.value)}
                          className="flex-1 px-2.5 py-1.5 border rounded-lg font-mono text-xs"
                        />
                        <button
                          type="button"
                          disabled={savingAiKey}
                          onClick={handleSaveAiApiKey}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold"
                        >
                          {savingAiKey ? '저장중...' : '키 저장'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <textarea
                  rows={10}
                  onPaste={handleClipboardPaste}
                  placeholder={`여기에 카카오톡 배차 글이나 엑셀 표를 복사(Ctrl+C)해서 붙여넣기(Ctrl+V) 하세요.\n(이미지를 복사한 상태로 여기에 Ctrl+V 해도 사진이 자동 첨부됩니다!)\n\n예)\n6번 정태광님\n냉장7파렛 9시\n청주.증평 ㅡ 용인 17만\n11시30분하차/1도,10도\n\n> 밀크런 6번 / 냉장 총 7파렛 ...`}
                  value={pasteRawText}
                  onChange={(e) => setPasteRawText(e.target.value)}
                  className="w-full flex-1 min-h-[190px] p-3 border rounded-xl text-xs font-mono leading-relaxed bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />

                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pasteMergeMode}
                    onChange={(e) => setPasteMergeMode(e.target.checked)}
                  />
                  같은 날짜에 이미 등록된 코스가 있으면 덮어쓰지 않고 이어 붙이기
                </label>
              </div>

              {/* 오른쪽: 실시간/AI 분석 미리보기 (수정·삭제 가능) */}
              <div className="space-y-3 overflow-y-auto max-h-[560px] pr-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-black text-sm text-slate-900">
                    분석 결과 미리보기 ({pasteGroups.length}명)
                    {pasteImages.length > 0 && (
                      <span className="ml-2 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-black">
                        AI 비교 모드
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const workDate = pasteDefaultDate || todayKstStr();
                        setPasteGroups((prev) => [
                          ...prev,
                          {
                            key: `${workDate}__unmatched_${Date.now()}`,
                            workDate,
                            driverId: `unmatched_${Date.now()}`,
                            isDriverMatched: false,
                            driverName: '직접 추가 기사',
                            plateNo: '-',
                            defaultRouteId: 'route_gansen',
                            trips: [
                              makeEmptyTrip(1, {
                                clientName: pasteContractor,
                                dispatchCategory: pasteCategory,
                                invoiceType:
                                  pasteCategory === 'fixed_gansen'
                                    ? 'bundled'
                                    : 'per_trip',
                              }),
                            ],
                          },
                        ]);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-blue-50 text-[#1E5EFF] border border-blue-200 hover:bg-blue-100 text-[11px] font-bold"
                    >
                      + 기사 수동 추가
                    </button>
                    <span className="text-[11px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
                      금액은 관리자웹에만 저장 (기사앱 비공개)
                    </span>
                  </div>
                </div>

                {pasteGroups.length === 0 && pasteUnmatchedMilkruns.length === 0 ? (
                  <div className="p-8 border rounded-2xl text-center text-xs text-slate-400 font-semibold">
                    {pasteImages.length > 0
                      ? '사진이 첨부되었습니다. 위 [🤖 AI로 사진 + 텍스트 비교 분석하기] 버튼을 눌러 주세요.'
                      : '왼쪽 칸에 카톡 배차 글·엑셀 표 또는 사진을 넣으면 기사별 1·2·3코스가 자동으로 정리됩니다.'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pasteUnmatchedMilkruns.map((um) => (
                      <div
                        key={um.milkrunNo}
                        className="p-3 rounded-xl bg-amber-50 border border-amber-300 space-y-2 text-xs"
                      >
                        <div className="font-black text-amber-900">
                          ⚠️ 요약 글 없이 [밀크런 {um.milkrunNo}번] 상세 주소만 붙여넣어졌습니다. 담당 기사를 골라 주세요:
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            defaultValue=""
                            onChange={(e) =>
                              handleAssignUnmatchedMilkrun(um, e.target.value)
                            }
                            className="flex-1 px-2.5 py-1.5 border rounded-lg bg-white font-bold"
                          >
                            <option value="">기사 선택...</option>
                            {activeDrivers.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name} ({vehicleMap[d.assignedVehicleId]?.plateNo || '미배정'})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}

                    {pasteGroups.map((grp, gIdx) => (
                      <div
                        key={grp.key || gIdx}
                        className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input
                              type="date"
                              value={grp.workDate}
                              onChange={(e) => {
                                const nextDate = e.target.value;
                                setPasteGroups((prev) =>
                                  prev.map((g, i) =>
                                    i === gIdx
                                      ? {
                                          ...g,
                                          workDate: nextDate,
                                          key: `${nextDate}__${g.driverId}`,
                                        }
                                      : g
                                  )
                                );
                              }}
                              className="px-2 py-0.5 rounded-lg border bg-white text-slate-900 text-xs font-black"
                            />
                            {grp.isDriverMatched ? (
                              <span className="font-black text-slate-900 text-sm">
                                {grp.driverName}{' '}
                                <span className="text-xs font-semibold text-slate-500">
                                  ({grp.plateNo})
                                </span>
                              </span>
                            ) : (
                              <select
                                value=""
                                onChange={(e) => {
                                  const drvId = e.target.value;
                                  const drv = userMap[drvId];
                                  if (!drv) return;
                                  const plate =
                                    vehicleMap[drv.assignedVehicleId]?.plateNo ||
                                    '-';
                                  setPasteGroups((prev) =>
                                    prev.map((g, i) =>
                                      i === gIdx
                                        ? {
                                            ...g,
                                            driverId: drv.id,
                                            key: `${g.workDate}__${drv.id}`,
                                            isDriverMatched: true,
                                            driverName: drv.name,
                                            plateNo: plate,
                                            defaultRouteId:
                                              drv.defaultRouteId || 'route_gansen',
                                          }
                                        : g
                                    )
                                  );
                                }}
                                className="px-2 py-1 border border-red-400 rounded-lg bg-red-50 text-xs font-bold text-red-700"
                              >
                                <option value="">
                                  ⚠️ {grp.driverName} 매칭 선택...
                                </option>
                                {activeDrivers.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-black text-[#1E5EFF] mr-1">
                              총 {grp.trips.length}코스 ·{' '}
                              {grp.trips
                                .reduce(
                                  (s, t) => s + (Number(t.supplyAmount) || 0),
                                  0
                                )
                                .toLocaleString()}
                              원
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setPasteGroups((prev) =>
                                  prev.map((g, i) =>
                                    i === gIdx
                                      ? {
                                          ...g,
                                          trips: [
                                            ...g.trips,
                                            makeEmptyTrip(g.trips.length + 1, {
                                              clientName: pasteContractor,
                                              dispatchCategory: pasteCategory,
                                              invoiceType:
                                                pasteCategory === 'fixed_gansen'
                                                  ? 'bundled'
                                                  : 'per_trip',
                                            }),
                                          ],
                                        }
                                      : g
                                  )
                                )
                              }
                              className="px-2 py-1 rounded-lg bg-blue-50 text-[#1E5EFF] hover:bg-blue-100 text-[11px] font-bold"
                            >
                              + 코스 추가
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPasteGroups((prev) =>
                                  prev.filter((_, i) => i !== gIdx)
                                )
                              }
                              className="px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-[11px] font-bold"
                            >
                              🗑️ 이 기사 제외
                            </button>
                          </div>
                        </div>

                        {grp.trips.map((t, tIdx) => (
                          <TripCardEditor
                            key={tIdx}
                            trip={t}
                            idx={tIdx}
                            totalTrips={grp.trips.length}
                            stopsExpanded={Boolean(
                              expandedStopKeys[`paste_${gIdx}_${tIdx}`]
                            )}
                            onToggleStops={() =>
                              toggleStopEditor(`paste_${gIdx}_${tIdx}`)
                            }
                            onUpdateTrip={(nextTrip) =>
                              setPasteGroups((prev) =>
                                prev.map((g, i) =>
                                  i === gIdx
                                    ? {
                                        ...g,
                                        trips: g.trips.map((tr, ti) =>
                                          ti === tIdx ? nextTrip : tr
                                        ),
                                      }
                                    : g
                                )
                              )
                            }
                            onDeleteTrip={() => {
                              setPasteGroups((prev) =>
                                prev.map((g, i) =>
                                  i === gIdx
                                    ? {
                                        ...g,
                                        trips: g.trips
                                          .filter((_, ti) => ti !== tIdx)
                                          .map((tr, n) => ({
                                            ...tr,
                                            tripNo: n + 1,
                                          })),
                                      }
                                    : g
                                )
                              );
                              setExpandedStopKeys({});
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t text-sm">
              <div className="text-xs text-slate-500 font-semibold">
                저장 즉시 세금계산서 대기함(금액 포함)과 기사앱 노선표(금액 제외)에 동시 반영됩니다.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={savingPaste}
                  onClick={() => setPasteModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 font-bold"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={savingPaste || pasteGroups.length === 0}
                  onClick={handleSavePasteGroups}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold disabled:opacity-50"
                >
                  {savingPaste
                    ? '저장 중...'
                    : `✅ ${pasteGroups.length}명 배차 일괄 등록`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
