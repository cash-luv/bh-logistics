import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import 'firebase_options.dart';
import 'models/driver_home_info.dart';
import 'screens/app_version_label.dart';
import 'screens/change_password_screen.dart';
import 'screens/check_in_screen.dart';
import 'screens/check_out_screen.dart';
import 'screens/driver_home_screen.dart';
import 'screens/fuel_log_screen.dart';
import 'screens/login_screen.dart';
import 'screens/required_permission_screen.dart';
import 'services/app_update_service.dart';
import 'services/auth_service.dart';
import 'services/draft_storage.dart';
import 'services/firestore_service.dart';
import 'services/gps_tracker_service.dart';
import 'services/offline_photo_queue.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await DraftStorage.init();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  runApp(const BhDriverApp());
}

class BhDriverApp extends StatelessWidget {
  const BhDriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BH 기사앱',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      // 휴대폰 기종(소형~대화면) 및 어르신들의 시스템 글자 크기 확대(최대 200%) 설정에서도
      // 글자가 영역 밖으로 터지지 않도록 배율을 1.0~1.2배 사이로 안전하게 고정하고
      // 대화면(폴드/태블릿)에서는 가운데 정렬로 깔끔하게 맞춥니다.
      builder: (context, child) {
        final media = MediaQuery.of(context);
        return MediaQuery(
          data: media.copyWith(
            textScaler: media.textScaler.clamp(
              minScaleFactor: 1.0,
              maxScaleFactor: 1.2,
            ),
          ),
          child: ColoredBox(
            color: AppColors.background,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 600),
                child: child ?? const SizedBox.shrink(),
              ),
            ),
          ),
        );
      },
      home: const _AuthGate(),
    );
  }
}

/// 화면 전환을 기다리지 않고 즉시 넘어가도록 만든 빠른 라우트입니다.
PageRoute<T> _fastRoute<T>(Widget page) {
  return PageRouteBuilder<T>(
    pageBuilder: (_, _, _) => page,
    transitionDuration: const Duration(milliseconds: 120),
    reverseTransitionDuration: const Duration(milliseconds: 100),
    transitionsBuilder: (_, animation, _, child) {
      return FadeTransition(opacity: animation, child: child);
    },
  );
}

/// 앱 시작 및 데이터 로딩 중에 화면 가운데에 고화질 BH Logistics 로고를 크게 보여주는 화면입니다.
class _BrandLoadingScreen extends StatelessWidget {
  const _BrandLoadingScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Image.asset(
                  'assets/icon/splash_logo.png',
                  width: 320,
                  fit: BoxFit.contain,
                ),
                const SizedBox(height: 36),
                const SizedBox(
                  width: 36,
                  height: 36,
                  child: CircularProgressIndicator(
                    strokeWidth: 3.5,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  '운행 정보를 불러오는 중...',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: AppColors.subText,
                  ),
                ),
                const SizedBox(height: 12),
                const AppVersionLabel(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: AuthService.authStateChanges,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const _BrandLoadingScreen();
        }
        final user = snapshot.data;
        if (user == null) {
          return const LoginScreen();
        }
        return _AuthenticatedHome(uid: user.uid);
      },
    );
  }
}

class _AuthenticatedHome extends StatefulWidget {
  const _AuthenticatedHome({required this.uid});

  final String uid;

  @override
  State<_AuthenticatedHome> createState() => _AuthenticatedHomeState();
}

