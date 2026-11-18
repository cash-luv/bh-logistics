import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../models/check_in_result.dart';
import '../models/driver_home_info.dart';
import '../services/draft_storage.dart';
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

/// 출근 / 차량 점검 화면
/// - 필수(2개): 1) 계기판 사진 1장, 2) 계기판 주행거리 숫자 입력 -> 이 2개만 채우면 바로 [출근 완료] 가능!
/// - 선택: 차량 외부/내부 사진(안 찍어도 됨), 출발 전 차량 점검(기본값 '정상'으로 자동 선택됨)
class CheckInScreen extends StatefulWidget {
  const CheckInScreen({
    super.key,
    required this.driverId,
    required this.currentHomeInfo,
    this.initialOdometerKm,
  });

  final String driverId;
  final DriverHomeInfo currentHomeInfo;
  final int? initialOdometerKm;

  @override
  State<CheckInScreen> createState() => _CheckInScreenState();
}

class _CheckInScreenState extends State<CheckInScreen> {
  final ImagePicker _picker = ImagePicker();
  late final TextEditingController _odometerController;
  bool _isOpeningCamera = false;

  bool _isSubmitting = false;
  String? _progressMessage;
  String? _errorMessage;

  Map<String, String> get _photoPaths => DraftStorage.checkInPhotos;
  Map<String, String> get _checklist => DraftStorage.checkInChecklist;

  static const _optionalPhotoItems = [
    (key: 'exterior', title: '차량 외부 사진 (선택)', sub: '필요할 때만 찍어 주세요'),
    (key: 'interior', title: '차량 내부 사진 (선택)', sub: '필요할 때만 찍어 주세요'),
  ];

  static const _checkItems = [
    (key: 'tirePressure', title: '타이어 공기압'),
    (key: 'ureaLevel', title: '요소수'),
    (key: 'fuelLevel', title: '연료'),
  ];

  @override
  void initState() {
    super.initState();
    DraftStorage.setActiveScreen('checkIn');
    // 기사님이 일일이 누르지 않아도 되도록 기본값을 모두 '정상(ok)'으로 채워 둡니다.
    for (final item in _checkItems) {
      if (!_checklist.containsKey(item.key)) {
        DraftStorage.saveCheckInChecklist(item.key, 'ok');
      }
    }
    final draftOdo = DraftStorage.checkInOdometer;
    final initialText = draftOdo.isNotEmpty
        ? formatComma(int.tryParse(draftOdo.replaceAll(',', '')))
        : (widget.initialOdometerKm != null
            ? formatComma(widget.initialOdometerKm)
            : '');
    _odometerController = TextEditingController(text: initialText);
    _recoverLostPhotoIfNeeded();
  }

  @override
  void dispose() {
    _odometerController.dispose();
    super.dispose();
  }

  Future<void> _recoverLostPhotoIfNeeded() async {
    if (!Platform.isAndroid) return;
    try {
      final LostDataResponse response = await _picker.retrieveLostData();
      if (response.isEmpty) return;
      final file = response.file;
      final key = DraftStorage.pendingPhotoKey;
      if (file != null && key != null) {
        await DraftStorage.saveCheckInPhoto(key, file.path);
        if (mounted) {
          setState(() {});
        }
      }
    } catch (_) {}
  }

  int? get _parsedOdometer {
    final raw = _odometerController.text.replaceAll(',', '').trim();
    if (raw.isEmpty) return null;
    final val = int.tryParse(raw);
    if (val == null || val <= 0) return null;
    return val;
  }

  /// 필수 항목: 계기판 사진(dashboard) 1장 + 주행거리 숫자 입력 (총 2개)
  int get _remainingCount {
    final hasDashboardPhoto = (_photoPaths['dashboard'] ?? '').isNotEmpty;
    final missingDashboard = hasDashboardPhoto ? 0 : 1;
    final missingOdometer = _parsedOdometer == null ? 1 : 0;
    return missingDashboard + missingOdometer;
  }

  bool get _canSubmit => _remainingCount == 0 && !_isSubmitting;

