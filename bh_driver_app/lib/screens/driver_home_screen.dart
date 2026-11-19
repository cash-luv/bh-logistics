import 'package:flutter/material.dart';

import '../models/driver_home_info.dart';
import '../theme/app_theme.dart';
import 'app_version_label.dart';

/// 기사용 메인 화면: 큰 버튼 2개
///  - [출근 / 차량 점검] 파란색
///  - [퇴근 / 빠른 보고] 청록색
class DriverHomeScreen extends StatelessWidget {
  const DriverHomeScreen({
    super.key,
    required this.info,
    required this.onCheckIn,
    required this.onCheckOut,
    this.onFuelLog,
    this.onChangePassword,
    this.onSignOut,
    this.pendingPhotoCount = 0,
    this.onRetryPendingPhotos,
  });

  final DriverHomeInfo info;
  final VoidCallback onCheckIn;
  final VoidCallback onCheckOut;
  final VoidCallback? onFuelLog;
  final VoidCallback? onChangePassword;
  final VoidCallback? onSignOut;
  final int pendingPhotoCount;
  final VoidCallback? onRetryPendingPhotos;

  bool get _canCheckIn =>
      info.hasVehicle && info.status == WorkStatus.beforeWork;
  bool get _canCheckOut => info.hasVehicle && info.status == WorkStatus.working;

  String get _checkInSub {
    if (!info.hasVehicle) return '배정된 차량이 없어요';
    return info.status == WorkStatus.beforeWork
        ? '차량 사진 · 계기판 · 점검'
        : '오늘 출근을 마쳤어요';
  }

