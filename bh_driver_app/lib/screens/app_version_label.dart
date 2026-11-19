import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../theme/app_theme.dart';

/// 화면 맨 아래에 작게 보여 주는 앱 버전 표시. 예) "앱 버전 v1.0.6 (7)"
/// 관리자 웹에 저장한 최신 버전과 비교할 때 사용합니다.
class AppVersionLabel extends StatelessWidget {
  const AppVersionLabel({super.key});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PackageInfo>(
      future: PackageInfo.fromPlatform(),
      builder: (context, snap) {
        final info = snap.data;
        final text = info == null
            ? ''
            : '앱 버전 v${info.version} (${info.buildNumber})';
        return Center(
          child: Text(
            text,
            style: AppText.caption.copyWith(
              color: AppColors.subText.withValues(alpha: 0.7),
            ),
          ),
        );
      },
    );
  }
}
