import 'dart:io';

import 'package:firebase_storage/firebase_storage.dart';

import 'offline_photo_queue.dart';

/// Cloud Storage 업로드 전담 서비스
/// 규칙: DailyLogs에는 다운로드 URL이 아니라 Storage 경로를 저장합니다.
/// [프롬프트 8 적용] 인터넷이 약해 업로드에 실패한 사진은 OfflinePhotoQueue에 저장해 두고,
/// 출퇴근 기록 저장은 막히지 않고 바로 진행되도록 합니다.
class StorageService {
  StorageService._();

  static final FirebaseStorage _storage = FirebaseStorage.instance;

  /// 출근 사진을 업로드하고 Storage 경로 맵을 반환합니다.
  /// 업로드에 실패한 사진은 OfflinePhotoQueue에 등록되어 인터넷 연결 시 자동 업로드됩니다.
  static Future<Map<String, String>> uploadCheckInPhotos({
    required String yearMonth,
    required String dailyLogId,
    required Map<String, String> localPhotoPaths,
    void Function(int completed, int total)? onProgress,
  }) async {
    const orderedKeys = ['dashboard', 'exterior', 'interior'];
    final keysToUpload = [
      for (final k in orderedKeys)
        if ((localPhotoPaths[k] ?? '').isNotEmpty) k,
    ];

    final Map<String, String> storagePaths = {};
    var completed = 0;
    final total = keysToUpload.length;
    onProgress?.call(completed, total);

    for (final key in keysToUpload) {
      final localPath = localPhotoPaths[key]!;
      final storagePath = 'dailyLogs/$yearMonth/$dailyLogId/start_$key.jpg';
      final ref = _storage.ref(storagePath);

      try {
        await ref
            .putFile(
              File(localPath),
              SettableMetadata(contentType: 'image/jpeg'),
            )
            .timeout(const Duration(seconds: 12));
        storagePaths[key] = storagePath;
      } catch (_) {
        // 오프라인/터널 등 업로드 실패 시 큐에 넣어 두고 나중에 자동 업로드
        await OfflinePhotoQueue.enqueue(
          dailyLogId: dailyLogId,
          storagePath: storagePath,
          localFilePath: localPath,
          fieldPath: 'startPhotos.$key',
        );
        storagePaths[key] = storagePath;
      }

      completed += 1;
      onProgress?.call(completed, total);
    }

    return storagePaths;
  }

  /// 퇴근 계기판 사진 1장을 업로드하고 Storage 경로를 반환합니다.
  /// 실패 시 OfflinePhotoQueue에 등록해 두고 예상 Storage 경로를 반환합니다.
  static Future<String> uploadCheckOutDashboardPhoto({
    required String yearMonth,
    required String dailyLogId,
    required String localPhotoPath,
  }) async {
    final storagePath = 'dailyLogs/$yearMonth/$dailyLogId/end_dashboard.jpg';
    final ref = _storage.ref(storagePath);

    try {
      await ref
          .putFile(
            File(localPhotoPath),
            SettableMetadata(contentType: 'image/jpeg'),
          )
          .timeout(const Duration(seconds: 12));
    } catch (_) {
      await OfflinePhotoQueue.enqueue(
        dailyLogId: dailyLogId,
        storagePath: storagePath,
        localFilePath: localPhotoPath,
        fieldPath: 'endPhotos.dashboard',
      );
    }

    return storagePath;
  }

  /// 주유 영수증 사진을 Storage에 업로드하고 경로를 반환합니다.
  static Future<String> uploadFuelReceiptPhoto({
    required String yearMonth,
    required String dailyLogId,
    required String localPhotoPath,
  }) async {
    final ts = DateTime.now().millisecondsSinceEpoch;
    final storagePath =
        'dailyLogs/$yearMonth/$dailyLogId/fuel_receipt_$ts.jpg';
    final ref = _storage.ref(storagePath);

    try {
      await ref
          .putFile(
            File(localPhotoPath),
            SettableMetadata(contentType: 'image/jpeg'),
          )
          .timeout(const Duration(seconds: 12));
    } catch (_) {
      // 오프라인이면 경로만 먼저 돌려주고 나중에 업로드되도록 보관
      await OfflinePhotoQueue.enqueue(
        dailyLogId: dailyLogId,
        storagePath: storagePath,
        localFilePath: localPhotoPath,
        fieldPath: 'lastFuelReceiptPath.photo',
      );
    }

    return storagePath;
  }
}
