import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/check_out_result.dart';

/// 카메라 앱 실행 등으로 안드로이드가 앱을 재시작하더라도
/// 마지막에 찍고 있던 사진 칸(interior, dashboard 등)과 입력 내용을
/// 기기 저장소(SharedPreferences)에 즉시 기록해 두는 도우미입니다.
class DraftStorage {
  DraftStorage._();

  static const _kActiveScreen = 'draft_active_screen'; // 'checkIn' | 'checkOut'
  static const _kPendingPhotoKey = 'draft_pending_photo_key';
  static const _kSavedDriverCode = 'saved_driver_code';

  // 출근 임시 데이터
  static const _kCheckInPhotos = 'draft_checkin_photos';
  static const _kCheckInChecklist = 'draft_checkin_checklist';
  static const _kCheckInOdometer = 'draft_checkin_odometer';

  // 퇴근 임시 데이터
  static const _kCheckOutPhoto = 'draft_checkout_photo';
  static const _kCheckOutOdometer = 'draft_checkout_odometer';
  static const _kCheckOutNote = 'draft_checkout_note';
  static const _kCheckOutNoteType = 'draft_checkout_note_type';
  static const _kCheckOutStartKm = 'draft_checkout_start_km';

  // 메모리 캐시 (화면 전환이 지체 없이 즉시 일어나도록 함)
  static String? activeScreen;
  static String? pendingPhotoKey;
  static String savedDriverCode = '';

  static final Map<String, String> checkInPhotos = {};
  static final Map<String, String> checkInChecklist = {};
  static String checkInOdometer = '';

  static String? checkOutPhoto;
  static String checkOutOdometer = '';
  static String checkOutNote = '';
  static CheckOutNoteType? checkOutNoteType;
  static int checkOutStartKm = 0;

  static SharedPreferences? _prefs;

  /// 앱 시작 시 1회 불러옵니다.
  static Future<void> init() async {
    final prefs = _prefs ??= await SharedPreferences.getInstance();
    activeScreen = prefs.getString(_kActiveScreen);
    pendingPhotoKey = prefs.getString(_kPendingPhotoKey);
    savedDriverCode = prefs.getString(_kSavedDriverCode) ?? '';

    // 출근 복원
    final photosJson = prefs.getString(_kCheckInPhotos);
    if (photosJson != null && photosJson.isNotEmpty) {
      try {
        final decoded = jsonDecode(photosJson) as Map<String, dynamic>;
        checkInPhotos
          ..clear()
          ..addAll(decoded.map((k, v) => MapEntry(k, v.toString())));
      } catch (_) {}
    }

    final checklistJson = prefs.getString(_kCheckInChecklist);
    if (checklistJson != null && checklistJson.isNotEmpty) {
      try {
        final decoded = jsonDecode(checklistJson) as Map<String, dynamic>;
        checkInChecklist
          ..clear()
          ..addAll(decoded.map((k, v) => MapEntry(k, v.toString())));
      } catch (_) {}
    }

    checkInOdometer = prefs.getString(_kCheckInOdometer) ?? '';

    // 퇴근 복원
    checkOutPhoto = prefs.getString(_kCheckOutPhoto);
    checkOutOdometer = prefs.getString(_kCheckOutOdometer) ?? '';
    checkOutNote = prefs.getString(_kCheckOutNote) ?? '';
    checkOutStartKm = prefs.getInt(_kCheckOutStartKm) ?? 0;
    final noteTypeName = prefs.getString(_kCheckOutNoteType);
    if (noteTypeName != null) {
      for (final t in CheckOutNoteType.values) {
        if (t.name == noteTypeName) {
          checkOutNoteType = t;
          break;
        }
      }
    }
  }

