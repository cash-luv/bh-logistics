import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/auth_service.dart';
import '../theme/app_theme.dart';

/// 초기 비밀번호(생년월일)로 첫 로그인했을 때, 또는 기사님이 원할 때
/// 새 6자리 숫자 비밀번호로 바꾸는 화면입니다.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({
    super.key,
    required this.isInitialSetup,
    this.onCompleted,
  });

  /// true이면 첫 로그인 안내 문구를 보여주고, [나중에 바꾸기] 버튼도 함께 제공합니다.
  final bool isInitialSetup;
  final VoidCallback? onCompleted;

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final TextEditingController _newController = TextEditingController();
  final TextEditingController _confirmController = TextEditingController();
  bool _isSaving = false;
  String? _errorMessage;

  @override
  void dispose() {
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  bool get _isTooShort =>
      _newController.text.isNotEmpty && _newController.text.length < 6;

  bool get _isMismatch =>
      _confirmController.text.isNotEmpty &&
      _newController.text != _confirmController.text;

  bool get _canSubmit =>
      _newController.text.length >= 6 &&
      _newController.text == _confirmController.text &&
      !_isSaving;

  Future<void> _save() async {
    if (!_canSubmit) return;
    FocusScope.of(context).unfocus();

    setState(() {
      _isSaving = true;
      _errorMessage = null;
    });

    try {
      await AuthService.changePassword(_newController.text);
      if (!mounted) return;
      if (widget.onCompleted != null) {
        widget.onCompleted!();
      } else {
        Navigator.of(context).pop(true);
      }
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.code == 'requires-recent-login') {
          _errorMessage = '보안을 위해 다시 로그인한 뒤 비밀번호를 바꿔 주세요.';
        } else {
          _errorMessage = '비밀번호를 바꾸지 못했어요. 6자리 이상 숫자로 입력해 주세요.';
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = '비밀번호 변경 중 문제가 생겼어요. 다시 시도해 주세요.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        automaticallyImplyLeading: !widget.isInitialSetup,
        title: const Text(
          '비밀번호 변경',
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
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.isInitialSetup) ...[
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.infoBg,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: const Text(
                      '처음 로그인하셨네요!\n생년월일 대신 앞으로 쓰실 나만의 숫자 비밀번호(6자리)로 바꿔 주세요.',
                      style: AppText.body,
                    ),
                  ),
                  const SizedBox(height: 24),
                ],
                const Text('1. 새 비밀번호 (숫자 6자리)', style: AppText.heading),
                const SizedBox(height: 8),
                _PinBox(
                  controller: _newController,
                  hintText: '새 숫자 6자리 입력',
                  onChanged: (_) => setState(() {}),
                ),
                if (_isTooShort) ...[
                  const SizedBox(height: 8),
                  const Text(
                    '숫자 6자리 이상 입력해 주세요.',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: AppColors.warn,
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                const Text('2. 새 비밀번호 한 번 더 입력', style: AppText.heading),
                const SizedBox(height: 8),
                _PinBox(
                  controller: _confirmController,
                  hintText: '똑같이 한 번 더 입력',
                  onChanged: (_) => setState(() {}),
                ),
                if (_isMismatch) ...[
                  const SizedBox(height: 8),
                  const Text(
                    '위에서 입력한 숫자와 달라요. 다시 확인해 주세요.',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: AppColors.warn,
                    ),
                  ),
                ],
                if (_errorMessage != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: AppColors.warnBg,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.warn, width: 2),
                    ),
                    child: Text(
                      _errorMessage!,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: AppColors.warn,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 28),
                Material(
                  color: _canSubmit ? AppColors.primary : AppColors.disabled,
                  borderRadius: BorderRadius.circular(24),
                  elevation: _canSubmit ? 4 : 0,
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: _canSubmit ? _save : null,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        vertical: 20,
                        horizontal: 16,
                      ),
                      child: Center(
                        child: Text(
                          _isSaving ? '변경 중...' : '비밀번호 바꾸기 완료',
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
                if (widget.isInitialSetup && widget.onCompleted != null) ...[
                  const SizedBox(height: 14),
                  TextButton(
                    onPressed: widget.onCompleted,
                    child: const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        '다음에 바꾸기 (바로 시작)',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: AppColors.subText,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PinBox extends StatelessWidget {
  const _PinBox({
    required this.controller,
    required this.hintText,
    required this.onChanged,
  });

  final TextEditingController controller;
  final String hintText;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.disabled, width: 2),
      ),
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        style: const TextStyle(
          fontSize: 28,
          fontWeight: FontWeight.w800,
          color: AppColors.text,
          letterSpacing: 4,
        ),
        decoration: InputDecoration(
          border: InputBorder.none,
          hintText: hintText,
          hintStyle: const TextStyle(
            fontSize: 22,
            letterSpacing: 0,
            color: AppColors.subText,
          ),
        ),
      ),
    );
  }
}
