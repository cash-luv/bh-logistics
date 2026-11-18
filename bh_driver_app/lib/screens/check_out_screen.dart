import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';

import '../models/check_out_result.dart';
import '../models/driver_home_info.dart';
import '../services/draft_storage.dart';
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

/// 퇴근 / 빠른 보고 화면
class CheckOutScreen extends StatefulWidget {
  const CheckOutScreen({
    super.key,
    required this.driverId,
    required this.currentHomeInfo,
    required this.startOdometerKm,
  });

  final String driverId;
  final DriverHomeInfo currentHomeInfo;
  final int startOdometerKm;

  @override
  State<CheckOutScreen> createState() => _CheckOutScreenState();
}

class _CheckOutScreenState extends State<CheckOutScreen> {
  final ImagePicker _picker = ImagePicker();
  late final TextEditingController _odometerController;
  late final TextEditingController _noteController;

  bool _isOpeningCamera = false;
  bool _isSubmitting = false;
  String? _progressMessage;

  String? _locationErrorMessage;
  bool _canOpenSettings = false;

  String? _uploadErrorMessage;
  double? _lastLatitude;
  double? _lastLongitude;
  double? _lastAccuracyM;

  String? get _dashboardPhotoPath => DraftStorage.checkOutPhoto;
  CheckOutNoteType? get _noteType => DraftStorage.checkOutNoteType;

  @override
  void initState() {
    super.initState();
    DraftStorage.setActiveScreen('checkOut', startKm: widget.startOdometerKm);
    final draftOdo = DraftStorage.checkOutOdometer;
    final initialText = draftOdo.isNotEmpty
        ? formatComma(int.tryParse(draftOdo.replaceAll(',', '')))
        : '';
    _odometerController = TextEditingController(
      text: initialText,
    );
    _noteController = TextEditingController(
      text: DraftStorage.checkOutNote,
    );
    _recoverLostPhotoIfNeeded();
  }

