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
 * [관리자 3] 노선 관리 (Routes)
 * - 기본 4대 노선: (1) 대형차 고정노선, (2) 빽다방, (3) 교촌, (4) B2B(가게 납품)
 * - 빽다방 / 교촌 / B2B 노선은 단가 미정(0원 허용) + 실제 기사 출퇴근 후 찍힌 운행거리(drivenKm)로 자동 산정!
 * ========================================================================== */
export default function RoutesView() {
  const [routes, setRoutes] = useState([]);
  const [logs, setLogs] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [stopInput, setStopInput] = useState('');
  const [stops, setStops] = useState(['물류센터', '가맹점 납품', '복귀']);
  const [price, setPrice] = useState('0');
  const [expectedKm, setExpectedKm] = useState('0');

  const loadRoutes = async () => {
    const [rSnap, lSnap] = await Promise.all([
      getDocs(collection(db, 'Routes')),
      getDocs(collection(db, 'DailyLogs')),
    ]);
    const rList = rSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
    setRoutes(rList);
    setLogs(lSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    loadRoutes();
  }, []);

  const addStopChip = () => {
    if (!stopInput.trim()) return;
    const next = [...stops, stopInput.trim()];
    setStops(next);
    setStopInput('');
  };

  const handleSaveRoute = async (e) => {
    e.preventDefault();
    const finalName = name.trim();
    if (!finalName) {
      alert('노선명을 입력해 주세요.');
      return;
    }
    await addDoc(collection(db, 'Routes'), {
      name: finalName,
      stops,
      price: parseNumberWithoutCommas(price),
      expectedKm: parseNumberWithoutCommas(expectedKm),
      isVariableKm: parseNumberWithoutCommas(expectedKm) === 0,
      kmTolerancePct: 100,
      isActive: true,
      sortOrder: routes.length + 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setName('');
    setPrice('0');
    setExpectedKm('0');
    setShowAddModal(false);
    loadRoutes();
  };

  const handleUpdatePrice = async (r) => {
    const nextPrice = window.prompt(
      `[${r.name}] 노선의 단가(원)를 입력해 주세요 (미정이면 0).\n이미 출근한 기록의 단가는 바뀌지 않고 앞으로 출근하는 기록부터 적용됩니다:`,
      (r.price || 0).toLocaleString('ko-KR')
    );
    if (nextPrice === null) return;
    await setDoc(
      doc(db, 'Routes', r.id),
      { price: parseNumberWithoutCommas(nextPrice), updatedAt: serverTimestamp() },
      { merge: true }
    );
    loadRoutes();
  };

  const handleDeleteRoute = async (r) => {
    if (!window.confirm(`[${r.name}] 노선을 삭제하시겠습니까?`)) return;
    await deleteDoc(doc(db, 'Routes', r.id));
    loadRoutes();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black">노선 관리 (Routes)</h1>
          <p className="text-sm text-slate-500 mt-1">
            대형차 고정노선 외에 <b>빽다방, 교촌, B2B(가게 납품)</b> 노선은 기사가
            출근~퇴근 후 찍힌 <b>실제 운행거리(drivenKm)</b>로 거리가 자동 산정됩니다.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold text-sm shadow whitespace-nowrap"
        >
          + 노선 추가
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm text-left">
            <thead className="bg-slate-50 border-b font-bold">
              <tr>
                <th className="p-3 whitespace-nowrap">노선명</th>
                <th className="p-3 whitespace-nowrap">구분 / 경유지</th>
                <th className="p-3 whitespace-nowrap">단가</th>
                <th className="p-3 whitespace-nowrap">
                  운행거리 (실제 출퇴근 기록 기준 산정)
                </th>
                <th className="p-3 whitespace-nowrap">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {routes.map((r) => {
                // 해당 노선의 완료된 운행 기록들에서 실제 찍힌 운행거리(drivenKm) 추출
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

                const isFixed =
                  r.id === 'route_dj_yi_gj' && r.isVariableKm === false;

                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="p-3 font-black text-base">{r.name}</td>
                    <td className="p-3 text-xs text-slate-600">
                      {(r.stops || []).join(' → ')}
                    </td>
                    <td className="p-3 font-black">
                      {Number(r.price) > 0 ? (
                        <span className="text-[#1E5EFF]">
                          {Number(r.price).toLocaleString()}원
                        </span>
                      ) : (
                        <span className="text-slate-400">미정 (추후 입력)</span>
                      )}
                    </td>
                    <td className="p-3">
                      {isFixed ? (
                        <span className="font-bold">
                          고정 {r.expectedKm}km (±{r.kmTolerancePct || 15}%)
                        </span>
                      ) : latestDrivenKm > 0 ? (
                        <div>
                          <span className="font-black text-emerald-700">
                            최근 실측 {latestDrivenKm.toLocaleString()}km
                          </span>
                          <span className="text-xs text-slate-500 ml-2">
                            (평균 {avgDrivenKm.toLocaleString()}km · 총{' '}
                            {routeLogs.length}회 운행)
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-500 font-semibold">
                          출퇴근 완료 시 실측 거리로 자동 산정
                        </span>
                      )}
                    </td>
                    <td className="p-3 space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => handleUpdatePrice(r)}
                        className="px-3 py-1 rounded-lg border font-bold text-xs hover:bg-slate-50"
                      >
                        단가 입력/변경
                      </button>
                      <button
                        onClick={() => handleDeleteRoute(r)}
                        className="px-3 py-1 rounded-lg border border-red-200 text-red-600 font-bold text-xs hover:bg-red-50"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 노선 추가 모달 */}
      {showAddModal && (
        <div
          onClick={() => setShowAddModal(false)}
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-6 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-xl font-black">신규 노선 추가</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-100 font-bold text-sm"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleSaveRoute} className="space-y-4 text-sm">
              <div>
                <label className="font-bold block mb-1">노선명</label>
                <input
                  placeholder="예: 빽다방, 교촌, B2B (가게 납품)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-xl font-bold"
                />
              </div>

              <div>
                <label className="font-bold block mb-1">경유지 칩</label>
                <div className="flex flex-wrap items-center gap-2 mb-2">
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
                    placeholder="경유지 입력"
                    value={stopInput}
                    onChange={(e) => setStopInput(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={addStopChip}
                    className="px-4 py-2 bg-slate-200 font-bold rounded-xl"
                  >
                    + 추가
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold block mb-1">
                    단가(원) - 미정이면 0
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={price}
                    onChange={(e) => setPrice(formatNumberWithCommas(e.target.value))}
                    placeholder="예: 250,000"
                    className="w-full px-3 py-2 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold block mb-1">
                    예상 거리(km) - 실측산정이면 0
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={expectedKm}
                    onChange={(e) => setExpectedKm(formatNumberWithCommas(e.target.value))}
                    placeholder="예: 180"
                    className="w-full px-3 py-2 border rounded-xl"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 font-bold"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#1E5EFF] text-white font-bold"
                >
                  노선 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