class _AuthenticatedHomeState extends State<_AuthenticatedHome>
    with WidgetsBindingObserver {
  static String? _cachedUid;
  static DriverHomeInfo? _cachedInfo;

  bool _isLoading = true;
  bool _showInitialPasswordPrompt = false;
  int _pendingPhotoCount = 0;
  Map<String, bool>? _permStatus;

  bool get _hasAllRequiredPermissions {
    if (!Platform.isAndroid) return true;
    final status = _permStatus;
    if (status == null) return false;
    return status['gpsEnabled'] == true &&
        status['fineLocationGranted'] == true &&
        status['batteryUnrestricted'] == true &&
        status['notificationGranted'] == true;
  }

  Future<void> _refreshPermissions({bool promptUpdateIfUnlocked = false}) async {
    if (!Platform.isAndroid) return;
    final wasUnlocked = _hasAllRequiredPermissions;
    final status = await GpsTrackerService.checkRequiredPermissions();
    if (!mounted) return;
    setState(() {
      _permStatus = status;
    });
    if (_hasAllRequiredPermissions) {
      if (_info?.status == WorkStatus.working) {
        GpsTrackerService.startTrackingForToday(
          FirestoreService.todayWorkDate(),
        );
      }
      if (!wasUnlocked && promptUpdateIfUnlocked && !_showInitialPasswordPrompt) {
        AppUpdateService.checkAndPromptUpdate(context);
      }
    }
  }

  DriverHomeInfo? get _info => _cachedInfo;
  set _info(DriverHomeInfo? val) => _cachedInfo = val;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initProfileAndRestoreCamera();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// 앱이 다시 화면 앞으로 올라올 때마다 오프라인 사진 대기열 및 필수 권한을 확인합니다.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _flushOfflinePhotos();
      _refreshPermissions(promptUpdateIfUnlocked: true);
      // 앱으로 돌아올 때마다 새 버전이 있는지 확인합니다.
      if (_hasAllRequiredPermissions && !_showInitialPasswordPrompt && mounted) {
        AppUpdateService.checkAndPromptUpdate(context);
      }
    }
  }

  Future<void> _flushOfflinePhotos() async {
    final remaining = await OfflinePhotoQueue.flushQueue();
    if (!mounted) return;
    setState(() {
      _pendingPhotoCount = remaining;
    });
  }

  Future<void> _initProfileAndRestoreCamera() async {
    final perms = await GpsTrackerService.checkRequiredPermissions();
    _permStatus = perms;

    if (_cachedUid != widget.uid || _cachedInfo == null) {
      try {
        final (session, baseInfo) =
            await AuthService.loadDriverProfile(widget.uid);
        final restoredInfo = await FirestoreService.restoreTodayStatus(
          driverId: widget.uid,
          baseInfo: baseInfo,
        );
        _cachedUid = widget.uid;
        _cachedInfo = restoredInfo;
        _showInitialPasswordPrompt = session.mustChangePassword;
      } catch (_) {
        _cachedUid = widget.uid;
        _cachedInfo = const DriverHomeInfo(
          driverName: '기사',
          status: WorkStatus.beforeWork,
        );
      }
    }

    final pending = await OfflinePhotoQueue.pendingCount();
    if (!mounted) return;
    setState(() {
      _isLoading = false;
      _pendingPhotoCount = pending;
    });

    // 시작 시 대기 중인 오프라인 사진 자동 업로드 시도
    _flushOfflinePhotos();

    if (_hasAllRequiredPermissions && _info?.status == WorkStatus.working) {
      GpsTrackerService.startTrackingForToday(FirestoreService.todayWorkDate());
    }

    if (!_showInitialPasswordPrompt) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _restoreCameraSessionIfNeeded();
        if (mounted && _hasAllRequiredPermissions) {
          AppUpdateService.checkAndPromptUpdate(context);
        }
      });
    }
  }

  Future<void> _restoreCameraSessionIfNeeded() async {
    if (!Platform.isAndroid || _info == null) return;

    try {
      final picker = ImagePicker();
      final response = await picker.retrieveLostData();
      final file = response.file;
      final pendingKey = DraftStorage.pendingPhotoKey;

      if (file != null) {
        if (pendingKey == 'checkout_dashboard' ||
            DraftStorage.activeScreen == 'checkOut') {
          await DraftStorage.saveCheckOutPhoto(file.path);
          if (mounted) await _openCheckOut();
          return;
        } else {
          final targetKey = pendingKey ?? 'dashboard';
          await DraftStorage.saveCheckInPhoto(targetKey, file.path);
          if (mounted) await _openCheckIn();
          return;
        }
      }
    } catch (_) {}

    if (!mounted) return;
    if (DraftStorage.activeScreen == 'checkIn') {
      await _openCheckIn();
    } else if (DraftStorage.activeScreen == 'checkOut') {
      await _openCheckOut();
    }
  }

  Future<void> _openCheckIn() async {
    final current = _info;
    if (current == null) return;

    final updatedInfo = await Navigator.of(context).push<DriverHomeInfo>(
      _fastRoute(
        CheckInScreen(
          driverId: widget.uid,
          currentHomeInfo: current,
        ),
      ),
    );
    if (updatedInfo == null || !mounted) return;

    final pending = await OfflinePhotoQueue.pendingCount();
    if (!mounted) return;
    setState(() {
      _info = updatedInfo;
      _pendingPhotoCount = pending;
    });
    _flushOfflinePhotos();
  }

  Future<void> _openCheckOut() async {
    final current = _info;
    if (current == null) return;

    final startKm = current.startOdometerKm ?? DraftStorage.checkOutStartKm;
    final updatedInfo = await Navigator.of(context).push<DriverHomeInfo>(
      _fastRoute(
        CheckOutScreen(
          driverId: widget.uid,
          currentHomeInfo: current,
          startOdometerKm: startKm,
        ),
      ),
    );
    if (updatedInfo == null || !mounted) return;

    final pending = await OfflinePhotoQueue.pendingCount();
    if (!mounted) return;
    setState(() {
      _info = updatedInfo;
      _pendingPhotoCount = pending;
    });
    _flushOfflinePhotos();
  }

  Future<void> _openFuelLog() async {
    final current = _info;
    if (current == null) return;

    final updatedInfo = await Navigator.of(context).push<DriverHomeInfo>(
      _fastRoute(
        FuelLogScreen(
          driverId: widget.uid,
          currentHomeInfo: current,
        ),
      ),
    );
    if (updatedInfo == null || !mounted) return;

    setState(() {
      _info = updatedInfo;
    });
    _flushOfflinePhotos();
  }

  Future<void> _openChangePassword() async {
    final changed = await Navigator.of(context).push<bool>(
      _fastRoute(const ChangePasswordScreen(isInitialSetup: false)),
    );
    if (changed == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            '비밀번호가 변경되었습니다.',
            style: TextStyle(fontSize: 20, color: Colors.white),
          ),
        ),
      );
    }
  }

  Future<void> _signOut() async {
    _cachedUid = null;
    _cachedInfo = null;
    await AuthService.signOut();
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading || _info == null) {
      return const _BrandLoadingScreen();
    }

    if (_showInitialPasswordPrompt) {
      return ChangePasswordScreen(
        isInitialSetup: true,
        onCompleted: () {
          setState(() {
            _showInitialPasswordPrompt = false;
          });
        },
      );
    }

    if (!_hasAllRequiredPermissions) {
      return RequiredPermissionScreen(
        status: _permStatus ?? const {},
        onRecheck: () => _refreshPermissions(promptUpdateIfUnlocked: true),
      );
    }

    return DriverHomeScreen(
      info: _info!,
      onCheckIn: _openCheckIn,
      onCheckOut: _openCheckOut,
      onFuelLog: _openFuelLog,
      onChangePassword: _openChangePassword,
      onSignOut: _signOut,
      pendingPhotoCount: _pendingPhotoCount,
      onRetryPendingPhotos: _flushOfflinePhotos,
    );
  }
}
