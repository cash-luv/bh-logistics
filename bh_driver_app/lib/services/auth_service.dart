import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/driver_home_info.dart';
import 'draft_storage.dart';

/// 기사 로그인 정보 및 Users 문서 스냅샷
class DriverSession {
  const DriverSession({
    required this.uid,
    required this.driverCode,
    required this.name,
    required this.role,
    required this.mustChangePassword,
    this.assignedVehicleId,
    this.defaultRouteId,
  });

  final String uid;
  final String driverCode;
  final String name;
  final String role; // 'driver' | 'admin'
  final bool mustChangePassword;
  final String? assignedVehicleId;
  final String? defaultRouteId;
}

/// 기사 코드(예: bh01) + 6자리 비밀번호(초기: 생년월일) 로그인 및
/// Users / Vehicles / Routes 조회를 담당하는 서비스입니다.
class AuthService {
  AuthService._();

  static final FirebaseAuth _auth = FirebaseAuth.instance;
  static final FirebaseFirestore _db = FirebaseFirestore.instance;

  /// 기사 코드를 내부 이메일 주소로 변환합니다. (예: bh01 -> bh01@bhlogistics.local)
  static String codeToEmail(String driverCode) {
    final clean = driverCode.trim().toLowerCase();
    if (clean.contains('@')) return clean;
    return '$clean@bhlogistics.local';
  }

  /// 현재 로그인된 사용자 스트림 (앱을 껐다 켜도 자동 유지됨)
  static Stream<User?> get authStateChanges => _auth.authStateChanges();

  static User? get currentUser => _auth.currentUser;

  /// 기사 코드 + 비밀번호로 로그인
  static Future<void> signInWithCode({
    required String driverCode,
    required String password,
  }) async {
    final cleanCode = driverCode.trim().toLowerCase();
    final email = codeToEmail(cleanCode);
    await _auth.signInWithEmailAndPassword(
      email: email,
      password: password.trim(),
    );
    await DraftStorage.saveDriverCode(cleanCode);
  }

  /// 비밀번호 변경 (초기 생년월일 -> 새 비밀번호) + Users.mustChangePassword = false 갱신
  static Future<void> changePassword(String newPassword) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw Exception('로그인 상태가 아닙니다.');
    }
    await user.updatePassword(newPassword.trim());
    await _db.collection('Users').doc(user.uid).set(
      {
        'mustChangePassword': false,
        'updatedAt': FieldValue.serverTimestamp(),
      },
      SetOptions(merge: true),
    );
  }

  static Future<void> signOut() async {
    await _auth.signOut();
  }

  /// 로그인된 uid로 Users/{uid}, Vehicles/{assignedVehicleId}, Routes/{defaultRouteId}를 읽어
  /// 세션 정보와 홈 화면 정보(DriverHomeInfo)를 만들어 돌려줍니다.
  static Future<(DriverSession, DriverHomeInfo)> loadDriverProfile(
    String uid,
  ) async {
    final userDoc = await _db.collection('Users').doc(uid).get();
    final data = userDoc.data() ?? {};

    final email = _auth.currentUser?.email ?? '';
    final fallbackCode = email.contains('@') ? email.split('@').first : '';

    final session = DriverSession(
      uid: uid,
      driverCode: (data['driverCode'] as String?) ?? fallbackCode,
      name: (data['name'] as String?) ?? '기사',
      role: (data['role'] as String?) ?? 'driver',
      mustChangePassword: (data['mustChangePassword'] as bool?) ?? false,
      assignedVehicleId: data['assignedVehicleId'] as String?,
      defaultRouteId: data['defaultRouteId'] as String?,
    );
    if (session.driverCode.isNotEmpty) {
      await DraftStorage.saveDriverCode(session.driverCode);
    }

    String? plateNo;
    String? vehicleModel;
    if (session.assignedVehicleId != null &&
        session.assignedVehicleId!.isNotEmpty) {
      final vehDoc = await _db
          .collection('Vehicles')
          .doc(session.assignedVehicleId)
          .get();
      final veh = vehDoc.data();
      if (veh != null) {
        plateNo = veh['plateNo'] as String?;
        final manufacturer = (veh['manufacturer'] as String?) ?? '';
        final model = (veh['model'] as String?) ?? '';
        final combined = '$manufacturer $model'.trim();
        vehicleModel = combined.isEmpty ? null : combined;
      }
    }

    String? routeName;
    if (session.defaultRouteId != null && session.defaultRouteId!.isNotEmpty) {
      final routeDoc =
          await _db.collection('Routes').doc(session.defaultRouteId).get();
      final route = routeDoc.data();
      if (route != null) {
        routeName = route['name'] as String?;
      }
    }

    final homeInfo = DriverHomeInfo(
      driverName: session.name,
      status: WorkStatus.beforeWork,
      plateNo: plateNo,
      vehicleModel: vehicleModel,
      routeName: routeName,
    );

    return (session, homeInfo);
  }
}