  String get _checkOutSub {
    if (!info.hasVehicle) return '배정된 차량이 없어요';
    return switch (info.status) {
      WorkStatus.beforeWork => '먼저 출근해 주세요',
      WorkStatus.working => '계기판 사진 1장이면 끝',
      WorkStatus.done => '오늘도 수고하셨습니다',
    };
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        // 글자 크기를 키운 폰에서도 깨지지 않게: 부족하면 스크롤, 남으면 버튼이 늘어남
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: IntrinsicHeight(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _Header(
                        name: info.driverName,
                        onChangePassword: onChangePassword,
                        onSignOut: onSignOut,
                      ),
                      if (pendingPhotoCount > 0) ...[
                        const SizedBox(height: 12),
                        _PendingPhotoBanner(
                          count: pendingPhotoCount,
                          onTap: onRetryPendingPhotos,
                        ),
                      ],
                      const SizedBox(height: 16),
                      _StatusCard(info: info),
                      const SizedBox(height: 20),
                      Expanded(
                        child: _BigActionButton(
                          icon: Icons.fact_check,
                          title: '출근 / 차량 점검',
                          subtitle: _checkInSub,
                          color: AppColors.primary,
                          enabled: _canCheckIn,
                          onTap: onCheckIn,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Expanded(
                        child: _BigActionButton(
                          icon: Icons.camera_alt,
                          title: '퇴근 / 빠른 보고',
                          subtitle: _checkOutSub,
                          color: AppColors.teal,
                          enabled: _canCheckOut,
                          onTap: onCheckOut,
                        ),
                      ),
                      if (_canCheckOut && onFuelLog != null) ...[
                        const SizedBox(height: 12),
                        _FuelActionTile(
                          todayFuelCost: info.todayFuelCost,
                          onTap: onFuelLog!,
                        ),
                      ],
                      const SizedBox(height: 12),
                      const AppVersionLabel(),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.name,
    this.onChangePassword,
    this.onSignOut,
  });

  final String name;
  final VoidCallback? onChangePassword;
  final VoidCallback? onSignOut;

  static const _weekdays = ['월', '화', '수', '목', '금', '토', '일'];

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final date = '${now.month}월 ${now.day}일 ${_weekdays[now.weekday - 1]}요일';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Flexible(
              child: Text(
                'BH로지스틱스',
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primary,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                date,
                textAlign: TextAlign.right,
                overflow: TextOverflow.ellipsis,
                style: AppText.caption,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Text('$name 기사님', style: AppText.title),
            ),
            if (onChangePassword != null || onSignOut != null)
              PopupMenuButton<String>(
                icon: const Icon(
                  Icons.manage_accounts_outlined,
                  size: 32,
                  color: AppColors.subText,
                ),
                onSelected: (value) {
                  if (value == 'pw') onChangePassword?.call();
                  if (value == 'out') onSignOut?.call();
                },
                itemBuilder: (_) => [
                  if (onChangePassword != null)
                    const PopupMenuItem(
                      value: 'pw',
                      child: Text('비밀번호 변경', style: AppText.body),
                    ),
                  if (onSignOut != null)
                    const PopupMenuItem(
                      value: 'out',
                      child: Text('로그아웃', style: AppText.body),
                    ),
                ],
              ),
          ],
        ),
        const Text('오늘도 안전운행 하세요', style: AppText.body),
      ],
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.info});

  final DriverHomeInfo info;

  @override
  Widget build(BuildContext context) {
    if (!info.hasVehicle) {
      return _card(
        const Row(
          children: [
            Icon(Icons.info_outline, size: 32, color: AppColors.warn),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                '배정된 차량이 없어요.\n관리자에게 문의해 주세요.',
                style: AppText.body,
              ),
            ),
          ],
        ),
      );
    }

    final (chipText, chipFg, chipBg) = switch (info.status) {
      WorkStatus.beforeWork => ('출근 전', AppColors.warn, AppColors.warnBg),
      WorkStatus.working => (
          '운행 중 · ${info.checkInTime ?? ''} 출근',
          AppColors.primary,
          AppColors.infoBg,
        ),
      WorkStatus.done => (
          '퇴근 완료 · ${_formatKm(info.drivenKm ?? 0)}km 운행',
          AppColors.success,
          AppColors.successBg,
        ),
    };

    return _card(
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.local_shipping,
                size: 34,
                color: AppColors.primary,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(info.plateNo!, style: AppText.heading),
              ),
            ],
          ),
          if (info.vehicleModel != null)
            Padding(
              padding: const EdgeInsets.only(left: 44),
              child: Text(info.vehicleModel!, style: AppText.caption),
            ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.route, size: 30, color: AppColors.subText),
              const SizedBox(width: 10),
              Expanded(
                child: Text(info.routeName ?? '코스 미정', style: AppText.body),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: chipBg,
              borderRadius: BorderRadius.circular(30),
            ),
            child: Text(
              chipText,
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: chipFg,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BigActionButton extends StatelessWidget {
  const _BigActionButton({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.enabled,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fg = enabled ? Colors.white : AppColors.disabledText;
    return Semantics(
      button: true,
      enabled: enabled,
      child: Material(
        color: enabled ? color : AppColors.disabled,
        elevation: enabled ? 4 : 0,
        borderRadius: BorderRadius.circular(28),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: enabled ? onTap : null,
          child: Center(
            child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 58, color: fg),
                const SizedBox(height: 8),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    title,
                    textAlign: TextAlign.center,
                    style: AppText.bigButton.copyWith(color: fg),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 20, color: fg),
                ),
              ],
            ),
            ),
          ),
        ),
      ),
    );
  }
}

Widget _card(Widget child) {
  return Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(20),
    ),
    child: child,
  );
}

class _FuelActionTile extends StatelessWidget {
  const _FuelActionTile({
    required this.todayFuelCost,
    required this.onTap,
  });

  final int todayFuelCost;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(22),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: AppColors.primary, width: 2),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.local_gas_station,
                size: 36,
                color: AppColors.primary,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '주유 영수증 · 금액 등록',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        color: AppColors.text,
                      ),
                    ),
                    Text(
                      todayFuelCost > 0
                          ? '오늘 등록된 주유비: ${_formatKm(todayFuelCost)}원'
                          : '주유카드로 주유했을 때 눌러 주세요',
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right,
                size: 32,
                color: AppColors.primary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PendingPhotoBanner extends StatelessWidget {
  const _PendingPhotoBanner({
    required this.count,
    this.onTap,
  });

  final int count;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.infoBg,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              const Icon(
                Icons.cloud_upload_outlined,
                size: 28,
                color: AppColors.primary,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  '저장됐어요! 사진 $count장은 인터넷이 연결되면 자동으로 올라가요.',
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 182340 -> 182,340
String _formatKm(int km) => km.toString().replaceAllMapped(
      RegExp(r'\B(?=(\d{3})+(?!\d))'),
      (m) => ',',
    );
