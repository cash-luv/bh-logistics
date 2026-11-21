import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import KpiCard from '../components/KpiCard';
import {
  formatNumberWithCommas,
  parseNumberWithoutCommas,
} from '../utils/format';

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

function formatBillingDayLabel(billingDay) {
  const d = Number(billingDay) || 31;
  return d >= 31 ? '매월 말일' : `매월 ${d}일`;
}

/* ============================================================================
 * [관리자 6] 거래처 · 노선 · 계약 관리 (Routes)
 * - 기준표(거래처명·사업자번호·월정액 계약금·청구일·간선 기본단가·경유지) 일원화 관리
 * ========================================================================== */
export default function RoutesView() {
  const [routes, setRoutes] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [typeFilter, setTypeFilter] = useState('all'); // all | monthly | variable
  const [searchText, setSearchText] = useState('');

  // 추가/수정 공용 모달 상태
  const [showModal, setShowModal] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState(null);
  const [name, setName] = useState('');
  const [billingType, setBillingType] = useState('monthly');
  const [clientName, setClientName] = useState('');
  const [bizNo, setBizNo] = useState('');
  const [monthlyContractAmount, setMonthlyContractAmount] = useState('0');
  const [billingDay, setBillingDay] = useState(31);
  const [price, setPrice] = useState('0');
  const [expectedKm, setExpectedKm] = useState('0');
  const [stopInput, setStopInput] = useState('');
  const [stops, setStops] = useState(['물류센터', '가맹점 납품', '복귀']);
  const [saving, setSaving] = useState(false);

  const loadRoutes = async () => {
    setLoading(true);
    try {
      const [rSnap, lSnap] = await Promise.all([
        getDocs(collection(db, 'Routes')),
        getDocs(collection(db, 'DailyLogs')),
      ]);
      const rList = rSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
      setRoutes(rList);
      setLogs(lSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoutes();
  }, []);

  const openCreateModal = () => {
    setEditingRouteId(null);
    setName('');
    setBillingType('monthly');
    setClientName('');
    setBizNo('');
    setMonthlyContractAmount('0');
    setBillingDay(31);
    setPrice('0');
    setExpectedKm('0');
    setStops(['물류센터', '가맹점 납품', '복귀']);
    setStopInput('');
    setShowModal(true);
  };

  const openEditModal = (r) => {
    const bType = getRouteBillingType(r);
    setEditingRouteId(r.id);
    setName(r.name || '');
    setBillingType(bType);
    setClientName(r.clientName || r.name || '');
    setBizNo(r.bizNo || '');
    setMonthlyContractAmount(
      formatNumberWithCommas(Number(r.monthlyContractAmount) || 0)
    );
    setBillingDay(Number(r.billingDay) || 31);
    setPrice(formatNumberWithCommas(Number(r.price) || 0));
    setExpectedKm(formatNumberWithCommas(Number(r.expectedKm) || 0));
    setStops(Array.isArray(r.stops) && r.stops.length > 0 ? r.stops : []);
    setStopInput('');
    setShowModal(true);
  };

  const addStopChip = () => {
    if (!stopInput.trim()) return;
    setStops((prev) => [...prev, stopInput.trim()]);
    setStopInput('');
  };

  const handleSaveRoute = async (e) => {
    e.preventDefault();
    const finalName = name.trim();
    if (!finalName) {
      alert('노선명을 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const parsedContract = parseNumberWithoutCommas(monthlyContractAmount);
      const parsedPrice = parseNumberWithoutCommas(price);
      const parsedExpectedKm = parseNumberWithoutCommas(expectedKm);

      const payload = {
        name: finalName,
        stops,
        billingType,
        clientName: clientName.trim() || finalName,
        bizNo: bizNo.trim(),
        monthlyContractAmount: billingType === 'monthly' ? parsedContract : 0,
        billingDay:
          billingType === 'monthly'
            ? Math.min(31, Math.max(1, Number(billingDay) || 31))
            : 31,
        invoiceMode: billingType === 'monthly' ? 'monthly' : 'per_trip',
        price: billingType === 'variable' ? parsedPrice : 0,
        expectedKm: parsedExpectedKm,
        isVariableKm: parsedExpectedKm === 0,
        kmTolerancePct: 100,
        isActive: true,
        updatedAt: serverTimestamp(),
      };

      if (editingRouteId) {
        await setDoc(doc(db, 'Routes', editingRouteId), payload, {
          merge: true,
        });
      } else {
        await addDoc(collection(db, 'Routes'), {
          ...payload,
          sortOrder: routes.length + 1,
          createdAt: serverTimestamp(),
        });
      }
      setShowModal(false);
      await loadRoutes();
    } catch (err) {
      alert(`저장 중 오류가 발생했습니다: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRoute = async (r) => {
    if (
      !window.confirm(
        `[${r.name}] 노선을 삭제하시겠습니까?\n(기존 운행기록은 유지되지만, 신규 배정 목록에서 제외됩니다.)`
      )
    ) {
      return;
    }
    await deleteDoc(doc(db, 'Routes', r.id));
    loadRoutes();
  };

  const { monthlyCount, variableCount, monthlyContractSum, filteredRoutes } =
    useMemo(() => {
      let mCount = 0;
      let vCount = 0;
      let mSum = 0;
      const q = searchText.trim().toLowerCase();

      const enriched = routes.map((r) => {
        const bType = getRouteBillingType(r);
        if (bType === 'monthly') {
          mCount += 1;
          mSum += Number(r.monthlyContractAmount) || 0;
        } else {
          vCount += 1;
        }
        return { ...r, _billingType: bType };
      });

      const filtered = enriched.filter((r) => {
        if (typeFilter !== 'all' && r._billingType !== typeFilter) return false;
        if (!q) return true;
        return (
          (r.name || '').toLowerCase().includes(q) ||
          (r.clientName || '').toLowerCase().includes(q) ||
          (r.bizNo || '').toLowerCase().includes(q)
        );
      });

      return {
        monthlyCount: mCount,
        variableCount: vCount,
        monthlyContractSum: mSum,
        filteredRoutes: filtered,
      };
    }, [routes, typeFilter, searchText]);

  return (
    <div className="space-y-6">
      {/* 상단 타이틀 & 추가 버튼 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">
            거래처 · 노선 · 계약 관리
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            월정액 계약 거래처(청구일·계약금)와 간선(변동형) 노선 기준을 한곳에서 관리합니다. 여기서 설정한 내용이 <b>[7. 매출 · 세금계산서]</b>에 바로 반영됩니다.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="px-5 py-2.5 rounded-xl bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold text-sm shadow whitespace-nowrap"
        >
          + 거래처 · 노선 추가
        </button>
      </div>

      {/* 요약 KPI 3종 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          title="전체 등록 노선 · 거래처"
          value={`${routes.length}개`}
          sub={`월정액 ${monthlyCount}개 · 간선(변동) ${variableCount}개`}
          color="text-slate-900"
        />
        <KpiCard
          title="월정액 거래처 월 계약 합계"
          value={`${monthlyContractSum.toLocaleString()}원`}
          sub="공급가액 기준 (세금계산서 자동 연동)"
          color="text-teal-700"
        />
        <KpiCard
          title="간선(변동형) 노선"
          value={`${variableCount}개`}
          sub="매일 카톡 배차 코스(1~3탕) 단위로 정산"
          color="text-[#1E5EFF]"
        />
      </div>

      {/* 필터 탭 & 검색 바 */}
      <div className="bg-white p-3.5 rounded-2xl border shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
          {[
            { id: 'all', label: `전체 (${routes.length})` },
            { id: 'monthly', label: `🏢 월정액 고정형 (${monthlyCount})` },
            { id: 'variable', label: `🚛 간선 변동형 (${variableCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTypeFilter(tab.id)}
              className={`px-3.5 py-2 rounded-xl border transition ${
                typeFilter === tab.id
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="노선명 · 거래처명 · 사업자번호 검색"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-full sm:w-72 px-3.5 py-2 border rounded-xl text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
      </div>

      {/* 거래처 · 노선 테이블 */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm text-left">
            <thead className="bg-slate-50 border-b font-bold text-xs text-slate-600">
              <tr>
                <th className="p-3.5 whitespace-nowrap">구분</th>
                <th className="p-3.5 whitespace-nowrap">거래처 · 노선명</th>
                <th className="p-3.5 whitespace-nowrap">계약금 / 기본단가</th>
                <th className="p-3.5 whitespace-nowrap">청구 기준일</th>
                <th className="p-3.5 whitespace-nowrap">경유지 · 실측 거리</th>
                <th className="p-3.5 whitespace-nowrap text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan="6" className="p-10 text-center text-slate-400 font-semibold">
                    노선 및 거래처 정보를 불러오는 중...
                  </td>
                </tr>
              ) : filteredRoutes.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-10 text-center text-slate-400 font-semibold">
                    조건에 맞는 거래처 또는 노선이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredRoutes.map((r) => {
                  const isMonthly = r._billingType === 'monthly';
                  const routeLogs = logs.filter(
                    (l) =>
                      (l.routeId === r.id || l.routeName === r.name) &&
                      Number(l.drivenKm) > 0
                  );
                  const latestDrivenKm =
                    routeLogs.length > 0
                      ? Number(routeLogs[0].drivenKm)
                      : Number(r.lastActualKm) || 0;
                  const avgDrivenKm =
                    routeLogs.length > 0
                      ? Math.round(
                          routeLogs.reduce(
                            (s, l) => s + (Number(l.drivenKm) || 0),
                            0
                          ) / routeLogs.length
                        )
                      : 0;

                  const contractAmt = Number(r.monthlyContractAmount) || 0;
                  const unitPrice = Number(r.price) || 0;

                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 whitespace-nowrap">
                        {isMonthly ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-teal-50 text-teal-800 border border-teal-200 text-xs font-black">
                            🏢 월정액 고정
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-blue-50 text-[#1E5EFF] border border-blue-200 text-xs font-black">
                            🚛 간선 변동
                          </span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <div className="font-black text-slate-900 text-base">
                          {r.name}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          청구처: <b className="text-slate-700">{r.clientName || r.name}</b>
                          {r.bizNo ? ` · ${r.bizNo}` : ''}
                        </div>
                      </td>
                      <td className="p-3.5 whitespace-nowrap tabular-nums">
                        {isMonthly ? (
                          contractAmt > 0 ? (
                            <div>
                              <span className="font-black text-teal-700 text-base">
                                월 {contractAmt.toLocaleString()}원
                              </span>
                              <div className="text-[11px] text-slate-400">
                                VAT별도 · 전체 합계
                              </div>
                            </div>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold">
                              계약금액 미입력
                            </span>
                          )
                        ) : unitPrice > 0 ? (
                          <div>
                            <span className="font-black text-[#1E5EFF] text-base">
                              기본 {unitPrice.toLocaleString()}원
                            </span>
                            <div className="text-[11px] text-slate-400">
                              매일 1~3코스 별도 입력 가능
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-slate-500">
                            배차별 변동 운임 (카톡 입력)
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        {isMonthly ? (
                          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-bold text-xs">
                            {formatBillingDayLabel(r.billingDay)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500 font-semibold">
                            건별 / 거래처 묶음
                          </span>
                        )}
                      </td>
                      <td className="p-3.5">
                        {Array.isArray(r.stops) && r.stops.length > 0 && (
                          <div className="text-xs text-slate-600 mb-1 truncate max-w-xs">
                            {r.stops.join(' → ')}
                          </div>
                        )}
                        {r.id === 'route_dj_yi_gj' && r.isVariableKm === false ? (
                          <span className="text-xs font-bold text-slate-700">
                            고정 {r.expectedKm}km (±{r.kmTolerancePct || 15}%)
                          </span>
                        ) : latestDrivenKm > 0 ? (
                          <div className="text-xs">
                            <span className="font-black text-emerald-700">
                              최근 {latestDrivenKm.toLocaleString()}km
                            </span>
                            <span className="text-slate-500 ml-1.5">
                              (평균 {avgDrivenKm.toLocaleString()}km · {routeLogs.length}회)
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">
                            출퇴근 완료 시 실측 거리 자동 산정
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 whitespace-nowrap text-right space-x-1.5">
                        <button
                          onClick={() => openEditModal(r)}
                          className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-sm"
                        >
                          계약 · 단가 수정
                        </button>
                        <button
                          onClick={() => handleDeleteRoute(r)}
                          className="px-3 py-1.5 rounded-xl border border-red-200 text-red-600 font-bold text-xs hover:bg-red-50"
                        >
                          삭제
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

      {/* 거래처 · 노선 추가 / 수정 모달 */}
      {showModal && (
        <div
          onClick={() => !saving && setShowModal(false)}
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto space-y-5 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <div className="text-xs font-bold text-[#1E5EFF]">
                  거래처 · 노선 기준표 설정
                </div>
                <h2 className="text-xl font-black text-slate-900">
                  {editingRouteId ? `[${name}] 계약·노선 수정` : '신규 거래처 · 노선 추가'}
                </h2>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => setShowModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-100 font-bold text-sm"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleSaveRoute} className="space-y-4 text-sm">
              {/* 정산 방식 카드 선택 */}
              <div>
                <label className="font-bold block text-slate-700 mb-1.5">
                  1. 정산 방식 선택
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setBillingType('monthly')}
                    className={`p-3 rounded-xl border text-left transition ${
                      billingType === 'monthly'
                        ? 'border-teal-600 bg-teal-50 ring-1 ring-teal-600'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-black text-slate-900">
                      🏢 월정액 고정형
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      이마트·GS·교촌·빽다방·B2B 등 월 계약 합계
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillingType('variable')}
                    className={`p-3 rounded-xl border text-left transition ${
                      billingType === 'variable'
                        ? 'border-[#1E5EFF] bg-blue-50 ring-1 ring-[#1E5EFF]'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-black text-slate-900">
                      🚛 간선 변동형
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      매일 코스(1~3탕)·용차 콜마다 단가가 다름
                    </div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold block text-slate-700 mb-1">
                    2. 노선명 (앱·배차 표시명)
                  </label>
                  <input
                    placeholder="예: 교촌 - 대전, 간선 운송"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl font-bold"
                  />
                </div>
                <div>
                  <label className="font-bold block text-slate-700 mb-1">
                    3. 세금계산서 거래처명 (상호)
                  </label>
                  <input
                    placeholder="미입력 시 노선명과 동일"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold block text-slate-700 mb-1">
                    4. 사업자등록번호 (선택)
                  </label>
                  <input
                    placeholder="000-00-00000"
                    value={bizNo}
                    onChange={(e) => setBizNo(e.target.value)}
                    className="w-full px-3 py-2.5 border rounded-xl"
                  />
                </div>

                {billingType === 'monthly' ? (
                  <div>
                    <label className="font-bold block text-slate-700 mb-1">
                      5. 세금계산서 청구 기준일
                    </label>
                    <select
                      value={billingDay}
                      onChange={(e) => setBillingDay(Number(e.target.value))}
                      className="w-full px-3 py-2.5 border rounded-xl bg-white font-bold"
                    >
                      <option value={25}>매월 25일</option>
                      <option value={31}>매월 말일</option>
                      <option value={10}>매월 10일</option>
                      <option value={15}>매월 15일</option>
                      <option value={20}>매월 20일</option>
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="font-bold block text-slate-700 mb-1">
                      5. 예상 거리 (km · 실측이면 0)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={expectedKm}
                      onChange={(e) =>
                        setExpectedKm(formatNumberWithCommas(e.target.value))
                      }
                      placeholder="예: 180"
                      className="w-full px-3 py-2.5 border rounded-xl text-right font-bold"
                    />
                  </div>
                )}
              </div>

              {billingType === 'monthly' ? (
                <div className="p-3.5 rounded-xl bg-teal-50/70 border border-teal-200">
                  <label className="font-bold block text-teal-900 mb-1">
                    6. 월 전체 합계 계약금액 (VAT 별도 · 원)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={monthlyContractAmount}
                    onChange={(e) =>
                      setMonthlyContractAmount(
                        formatNumberWithCommas(e.target.value)
                      )
                    }
                    placeholder="예: 12,000,000"
                    className="w-full px-3 py-2.5 border border-teal-300 rounded-xl bg-white text-right font-black text-teal-700 text-base"
                  />
                  <p className="text-[11px] text-teal-800 mt-1">
                    입력하신 금액이 [7. 매출 · 세금계산서]의 월정액 정기 발행 대기 목록에 자동으로 올라갑니다.
                  </p>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200">
                  <label className="font-bold block text-blue-900 mb-1">
                    6. 기본 1회 단가 (VAT 별도 · 매일 다르면 0)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={price}
                    onChange={(e) =>
                      setPrice(formatNumberWithCommas(e.target.value))
                    }
                    placeholder="예: 0 (매일 카톡 배차 등록 시 입력)"
                    className="w-full px-3 py-2.5 border border-blue-300 rounded-xl bg-white text-right font-black text-[#1E5EFF] text-base"
                  />
                </div>
              )}

              <div>
                <label className="font-bold block text-slate-700 mb-1">
                  7. 경유지 칩
                </label>
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {stops.map((s, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center gap-1.5"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() =>
                          setStops(stops.filter((_, i) => i !== idx))
                        }
                        className="text-slate-400 hover:text-white"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    placeholder="경유지 추가 (예: 곤지암)"
                    value={stopInput}
                    onChange={(e) => setStopInput(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={addStopChip}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 font-bold rounded-xl"
                  >
                    + 추가
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold disabled:opacity-50"
                >
                  {saving
                    ? '저장 중...'
                    : editingRouteId
                      ? '계약 · 노선 수정 저장'
                      : '신규 노선 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