  @override
  void dispose() {
    _odometerController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _recoverLostPhotoIfNeeded() async {
    if (!Platform.isAndroid) return;
    try {
      final LostDataResponse response = await _picker.retrieveLostData();
      if (response.isEmpty) return;
      final file = response.file;
      if (file != null) {
        await DraftStorage.saveCheckOutPhoto(file.path);
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

  bool get _isOdometerTooSmall {
    final val = _parsedOdometer;
    if (val == null) return false;
    return val < widget.startOdometerKm;
  }

  bool get _isOdometerValid {
    final val = _parsedOdometer;
    return val != null && val >= widget.startOdometerKm;
  }

  int get _remainingCount {
    final missingPhoto = _dashboardPhotoPath == null ? 1 : 0;
    final missingOdometer = _isOdometerValid ? 0 : 1;
    final missingNoteType = _noteType == null ? 1 : 0;
    return missingPhoto + missingOdometer + missingNoteType;
  }

  bool get _canSubmit => _remainingCount == 0 && !_isSubmitting;

  Future<void> _takeDashboardPhoto() async {
    if (_isOpeningCamera || _isSubmitting) return;
    _isOpeningCamera = true;
    await DraftStorage.setPendingPhotoKey('checkout_dashboard');

    try {
      final XFile? picked = await _picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 65,
        maxWidth: 960,
        maxHeight: 960,
      );
      if (picked != null) {
        await DraftStorage.saveCheckOutPhoto(picked.path);
        if (mounted) {
          setState(() {});
        }
      } else {
        await DraftStorage.setPendingPhotoKey(null);
      }
    } catch (_) {
      if (mounted) {
        await _pickFromGalleryFallback();
      }
    } finally {
      _isOpeningCamera = false;
    }
  }

  Future<void> _pickFromGalleryFallback() async {
    try {
      final XFile? picked = await _picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 65,
        maxWidth: 960,
        maxHeight: 960,
      );
      if (picked != null) {
        await DraftStorage.saveCheckOutPhoto(picked.path);
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

  Future<void> _trySubmitWithLocation() async {
    if (!_canSubmit) return;
    FocusScope.of(context).unfocus();

    setState(() {
      _isSubmitting = true;
      _progressMessage = '현재 위치(GPS)를 확인하는 중...';
      _locationErrorMessage = null;
      _uploadErrorMessage = null;
      _canOpenSettings = false;
    });

    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        if (!mounted) return;
        setState(() {
          _isSubmitting = false;
          _progressMessage = null;
          _locationErrorMessage =
              '휴대폰의 위치(GPS) 기능이 꺼져 있어요.\n위치 기능을 켜고 다시 시도하거나, 위치 없이 퇴근을 마칠 수 있어요.';
          _canOpenSettings = true;
        });
        return;
      }

      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.denied) {
        if (!mounted) return;
        setState(() {
          _isSubmitting = false;
          _progressMessage = null;
          _locationErrorMessage =
              '위치 권한을 허용하지 않으셨어요.\n다시 시도해서 허용하거나, 설정 화면에서 위치 권한을 켜 주세요.';
          _canOpenSettings = true;
        });
        return;
      }

      if (permission == LocationPermission.deniedForever) {
        if (!mounted) return;
        setState(() {
          _isSubmitting = false;
          _progressMessage = null;
          _locationErrorMessage =
              '위치 권한이 꺼져 있어요.\n아래 [설정 열기] 버튼을 눌러 위치 권한을 허용해 주세요.';
          _canOpenSettings = true;
        });
        return;
      }

      Position? position;
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.medium,
            timeLimit: Duration(seconds: 5),
          ),
        );
      } catch (_) {
        position = await Geolocator.getLastKnownPosition();
      }

      if (position == null) {
        if (!mounted) return;
        setState(() {
          _isSubmitting = false;
          _progressMessage = null;
          _locationErrorMessage =
              '현재 위치를 가져오지 못했어요.\n실내나 지하라면 밖에서 [다시 시도]를 누르거나, 바로 퇴근을 완료할 수 있어요.';
          _canOpenSettings = false;
        });
        return;
      }

      if (!mounted) return;
      _lastLatitude = position.latitude;
      _lastLongitude = position.longitude;
      _lastAccuracyM = position.accuracy;

      await _saveToFirebase(
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyM: position.accuracy,
        skipPhotoUpload: false,
      );
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _progressMessage = null;
        _locationErrorMessage =
            '현재 위치를 가져오지 못했어요.\n실내나 지하라면 밖에서 [다시 시도]를 누르거나, 바로 퇴근을 완료할 수 있어요.';
        _canOpenSettings = false;
      });
    }
  }

  /// Firebase(Storage + Firestore WriteBatch)에 퇴근 기록을 저장합니다.
  /// 만약 사진 업로드가 실패해도 퇴근 기록이 날아가지 않도록
  /// [다시 시도] 또는 [사진 없이 퇴근 기록 먼저 저장하기] 선택지를 보여줍니다.
  Future<void> _saveToFirebase({
    double? latitude,
    double? longitude,
    double? accuracyM,
    required bool skipPhotoUpload,
  }) async {
    final endKm = _parsedOdometer;
    final photo = _dashboardPhotoPath;
    final noteType = _noteType;
    if (endKm == null || photo == null || noteType == null) return;

    final result = CheckOutResult(
      endOdometerKm: endKm,
      dashboardPhotoPath: photo,
      latitude: latitude,
      longitude: longitude,
      accuracyM: accuracyM,
      noteType: noteType,
      note: _noteController.text.trim(),
      drivenKm: endKm - widget.startOdometerKm,
    );

    setState(() {
      _isSubmitting = true;
      _locationErrorMessage = null;
      _uploadErrorMessage = null;
      _progressMessage = '퇴근 기록을 준비하는 중...';
    });

    try {
      final updatedInfo = await FirestoreService.saveCheckOut(
        driverId: widget.driverId,
        result: result,
        currentHomeInfo: widget.currentHomeInfo,
        skipPhotoUpload: skipPhotoUpload,
        onProgress: (msg) {
          if (!mounted) return;
          setState(() {
            _progressMessage = msg;
          });
        },
      );

      await DraftStorage.clearCheckOut();
      if (!mounted) return;
      Navigator.of(context).pop(updatedInfo);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _progressMessage = null;
        _uploadErrorMessage =
            '계기판 사진 업로드가 지연되고 있어요.\n[다시 시도]를 누르거나, 사진 없이 퇴근 기록부터 먼저 저장할 수 있어요.';
      });
    }
  }

  Future<void> _openSettings() async {
    final openedApp = await Geolocator.openAppSettings();
    if (!openedApp) {
      await Geolocator.openLocationSettings();
    }
  }

  @override
  Widget build(BuildContext context) {
    final remaining = _remainingCount;
    final endKm = _parsedOdometer;
    final previewDrivenKm =
        (endKm != null && endKm >= widget.startOdometerKm)
            ? endKm - widget.startOdometerKm
            : null;

    return PopScope(
      canPop: !_isSubmitting,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) {
          DraftStorage.setActiveScreen(null);
        }
      },
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: AppColors.teal,
          foregroundColor: Colors.white,
          title: const Text(
            '퇴근 / 빠른 보고',
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
                  const Text('1. 계기판 사진 찍기 (1장)', style: AppText.heading),
                  const SizedBox(height: 6),
                  const Text('주행거리 숫자가 잘 보이게 찍어 주세요.', style: AppText.caption),
                  const SizedBox(height: 14),
                  _DashboardPhotoTile(
                    photoPath: _dashboardPhotoPath,
                    onTap: _takeDashboardPhoto,
                  ),
                  const SizedBox(height: 24),
                  const Text('2. 계기판 주행거리 입력', style: AppText.heading),
                  const SizedBox(height: 6),
                  Text(
                    '오늘 출근 때 주행거리: ${_formatKm(widget.startOdometerKm)}km',
                    style: AppText.caption,
                  ),
                  const SizedBox(height: 12),
                  _OdometerInputCard(
                    controller: _odometerController,
                    startOdometerKm: widget.startOdometerKm,
                    hasError: _isOdometerTooSmall,
                    onChanged: (val) => setState(() {
                      DraftStorage.saveCheckOutOdometer(val);
                    }),
                  ),
                  if (_isOdometerTooSmall) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.warnBg,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: AppColors.warn, width: 2),
                      ),
                      child: const Row(
                        children: [
                          Icon(
                            Icons.warning_amber_rounded,
                            size: 30,
                            color: AppColors.warn,
                          ),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              '출근 때보다 숫자가 작아요. 다시 확인해 주세요',
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w700,
                                color: AppColors.warn,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ] else if (previewDrivenKm != null) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.successBg,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Text(
                        '오늘 운행거리: ${_formatKm(previewDrivenKm)}km',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          color: AppColors.success,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 28),
                  const Text('3. 오늘 차량 특이사항', style: AppText.heading),
                  const SizedBox(height: 6),
                  const Text('버튼 하나를 눌러 주세요.', style: AppText.caption),
                  const SizedBox(height: 14),
                  _NoteTypeSelector(
                    selected: _noteType,
                    onSelected: (type) => setState(() {
                      DraftStorage.saveCheckOutNoteType(type);
                    }),
                  ),
                  const SizedBox(height: 14),
                  _OptionalNoteCard(
                    controller: _noteController,
                    noteType: _noteType,
                    onChanged: (val) {
                      DraftStorage.saveCheckOutNote(val);
                    },
                  ),
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
                                color: AppColors.teal,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  if (_locationErrorMessage != null) ...[
                    _LocationFallbackCard(
                      message: _locationErrorMessage!,
                      canOpenSettings: _canOpenSettings,
                      onRetry: _trySubmitWithLocation,
                      onOpenSettings: _openSettings,
                      onSubmitWithoutLocation: () => _saveToFirebase(
                        skipPhotoUpload: false,
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  if (_uploadErrorMessage != null) ...[
                    _UploadFallbackCard(
                      message: _uploadErrorMessage!,
                      onRetry: () => _saveToFirebase(
                        latitude: _lastLatitude,
                        longitude: _lastLongitude,
                        accuracyM: _lastAccuracyM,
                        skipPhotoUpload: false,
                      ),
                      onSaveRecordWithoutPhoto: () => _saveToFirebase(
                        latitude: _lastLatitude,
                        longitude: _lastLongitude,
                        accuracyM: _lastAccuracyM,
                        skipPhotoUpload: true,
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  _SubmitButton(
                    enabled: _canSubmit,
                    isLoading: _isSubmitting,
                    remainingCount: remaining,
                    onTap: _trySubmitWithLocation,
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

class _DashboardPhotoTile extends StatelessWidget {
  const _DashboardPhotoTile({
    required this.photoPath,
    required this.onTap,
  });

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
                    color: hasPhoto ? AppColors.success : AppColors.teal,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '계기판 사진',
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
                        color: hasPhoto ? AppColors.success : AppColors.teal,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              const Text('칸을 누르면 카메라가 켜집니다.', style: AppText.caption),
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
    required this.startOdometerKm,
    required this.hasError,
    required this.onChanged,
  });

  final TextEditingController controller;
  final int startOdometerKm;
  final bool hasError;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: hasError ? AppColors.warn : AppColors.disabled,
          width: 2,
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.speed,
            size: 34,
            color: hasError ? AppColors.warn : AppColors.teal,
          ),
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
                hintText: '예: ${formatComma(startOdometerKm + 300)}',
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

class _NoteTypeSelector extends StatelessWidget {
  const _NoteTypeSelector({
    required this.selected,
    required this.onSelected,
  });

  final CheckOutNoteType? selected;
  final ValueChanged<CheckOutNoteType> onSelected;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _NoteTypeButton(
          label: '이상 없음',
          icon: Icons.check_circle_outline,
          selected: selected == CheckOutNoteType.none,
          activeColor: AppColors.success,
          onTap: () => onSelected(CheckOutNoteType.none),
        ),
        const SizedBox(height: 10),
        _NoteTypeButton(
          label: '수리했어요',
          icon: Icons.build_circle_outlined,
          selected: selected == CheckOutNoteType.repaired,
          activeColor: AppColors.teal,
          onTap: () => onSelected(CheckOutNoteType.repaired),
        ),
        const SizedBox(height: 10),
        _NoteTypeButton(
          label: '수리가 필요해요',
          icon: Icons.warning_amber_rounded,
          selected: selected == CheckOutNoteType.needsRepair,
          activeColor: AppColors.warn,
          onTap: () => onSelected(CheckOutNoteType.needsRepair),
        ),
      ],
    );
  }
}

class _NoteTypeButton extends StatelessWidget {
  const _NoteTypeButton({
    required this.label,
    required this.icon,
    required this.selected,
    required this.activeColor,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final Color activeColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bg = selected ? activeColor : AppColors.surface;
    final fg = selected ? Colors.white : AppColors.text;
    final borderColor = selected ? activeColor : AppColors.disabled;

    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: borderColor, width: 2),
          ),
          child: Row(
            children: [
              Icon(icon, size: 30, color: fg),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
              ),
              if (selected)
                const Icon(Icons.check, size: 28, color: Colors.white),
            ],
          ),
        ),
      ),
    );
  }
}

