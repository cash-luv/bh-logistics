import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// [관리자 전용 백그라운드 분석기 & 이동 타임라인 기록기]
/// 기사님 화면에는 전혀 보이지 않으며, 운행 중에는 서버(Firebase)에 전송하지 않고
/// 휴대폰 내부에만 누적 거리와 주요 이동 타임라인(시각, 시·구·동 주소, 누적km)을 기록해 두었다가
/// 퇴근 버튼을 누를 때 딱 한 번 DailyLogs에 함께 저장합니다. (서버 추가 비용 0원)
class GpsTrackerService {
  GpsTrackerService._();

  static const _kAccumMeters = 'gps_tracker_accum_meters';
  static const _kLastLat = 'gps_tracker_last_lat';
  static const _kLastLng = 'gps_tracker_last_lng';
  static const _kTrackingDate = 'gps_tracker_date';
  static const _kTimelineList = 'gps_tracker_timeline_v1';

  static StreamSubscription<Position>? _sub;
  static double _accumulatedMeters = 0.0;
  static double? _lastLat;
  static double? _lastLng;
  static double _metersSinceLastTimelinePoint = 0.0;
  static List<Map<String, dynamic>> _timeline = [];

  /// 현재 누적된 GPS 주행거리 (km 정수)
  static int get gpsDrivenKm => (_accumulatedMeters / 1000.0).round();

  static String _nowKstHm() {
    final kst = DateTime.now().toUtc().add(const Duration(hours: 9));
    final hh = kst.hour.toString().padLeft(2, '0');
    final mm = kst.minute.toString().padLeft(2, '0');
    return '$hh:$mm';
  }

