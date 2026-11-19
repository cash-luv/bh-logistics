import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/auth_service.dart';
import '../services/draft_storage.dart';
import '../theme/app_theme.dart';
import 'app_version_label.dart';

/// 기사용 로그인 화면
/// - 관리자가 부여한 기사 ID 코드(예: bh01) + 6자리 비밀번호(초기: 생년월일 6자리)
/// - 모든 글씨 20 이상(AppText), 큰 버튼 중심
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  late final TextEditingController _codeController;
  final TextEditingController _passwordController = TextEditingController();
  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _codeController = TextEditingController(text: DraftStorage.savedDriverCode);
  }

  @override
  void dispose() {
    _codeController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      _codeController.text.trim().isNotEmpty &&
      _passwordController.text.trim().length >= 6 &&
      !_isLoading;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    FocusScope.of(context).unfocus();

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      await AuthService.signInWithCode(
        driverCode: _codeController.text,
        password: _passwordController.text,
      );
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = _friendlyError(e.code);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = '로그인 중 문제가 생겼어요. 인터넷 연결을 확인해 주세요.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  String _friendlyError(String code) {
    return switch (code) {
      'user-not-found' ||
      'invalid-credential' ||
      'wrong-password' =>
        '기사 코드 또는 비밀번호가 맞지 않아요.\n다시 확인해 주세요.',
      'user-disabled' => '사용이 중지된 계정이에요. 관리자에게 문의해 주세요.',
      'too-many-requests' => '시도 횟수가 너무 많아요. 잠시 뒤에 다시 눌러 주세요.',
      'network-request-failed' => '인터넷 연결이 불안정해요. 잠시 뒤 다시 시도해 주세요.',
      _ => '로그인할 수 없어요. 기사 코드와 비밀번호를 확인해 주세요.',
    };
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: GestureDetector(
          onTap: () => FocusScope.of(context).unfocus(),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 32, 24, 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Image.asset(
                    'assets/icon/splash_logo.png',
                    height: 76,
                    fit: BoxFit.contain,
                  ),
                ),
                const SizedBox(height: 18),
                const Text('기사님 로그인', style: AppText.title),
                const SizedBox(height: 8),
                const Text(
                  '한 번 로그인하면 다음부터는 자동으로 켜집니다.',
                  style: AppText.caption,
                ),
                const SizedBox(height: 28),
                const Text('1. 기사 코드', style: AppText.heading),
                const SizedBox(height: 6),
                const Text(
                  '회사에서 받은 기사 코드를 입력해 주세요. (예: bh01)',
                  style: AppText.caption,
                ),
                const SizedBox(height: 10),
                _InputBox(
                  icon: Icons.badge_outlined,
                  trailing: _codeController.text.isNotEmpty
                      ? IconButton(
                          iconSize: 28,
                          tooltip: '지우기',
                          onPressed: () {
                            _codeController.clear();
                            setState(() {});
                          },
                          icon: const Icon(
                            Icons.cancel_outlined,
                            color: AppColors.subText,
                          ),
                        )
                      : null,
                  child: TextField(
                    controller: _codeController,
                    onChanged: (_) => setState(() {}),
                    textInputAction: TextInputAction.next,
                    autocorrect: false,
                    style: const TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w800,
                      color: AppColors.text,
                    ),
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      hintText: '예: bh01',
                      hintStyle: TextStyle(
                        fontSize: 22,
                        color: AppColors.subText,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                const Text('2. 비밀번호 (숫자 6자리)', style: AppText.heading),
                const SizedBox(height: 6),
                const Text(
                  '처음 로그인할 때는 생년월일 6자리(예: 650315)를 입력해 주세요.',
                  style: AppText.caption,
                ),
                const SizedBox(height: 10),
                _InputBox(
                  icon: Icons.lock_outline,
                  trailing: IconButton(
                    iconSize: 30,
                    onPressed: () => setState(() {
                      _obscurePassword = !_obscurePassword;
                    }),
                    icon: Icon(
                      _obscurePassword
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                      color: AppColors.subText,
                    ),
                  ),
                  child: TextField(
                    controller: _passwordController,
                    onChanged: (_) => setState(() {}),
                    obscureText: _obscurePassword,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    onSubmitted: (_) => _submit(),
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                      color: AppColors.text,
                      letterSpacing: 4,
                    ),
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      hintText: '예: 650315',
                      hintStyle: TextStyle(
                        fontSize: 22,
                        letterSpacing: 0,
                        color: AppColors.subText,
                      ),
                    ),
                  ),
                ),
                if (_errorMessage != null) ...[
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.warnBg,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: AppColors.warn, width: 2),
                    ),
                    child: Row(
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
                              color: AppColors.warn,
                            ),
                          ),
                        ),
                      ],
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
                    onTap: _canSubmit ? _submit : null,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        vertical: 20,
                        horizontal: 16,
                      ),
                      child: Center(
                        child: Text(
                          _isLoading ? '로그인 중...' : '로그인',
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
                const SizedBox(height: 24),
                const AppVersionLabel(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _InputBox extends StatelessWidget {
  const _InputBox({
    required this.icon,
    required this.child,
    this.trailing,
  });

  final IconData icon;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.disabled, width: 2),
      ),
      child: Row(
        children: [
          Icon(icon, size: 32, color: AppColors.primary),
          const SizedBox(width: 12),
          Expanded(child: child),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}