  static Future<void> setActiveScreen(String? screen, {int? startKm}) async {
    activeScreen = screen;
    final prefs = _prefs ??= await SharedPreferences.getInstance();
    if (screen == null) {
      await prefs.remove(_kActiveScreen);
    } else {
      await prefs.setString(_kActiveScreen, screen);
    }
    if (startKm != null) {
      checkOutStartKm = startKm;
      await prefs.setInt(_kCheckOutStartKm, startKm);
    }
  }

  /// 카메라를 열기 직전에 어느 칸('exterior', 'interior', 'dashboard')을 찍는지 디스크에 즉시 저장합니다.
  static Future<void> setPendingPhotoKey(String? key) async {
    pendingPhotoKey = key;
    final prefs = _prefs ??= await SharedPreferences.getInstance();
    if (key == null) {
      await prefs.remove(_kPendingPhotoKey);
    } else {
      await prefs.setString(_kPendingPhotoKey, key);
    }
  }

  static Future<void> saveCheckInPhoto(String key, String path) async {
    checkInPhotos[key] = path;
    pendingPhotoKey = null;
    final prefs = _prefs ??= await SharedPreferences.getInstance();
    await prefs.setString(_kCheckInPhotos, jsonEncode(checkInPhotos));
    await prefs.remove(_kPendingPhotoKey);
  }

  static void saveCheckInChecklist(String key, String value) {
    checkInChecklist[key] = value;
    _prefs?.setString(_kCheckInChecklist, jsonEncode(checkInChecklist));
  }

  static void saveCheckInOdometer(String text) {
    checkInOdometer = text;
    _prefs?.setString(_kCheckInOdometer, text);
  }

  static Future<void> clearCheckIn() async {
    activeScreen = null;
    pendingPhotoKey = null;
    checkInPhotos.clear();
    checkInChecklist.clear();
    checkInOdometer = '';
    final prefs = _prefs ??= await SharedPreferences.getInstance();
    await prefs.remove(_kActiveScreen);
    await prefs.remove(_kPendingPhotoKey);
    await prefs.remove(_kCheckInPhotos);
    await prefs.remove(_kCheckInChecklist);
    await prefs.remove(_kCheckInOdometer);
  }

  static Future<void> saveCheckOutPhoto(String path) async {
    checkOutPhoto = path;
    pendingPhotoKey = null;
    final prefs = _prefs ??= await SharedPreferences.getInstance();
    await prefs.setString(_kCheckOutPhoto, path);
    await prefs.remove(_kPendingPhotoKey);
  }

  static void saveCheckOutOdometer(String text) {
    checkOutOdometer = text;
    _prefs?.setString(_kCheckOutOdometer, text);
  }

  static void saveCheckOutNote(String text) {
    checkOutNote = text;
    _prefs?.setString(_kCheckOutNote, text);
  }

  static void saveCheckOutNoteType(CheckOutNoteType type) {
    checkOutNoteType = type;
    _prefs?.setString(_kCheckOutNoteType, type.name);
  }

  static Future<void> clearCheckOut() async {
    activeScreen = null;
    pendingPhotoKey = null;
    checkOutPhoto = null;
    checkOutOdometer = '';
    checkOutNote = '';
    checkOutNoteType = null;
    final prefs = _prefs ??= await SharedPreferences.getInstance();
    await prefs.remove(_kActiveScreen);
    await prefs.remove(_kPendingPhotoKey);
    await prefs.remove(_kCheckOutPhoto);
    await prefs.remove(_kCheckOutOdometer);
    await prefs.remove(_kCheckOutNote);
    await prefs.remove(_kCheckOutNoteType);
  }

  /// 한 번 로그인한 기사 코드(예: bh01)를 기기에 영구 저장해 로그아웃 후에도 유지합니다.
  static Future<void> saveDriverCode(String code) async {
    final clean = code.trim().toLowerCase();
    if (clean.isEmpty) return;
    savedDriverCode = clean;
    final prefs = _prefs ??= await SharedPreferences.getInstance();
    await prefs.setString(_kSavedDriverCode, clean);
  }
}
