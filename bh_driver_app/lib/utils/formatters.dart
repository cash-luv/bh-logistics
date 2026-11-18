import 'package:flutter/services.dart';

/// 숫자를 입력할 때 3자리마다 자동으로 콤마(,)를 찍어주는 포맷터
/// 예: 1000 -> 1,000 / 125430 -> 125,430
class ThousandsSeparatorInputFormatter extends TextInputFormatter {
  const ThousandsSeparatorInputFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    if (newValue.text.isEmpty) {
      return newValue.copyWith(text: '');
    }

    final digitsOnly = newValue.text.replaceAll(RegExp(r'[^\d]'), '');
    if (digitsOnly.isEmpty) {
      return newValue.copyWith(text: '');
    }

    // 3자리마다 콤마 삽입
    final formatted = digitsOnly.replaceAllMapped(
      RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
      (Match m) => '${m[1]},',
    );

    return TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(offset: formatted.length),
    );
  }
}

/// 콤마가 포함된 문자열을 정수(int)로 파싱 (실패 시 null)
int? parseCommaInt(String? text) {
  if (text == null) return null;
  final clean = text.replaceAll(',', '').trim();
  if (clean.isEmpty) return null;
  return int.tryParse(clean);
}

/// 숫자를 3자리 콤마 문자열로 변환 (예: 125430 -> 125,430)
String formatComma(num? value) {
  if (value == null) return '0';
  final s = value.round().toString();
  return s.replaceAllMapped(
    RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
    (Match m) => '${m[1]},',
  );
}
