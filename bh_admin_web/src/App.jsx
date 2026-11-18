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
import { auth, db, storage, secondaryAuth } from './firebase';
import { calcDday, formatKstTime, todayKstStr } from './utils/format';
import { exportMonthlySettlementExcel } from './utils/excel';
import { seedSampleData } from './services/seedService';
import {
  parseVehicleExcel,
  importVehicles,
  importDriversFromRows,
  deleteAllVehicles,
} from './services/vehicleImport';
import { syncMasterDataAndRoutes } from './services/masterDataService';
import AttendanceView from './pages/AttendanceView';

const CHART_COLORS = ['#1E5EFF', '#00796B', '#F59E0B', '#6366F1', '#EC4899'];

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // 6개 메뉴: dashboard | logs | vehicles | drivers | routes | settlements
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [vehiclePresetFilter, setVehiclePresetFilter] = useState('all');
  const [logPresetDriverId, setLogPresetDriverId] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setLoadingAuth(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'Users', u.uid));
        setProfile(snap.exists() ? snap.data() : null);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingAuth(false);
      }
    });
    return () => unsub();
  }, []);

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-lg font-bold text-slate-600">
        관리자 시스템 불러오는 중...
      </div>
    );
  }

  // [관리자 2] role === 'admin' && isActive !== false 확인
  if (!user || !profile || profile.role !== 'admin' || profile.isActive === false) {
    return (
      <AdminLoginScreen
        currentUser={user}
        currentProfile={profile}
        onAdminCreated={(newProfile) => setProfile(newProfile)}
      />
    );
  }

  const openVehicleDetail = (vehId) => {
    setSelectedVehicleId(vehId);
    setActiveTab('vehicles');
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-100 overflow-x-hidden">
      {/* [관리자 2] 반응형 사이드바 (창이 좁을 때는 상단 메뉴, 넓을 때는 왼쪽 고정) */}
      <aside className="w-full lg:w-64 bg-slate-900 text-white flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800">
          <div className="text-2xl font-black tracking-tight text-sky-400">
            BH로지스틱스
          </div>
          <div className="text-xs text-slate-400 mt-1">
            본사 통합 배차 · 운행 · 정산 시스템
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1.5">
          <NavItem
            label="1. 종합 KPI 대시보드"
            active={activeTab === 'dashboard'}
            onClick={() => {
              setSelectedVehicleId(null);
              setActiveTab('dashboard');
            }}
          />
          <NavItem
            label="2. 기사별 출근표 · 휴무"
            active={activeTab === 'attendance'}
            onClick={() => {
              setSelectedVehicleId(null);
              setActiveTab('attendance');
            }}
          />
          <NavItem
            label="3. 운행 기록 (DailyLogs)"
            active={activeTab === 'logs'}
            onClick={() => {
              setSelectedVehicleId(null);
              setActiveTab('logs');
            }}
          />
          <NavItem
            label="4. 차량 · 공차 · 정비"
            active={activeTab === 'vehicles'}
            onClick={() => {
              setSelectedVehicleId(null);
              setActiveTab('vehicles');
            }}
          />
          <NavItem
            label="5. 기사 관리 · 배정"
            active={activeTab === 'drivers'}
            onClick={() => {
              setSelectedVehicleId(null);
              setActiveTab('drivers');
            }}
          />
          <NavItem
            label="6. 노선 · 단가 관리"
            active={activeTab === 'routes'}
            onClick={() => {
              setSelectedVehicleId(null);
              setActiveTab('routes');
            }}
          />
          <NavItem
            label="7. 월 결산 · 차트 · 마감"
            active={activeTab === 'settlements'}
            onClick={() => {
              setSelectedVehicleId(null);
              setActiveTab('settlements');
            }}
          />
        </nav>

        <div className="p-4 border-t border-slate-800 text-sm">
          <div className="font-bold">{profile.name || '관리자'}님</div>
          <div className="text-slate-400 text-xs truncate">{user.email}</div>
          <button
            onClick={() => signOut(auth)}
            className="mt-3 w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* 오른쪽 메인 영역 */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
        {activeTab === 'dashboard' && (
          <DashboardView
            onNavigateVehicles={(filter) => {
              setSelectedVehicleId(null);
              setVehiclePresetFilter(filter);
              setActiveTab('vehicles');
            }}
            onOpenVehicleDetail={openVehicleDetail}
            onNavigateLogs={() => setActiveTab('logs')}
          />
        )}
        {activeTab === 'attendance' && <AttendanceView />}
        {activeTab === 'logs' && (
          <DailyLogsView
            adminUid={user.uid}
            presetDriverId={logPresetDriverId}
            onClearPresetDriver={() => setLogPresetDriverId('')}
          />
        )}
        {activeTab === 'vehicles' &&
          (selectedVehicleId ? (
            <VehicleDetailView
              vehicleId={selectedVehicleId}
              adminUid={user.uid}
              onBack={() => setSelectedVehicleId(null)}
            />
          ) : (
            <VehiclesView
              presetFilter={vehiclePresetFilter}
              onSelectVehicle={(id) => setSelectedVehicleId(id)}
            />
          ))}
        {activeTab === 'drivers' && <DriversView />}
        {activeTab === 'routes' && <RoutesView />}
        {activeTab === 'settlements' && (
          <SettlementsView
            adminUid={user.uid}
            onSelectDriverLogs={(driverId) => {
              setLogPresetDriverId(driverId);
              setActiveTab('logs');
            }}
          />
        )}
      </main>
    </div>
  );
}

