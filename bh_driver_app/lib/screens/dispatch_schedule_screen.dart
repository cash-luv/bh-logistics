import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/firestore_service.dart';
import '../theme/app_theme.dart';

/// 기사 전용 [나의 배차 노선표] 화면
/// - 관리자가 등록한 오늘/내일 다회차 코스(1~3코스) 및 상·하차 상세 주소·담당자·온도를 표시합니다.
/// - 정산 금액(운임) 정보는 기사 화면에 일절 노출하지 않습니다.
/// - 모든 글씨는 20pt 이상으로 유지하여 어르신 기사님도 한눈에 볼 수 있습니다.
class DispatchScheduleScreen extends StatefulWidget {
  const DispatchScheduleScreen({
    super.key,
    required this.driverId,
    required this.driverName,
    this.plateNo,
    this.initialTab = 0,
    this.initialTodayTrips = const [],
    this.initialTomorrowTrips = const [],
  });

  final String driverId;
  final String driverName;
  final String? plateNo;
  final int initialTab; // 0: 오늘, 1: 내일
  final List<Map<String, dynamic>> initialTodayTrips;
  final List<Map<String, dynamic>> initialTomorrowTrips;

  @override
  State<DispatchScheduleScreen> createState() => _DispatchScheduleScreenState();
}

class _DispatchScheduleScreenState extends State<DispatchScheduleScreen> {
  late int _selectedTab;
  late List<Map<String, dynamic>> _todayTrips;
  late List<Map<String, dynamic>> _tomorrowTrips;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _selectedTab = widget.initialTab == 1 ? 1 : 0;
    _todayTrips = widget.initialTodayTrips;
    _tomorrowTrips = widget.initialTomorrowTrips;
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    try {
      final (today, tomorrow) =
          await FirestoreService.fetchTodayAndTomorrowDispatches(
        widget.driverId,
      );
      if (!mounted) return;
      setState(() {
        _todayTrips = today;
        _tomorrowTrips = tomorrow;
      });
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _copyAddress(String address) async {
    await Clipboard.setData(ClipboardData(text: address));
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          backgroundColor: AppColors.primary,
          behavior: SnackBarBehavior.floating,
          content: Text(
            '주소를 복사했어요!\n내비게이션에 붙여넣기 하세요.\n($address)',
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          duration: const Duration(seconds: 3),
        ),
      );
  }