  /// 출근 완료 시 또는 앱 재시작(운행 중 상태) 시 조용히 추적을 시작합니다.
  static Future<void> startTrackingForToday(
    String workDate, {
    double? initialLat,
    double? initialLng,
    String? initialAddress,
    bool reset = false,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final savedDate = prefs.getString(_kTrackingDate);

    if (!reset && savedDate == workDate) {
      _accumulatedMeters = prefs.getDouble(_kAccumMeters) ?? 0.0;
      _lastLat = prefs.getDouble(_kLastLat);
      _lastLng = prefs.getDouble(_kLastLng);
      final rawTimeline = prefs.getString(_kTimelineList);
      if (rawTimeline != null && rawTimeline.isNotEmpty) {
        try {
          final decoded = jsonDecode(rawTimeline) as List<dynamic>;
          _timeline = decoded
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
        } catch (_) {
          _timeline = [];
        }
      }
    } else {
      await _sub?.cancel();
      _sub = null;
      _accumulatedMeters = 0.0;
      _metersSinceLastTimelinePoint = 0.0;
      _lastLat = initialLat;
      _lastLng = initialLng;
      _timeline = [];
      if (initialLat != null && initialLng != null) {
        _timeline.add({
          'time': _nowKstHm(),
          'type': '출근 출발',
          'address': (initialAddress ?? '').isNotEmpty
              ? initialAddress
              : '출발 위치',
          'lat': initialLat,
          'lng': initialLng,
          'cumKm': 0,
        });
      }
      await prefs.setString(_kTrackingDate, workDate);
      await prefs.setDouble(_kAccumMeters, 0.0);
      await prefs.setString(_kTimelineList, jsonEncode(_timeline));
      if (initialLat != null && initialLng != null) {
        await prefs.setDouble(_kLastLat, initialLat);
        await prefs.setDouble(_kLastLng, initialLng);
      } else {
        await prefs.remove(_kLastLat);
        await prefs.remove(_kLastLng);
      }
    }

    if (_sub != null) return;

    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }

      // 안드로이드: 상단 알림이 있는 '전경 서비스'로 실행되어 화면이 꺼지거나 다른 앱을 써도 계속 기록됩니다.
      // 아이폰: 백그라운드 위치 업데이트를 허용합니다.
      final LocationSettings locationSettings;
      if (Platform.isAndroid) {
        locationSettings = AndroidSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 100,
          intervalDuration: const Duration(seconds: 15),
          foregroundNotificationConfig: const ForegroundNotificationConfig(
            notificationTitle: 'BH 기사앱 운행 기록 중',
            notificationText: '퇴근 버튼을 누르면 위치 기록이 끝납니다.',
            enableWakeLock: true,
            setOngoing: true,
          ),
        );
      } else if (Platform.isIOS) {
        locationSettings = AppleSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 100,
          activityType: ActivityType.automotiveNavigation,
          pauseLocationUpdatesAutomatically: false,
          showBackgroundLocationIndicator: true,
          allowBackgroundLocationUpdates: true,
        );
      } else {
        locationSettings = const LocationSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 100,
        );
      }

      _sub = Geolocator.getPositionStream(
        locationSettings: locationSettings,
      ).listen((Position pos) async {
        if (pos.accuracy > 150) return;

        if (_lastLat != null && _lastLng != null) {
          final deltaMeters = Geolocator.distanceBetween(
            _lastLat!,
            _lastLng!,
            pos.latitude,
            pos.longitude,
          );
          if (deltaMeters >= 50 && deltaMeters <= 50000) {
            _accumulatedMeters += deltaMeters;
            _metersSinceLastTimelinePoint += deltaMeters;
            await prefs.setDouble(_kAccumMeters, _accumulatedMeters);

            // 초반 12개 지점은 300m마다(단거리 실차 테스트에서도 경로가 촘촘히 찍히도록),
            // 이후 장거리 운행 시에는 2km마다 최대 40개까지 타임라인 경유 지점을 자동 기록합니다.
            final double stepThreshold = _timeline.length < 12 ? 300.0 : 2000.0;
            if (_metersSinceLastTimelinePoint >= stepThreshold &&
                _timeline.length < 40) {
              _metersSinceLastTimelinePoint = 0.0;
              final addr = await resolveKoreanAddress(
                latitude: pos.latitude,
                longitude: pos.longitude,
              );
              final cumKmVal = _accumulatedMeters >= 100
                  ? (_accumulatedMeters / 1000.0).round().clamp(1, 99999)
                  : 0;
              _timeline.add({
                'time': _nowKstHm(),
                'type': '운행 경유',
                'address': addr.isNotEmpty ? addr : '이동 중',
                'lat': pos.latitude,
                'lng': pos.longitude,
                'cumKm': cumKmVal,
              });
              await prefs.setString(_kTimelineList, jsonEncode(_timeline));
            }
          }
        } else if (_timeline.isEmpty) {
          final addr = await resolveKoreanAddress(
            latitude: pos.latitude,
            longitude: pos.longitude,
          );
          _timeline.add({
            'time': _nowKstHm(),
            'type': '출근 출발',
            'address': addr.isNotEmpty ? addr : '출발 위치',
            'lat': pos.latitude,
            'lng': pos.longitude,
            'cumKm': 0,
          });
          await prefs.setString(_kTimelineList, jsonEncode(_timeline));
        }

        _lastLat = pos.latitude;
        _lastLng = pos.longitude;
        await prefs.setDouble(_kLastLat, pos.latitude);
        await prefs.setDouble(_kLastLng, pos.longitude);
      });
    } catch (_) {}
  }

  /// 출근 시점 현재 GPS 위치를 조용히 1회 가져옵니다.
  static Future<Position?> tryGetSilentCurrentPosition() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return null;

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return null;
      }

      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 4),
        ),
      );
    } catch (_) {
      try {
        return await Geolocator.getLastKnownPosition();
      } catch (_) {
        return null;
      }
    }
  }

  /// 위도·경도를 한국어 "시·구·동" 주소 문자열로 변환합니다.
  static Future<String> resolveKoreanAddress({
    required double? latitude,
    required double? longitude,
  }) async {
    if (latitude == null || longitude == null) return '';
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 3);
    try {
      final uri = Uri.parse(
        'https://nominatim.openstreetmap.org/reverse?format=json&lat=$latitude&lon=$longitude&zoom=16&addressdetails=1&accept-language=ko',
      );
      final req = await client.getUrl(uri);
      req.headers.set(HttpHeaders.userAgentHeader, 'BHDriverApp/1.0');
      final resp = await req.close().timeout(const Duration(seconds: 3));
      if (resp.statusCode != 200) return '';

      final body = await resp.transform(utf8.decoder).join();
      final decoded = jsonDecode(body) as Map<String, dynamic>;
      final addr = (decoded['address'] as Map<String, dynamic>?) ?? {};

      final parts = <String>[];
      for (final key in [
        'province',
        'state',
        'city',
        'county',
        'borough',
        'city_district',
        'suburb',
        'quarter',
        'neighbourhood',
        'town',
        'village',
      ]) {
        final val = (addr[key]?.toString() ?? '').trim();
        if (val.isNotEmpty && !parts.contains(val)) {
          parts.add(val);
        }
        if (parts.length >= 3) break;
      }

      if (parts.isNotEmpty) {
        return parts.join(' ');
      }
      return (decoded['display_name']?.toString() ?? '').trim();
    } catch (_) {
      return '';
    } finally {
      client.close(force: true);
    }
  }

  /// 퇴근 완료 시 추적을 멈추고 (최종 GPS 주행거리 km, 이동 타임라인 배열)을 돌려준 뒤 초기화합니다.
  static Future<(int, List<Map<String, dynamic>>)> stopAndConsumeGpsSession({
    double? startLat,
    double? startLng,
    String? startAddress,
    String? startTimeHm,
    double? endLat,
    double? endLng,
    String? endAddress,
  }) async {
    await _sub?.cancel();
    _sub = null;

    final prefs = await SharedPreferences.getInstance();

    // 앱이 백그라운드에서 재시작된 직후 퇴근을 누른 경우에도 저장된 누적값과 타임라인을 복원합니다.
    if (_accumulatedMeters == 0.0) {
      _accumulatedMeters = prefs.getDouble(_kAccumMeters) ?? 0.0;
    }
    _lastLat ??= prefs.getDouble(_kLastLat);
    _lastLng ??= prefs.getDouble(_kLastLng);
    if (_timeline.isEmpty) {
      final rawTimeline = prefs.getString(_kTimelineList);
      if (rawTimeline != null && rawTimeline.isNotEmpty) {
        try {
          final decoded = jsonDecode(rawTimeline) as List<dynamic>;
          _timeline = decoded
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
        } catch (_) {
          _timeline = [];
        }
      }
    }

    if (_lastLat != null &&
        _lastLng != null &&
        endLat != null &&
        endLng != null) {
      final tailMeters = Geolocator.distanceBetween(
        _lastLat!,
        _lastLng!,
        endLat,
        endLng,
      );
      if (tailMeters >= 50 && tailMeters <= 50000) {
        _accumulatedMeters += tailMeters;
      }
    } else if (_accumulatedMeters == 0.0 &&
        startLat != null &&
        startLng != null &&
        endLat != null &&
        endLng != null) {
      final directMeters = Geolocator.distanceBetween(
        startLat,
        startLng,
        endLat,
        endLng,
      );
      if (directMeters >= 50 && directMeters <= 50000) {
        _accumulatedMeters = directMeters;
      }
    }

    final totalKm = _accumulatedMeters >= 100
        ? (_accumulatedMeters / 1000.0).round().clamp(1, 99999)
        : 0;

    final finalTimeline = List<Map<String, dynamic>>.from(_timeline);

    // 만약 출근 출발 지점이 타임라인에 빠져 있다면 DailyLogs의 출근 위치로 보강합니다.
    if (finalTimeline.isEmpty && startLat != null && startLng != null) {
      finalTimeline.add({
        'time': (startTimeHm ?? '').isNotEmpty ? startTimeHm : _nowKstHm(),
        'type': '출근 출발',
        'address':
            (startAddress ?? '').isNotEmpty ? startAddress : '출근 출발 위치',
        'lat': startLat,
        'lng': startLng,
        'cumKm': 0,
      });
    }

    if (endLat != null && endLng != null) {
      finalTimeline.add({
        'time': _nowKstHm(),
        'type': '퇴근 도착',
        'address':
            (endAddress ?? '').isNotEmpty ? endAddress : '퇴근 주차 위치',
        'lat': endLat,
        'lng': endLng,
        'cumKm': totalKm,
      });
    }

    _accumulatedMeters = 0.0;
    _metersSinceLastTimelinePoint = 0.0;
    _lastLat = null;
    _lastLng = null;
    _timeline = [];

    await prefs.remove(_kAccumMeters);
    await prefs.remove(_kLastLat);
    await prefs.remove(_kLastLng);
    await prefs.remove(_kTrackingDate);
    await prefs.remove(_kTimelineList);

    return (totalKm, finalTimeline);
  }
}
