import 'package:flutter/material.dart';

/// 앱 색상. 야외·고령 사용자도 잘 보이도록 대비를 높게 잡았습니다.
class AppColors {
  AppColors._();

  static const primary = Color(0xFF1E5EFF); // 출근 / 차량 점검 (파랑)
  static const teal = Color(0xFF00796B); // 퇴근 / 빠른 보고 (청록)
  static const background = Color(0xFFF4F6FA);
  static const surface = Colors.white;
  static const text = Color(0xFF16202A);
  static const subText = Color(0xFF52606D);
  static const disabled = Color(0xFFCFD8DC);
  static const disabledText = Color(0xFF546E7A);
  static const success = Color(0xFF2E7D32);
  static const successBg = Color(0xFFE3F4E5);
  static const infoBg = Color(0xFFE5EDFF);
  static const warn = Color(0xFF9A5300);
  static const warnBg = Color(0xFFFFF1DC);
}

/// 글씨 스타일. 앱 안의 모든 글씨는 20 이상으로 유지합니다.
class AppText {
  AppText._();

  static const title = TextStyle(
    fontSize: 30,
    fontWeight: FontWeight.w800,
    color: AppColors.text,
    height: 1.25,
  );
  static const heading = TextStyle(
    fontSize: 26,
    fontWeight: FontWeight.w700,
    color: AppColors.text,
  );
  static const body = TextStyle(fontSize: 22, color: AppColors.text);
  static const caption = TextStyle(fontSize: 20, color: AppColors.subText);
  static const bigButton = TextStyle(
    fontSize: 32,
    fontWeight: FontWeight.w800,
    color: Colors.white,
  );
}

class AppTheme {
  AppTheme._();

  static ThemeData get light => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: AppColors.primary),
        scaffoldBackgroundColor: AppColors.background,
      );
}
