import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../models/driver_home_info.dart';
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';

/// 운행 중 주유할 때 주유카드 영수증 사진과 결제 금액을 등록하는 화면입니다.
class FuelLogScreen extends StatefulWidget {
  const FuelLogScreen({
    super.key,
    required this.driverId,
    required this.currentHomeInfo,
  });

  final String driverId;
  final DriverHomeInfo currentHomeInfo;

  @override
  State<FuelLogScreen> createState() => _FuelLogScreenState();
}

class _FuelLogScreenState extends State<FuelLogScreen> {
  final ImagePicker _picker = ImagePicker();
  final TextEditingController _amountController = TextEditingController();
  final TextEditingController _litersController = TextEditingController();

  String? _receiptPhotoPath;
  bool _isOpeningCamera = false;
  bool _isSubmitting = false;
  String? _progressMessage;
  String? _errorMessage;

  @override
  void dispose() {
    _amountController.dispose();
    _litersController.dispose();
    super.dispose();
  }

  int? get _parsedAmount {
    final raw = _amountController.text.replaceAll(',', '').trim();
    if (raw.isEmpty) return null;
    final val = int.tryParse(raw);
    if (val == null || val <= 0) return null;
    return val;
  }

  double? get _parsedLiters {
    final raw = _litersController.text.replaceAll(',', '').trim();
    if (raw.isEmpty) return null;
    final val = double.tryParse(raw);
    if (val == null || val <= 0) return null;
    return val;
  }

  int get _remainingCount {
    final missingPhoto = _receiptPhotoPath == null ? 1 : 0;
    final missingAmount = _parsedAmount == null ? 1 : 0;
    return missingPhoto + missingAmount;
  }

  bool get _canSubmit => _remainingCount == 0 && !_isSubmitting;

  Future<void> _takeReceiptPhoto() async {
    if (_isOpeningCamera || _isSubmitting) return;
    _isOpeningCamera = true;
    try {
      final XFile? picked = await _picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 65,
        maxWidth: 960,
        maxHeight: 960,
      );
      if (picked != null && mounted) {
        setState(() {
          _receiptPhotoPath = picked.path;
        });
      }
    } catch (_) {
      try {
        final XFile? picked = await _picker.pickImage(
          source: ImageSource.gallery,
          imageQuality: 65,
          maxWidth: 960,
          maxHeight: 960,
        );
        if (picked != null && mounted) {
          setState(() {
            _receiptPhotoPath = picked.path;
          });
        }
      } catch (_) {}
    } finally {
      _isOpeningCamera = false;
    }
  }

  Future<void> _submit() async {
    final amount = _parsedAmount;
    final photo = _receiptPhotoPath;
    if (!_canSubmit || amount == null || photo == null) return;
    FocusScope.of(context).unfocus();

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
      _progressMessage = '주유 내역을 저장하는 중...';
    });

    try {
      final updatedInfo = await FirestoreService.saveFuelReceipt(
        driverId: widget.driverId,
        localPhotoPath: photo,
        fuelCostWon: amount,
        fuelLiters: _parsedLiters,
        currentHomeInfo: widget.currentHomeInfo,
        onProgress: (msg) {
          if (!mounted) return;
          setState(() {
            _progressMessage = msg;
          });
        },
      );
      if (!mounted) return;
      Navigator.of(context).pop(updatedInfo);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _progressMessage = null;
        _errorMessage = '저장에 실패했어요. 다시 시도해 주세요.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final remaining = _remainingCount;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        title: const Text(
          '주유 영수증 · 금액 등록',
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
                const Text('1. 주유 영수증 사진 (필수)', style: AppText.heading),
                const SizedBox(height: 6),
                const Text(
                  '주유카드 영수증의 금액이 잘 보이게 찍어 주세요.',
                  style: AppText.caption,
                ),
                const SizedBox(height: 12),
                Material(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(20),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: _takeReceiptPhoto,
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: _receiptPhotoPath != null
                              ? AppColors.success
                              : AppColors.disabled,
                          width: 2,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Icon(
                                _receiptPhotoPath != null
                                    ? Icons.check_circle
                                    : Icons.receipt_long,
                                size: 32,
                                color: _receiptPhotoPath != null
                                    ? AppColors.success
                                    : AppColors.primary,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  '영수증 사진 찍기',
                                  style: AppText.body.copyWith(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 6,
                                ),
                                decoration: BoxDecoration(
                                  color: _receiptPhotoPath != null
                                      ? AppColors.successBg
                                      : AppColors.infoBg,
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text(
                                  _receiptPhotoPath != null ? '다시 찍기' : '사진 찍기',
                                  style: TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w700,
                                    color: _receiptPhotoPath != null
                                        ? AppColors.success
                                        : AppColors.primary,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          if (_receiptPhotoPath != null) ...[
                            const SizedBox(height: 12),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(14),
                              child: Image.file(
                                File(_receiptPhotoPath!),
                                height: 160,
                                width: double.infinity,
                                fit: BoxFit.cover,
                                cacheWidth: 480,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                const Text('2. 주유카드 결제 금액 (필수)', style: AppText.heading),
                const SizedBox(height: 6),
                const Text(
                  '영수증에 찍힌 결제 금액(원)을 입력해 주세요.',
                  style: AppText.caption,
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 14,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.disabled, width: 2),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.local_gas_station,
                        size: 34,
                        color: AppColors.primary,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _amountController,
                          onChanged: (_) => setState(() {}),
                          keyboardType: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                          ],
                          style: const TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.w800,
                            color: AppColors.text,
                          ),
                          decoration: const InputDecoration(
                            border: InputBorder.none,
                            hintText: '예: 110000',
                            hintStyle: TextStyle(
                              fontSize: 24,
                              color: AppColors.subText,
                            ),
                          ),
                        ),
                      ),
                      const Text(
                        '원',
                        style: TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w700,
                          color: AppColors.subText,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                const Text('3. 주유 리터 수 (선택 사항)', style: AppText.heading),
                const SizedBox(height: 6),
                const Text(
                  '영수증에 주유량(L)이 나와 있으면 적어 주세요.',
                  style: AppText.caption,
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 14,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.disabled, width: 2),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.water_drop_outlined,
                        size: 32,
                        color: AppColors.subText,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _litersController,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          style: const TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                            color: AppColors.text,
                          ),
                          decoration: const InputDecoration(
                            border: InputBorder.none,
                            hintText: '예: 70 (안 적어도 됨)',
                            hintStyle: TextStyle(
                              fontSize: 22,
                              color: AppColors.subText,
                            ),
                          ),
                        ),
                      ),
                      const Text(
                        'L',
                        style: TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w700,
                          color: AppColors.subText,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 28),
                if (_isSubmitting && _progressMessage != null) ...[
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.infoBg,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Text(
                      _progressMessage!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        color: AppColors.primary,
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                if (_errorMessage != null) ...[
                  Text(
                    _errorMessage!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: AppColors.warn,
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                Material(
                  color: _canSubmit ? AppColors.primary : AppColors.disabled,
                  borderRadius: BorderRadius.circular(24),
                  elevation: _canSubmit ? 4 : 0,
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: _canSubmit ? _submit : null,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        vertical: 20,
                        horizontal: 16,
                      ),
                      child: Center(
                        child: Text(
                          _isSubmitting
                              ? '저장 중...'
                              : remaining == 0
                                  ? '주유 내역 저장 완료'
                                  : '남은 필수 항목 $remaining개',
                          style: AppText.bigButton.copyWith(
                            color: _canSubmit
                                ? Colors.white
                                : AppColors.disabledText,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