function NavItem({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl font-bold transition ${
        active
          ? 'bg-[#1E5EFF] text-white shadow'
          : 'text-slate-300 hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  );
}

/* ============================================================================
 * 공통: GPS 이동 타임라인 빨간 선(Polyline) 지도 컴포넌트 (Leaflet 기반)
 * ========================================================================== */
function RoutePolylineMap({ points }) {
  const mapContainerRef = React.useRef(null);
  const mapInstanceRef = React.useRef(null);

  useEffect(() => {
    const L = window.L;
    if (!L || !mapContainerRef.current) return;

    const validPts = (points || []).filter(
      (p) =>
        p &&
        typeof Number(p.lat) === 'number' &&
        !isNaN(Number(p.lat)) &&
        typeof Number(p.lng) === 'number' &&
        !isNaN(Number(p.lng))
    );

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    if (validPts.length === 0) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
    });
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(map);

    const latLngs = validPts.map((p) => [Number(p.lat), Number(p.lng)]);

    // 이동 경로를 굵은 빨간 선(#EF4444)으로 이어서 표시
    const polyline = L.polyline(latLngs, {
      color: '#EF4444',
      weight: 5,
      opacity: 0.9,
    }).addTo(map);

    // 출발 · 경유 · 도착 지점마다 원형 마커와 팝업 말풍선 표시
    validPts.forEach((pt, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === validPts.length - 1 && validPts.length > 1;
      const markerColor = isStart
        ? '#10B981'
        : isEnd
        ? '#1E5EFF'
        : '#EF4444';

      const marker = L.circleMarker([Number(pt.lat), Number(pt.lng)], {
        radius: isStart || isEnd ? 8 : 6,
        fillColor: markerColor,
        color: '#FFFFFF',
        weight: 2.5,
        fillOpacity: 1,
      }).addTo(map);

      marker.bindPopup(
        `<div style="font-size:12px;line-height:1.4">
          <b>[${pt.time || '-'} · ${pt.type || '이동'}]</b><br/>
          📍 ${pt.address || '위치 정보'}<br/>
          누적 거리: <b>${pt.cumKm ?? 0}km</b>
        </div>`
      );
    });

    if (latLngs.length === 1) {
      map.setView(latLngs[0], 15);
    } else {
      map.fitBounds(polyline.getBounds(), { padding: [28, 28] });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [points]);

  return (
    <div
      ref={mapContainerRef}
      className="w-full h-64 rounded-xl border border-indigo-200 overflow-hidden bg-slate-100 z-0"
    />
  );
}

/* ============================================================================
 * 공통: 시·구·동 주소 + 상세 지도 팝업 모달
 * ========================================================================== */
function LocationDetailModal({ info, onClose }) {
  if (!info) return null;
  const { title, address, lat, lng, subtitle } = info;
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  const googleEmbedUrl = hasCoords
    ? `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`
    : null;
  const googleLinkUrl = hasCoords
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : null;
  const naverMapUrl = hasCoords
    ? `https://map.naver.com/p/search/${encodeURIComponent(
        address || `${lat},${lng}`
      )}`
    : null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-6 z-50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl p-6 max-w-2xl w-full space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-bold text-[#1E5EFF]">{subtitle}</div>
            <h3 className="text-xl font-black mt-0.5">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-sm"
          >
            닫기
          </button>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
          <div className="text-base font-bold text-slate-900">
            📍 {address || '주소 정보 없음'}
          </div>
          {hasCoords && (
            <div className="text-xs text-slate-500">
              위도·경도 좌표: {lat.toFixed(6)}, {lng.toFixed(6)}
            </div>
          )}
        </div>

        {googleEmbedUrl && (
          <div className="rounded-xl overflow-hidden border border-slate-200 h-80">
            <iframe
              title="상세 위치 지도"
              src={googleEmbedUrl}
              className="w-full h-full border-0"
              loading="lazy"
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          {googleLinkUrl && (
            <a
              href={googleLinkUrl}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2.5 rounded-xl bg-[#1E5EFF] text-white font-bold text-sm"
            >
              구글 지도에서 보기 ↗
            </a>
          )}
          {naverMapUrl && (
            <a
              href={naverMapUrl}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm"
            >
              네이버 지도에서 보기 ↗
            </a>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * [관리자 2] 로그인 화면 (role === 'admin' && isActive === true 확인)
 * ========================================================================== */
function AdminLoginScreen({ currentUser, currentProfile, onAdminCreated }) {
  const [email, setEmail] = useState('admin@bhlogistics.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const cleanEmail = email.includes('@')
        ? email.trim()
        : `${email.trim()}@bhlogistics.local`;
      await signInWithEmailAndPassword(auth, cleanEmail, password);
    } catch (_) {
      setError('이메일 또는 비밀번호가 틀렸어요. 다시 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const handleInitAdmin = async () => {
    setError('');
    setBusy(true);
    try {
      const cleanEmail = email.includes('@')
        ? email.trim()
        : `${email.trim()}@bhlogistics.local`;
      let uid = currentUser?.uid;
      if (!uid) {
        if (!password || password.length < 6) {
          setError('비밀번호를 6자리 이상 입력한 뒤 눌러 주세요.');
          setBusy(false);
          return;
        }
        try {
          const cred = await createUserWithEmailAndPassword(
            auth,
            cleanEmail,
            password
          );
          uid = cred.user.uid;
        } catch (_) {
          const cred = await signInWithEmailAndPassword(
            auth,
            cleanEmail,
            password
          );
          uid = cred.user.uid;
        }
      }
      const adminDoc = {
        role: 'admin',
        name: '총괄 관리자',
        phone: '010-0000-0000',
        isActive: true,
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'Users', uid), adminDoc, { merge: true });
      onAdminCreated(adminDoc);
    } catch (err) {
      setError(`관리자 등록 실패: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <div className="text-2xl font-black text-[#1E5EFF]">BH로지스틱스</div>
        <h1 className="text-2xl font-bold mt-1">관리자 웹 로그인</h1>
        <p className="text-sm text-slate-500 mt-1">
          관리자만 사용할 수 있어요 (Users.role === &apos;admin&apos;).
        </p>

        {currentUser && currentProfile?.role !== 'admin' && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 text-sm font-semibold">
            관리자만 사용할 수 있어요. 아래 [관리자로 승격]을 누르거나 다른 계정으로
            로그인해 주세요.
          </div>
        )}

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700">
              관리자 이메일 (또는 아이디)
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full px-4 py-3 rounded-xl border border-slate-300 font-semibold"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700">
              비밀번호
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full px-4 py-3 rounded-xl border border-slate-300 font-semibold"
              placeholder="6자리 이상 입력"
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 text-red-600 text-sm font-bold">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-xl bg-[#1E5EFF] hover:bg-blue-700 text-white font-bold text-lg"
          >
            {busy ? '확인 중...' : '로그인'}
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-200 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleInitAdmin}
            disabled={busy}
            className="w-full py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-sm"
          >
            처음 접속: 위 이메일/비밀번호로 관리자(admin) 계정 바로 만들기
          </button>
          {currentUser && (
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="w-full py-2 text-xs text-slate-500 underline"
            >
              현재 계정 로그아웃
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * [관리자 7] 종합 KPI 대시보드
 * - 위쪽 카드 4개(총매출, 운행중, 공차/대기, 정비필요) + 주유비/비업무주행 카드
 * - 아래쪽: (1) 검사 임박·초과 차량 목록, (2) 오늘 출근 현황, (3) 오늘 아직 출근 안 한 기사 목록
 * ========================================================================== */
function DashboardView({
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
  const [seeding, setSeeding] = useState(false);

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

  const handleSeedDummyData = async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      await seedSampleData(yearMonth);
      await loadData();
      alert('샘플 더미데이터가 모두 생성되었습니다!');
    } catch (e) {
      alert('더미데이터 생성 실패: ' + e.message);
    } finally {
      setSeeding(false);
    }
  };

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
            <div className="space-y-2.5">
              {inspectionDueVehicles.map((v) => (
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
              ))}
            </div>
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
            <div className="space-y-2.5">
              {todayLogs.map((l) => (
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
              ))}
            </div>
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
            <div className="space-y-2.5">
              {notCheckedInDrivers.map((d) => (
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, sub, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 w-full text-left bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200 hover:border-[#1E5EFF] transition overflow-hidden"
    >
      <div className="text-xs font-bold text-slate-500 truncate">{title}</div>
      <div className={`text-lg sm:text-xl xl:text-2xl font-black mt-1.5 truncate ${color}`}>
        {value}
      </div>
      <div className="text-xs text-slate-400 mt-1 truncate">{sub}</div>
    </button>
  );
}

/* ============================================================================
 * [관리자 8] 운행 기록 (DailyLogs)
 * - 필터: 월, 기사, 차량, 상태, 점검 이상만, 거리 이상만, 퇴근 누락만
 * - 오른쪽 상세 슬라이드 패널: 출근 사진 3장 + 퇴근 사진 + 체크리스트 + 퇴근 위치(시구동 + 상세 지도)
 * - 관리자 보정: 퇴근 누락 보정(completed 전환) + void(무효 처리 및 사유 기록)
 * ========================================================================== */
function DailyLogsView({ adminUid, presetDriverId, onClearPresetDriver }) {
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

  const [selectedLog, setSelectedLog] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [locationModal, setLocationModal] = useState(null);

  // 보정용 입력 상태
  const [fixEndKm, setFixEndKm] = useState('');
  const [voidReason, setVoidReason] = useState('');

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
    const endKm = Number(fixEndKm);
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
                      {points.map((pt, idx) => (
                      <div
                        key={idx}
                        className="bg-white p-2.5 rounded-xl border border-indigo-100 flex items-center justify-between gap-2"
                      >
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
                                subtitle: `${selectedLog.workDate} · ${
                                  pt.time || ''
                                } (${pt.type || '경유'})`,
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
                    ))}
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
                    type="number"
                    value={fixEndKm}
                    onChange={(e) => setFixEndKm(e.target.value)}
                    placeholder="종료 주행거리 km"
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

/* ============================================================================
 * [관리자 4 & 6] 차량 목록 + 필터 + D-Day + 기사↔차량 트랜잭션 배정
 * ========================================================================== */
/* ============================================================================
 * 양방향 기사 ↔ 차량 배정 동기화 트랜잭션 헬퍼
 * - 모든 Firestore 읽기(tx.get)를 먼저 수행한 뒤 쓰기(tx.set)를 실행하여 트랜잭션 오류를 방지합니다.
 * ========================================================================== */
async function syncVehicleDriverTx({ vehicleId, driverId }) {
  await runTransaction(db, async (tx) => {
    const vehRef = doc(db, 'Vehicles', vehicleId);
    const vehSnap = await tx.get(vehRef);
    const currentVeh = vehSnap.data() || {};

    let newDriver = null;
    const newDriverRef = driverId ? doc(db, 'Users', driverId) : null;
    if (newDriverRef) {
      const newDriverSnap = await tx.get(newDriverRef);
      newDriver = newDriverSnap.data() || {};
    }

    // 1) 이 차량에 기존 배정된 다른 기사가 있었다면 해제
    if (
      currentVeh.assignedDriverId &&
      currentVeh.assignedDriverId !== driverId
    ) {
      tx.set(
        doc(db, 'Users', currentVeh.assignedDriverId),
        { assignedVehicleId: null, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }

    // 2) 공차(배정 해제)인 경우
    if (!driverId || !newDriverRef) {
      tx.set(
        vehRef,
        {
          assignedDriverId: null,
          assignedDriverName: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    // 3) 새로 선택한 기사가 기존에 다른 차량을 타고 있었다면 그 차량을 공차로 전환
    if (
      newDriver?.assignedVehicleId &&
      newDriver.assignedVehicleId !== vehicleId
    ) {
      tx.set(
        doc(db, 'Vehicles', newDriver.assignedVehicleId),
        {
          assignedDriverId: null,
          assignedDriverName: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    // 4) 새 기사 ↔ 차량 양방향 연결
    tx.set(
      newDriverRef,
      { assignedVehicleId: vehicleId, updatedAt: serverTimestamp() },
      { merge: true }
    );
    tx.set(
      vehRef,
      {
        assignedDriverId: driverId,
        assignedDriverName: newDriver?.name || '',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

async function syncDriverVehicleTx({ driverId, vehicleId }) {
  await runTransaction(db, async (tx) => {
    const driverRef = doc(db, 'Users', driverId);
    const driverSnap = await tx.get(driverRef);
    const currentDriver = driverSnap.data() || {};

    let newVeh = null;
    const newVehRef = vehicleId ? doc(db, 'Vehicles', vehicleId) : null;
    if (newVehRef) {
      const newVehSnap = await tx.get(newVehRef);
      newVeh = newVehSnap.data() || {};
    }

    // 1) 이 기사가 기존에 배정받았던 다른 차량이 있었다면 공차로 해제
    if (
      currentDriver.assignedVehicleId &&
      currentDriver.assignedVehicleId !== vehicleId
    ) {
      tx.set(
        doc(db, 'Vehicles', currentDriver.assignedVehicleId),
        {
          assignedDriverId: null,
          assignedDriverName: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    // 2) 차량 미배정 선택 시
    if (!vehicleId || !newVehRef) {
      tx.set(
        driverRef,
        { assignedVehicleId: null, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return;
    }

    // 3) 새로 선택한 차량에 기존 기사가 있었다면 그 기사의 차량 배정 해제
    if (newVeh?.assignedDriverId && newVeh.assignedDriverId !== driverId) {
      tx.set(
        doc(db, 'Users', newVeh.assignedDriverId),
        { assignedVehicleId: null, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }

    // 4) 기사 ↔ 새 차량 양방향 연결
    tx.set(
      driverRef,
      { assignedVehicleId: vehicleId, updatedAt: serverTimestamp() },
      { merge: true }
    );
    tx.set(
      newVehRef,
      {
        assignedDriverId: driverId,
        assignedDriverName: currentDriver.name || '',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

/* ============================================================================
 * 공통 페이지네이션 컴포넌트 (10개씩 보기)
 * ========================================================================== */
function Pagination({
  currentPage,
  totalPages,
  totalCount,
  pageSize = 10,
  onPageChange,
}) {
  if (totalCount === 0) return null;
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalCount);

  let pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    if (currentPage <= 4) {
      pages = [1, 2, 3, 4, 5, '...', totalPages];
    } else if (currentPage >= totalPages - 3) {
      pages = [
        1,
        '...',
        totalPages - 4,
        totalPages - 3,
        totalPages - 2,
        totalPages - 1,
        totalPages,
      ];
    } else {
      pages = [
        1,
        '...',
        currentPage - 1,
        currentPage,
        currentPage + 1,
        '...',
        totalPages,
      ];
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/80 border-t text-sm">
      <div className="text-slate-500 font-semibold text-xs">
        전체 <b className="text-slate-900">{totalCount.toLocaleString()}</b>건 중{' '}
        <b className="text-slate-900">
          {startItem}~{endItem}
        </b>{' '}
        표시 (페이지 {currentPage} / {totalPages})
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="px-2.5 py-1 rounded-lg border bg-white font-bold text-xs hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ‹ 이전
        </button>
        {pages.map((p, idx) =>
          p === '...' ? (
            <span
              key={`ellipsis-${idx}`}
              className="px-1 text-slate-400 font-bold text-xs"
            >
              ...
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-[32px] h-8 px-2 rounded-lg font-bold text-xs ${
                currentPage === p
                  ? 'bg-[#1E5EFF] text-white shadow'
                  : 'border bg-white hover:bg-slate-100 text-slate-700'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="px-2.5 py-1 rounded-lg border bg-white font-bold text-xs hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          다음 ›
        </button>
      </div>
    </div>
  );
}

function VehiclesView({ presetFilter, onSelectVehicle }) {
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

  useEffect(() => {
    loadAll();
  }, []);

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
    setOdometerKm(String(v.odometerKm ?? 0));
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
          odometerKm: Math.max(0, Number(odometerKm) || 0),
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
            odometerKm: Math.max(0, Number(odometerKm) || 0),
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
                    type="number"
                    placeholder="예: 125000"
                    value={odometerKm}
                    onChange={(e) => setOdometerKm(e.target.value)}
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

/* ============================================================================
 * [관리자 9] 차량 상세 화면 (검사 완료 처리, 주차 위치 이름 수정, 정비 이력 planned/done, 최근 운행 10건)
 * ========================================================================== */
function VehicleDetailView({ vehicleId, adminUid, onBack }) {
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
      dueOdometerKm: dueOdometerKm ? Number(dueOdometerKm) : null,
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
            type="number"
            placeholder="다음 교체 주행거리 km (선택)"
            value={dueOdometerKm}
            onChange={(e) => setDueOdometerKm(e.target.value)}
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

/* ============================================================================
 * [관리자 5] 기사 관리 (Users) - [+ 신규 기사 생성] 버튼 클릭 시 모달 창 오픈
 * ========================================================================== */
function DriversView() {
  const [drivers, setDrivers] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDriver, setEditingDriver] = useState(null);
  const [searchDriver, setSearchDriver] = useState('');
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);

  const [driverCode, setDriverCode] = useState('');
  const [birthPin, setBirthPin] = useState('');
  const [driverName, setDriverName] = useState('');
  const [phone, setPhone] = useState('');
  const [hireDate, setHireDate] = useState(todayKstStr());
  const [defaultRouteId, setDefaultRouteId] = useState('');
  const [assignedVehicleId, setAssignedVehicleId] = useState('');
  const [msg, setMsg] = useState('');

  // 기사앱 버전 배포 알림 설정 상태 (Settings/appVersion)
  const [latestAppVersion, setLatestAppVersion] = useState('1.0.2');
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

  const handleSyncMaster = async () => {
    if (
      !window.confirm(
        '김병훈 대표님 코드를 [bh-ceo], 정태광 기사님 코드를 [bh-tk]로 설정하고, 모든 기사 코드를 [bh01~]로 순차 재부여하며, 15개 표준 노선 등록 및 차량별 노선 자동 부여를 일괄 실행하시겠습니까?\n\n- 중복 기사 코드가 깔끔하게 정리됩니다.\n- 정태광 기사님은 대표님 바로 아래에 배치됩니다.\n- 차량과 기사, 노선이 자동으로 양방향 매칭됩니다.'
      )
    ) {
      return;
    }
    setSyncing(true);
    try {
      const res = await syncMasterDataAndRoutes();
      alert(
        `✅ 마스터 데이터 일괄 정리가 완료되었습니다!\n\n` +
          `• 등록/갱신된 표준 노선: ${res.routesCount}개\n` +
          `• 정리/부여된 기사 수: ${res.driversProcessed}명 (김병훈: bh-ceo / 정태광: bh-tk / 기사: bh01~)\n` +
          `• 노선 부여된 차량 수: ${res.vehiclesProcessed}대\n` +
          (res.cleanedDuplicatesCount ? `• 정리된 중복 계정: ${res.cleanedDuplicatesCount}개\n` : '')
      );
      await loadAll();
    } catch (err) {
      alert('마스터 데이터 정리 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setSyncing(false);
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

/* ============================================================================
 * [관리자 3] 노선 관리 (Routes)
 * - 기본 4대 노선: (1) 대형차 고정노선, (2) 빽다방, (3) 교촌, (4) B2B(가게 납품)
 * - 빽다방 / 교촌 / B2B 노선은 단가 미정(0원 허용) + 실제 기사 출퇴근 후 찍힌 운행거리(drivenKm)로 자동 산정!
 * ========================================================================== */
function RoutesView() {
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

  // 15개 사업소 표준 노선 전체 등록 및 차량 자동 연동
  const handleResetToStandardRoutes = async () => {
    if (
      !window.confirm(
        '15개 사업소 표준 노선(이마트 상온/저온, GS저온, CU, 교촌-대전/전북, 빽다방, B2B, 조인, 유해화학물, 쿠팡, 대전집배점, 간선, 기업물류, 대형고정)을 일괄 등록하고 차량별 노선을 자동 연동하시겠습니까?'
      )
    ) {
      return;
    }
    try {
      const res = await syncMasterDataAndRoutes();
      alert(
        `✅ 15개 표준 노선 등록 및 차량 연동이 완료되었습니다!\n\n` +
          `• 등록/최신화된 표준 노선: ${res.routesCount}개\n` +
          `• 노선 부여된 차량: ${res.vehiclesProcessed}대\n` +
          `• 정리된 기사: ${res.driversProcessed}명`
      );
      await loadRoutes();
    } catch (err) {
      alert('노선 일괄 등록 중 오류가 발생했습니다: ' + err.message);
    }
  };

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
      price: Number(price) || 0,
      expectedKm: Number(expectedKm) || 0,
      isVariableKm: Number(expectedKm) === 0,
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
      String(r.price || 0)
    );
    if (nextPrice === null) return;
    await setDoc(
      doc(db, 'Routes', r.id),
      { price: Number(nextPrice) || 0, updatedAt: serverTimestamp() },
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
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold block mb-1">
                    예상 거리(km) - 실측산정이면 0
                  </label>
                  <input
                    type="number"
                    value={expectedKm}
                    onChange={(e) => setExpectedKm(e.target.value)}
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

/* ============================================================================
 * [관리자 10 & 11] 월 결산 + Recharts 시각화 차트 3종 + 마감(Settlements) + ExcelJS 다운로드
 * ========================================================================== */
function SettlementsView({ adminUid, onSelectDriverLogs }) {
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
            type="number"
            value={dieselPrice}
            onChange={(e) => setDieselPrice(Number(e.target.value) || 0)}
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
