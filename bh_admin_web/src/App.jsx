import React, { Suspense, lazy, useEffect, useState } from 'react';
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
import { auth, db, storage, secondaryAuth } from './firebase';
import {
  calcDday,
  formatKstTime,
  todayKstStr,
  formatNumberWithCommas,
  parseNumberWithoutCommas,
} from './utils/format';
import DashboardView from './pages/DashboardView';
const AttendanceView = lazy(() => import('./pages/AttendanceView'));
const DailyLogsView = lazy(() => import('./pages/DailyLogsView'));
const VehiclesView = lazy(() => import('./pages/VehiclesView'));
const VehicleDetailView = lazy(() => import('./pages/VehicleDetailView'));
const DriversView = lazy(() => import('./pages/DriversView'));
const RoutesView = lazy(() => import('./pages/RoutesView'));
const SettlementsView = lazy(() => import('./pages/SettlementsView'));


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
        <Suspense fallback={<div className="text-sm text-slate-400 p-6">불러오는 중...</div>}>
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
        </Suspense>
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
