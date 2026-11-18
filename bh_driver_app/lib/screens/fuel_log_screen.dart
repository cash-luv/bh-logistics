import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../models/driver_home_info.dart';
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';
import '../utils/formatters.dart';

/// 운행 중 주유할 때 주유카드 영수증 사진과 결제 금액(요소수, 워셔액 등 기타 품목 포함)을 등록하는 화면입니다.
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

  // 기타 품목 (요소수, 워셔액, 첨가제, 기타)
  bool _includeExtraItems = false;
  int _ureaQty = 0; // 요소수 (통)
  final TextEditingController _ureaCostController = TextEditingController();
  int _washerQty = 0; // 워셔액 (통)
  final TextEditingController _washerCostController = TextEditingController();
  int _additiveQty = 0; // 연료첨가제 (통)
  final TextEditingController _additiveCostController = TextEditingController();
  int _otherQty = 0; // 기타
  final TextEditingController _otherNameController = TextEditingController();
  final TextEditingController _otherCostController = TextEditingController();

  String? _receiptPhotoPath;
  bool _isOpeningCamera = false;
  bool _isSubmitting = false;
  String? _progressMessage;
  String? _errorMessage;

  @override
  void dispose() {
    _amountController.dispose();
    _litersController.dispose();
    _ureaCostController.dispose();
    _washerCostController.dispose();
    _additiveCostController.dispose();
    _otherNameController.dispose();
    _otherCostController.dispose();
    super.dispose();
  }

  int? get _parsedAmount => parseCommaInt(_amountController.text);

  double? get _parsedLiters {
    final raw = _litersController.text.replaceAll(',', '').trim();
    if (raw.isEmpty) return null;
    final val = double.tryParse(raw);
    if (val == null || val <= 0) return null;
    return val;
  }

  /// 기타 품목 요약 목록 생성
  (List<Map<String, dynamic>>, String) _buildExtraItemsData() {
    if (!_includeExtraItems) return (<Map<String, dynamic>>[], '');

    final list = <Map<String, dynamic>>[];
    final summaryParts = <String>[];

    if (_ureaQty > 0) {
      final cost = parseCommaInt(_ureaCostController.text) ?? 0;
      list.add({
        'name': '요소수',
        'qty': _ureaQty,
        'unit': '통',
        if (cost > 0) 'cost': cost,
      });
      summaryParts.add('요소수 $_ureaQty통${cost > 0 ? '(${formatComma(cost)}원)' : ''}');
    }

    if (_washerQty > 0) {
      final cost = parseCommaInt(_washerCostController.text) ?? 0;
      list.add({
        'name': '워셔액',
        'qty': _washerQty,
        'unit': '통',
        if (cost > 0) 'cost': cost,
      });
      summaryParts.add('워셔액 $_washerQty통${cost > 0 ? '(${formatComma(cost)}원)' : ''}');
    }

    if (_additiveQty > 0) {
      final cost = parseCommaInt(_additiveCostController.text) ?? 0;
      list.add({
        'name': '연료첨가제',
        'qty': _additiveQty,
        'unit': '통',
        if (cost > 0) 'cost': cost,
      });
      summaryParts.add('연료첨가제 $_additiveQty통${cost > 0 ? '(${formatComma(cost)}원)' : ''}');
    }

    final otherName = _otherNameController.text.trim();
    if (_otherQty > 0 && otherName.isNotEmpty) {
      final cost = parseCommaInt(_otherCostController.text) ?? 0;
      list.add({
        'name': otherName,
        'qty': _otherQty,
        'unit': '개',
        if (cost > 0) 'cost': cost,
      });
      summaryParts.add('$otherName $_otherQty개${cost > 0 ? '(${formatComma(cost)}원)' : ''}');
    }

    return (list, summaryParts.join(', '));
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
      _progressMessage = '주유 내역 및 품목을 저장하는 중...';
    });

    final (extraItems, extraSummary) = _buildExtraItemsData();

    try {
      final updatedInfo = await FirestoreService.saveFuelReceipt(
        driverId: widget.driverId,
        localPhotoPath: photo,
        fuelCostWon: amount,
        fuelLiters: _parsedLiters,
        extraItems: extraItems,
        extraItemsSummary: extraSummary,
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
    final (extraItemsList, extraSummary) = _buildExtraItemsData();

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
                const Text(
                  '주유 영수증 사진을 찍고,\n영수증 총금액을 적어 주세요.',
                  style: AppText.heading,
                ),
                const SizedBox(height: 6),
                const Text(
                  '요소수, 워셔액, 첨가제도 함께 입력할 수 있습니다.',
                  style: AppText.caption,
                ),
                const SizedBox(height: 20),

                // 1. 영수증 사진 촬영 카드
                _buildReceiptCard(),
                const SizedBox(height: 24),

                // 2. 주유카드 결제 총금액 (콤마 자동 서식)
                const Text(
                  '영수증 총 결제 금액 (필수)',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  '영수증에 찍힌 결제 금액을 입력해 주세요.',
                  style: AppText.caption,
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: _parsedAmount != null ? AppColors.primary : AppColors.disabled,
                      width: 2,
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.credit_card, size: 34, color: AppColors.primary),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _amountController,
                          keyboardType: TextInputType.number,
                          inputFormatters: [const ThousandsSeparatorInputFormatter()],
                          onChanged: (_) => setState(() {}),
                          style: const TextStyle(
                            fontSize: 30,
                            fontWeight: FontWeight.w900,
                            color: AppColors.primary,
                          ),
                          decoration: const InputDecoration(
                            border: InputBorder.none,
                            hintText: '예: 120,000',
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
                          fontSize: 28,
                          fontWeight: FontWeight.w800,
                          color: AppColors.text,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),

                // 3. 주유량 (L, 선택)
                const Text(
                  '주유량 (선택)',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  '영수증에 주유량(L)이 나와 있으면 적어 주세요.',
                  style: AppText.caption,
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
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
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
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
                const SizedBox(height: 24),

                // 4. 기타 품목 (요소수 / 워셔액 / 첨가제 등) 체크박스 및 확장 카드
                _buildExtraItemsSection(extraSummary),
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

                // 5. 저장 완료 버튼
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
                            color: _canSubmit ? Colors.white : AppColors.disabledText,
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

  /// 1. 영수증 사진 카드
  Widget _buildReceiptCard() {
    final photo = _receiptPhotoPath;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: photo != null ? AppColors.success : AppColors.primary,
          width: 2.5,
        ),
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: photo != null ? AppColors.successBg : AppColors.infoBg,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  photo != null ? Icons.check_circle : Icons.camera_alt,
                  color: photo != null ? AppColors.success : AppColors.primary,
                  size: 28,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '영수증 사진 (필수)',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        color: AppColors.text,
                      ),
                    ),
                    Text(
                      photo != null ? '촬영 완료됨' : '카드 결제 영수증을 찍어 주세요',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        color: photo != null ? AppColors.success : AppColors.subText,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (photo != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.file(
                File(photo),
                height: 200,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(height: 12),
          ],
          ElevatedButton.icon(
            onPressed: _takeReceiptPhoto,
            icon: Icon(
              photo == null ? Icons.photo_camera : Icons.refresh,
              size: 26,
            ),
            label: Text(
              photo == null ? '영수증 사진 촬영' : '다시 촬영하기',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            style: ElevatedButton.styleFrom(
              backgroundColor: photo == null ? AppColors.primary : AppColors.surface,
              foregroundColor: photo == null ? Colors.white : AppColors.primary,
              side: photo == null ? null : const BorderSide(color: AppColors.primary, width: 2),
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// 4. 기타 품목 (요소수 / 워셔액 / 첨가제) 섹션
  Widget _buildExtraItemsSection(String summary) {
    return Container(
      decoration: BoxDecoration(
        color: _includeExtraItems ? const Color(0xFFF0FDF4) : AppColors.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: _includeExtraItems ? const Color(0xFF10B981) : AppColors.disabled,
          width: 2,
        ),
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: () {
              setState(() {
                _includeExtraItems = !_includeExtraItems;
              });
            },
            borderRadius: BorderRadius.circular(14),
            child: Row(
              children: [
                Checkbox(
                  value: _includeExtraItems,
                  onChanged: (val) {
                    setState(() {
                      _includeExtraItems = val ?? false;
                    });
                  },
                  activeColor: const Color(0xFF10B981),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                ),
                const SizedBox(width: 6),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '요소수 · 워셔액 · 첨가제 함께 결제함',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          color: AppColors.text,
                        ),
                      ),
                      Text(
                        '주유할 때 함께 넣은 소모품이 있다면 체크해 주세요.',
                        style: TextStyle(fontSize: 18, color: AppColors.subText),
                      ),
                    ],
                  ),
                ),
                Icon(
                  _includeExtraItems ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                  size: 32,
                  color: AppColors.subText,
                ),
              ],
            ),
          ),

          if (_includeExtraItems) ...[
            const Divider(height: 28, thickness: 1.5),

            // 요소수 항목
            _buildItemCounterRow(
              title: '🧪 요소수',
              qty: _ureaQty,
              costController: _ureaCostController,
              unit: '통',
              hintCost: '예: 12,000',
              onDecrement: () => setState(() => _ureaQty = (_ureaQty - 1).clamp(0, 99)),
              onIncrement: () => setState(() => _ureaQty++),
            ),
            const SizedBox(height: 18),

            // 워셔액 항목
            _buildItemCounterRow(
              title: '🚿 워셔액',
              qty: _washerQty,
              costController: _washerCostController,
              unit: '통',
              hintCost: '예: 3,000',
              onDecrement: () => setState(() => _washerQty = (_washerQty - 1).clamp(0, 99)),
              onIncrement: () => setState(() => _washerQty++),
            ),
            const SizedBox(height: 18),

            // 연료첨가제 항목
            _buildItemCounterRow(
              title: '⚡ 연료첨가제',
              qty: _additiveQty,
              costController: _additiveCostController,
              unit: '통',
              hintCost: '예: 15,000',
              onDecrement: () => setState(() => _additiveQty = (_additiveQty - 1).clamp(0, 99)),
              onIncrement: () => setState(() => _additiveQty++),
            ),
            const SizedBox(height: 18),

            // 직접 입력 (기타)
            _buildOtherCustomRow(),

            if (summary.isNotEmpty) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFFDCFCE7),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF86EFAC)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle, color: Color(0xFF16A34A), size: 22),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '포함 품목: $summary',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF166534),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }

  /// 단일 품목 카운터 & 금액 입력 행
  Widget _buildItemCounterRow({
    required String title,
    required int qty,
    required TextEditingController costController,
    required String unit,
    required String hintCost,
    required VoidCallback onDecrement,
    required VoidCallback onIncrement,
  }) {
    final hasCount = qty > 0;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: hasCount ? Colors.white : const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: hasCount ? const Color(0xFF10B981) : const Color(0xFFE2E8F0),
          width: 1.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.text,
                  ),
                ),
              ),
              // 수량 카운터 큰 버튼
              Row(
                children: [
                  IconButton(
                    onPressed: onDecrement,
                    icon: const Icon(Icons.remove_circle_outline),
                    iconSize: 34,
                    color: qty > 0 ? AppColors.text : AppColors.disabled,
                  ),
                  Container(
                    constraints: const BoxConstraints(minWidth: 54),
                    alignment: Alignment.center,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: hasCount ? const Color(0xFFE0F2FE) : const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '$qty$unit',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: hasCount ? const Color(0xFF0369A1) : AppColors.subText,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: onIncrement,
                    icon: const Icon(Icons.add_circle),
                    iconSize: 34,
                    color: const Color(0xFF10B981),
                  ),
                ],
              ),
            ],
          ),
          if (hasCount) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                const Text(
                  '품목 금액:',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.subText),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFCBD5E1)),
                    ),
                    child: TextField(
                      controller: costController,
                      keyboardType: TextInputType.number,
                      inputFormatters: [const ThousandsSeparatorInputFormatter()],
                      onChanged: (_) => setState(() {}),
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                      decoration: InputDecoration(
                        border: InputBorder.none,
                        isDense: true,
                        hintText: hintCost,
                        hintStyle: const TextStyle(fontSize: 18, color: AppColors.subText),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                const Text('원', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// 직접 입력 (기타 품목)
  Widget _buildOtherCustomRow() {
    final hasCount = _otherQty > 0;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: hasCount ? Colors.white : const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: hasCount ? const Color(0xFF10B981) : const Color(0xFFE2E8F0),
          width: 1.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _otherNameController,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                  decoration: const InputDecoration(
                    border: InputBorder.none,
                    hintText: '📝 기타 소모품 직접 입력 (예: 와이퍼)',
                    hintStyle: TextStyle(fontSize: 18, color: AppColors.subText),
                  ),
                ),
              ),
              Row(
                children: [
                  IconButton(
                    onPressed: () => setState(() => _otherQty = (_otherQty - 1).clamp(0, 99)),
                    icon: const Icon(Icons.remove_circle_outline),
                    iconSize: 34,
                    color: _otherQty > 0 ? AppColors.text : AppColors.disabled,
                  ),
                  Container(
                    constraints: const BoxConstraints(minWidth: 54),
                    alignment: Alignment.center,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: hasCount ? const Color(0xFFE0F2FE) : const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '$_otherQty개',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: hasCount ? const Color(0xFF0369A1) : AppColors.subText,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => setState(() => _otherQty++),
                    icon: const Icon(Icons.add_circle),
                    iconSize: 34,
                    color: const Color(0xFF10B981),
                  ),
                ],
              ),
            ],
          ),
          if (hasCount) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                const Text(
                  '금액:',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.subText),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: const Color(0xFFCBD5E1)),
                    ),
                    child: TextField(
                      controller: _otherCostController,
                      keyboardType: TextInputType.number,
                      inputFormatters: [const ThousandsSeparatorInputFormatter()],
                      onChanged: (_) => setState(() {}),
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                      decoration: const InputDecoration(
                        border: InputBorder.none,
                        isDense: true,
                        hintText: '예: 8,000',
                        hintStyle: TextStyle(fontSize: 18, color: AppColors.subText),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                const Text('원', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
