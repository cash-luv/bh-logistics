import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// [프롬프트 8: 사진 오프라인 대응 큐]
/// 터널·산간·지하주차장 등 인터넷이 약한 곳에서 사진 업로드가 실패하더라도
/// 출퇴근 기록은 즉시 완료 처리하고, 올라가지 못한 사진은 휴대폰 저장소에 보관했다가
/// 인터넷이 연결될 때 자동으로 Storage에 업로드하고 DailyLogs 문서의 경로를 갱신합니다.
class OfflinePhotoQueue {
  OfflinePhotoQueue._();

  static const _kQueueKey = 'offline_photo_upload_queue_v1';
  static bool _isFlushing = false;

  /// 대기 중인 사진 개수 조회
  static Future<int> pendingCount() async {
    final list = await _loadQueue();
    return list.length;
  }

  /// 업로드에 실패한 사진을 대기열에 추가합니다.
  /// fieldPath 예: 'startPhotos.dashboard', 'startPhotos.exterior', 'endPhotos.dashboard'
  static Future<void> enqueue({
    required String dailyLogId,
    required String storagePath,
    required String localFilePath,
    required String fieldPath,
  }) async {
    final list = await _loadQueue();
    // 같은 문서의 같은 필드가 이미 있으면 최신 파일로 교체
    list.removeWhere(
      (item) =>
          item['dailyLogId'] == dailyLogId && item['fieldPath'] == fieldPath,
    );
    list.add({
      'dailyLogId': dailyLogId,
      'storagePath': storagePath,
      'localFilePath': localFilePath,
      'fieldPath': fieldPath,
      'createdAt': DateTime.now().toIso8601String(),
    });
    await _saveQueue(list);
  }

  /// 대기열에 남은 사진을 순서대로 업로드하고 DailyLogs 문서를 갱신합니다.
  /// 반환값: 남은 대기 사진 개수
  static Future<int> flushQueue() async {
    if (_isFlushing) return pendingCount();
    _isFlushing = true;

    try {
      final list = await _loadQueue();
      if (list.isEmpty) return 0;

      final remaining = <Map<String, String>>[];
      final storage = FirebaseStorage.instance;
      final db = FirebaseFirestore.instance;

      for (final item in list) {
        final dailyLogId = item['dailyLogId'] ?? '';
        final storagePath = item['storagePath'] ?? '';
        final localFilePath = item['localFilePath'] ?? '';
        final fieldPath = item['fieldPath'] ?? '';

        if (dailyLogId.isEmpty ||
            storagePath.isEmpty ||
            localFilePath.isEmpty ||
            fieldPath.isEmpty) {
          continue;
        }

        final file = File(localFilePath);
        if (!file.existsSync()) {
          // 로컬 파일이 이미 지워졌으면 큐에서 제외
          continue;
        }

        try {
          await storage.ref(storagePath).putFile(
                file,
                SettableMetadata(contentType: 'image/jpeg'),
              );

          // fieldPath가 'startPhotos.dashboard' 형태이면 중첩 맵으로 병합
          final parts = fieldPath.split('.');
          if (parts.length == 2) {
            await db.collection('DailyLogs').doc(dailyLogId).set(
              {
                parts[0]: {parts[1]: storagePath},
                'updatedAt': FieldValue.serverTimestamp(),
              },
              SetOptions(merge: true),
            );
          }

          await _saveQueue(remaining);
        } catch (_) {
          // 아직 인터넷이 불안정하면 다음 기회에 다시 올리도록 남겨둠
          remaining.add(item);
        }
      }

      await _saveQueue(remaining);
      return remaining.length;
    } finally {
      _isFlushing = false;
    }
  }

  static Future<List<Map<String, String>>> _loadQueue() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kQueueKey);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw) as List<dynamic>;
      return decoded
          .map(
            (e) => (e as Map<String, dynamic>).map(
              (k, v) => MapEntry(k, v.toString()),
            ),
          )
          .toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> _saveQueue(List<Map<String, String>> list) async {
    final prefs = await SharedPreferences.getInstance();
    if (list.isEmpty) {
      await prefs.remove(_kQueueKey);
    } else {
      await prefs.setString(_kQueueKey, jsonEncode(list));
    }
  }
}
