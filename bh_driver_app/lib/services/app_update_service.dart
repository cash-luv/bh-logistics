import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:ota_update/ota_update.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme/app_theme.dart';

/// 기사앱의 현재 버전과 Firestore `Settings/appVersion`을 비교해
/// 새 버전이 있으면 큰 글씨로 [지금 업데이트하기] 안내 창을 띄워 주는 서비스입니다.
/// - 앱을 켤 때, 그리고 다른 앱에서 돌아올 때마다 확인합니다. (새 버전이면 매번 안내)
/// - 안드로이드에서는 버튼을 누르면 앱 안에서 바로 내려받고 설치 화면까지 열어 줍니다.
class AppUpdateService {
  AppUpdateService._();

  /// 현재 이 앱의 버전 (pubspec.yaml의 version: 1.0.4+5 와 동일하게 관리)
  static const String currentVersion = '1.0.4';

  /// 기본 APK 다운로드 주소 (Firebase Hosting에 올린 bh-driver.apk)
  static const String defaultApkUrl =
      'https://bh-logistics-f45d8.web.app/bh-driver.apk';

  static bool _dialogShowing = false;

  /// 앱 시작 및 앱 복귀 시 호출합니다. 새 버전이 있으면 안내 창을 띄웁니다.
  static Future<void> checkAndPromptUpdate(BuildContext context) async {
    if (_dialogShowing) return;

    try {
      final doc = await FirebaseFirestore.instance
          .collection('Settings')
          .doc('appVersion')
          .get(const GetOptions(source: Source.server));

      if (!doc.exists) return;
      final data = doc.data() ?? {};

      final latestVersion =
          (data['latestVersion'] as String?)?.trim() ?? currentVersion;
      final rawUrl = (data['apkUrl'] as String?)?.trim() ?? '';
      final baseUrl = rawUrl.isNotEmpty ? rawUrl : defaultApkUrl;
      // 캐시된 예전 파일이 내려오지 않도록 버전을 주소 뒤에 붙입니다.
      final apkUrl = baseUrl.contains('?')
          ? baseUrl
          : '$baseUrl?v=${Uri.encodeComponent(latestVersion)}';
      final message = (data['message'] as String?)?.trim() ??
          '더 편리해진 새 버전이 나왔어요.\n아래 버튼을 눌러 업데이트해 주세요.';
      final forceUpdate = (data['forceUpdate'] as bool?) ?? false;

      if (!_isNewerVersion(latestVersion, currentVersion)) return;
      if (!context.mounted) return;

      _dialogShowing = true;
      await showDialog<void>(
        context: context,
        barrierDismissible: !forceUpdate,
        builder: (ctx) => PopScope(
          canPop: !forceUpdate,
          child: _UpdateDialog(
            latestVersion: latestVersion,
            message: message,
            apkUrl: apkUrl,
            forceUpdate: forceUpdate,
          ),
        ),
      );
    } catch (_) {
      // 버전 확인 실패 시 기사님의 업무를 방해하지 않고 조용히 넘어갑니다.
    } finally {
      _dialogShowing = false;
    }
  }

  /// "1.0.1" > "1.0.0" 비교
  static bool _isNewerVersion(String latest, String current) {
    final lParts =
        latest.split('.').map((e) => int.tryParse(e.trim()) ?? 0).toList();
    final cParts =
        current.split('.').map((e) => int.tryParse(e.trim()) ?? 0).toList();
    final len = lParts.length > cParts.length ? lParts.length : cParts.length;

    for (var i = 0; i < len; i++) {
      final l = i < lParts.length ? lParts[i] : 0;
      final c = i < cParts.length ? cParts[i] : 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }
}

class _UpdateDialog extends StatefulWidget {
  const _UpdateDialog({
    required this.latestVersion,
    required this.message,
    required this.apkUrl,
    required this.forceUpdate,
  });

