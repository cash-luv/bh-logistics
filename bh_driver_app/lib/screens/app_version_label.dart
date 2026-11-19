import 'dart:async';

import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../theme/app_theme.dart';

/// 관리자·개발자 확인용 앱 버전 표시. 예) "v1.0.7 (8)"
/// 화면 진입 시 작은 글씨로 3초간 보여 준 뒤 자연스럽게 사라집니다.
class AppVersionLabel extends StatefulWidget {
  const AppVersionLabel({super.key});

  @override
  State<AppVersionLabel> createState() => _AppVersionLabelState();
}

class _AppVersionLabelState extends State<AppVersionLabel> {
  String _versionText = '';
  bool _visible = true;
  bool _collapsed = false;
  Timer? _hideTimer;
  Timer? _collapseTimer;

  @override
  void initState() {
    super.initState();
    _loadVersion();
    _hideTimer = Timer(const Duration(seconds: 3), () {
      if (!mounted) return;
      setState(() => _visible = false);
      _collapseTimer = Timer(const Duration(milliseconds: 400), () {
        if (!mounted) return;
        setState(() => _collapsed = true);
      });
    });
  }

  Future<void> _loadVersion() async {
    try {
      final info = await PackageInfo.fromPlatform();
      if (!mounted) return;
      setState(() {
        _versionText = 'v${info.version} (${info.buildNumber})';
      });
    } catch (_) {}
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    _collapseTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_collapsed || _versionText.isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: AnimatedOpacity(
        opacity: _visible ? 1.0 : 0.0,
        duration: const Duration(milliseconds: 400),
        child: Center(
          child: Text(
            _versionText,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.subText.withValues(alpha: 0.55),
            ),
          ),
        ),
      ),
    );
  }
}