  Future<void> _callContact(String phone) async {
    final digits = phone.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.isEmpty) return;
    final uri = Uri(scheme: 'tel', path: digits);
    try {
      final ok = await launchUrl(uri);
      if (!ok && mounted) {
        _showError('전화 화면을 열 수 없어요: $phone');
      }
    } catch (_) {
      if (mounted) {
        _showError('전화 연결 중 문제가 발생했어요: $phone');
      }
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          backgroundColor: AppColors.warn,
          content: Text(
            msg,
            style: const TextStyle(fontSize: 20, color: Colors.white),
          ),
        ),
      );
  }

  String _shortMd(String ymd) {
    final parts = ymd.split('-');
    if (parts.length != 3) return ymd;
    return '${int.tryParse(parts[1]) ?? parts[1]}/${int.tryParse(parts[2]) ?? parts[2]}';
  }

  @override
  Widget build(BuildContext context) {
    final todayStr = FirestoreService.workDateWithOffset(0);
    final tomorrowStr = FirestoreService.workDateWithOffset(1);
    final activeTrips = _selectedTab == 0 ? _todayTrips : _tomorrowTrips;
    final activeDateLabel =
        _selectedTab == 0 ? '오늘 (${_shortMd(todayStr)})' : '내일 (${_shortMd(tomorrowStr)})';

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.text,
        elevation: 0,
        toolbarHeight: 68,
        title: const Text(
          '나의 배차 노선표',
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w800,
            color: AppColors.text,
          ),
        ),
        actions: [
          IconButton(
            onPressed: _loading ? null : _refresh,
            icon: _loading
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 3),
                  )
                : const Icon(Icons.refresh, size: 32, color: AppColors.primary),
            tooltip: '새로고침',
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            // 오늘 / 내일 선택 큰 버튼
            Container(
              color: AppColors.surface,
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
              child: Row(
                children: [
                  Expanded(
                    child: _DateSwitchTab(
                      label: '오늘 (${_shortMd(todayStr)})',
                      count: _todayTrips.length,
                      selected: _selectedTab == 0,
                      onTap: () => setState(() => _selectedTab = 0),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _DateSwitchTab(
                      label: '내일 (${_shortMd(tomorrowStr)})',
                      count: _tomorrowTrips.length,
                      selected: _selectedTab == 1,
                      onTap: () => setState(() => _selectedTab = 1),
                    ),
                  ),
                ],
              ),
            ),

            // 배차 목록 본문
            Expanded(
              child: RefreshIndicator(
                onRefresh: _refresh,
                child: activeTrips.isEmpty
                    ? ListView(
                        padding: const EdgeInsets.all(20),
                        children: [
                          Container(
                            padding: const EdgeInsets.all(28),
                            decoration: BoxDecoration(
                              color: AppColors.surface,
                              borderRadius: BorderRadius.circular(24),
                            ),
                            child: Column(
                              children: [
                                const Icon(
                                  Icons.event_note_outlined,
                                  size: 64,
                                  color: AppColors.disabledText,
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  '$activeDateLabel 배차가\n아직 등록되지 않았어요.',
                                  textAlign: TextAlign.center,
                                  style: AppText.heading,
                                ),
                                const SizedBox(height: 10),
                                const Text(
                                  '관리자가 카톡 배차를 올리면\n이 화면에 코스별로 바로 표시됩니다.',
                                  textAlign: TextAlign.center,
                                  style: AppText.caption,
                                ),
                              ],
                            ),
                          ),
                        ],
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                        itemCount: activeTrips.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 20),
                        itemBuilder: (context, idx) => _CourseCard(
                          trip: activeTrips[idx],
                          index: idx,
                          onCopyAddress: _copyAddress,
                          onCallContact: _callContact,
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DateSwitchTab extends StatelessWidget {
  const _DateSwitchTab({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primary : const Color(0xFFEEF2F7),
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
          alignment: Alignment.center,
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              '$label · $count코스',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: selected ? Colors.white : AppColors.text,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CourseCard extends StatelessWidget {
  const _CourseCard({
    required this.trip,
    required this.index,
    required this.onCopyAddress,
    required this.onCallContact,
  });

  final Map<String, dynamic> trip;
  final int index;
  final void Function(String address) onCopyAddress;
  final void Function(String phone) onCallContact;

  @override
  Widget build(BuildContext context) {
    final int tripNo = (trip['tripNo'] as num?)?.toInt() ?? (index + 1);
    final String tag = (trip['dispatchTag'] ?? '').toString().trim();
    final String courseName = (trip['courseName'] ?? '').toString().trim();
    final String cargoInfo = (trip['cargoInfo'] ?? '').toString().trim();
    final String tempInfo = (trip['tempInfo'] ?? '').toString().trim();
    final String loadTime = (trip['loadTime'] ?? '').toString().trim();
    final String unloadTime = (trip['unloadTime'] ?? '').toString().trim();
    final List<Map<String, dynamic>> stops =
        (trip['stops'] as List?)?.whereType<Map<String, dynamic>>().toList() ??
            const [];

    final headerBadges = <String>[
      if (tag.isNotEmpty) tag,
      if (cargoInfo.isNotEmpty) cargoInfo,
      if (tempInfo.isNotEmpty) '온도 $tempInfo',
    ];

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFD6E0EE), width: 1.5),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 코스 상단 파란 헤더
          Container(
            padding: const EdgeInsets.all(18),
            color: AppColors.infoBg,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.primary,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        '$tripNo코스',
                        style: const TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                        ),
                      ),
                    ),
                    if (loadTime.isNotEmpty)
                      Text(
                        unloadTime.isNotEmpty
                            ? '$loadTime 출발 → $unloadTime 하차'
                            : '$loadTime 상차',
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primary,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  courseName.isNotEmpty ? courseName : '$tripNo코스 운행',
                  style: AppText.title.copyWith(fontSize: 26),
                ),
                if (headerBadges.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: headerBadges
                        .map(
                          (b) => Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: AppColors.primary.withValues(alpha: 0.35),
                              ),
                            ),
                            child: Text(
                              b,
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w700,
                                color: AppColors.text,
                              ),
                            ),
                          ),
                        )
                        .toList(),
                  ),
                ],
              ],
            ),
          ),

          // 상·하차 경유지 목록
          if (stops.isEmpty)
            const Padding(
              padding: EdgeInsets.all(18),
              child: Text(
                '상세 상·하차 주소가 아직 등록되지 않았습니다.',
                style: AppText.caption,
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  for (int i = 0; i < stops.length; i++) ...[
                    _StopCard(
                      stop: stops[i],
                      stepNumber: i + 1,
                      onCopyAddress: onCopyAddress,
                      onCallContact: onCallContact,
                    ),
                    if (i < stops.length - 1)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 8),
                        child: Icon(
                          Icons.arrow_downward_rounded,
                          size: 30,
                          color: AppColors.primary,
                        ),
                      ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _StopCard extends StatelessWidget {
  const _StopCard({
    required this.stop,
    required this.stepNumber,
    required this.onCopyAddress,
    required this.onCallContact,
  });

  final Map<String, dynamic> stop;
  final int stepNumber;
  final void Function(String address) onCopyAddress;
  final void Function(String phone) onCallContact;

  @override
  Widget build(BuildContext context) {
    final String stopType = (stop['stopType'] ?? '상차').toString();
    final bool isUnload = stopType == '하차';
    final Color accentColor = isUnload ? AppColors.teal : AppColors.primary;
    final String time = (stop['time'] ?? '').toString().trim();
    final String placeName = (stop['placeName'] ?? '').toString().trim();
    final String tempBadge = (stop['tempBadge'] ?? '').toString().trim();
    final String palletBadge = (stop['palletBadge'] ?? '').toString().trim();
    final String address = (stop['address'] ?? '').toString().trim();
    final String addressNote = (stop['addressNote'] ?? '').toString().trim();
    final String contactName = (stop['contactName'] ?? '').toString().trim();
    final String contactPhone = (stop['contactPhone'] ?? '').toString().trim();
    final String tempNotice = (stop['tempNotice'] ?? '').toString().trim();

    final hasTempBox =
        tempBadge.isNotEmpty || palletBadge.isNotEmpty || tempNotice.isNotEmpty;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFD),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: accentColor.withValues(alpha: 0.35),
          width: 1.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // [상차 09:00] 업체명
          Wrap(
            spacing: 10,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: accentColor,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  time.isNotEmpty ? '$stopType $time' : '$stopType $stepNumber',
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
              ),
              Text(
                placeName.isNotEmpty ? placeName : '$stopType지',
                style: AppText.heading.copyWith(fontSize: 23),
              ),
            ],
          ),

          // 온도 / 파렛트 주의 박스
          if (hasTempBox) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.warnBg,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: AppColors.warn.withValues(alpha: 0.4),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (tempBadge.isNotEmpty || palletBadge.isNotEmpty)
                    Text(
                      [
                        if (tempBadge.isNotEmpty) '❄️ $tempBadge',
                        if (palletBadge.isNotEmpty) palletBadge,
                      ].join(' · '),
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: AppColors.warn,
                      ),
                    ),
                  if (tempNotice.isNotEmpty) ...[
                    if (tempBadge.isNotEmpty || palletBadge.isNotEmpty)
                      const SizedBox(height: 4),
                    Text(
                      tempNotice,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: AppColors.text,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],

          // 도로명 주소 + 진입 안내
          if (address.isNotEmpty || addressNote.isNotEmpty) ...[
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.location_on, size: 28, color: accentColor),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (address.isNotEmpty)
                        Text(
                          address,
                          style: AppText.body.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      if (addressNote.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            '안내: $addressNote',
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
              ],
            ),
          ],

          // 현장 담당자 & 연락처
          if (contactName.isNotEmpty || contactPhone.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.person, size: 28, color: AppColors.subText),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    [
                      if (contactName.isNotEmpty) '담당 $contactName',
                      if (contactPhone.isNotEmpty) contactPhone,
                    ].join('  '),
                    style: AppText.body,
                  ),
                ),
              ],
            ),
          ],

          // 큰 액션 버튼: [주소 복사] / [담당자 전화]
          if (address.isNotEmpty || contactPhone.isNotEmpty) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                if (address.isNotEmpty)
                  Expanded(
                    child: SizedBox(
                      height: 56,
                      child: ElevatedButton.icon(
                        onPressed: () => onCopyAddress(address),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: accentColor,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        icon: const Icon(Icons.copy, size: 24),
                        label: const FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            '주소 복사',
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                if (address.isNotEmpty && contactPhone.isNotEmpty)
                  const SizedBox(width: 10),
                if (contactPhone.isNotEmpty)
                  Expanded(
                    child: SizedBox(
                      height: 56,
                      child: OutlinedButton.icon(
                        onPressed: () => onCallContact(contactPhone),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.text,
                          backgroundColor: Colors.white,
                          side: const BorderSide(
                            color: AppColors.text,
                            width: 1.8,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        icon: const Icon(Icons.phone, size: 24),
                        label: const FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            '담당자 전화',
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