class _OptionalNoteCard extends StatelessWidget {
  const _OptionalNoteCard({
    required this.controller,
    required this.noteType,
    required this.onChanged,
  });

  final TextEditingController controller;
  final CheckOutNoteType? noteType;
  final ValueChanged<String> onChanged;

  String get _hint {
    return switch (noteType) {
      CheckOutNoteType.repaired => '수리한 내용을 짧게 적어 주세요 (선택)',
      CheckOutNoteType.needsRepair => '어디가 불편한지 짧게 적어 주세요 (선택)',
      _ => '전달할 내용이 있으면 짧게 적어 주세요 (선택)',
    };
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.disabled, width: 2),
      ),
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        maxLines: 2,
        style: AppText.body,
        decoration: InputDecoration(
          border: InputBorder.none,
          hintText: _hint,
          hintStyle: AppText.caption,
        ),
      ),
    );
  }
}

class _LocationFallbackCard extends StatelessWidget {
  const _LocationFallbackCard({
    required this.message,
    required this.canOpenSettings,
    required this.onRetry,
    required this.onOpenSettings,
    required this.onSubmitWithoutLocation,
  });

  final String message;
  final bool canOpenSettings;
  final VoidCallback onRetry;
  final VoidCallback onOpenSettings;
  final VoidCallback onSubmitWithoutLocation;