  final String latestVersion;
  final String message;
  final String apkUrl;
  final bool forceUpdate;

  @override
  State<_UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<_UpdateDialog> {
  StreamSubscription<OtaEvent>? _sub;
  bool _busy = false;
  int _percent = 0;
  String _status = '';

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _openBrowserFallback() async {
    final uri = Uri.tryParse(widget.apkUrl);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  Future<void> _startUpdate() async {
    if (_busy) return;

    // 아이폰 등 안드로이드가 아닌 경우에는 기존처럼 브라우저로 안내합니다.
    if (!Platform.isAndroid) {
      await _openBrowserFallback();
      return;
    }

    setState(() {
      _busy = true;
      _percent = 0;
      _status = '새 버전을 내려받는 중...';
    });

    try {
      _sub = OtaUpdate()
          .execute(widget.apkUrl, destinationFilename: 'bh-driver.apk')
          .listen(
        (event) {
          if (!mounted) return;
          switch (event.status) {
            case OtaStatus.DOWNLOADING:
              setState(() {
                _percent = int.tryParse(event.value ?? '') ?? _percent;
                _status = '새 버전을 내려받는 중... $_percent%';
              });
            case OtaStatus.INSTALLING:
              setState(() {
                _percent = 100;
                _status = '설치 화면이 열리면 [설치] 또는 [업데이트]를 눌러 주세요.';
                _busy = false;
              });
            case OtaStatus.INSTALLATION_DONE:
              setState(() {
                _busy = false;
              });
            case OtaStatus.PERMISSION_NOT_GRANTED_ERROR:
              setState(() {
                _busy = false;
                _status = '설치 권한이 필요해요. 설정에서 이 앱의 [출처를 알 수 없는 앱 설치]를 허용해 주세요.';
              });
            default:
              setState(() {
                _busy = false;
                _status = '자동 설치에 실패했어요. 아래 [브라우저로 받기]를 눌러 주세요.';
              });
          }
        },
        onError: (_) {
          if (!mounted) return;
          setState(() {
            _busy = false;
            _status = '자동 설치에 실패했어요. 아래 [브라우저로 받기]를 눌러 주세요.';
          });
        },
      );
    } catch (_) {
      setState(() {
        _busy = false;
        _status = '자동 설치에 실패했어요. 아래 [브라우저로 받기]를 눌러 주세요.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Row(
              children: [
                Icon(
                  Icons.system_update,
                  size: 38,
                  color: AppColors.primary,
                ),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '새로운 버전이 나왔어요!',
                    style: AppText.heading,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              '새 버전: v${widget.latestVersion} (현재: v${AppUpdateService.currentVersion})',
              style: AppText.caption,
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.infoBg,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Text(
                widget.message,
                style: AppText.body,
              ),
            ),
            if (_status.isNotEmpty) ...[
              const SizedBox(height: 14),
              if (_busy)
                LinearProgressIndicator(
                  value: _percent > 0 ? _percent / 100 : null,
                  minHeight: 10,
                  borderRadius: BorderRadius.circular(8),
                ),
              const SizedBox(height: 8),
              Text(_status, style: AppText.body),
            ],
            const SizedBox(height: 20),
            Material(
              color: _busy ? AppColors.disabled : AppColors.primary,
              borderRadius: BorderRadius.circular(20),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: _busy ? null : _startUpdate,
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(vertical: 18, horizontal: 16),
                  child: Center(
                    child: Text(
                      _busy ? '내려받는 중...' : '지금 업데이트하기',
                      style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            if (Platform.isAndroid && _status.contains('실패')) ...[
              const SizedBox(height: 10),
              TextButton(
                onPressed: _openBrowserFallback,
                child: const Text(
                  '브라우저로 받기',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ],
            if (!widget.forceUpdate && !_busy) ...[
              const SizedBox(height: 10),
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text(
                  '나중에 하기',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: AppColors.subText,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
