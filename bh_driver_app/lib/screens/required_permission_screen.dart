import 'package:flutter/material.dart';

import '../services/gps_tracker_service.dart';
import '../theme/app_theme.dart';
import 'app_version_label.dart';

/// 안드로이드 필수 권한 4가지(GPS 켜짐, 정확한 위치, 배터리 제한 없음, 상단 알림)가
/// 모두 허용될 때까지 기사앱 사용을 안내·차단하는 화면입니다.
class RequiredPermissionScreen extends StatelessWidget {
  const RequiredPermissionScreen({
    super.key,
    required this.status,
    required this.onRecheck,
  });

  final Map<String, bool> status;
  final Future<void> Function() onRecheck;

  bool get _gpsEnabled => status['gpsEnabled'] == true;
  bool get _fineLocation => status['fineLocationGranted'] == true;
  bool get _batteryOk => status['batteryUnrestricted'] == true;
  bool get _notifOk => status['notificationGranted'] == true;

  Future<void> _triggerAction(Future<void> Function() action) async {
    await action();
    await Future<void>.delayed(const Duration(milliseconds: 500));
    await onRecheck();
  }

  Future<void> _requestNext() async {
    if (!_gpsEnabled) {
      await _triggerAction(GpsTrackerService.openLocationSettings);
    } else if (!_fineLocation) {
      await _triggerAction(GpsTrackerService.requestFineLocation);
    } else if (!_batteryOk) {
      await _triggerAction(GpsTrackerService.requestBatteryUnrestricted);
    } else if (!_notifOk) {
      await _triggerAction(GpsTrackerService.requestNotificationPermission);
    } else {
      await onRecheck();
    }
  }

  String get _nextButtonLabel {
    if (!_gpsEnabled) return '1단계: GPS(위치) 켜기';
    if (!_fineLocation) return '2단계: 정확한 위치 허용하기';
    if (!_batteryOk) return '3단계: 배터리 제한 없음 허용';
    if (!_notifOk) return '4단계: 운행 중 알림 허용';
    return '권한 다시 확인하기';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.infoBg,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: AppColors.primary.withValues(alpha: 0.35),
                    width: 2,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(
                          Icons.verified_user_rounded,
                          size: 34,
                          color: AppColors.primary,
                        ),
                        SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            '필수 권한 허용 안내',
                            style: AppText.heading,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      '운행 거리와 경로가 끊기지 않도록 아래 4가지를 모두 허용해야 앱을 쓸 수 있어요.',
                      style: AppText.body.copyWith(color: AppColors.text),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              _PermissionTile(
                step: '1',
                title: 'GPS(위치) 켜기',
                description: '휴대폰 위치(GPS) 기능이 켜져 있어야 합니다.',
                granted: _gpsEnabled,
                onTap: () => _triggerAction(
                  GpsTrackerService.openLocationSettings,
                ),
              ),
              const SizedBox(height: 12),
              _PermissionTile(
                step: '2',
                title: '정확한 위치 권한 허용',
                description: "대략적인 위치가 아닌 '정확한 위치'로 허용해야 합니다.",
                granted: _fineLocation,
                onTap: () => _triggerAction(
                  GpsTrackerService.requestFineLocation,
                ),
              ),
              const SizedBox(height: 12),
              _PermissionTile(
                step: '3',
                title: "배터리 '제한 없음' 설정",
                description: "화면이 꺼지거나 앱을 닫아도 운행이 기록되도록 '제한 없음'이 필수입니다.",
                granted: _batteryOk,
                onTap: () => _triggerAction(
                  GpsTrackerService.requestBatteryUnrestricted,
                ),
              ),
              const SizedBox(height: 12),
              _PermissionTile(
                step: '4',
                title: '운행 중 상단 알림 허용',
                description: "상단 알림줄에 'BH 기사앱 운행 중' 표시를 위해 필요합니다.",
                granted: _notifOk,
                onTap: () => _triggerAction(
                  GpsTrackerService.requestNotificationPermission,
                ),
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _requestNext,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(
                    vertical: 18,
                    horizontal: 20,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                  ),
                ),
                child: Text(
                  _nextButtonLabel,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: onRecheck,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.text,
                  side: const BorderSide(color: AppColors.disabled, width: 2),
                  padding: const EdgeInsets.symmetric(
                    vertical: 16,
                    horizontal: 20,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                  ),
                ),
                child: const Text(
                  '다시 확인하기',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const AppVersionLabel(),
            ],
          ),
        ),
      ),
    );
  }
}

class _PermissionTile extends StatelessWidget {
  const _PermissionTile({
    required this.step,
    required this.title,
    required this.description,
    required this.granted,
    required this.onTap,
  });

  final String step;
  final String title;
  final String description;
  final bool granted;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: granted ? AppColors.successBg : Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: granted ? AppColors.success : AppColors.warn,
          width: 2,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: granted ? AppColors.success : AppColors.primary,
                child: granted
                    ? const Icon(Icons.check, color: Colors.white, size: 22)
                    : Text(
                        step,
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                        ),
                      ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 21,
                    fontWeight: FontWeight.w800,
                    color: AppColors.text,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: granted ? AppColors.success : AppColors.warnBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  granted ? '완료' : '필요',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: granted ? Colors.white : AppColors.warn,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            description,
            style: AppText.caption.copyWith(color: AppColors.text),
          ),
          if (!granted) ...[
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: onTap,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.teal,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: const Text(
                '설정하기',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