  @override
  Widget build(BuildContext context) {
    return Container(
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
              const Icon(Icons.location_off, size: 32, color: AppColors.warn),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  message,
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
          Row(
            children: [
              Expanded(
                child: _SmallActionButton(
                  label: '다시 시도',
                  icon: Icons.refresh,
                  color: AppColors.teal,
                  onTap: onRetry,
                ),
              ),
              if (canOpenSettings) ...[
                const SizedBox(width: 10),
                Expanded(
                  child: _SmallActionButton(
                    label: '설정 열기',
                    icon: Icons.settings,
                    color: AppColors.primary,
                    onTap: onOpenSettings,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 10),
          _SmallActionButton(
            label: '위치 없이 퇴근 완료하기',
            icon: Icons.check_circle_outline,
            color: AppColors.subText,
            onTap: onSubmitWithoutLocation,
          ),
        ],
      ),
    );
  }
}

class _UploadFallbackCard extends StatelessWidget {
  const _UploadFallbackCard({
    required this.message,
    required this.onRetry,
    required this.onSaveRecordWithoutPhoto,
  });

  final String message;
  final VoidCallback onRetry;
  final VoidCallback onSaveRecordWithoutPhoto;

  @override
  Widget build(BuildContext context) {
    return Container(
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
                Icons.cloud_off_outlined,
                size: 32,
                color: AppColors.warn,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  message,
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
          _SmallActionButton(
            label: '사진 다시 올리기',
            icon: Icons.refresh,
            color: AppColors.teal,
            onTap: onRetry,
          ),
          const SizedBox(height: 10),
          _SmallActionButton(
            label: '사진 없이 퇴근 기록 먼저 저장하기',
            icon: Icons.save_outlined,
            color: AppColors.subText,
            onTap: onSaveRecordWithoutPhoto,
          ),
        ],
      ),
    );
  }
}

class _SmallActionButton extends StatelessWidget {
  const _SmallActionButton({
    required this.label,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 24, color: Colors.white),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
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
    required this.isLoading,
    required this.remainingCount,
    required this.onTap,
  });

  final bool enabled;
  final bool isLoading;
  final int remainingCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bg = enabled ? AppColors.teal : AppColors.disabled;
    final fg = enabled ? Colors.white : AppColors.disabledText;

    final String text;
    if (isLoading) {
      text = '저장하는 중...';
    } else if (remainingCount == 0) {
      text = '퇴근 완료';
    } else {
      text = '남은 항목 $remainingCount개';
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

String _formatKm(int km) => km.toString().replaceAllMapped(
      RegExp(r'\B(?=(\d{3})+(?!\d))'),
      (m) => ',',
    );