  Future<void> _takePhoto(String key) async {
    if (_isOpeningCamera || _isSubmitting) return;
    _isOpeningCamera = true;
    await DraftStorage.setPendingPhotoKey(key);

    try {
      final XFile? picked = await _picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 65,
        maxWidth: 960,
        maxHeight: 960,
      );
      if (picked != null) {
        await DraftStorage.saveCheckInPhoto(key, picked.path);
        if (mounted) {
          setState(() {});
        }
      } else {
        await DraftStorage.setPendingPhotoKey(null);
      }
    } catch (_) {
      if (mounted) {
        await _pickFromGalleryFallback(key);
      }
    } finally {
      _isOpeningCamera = false;
    }
  }

  Future<void> _pickFromGalleryFallback(String key) async {
    try {
      final XFile? picked = await _picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 65,
        maxWidth: 960,
        maxHeight: 960,
      );
      if (picked != null) {
        await DraftStorage.saveCheckInPhoto(key, picked.path);
        if (mounted) {
          setState(() {});
        }
      } else {
        await DraftStorage.setPendingPhotoKey(null);
      }
    } catch (_) {
      await DraftStorage.setPendingPhotoKey(null);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            '카메라를 열 수 없습니다. 권한 설정을 확인해 주세요.',
            style: TextStyle(fontSize: 20, color: Colors.white),
          ),
        ),
      );
    }
  }

  Future<void> _submit() async {
    final odometer = _parsedOdometer;
    if (!_canSubmit || odometer == null) return;
    FocusScope.of(context).unfocus();

    final normalizedChecklist = <String, String>{
      for (final item in _checkItems) item.key: _checklist[item.key] ?? 'ok',
    };

    final result = CheckInResult(
      startOdometerKm: odometer,
      photoPaths: Map<String, String>.from(_photoPaths),
      checklist: normalizedChecklist,
    );

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
      _progressMessage = '출근 기록을 준비하는 중...';
    });

    try {
      final updatedInfo = await FirestoreService.saveCheckIn(
        driverId: widget.driverId,
        result: result,
        currentHomeInfo: widget.currentHomeInfo,
        onProgress: (msg) {
          if (!mounted) return;
          setState(() {
            _progressMessage = msg;
          });
        },
      );

      await DraftStorage.clearCheckIn();
      if (!mounted) return;
      Navigator.of(context).pop(updatedInfo);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _progressMessage = null;
        _errorMessage =
            '사진 업로드나 저장에 실패했어요.\n인터넷 연결(또는 Storage 규칙)을 확인하고 아래 [다시 시도]를 눌러 주세요.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final remaining = _remainingCount;

    return PopScope(
      canPop: !_isSubmitting,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) {
          DraftStorage.setActiveScreen(null);
        }
      },
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          title: const Text(
            '출근 / 차량 점검',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
        ),
        body: SafeArea(
          child: GestureDetector(
            onTap: () => FocusScope.of(context).unfocus(),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('1. 계기판 사진 찍기 (필수)', style: AppText.heading),
                  const SizedBox(height: 6),
                  const Text(
                    '주행거리 숫자가 잘 보이게 1장만 찍어 주세요.',
                    style: AppText.caption,
                  ),
                  const SizedBox(height: 12),
                  _PhotoTile(
                    title: '계기판 사진 (필수)',
                    subtitle: '칸을 누르면 카메라가 켜집니다',
                    photoPath: _photoPaths['dashboard'],
                    onTap: () => _takePhoto('dashboard'),
                  ),
                  const SizedBox(height: 24),
                  const Text('2. 계기판 주행거리 입력 (필수)', style: AppText.heading),
                  const SizedBox(height: 6),
                  const Text(
                    '계기판에 적힌 숫자를 그대로 입력해 주세요.',
                    style: AppText.caption,
                  ),
                  const SizedBox(height: 12),
                  _OdometerInputCard(
                    controller: _odometerController,
                    hintKm: widget.initialOdometerKm,
                    onChanged: (val) => setState(() {
                      DraftStorage.saveCheckInOdometer(val);
                    }),
                  ),
                  const SizedBox(height: 28),
                  const Text(
                    '3. 차량 외부 · 내부 사진 (선택 사항)',
                    style: AppText.heading,
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    '안 찍으셔도 바로 출근 완료할 수 있어요.',
                    style: AppText.caption,
                  ),
                  const SizedBox(height: 12),
                  for (final item in _optionalPhotoItems) ...[
                    _PhotoTile(
                      title: item.title,
                      subtitle: item.sub,
                      photoPath: _photoPaths[item.key],
                      onTap: () => _takePhoto(item.key),
                    ),
                    const SizedBox(height: 12),
                  ],
                  const SizedBox(height: 16),
                  const Text(
                    '4. 출발 전 차량 점검 (선택 사항)',
                    style: AppText.heading,
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    '기본으로 [정상]이 선택되어 있어요. 이상이 있을 때만 [확인 필요]를 눌러 주세요.',
                    style: AppText.caption,
                  ),
                  const SizedBox(height: 14),
                  for (final item in _checkItems) ...[
                    _ChecklistTile(
                      title: item.title,
                      selected: _checklist[item.key] ?? 'ok',
                      onChanged: (val) => setState(() {
                        DraftStorage.saveCheckInChecklist(item.key, val);
                      }),
                    ),
                    const SizedBox(height: 12),
                  ],
                  const SizedBox(height: 24),
                  if (_isSubmitting && _progressMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: AppColors.infoBg,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        children: [
                          const SizedBox(
                            width: 28,
                            height: 28,
                            child: CircularProgressIndicator(strokeWidth: 3),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Text(
                              _progressMessage!,
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w800,
                                color: AppColors.primary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  if (_errorMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: AppColors.warnBg,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: AppColors.warn, width: 2),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(
                                Icons.warning_amber_rounded,
                                size: 32,
                                color: AppColors.warn,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  _errorMessage!,
                                  style: const TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.text,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          Material(
                            color: AppColors.primary,
                            borderRadius: BorderRadius.circular(16),
                            clipBehavior: Clip.antiAlias,
                            child: InkWell(
                              onTap: _submit,
                              child: const Padding(
                                padding: EdgeInsets.symmetric(vertical: 14),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(
                                      Icons.refresh,
                                      size: 26,
                                      color: Colors.white,
                                    ),
                                    SizedBox(width: 8),
                                    Text(
                                      '다시 시도',
                                      style: TextStyle(
                                        fontSize: 22,
                                        fontWeight: FontWeight.w800,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  _SubmitButton(
                    enabled: _canSubmit,
                    isSubmitting: _isSubmitting,
                    remainingCount: remaining,
                    onTap: _submit,
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

class _PhotoTile extends StatelessWidget {
  const _PhotoTile({
    required this.title,
    required this.subtitle,
    required this.photoPath,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final String? photoPath;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hasPhoto = photoPath != null;

    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(20),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: hasPhoto ? AppColors.success : AppColors.disabled,
              width: 2,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(
                    hasPhoto ? Icons.check_circle : Icons.camera_alt,
                    size: 32,
                    color: hasPhoto ? AppColors.success : AppColors.primary,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      title,
                      style: AppText.body.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: hasPhoto ? AppColors.successBg : AppColors.infoBg,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      hasPhoto ? '다시 찍기' : '사진 찍기',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: hasPhoto ? AppColors.success : AppColors.primary,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(subtitle, style: AppText.caption),
              if (hasPhoto) ...[
                const SizedBox(height: 12),
                ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: Image.file(
                    File(photoPath!),
                    key: ValueKey(photoPath),
                    height: 150,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    cacheWidth: 480,
                    gaplessPlayback: true,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _OdometerInputCard extends StatelessWidget {
  const _OdometerInputCard({
    required this.controller,
    required this.onChanged,
    this.hintKm,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final int? hintKm;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.disabled, width: 2),
      ),
      child: Row(
        children: [
          const Icon(Icons.speed, size: 34, color: AppColors.primary),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              keyboardType: TextInputType.number,
              inputFormatters: [const ThousandsSeparatorInputFormatter()],
              style: const TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w800,
                color: AppColors.text,
              ),
              decoration: InputDecoration(
                border: InputBorder.none,
                hintText: hintKm != null ? '예: ${formatComma(hintKm)}' : '예: 182,340',
                hintStyle: const TextStyle(
                  fontSize: 24,
                  color: AppColors.subText,
                ),
              ),
            ),
          ),
          const Text(
            'km',
            style: TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w700,
              color: AppColors.subText,
            ),
          ),
        ],
      ),
    );
  }
}

class _ChecklistTile extends StatelessWidget {
  const _ChecklistTile({
    required this.title,
    required this.selected,
    required this.onChanged,
  });

  final String title;
  final String? selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final isOk = selected == 'ok';
    final isWarn = selected == 'warn';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.disabled, width: 2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: AppText.body.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _ChoiceButton(
                  label: '정상',
                  icon: Icons.check_circle_outline,
                  selected: isOk,
                  activeBg: AppColors.success,
                  onTap: () => onChanged('ok'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ChoiceButton(
                  label: '확인 필요',
                  icon: Icons.warning_amber_rounded,
                  selected: isWarn,
                  activeBg: AppColors.warn,
                  onTap: () => onChanged('warn'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ChoiceButton extends StatelessWidget {
  const _ChoiceButton({
    required this.label,
    required this.icon,
    required this.selected,
    required this.activeBg,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final Color activeBg;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bg = selected ? activeBg : AppColors.background;
    final fg = selected ? Colors.white : AppColors.text;

    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 26, color: fg),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: fg,
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

class _SubmitButton extends StatelessWidget {
  const _SubmitButton({
    required this.enabled,
    required this.isSubmitting,
    required this.remainingCount,
    required this.onTap,
  });

  final bool enabled;
  final bool isSubmitting;
  final int remainingCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bg = enabled ? AppColors.primary : AppColors.disabled;
    final fg = enabled ? Colors.white : AppColors.disabledText;

    final String text;
    if (isSubmitting) {
      text = '저장하는 중...';
    } else if (remainingCount == 0) {
      text = '출근 완료';
    } else {
      text = '남은 필수 항목 $remainingCount개';
    }

    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(24),
      clipBehavior: Clip.antiAlias,
      elevation: enabled ? 4 : 0,
      child: InkWell(
        onTap: enabled ? onTap : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
          child: Center(
            child: Text(
              text,
              textAlign: TextAlign.center,
              style: AppText.bigButton.copyWith(color: fg),
            ),
          ),
        ),
      ),
    );
  }
}
