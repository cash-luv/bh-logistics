import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// [BH로지스틱스 기사앱 백그라운드 GPS 트래커 & 5분 주기 이동 타임라인 기록기]
/// - 기사님 화면에는 전혀 부담을 주지 않으며, 전경 서비스(Foreground Service)로 실행되어 화면이 꺼져도 계속 동작합니다.
/// - 5분마다 또는 고속도로 5km 이동 시마다 현재 위치(시·구·동)와 누적 거리를 휴대폰 내부에 저장합니다.
/// - 상하차 대기(쿠팡 등) 시에는 '정차/대기'로, 주행 중에는 '운행 중'으로 구분 기록하여 근무 시간을 완벽히 증명합니다.
/// - 퇴근 버튼을 누를 때 최종 누적 거리(km)와 전체 타임라인 배열을 DailyLogs에 1회 저장합니다. (서버 비용 최적화)
class GpsTrackerService {
  GpsTrackerService._();

  static const _kAccumMeters = 'gps_tracker_accum_meters';
  static const _kLastLat = 'gps_tracker_last_lat';
  static const _kLastLng = 'gps_tracker_last_lng';
  static const _kTrackingDate = 'gps_tracker_date';
  static const _kTimelineList = 'gps_tracker_timeline_v2';
  static const _kLastCheckpointMeters = 'gps_tracker_last_chk_meters';

  static const MethodChannel _nativeChannel = MethodChannel(
    'com.bhlogistics.bh_driver_app/native_gps',
  );

  // 5분 주기 기록 & 최대 300개 지점 (하루 24시간 이상 연속 운행 완벽 커버)
  static const int _kCheckpointIntervalMinutes = 5;
  static const int _kMaxTimelinePoints = 300;

  static StreamSubscription<Position>? _sub;
  static Timer? _periodicTimer;
  static double _accumulatedMeters = 0.0;
  static double? _lastLat;
  static double? _lastLng;
  static double _lastCheckpointMeters = 0.0;
  static List<Map<String, dynamic>> _timeline = [];
  static bool _isRecordingCheckpoint = false;

  /// 현재 누적된 GPS 주행거리 (km 정수)
  static int get gpsDrivenKm => (_accumulatedMeters / 1000.0).round();

  static String _nowKstHm() {
    final kst = DateTime.now().toUtc().add(const Duration(hours: 9));
    final hh = kst.hour.toString().padLeft(2, '0');
    final mm = kst.minute.toString().padLeft(2, '0');
    return '$hh:$mm';
  }

  /// 출근 완료 시 또는 앱 재실행(운행 중 복원) 시 5분 주기 백그라운드 추적을 시작합니다.
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
      _lastCheckpointMeters = prefs.getDouble(_kLastCheckpointMeters) ?? _accumulatedMeters;
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
      _periodicTimer?.cancel();
      _periodicTimer = null;

      _accumulatedMeters = 0.0;
      _lastCheckpointMeters = 0.0;
      _lastLat = initialLat;
      _lastLng = initialLng;
      _timeline = [];

      if (initialLat != null && initialLng != null) {
        _timeline.add({
          'time': _nowKstHm(),
          'type': '출근 출발',
          'address': (initialAddress ?? '').isNotEmpty
              ? initialAddress
              : '출근 출발 위치',
          'lat': initialLat,
          'lng': initialLng,
          'cumKm': 0,
        });
      }

      await prefs.setString(_kTrackingDate, workDate);
      await prefs.setDouble(_kAccumMeters, 0.0);
      await prefs.setDouble(_kLastCheckpointMeters, 0.0);
      await prefs.setString(_kTimelineList, jsonEncode(_timeline));

      if (initialLat != null && initialLng != null) {
        await prefs.setDouble(_kLastLat, initialLat);
        await prefs.setDouble(_kLastLng, initialLng);
      } else {
        await prefs.remove(_kLastLat);
        await prefs.remove(_kLastLng);
      }
    }

    // 이미 리스너와 타이머가 돌고 있다면 중복 실행 방지
    if (_sub != null && _periodicTimer != null) return;

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

      // 안드로이드: 앱이 종료(스와이프·뒤로가기)돼도 유지되는 독립 네이티브 전경 서비스를 실행합니다.
      if (Platform.isAndroid) {
        await _nativeChannel.invokeMethod<bool>('startNativeGps', {
          'workDate': workDate,
          'initialLat': initialLat,
          'initialLng': initialLng,
          'initialAddress': initialAddress ?? '',
          'reset': reset,
        });
        return;
      }

      // 안드로이드 외(아이폰): 백그라운드 위치 업데이트 허용
      final LocationSettings locationSettings;
      if (Platform.isAndroid) {
        locationSettings = AndroidSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 30, // 30m 이동 시 GPS 업데이트
          intervalDuration: const Duration(seconds: 20),
          foregroundNotificationConfig: const ForegroundNotificationConfig(
            notificationTitle: 'BH 기사앱 운행 중 (5분 주기 동선 기록)',
            notificationText: '정밀한 이동 거리와 물류 타임라인을 안전하게 기록하고 있습니다.',
            enableWakeLock: true,
            setOngoing: true,
          ),
        );
      } else if (Platform.isIOS) {
        locationSettings = AppleSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 30,
          activityType: ActivityType.automotiveNavigation,
          pauseLocationUpdatesAutomatically: false,
          showBackgroundLocationIndicator: true,
          allowBackgroundLocationUpdates: true,
        );
      } else {
        locationSettings = const LocationSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 30,
        );
      }

      // 1. 실시간 GPS 스트림 수신 (거리 누적 및 고속도로 장거리 이동 감지)
      _sub?.cancel();
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
          // 정상 주행 범위 (30m 이상 ~ 50km 이하 단일 점프)
          if (deltaMeters >= 30 && deltaMeters <= 50000) {
            _accumulatedMeters += deltaMeters;
            await prefs.setDouble(_kAccumMeters, _accumulatedMeters);

            // 고속도로 등에서 5분이 되기 전에 5km 이상 주행한 경우 즉시 체크포인트 기록
            if (_accumulatedMeters - _lastCheckpointMeters >= 5000) {
              await _recordCheckpoint(
                lat: pos.latitude,
                lng: pos.longitude,
                reason: '고속 이동',
              );
            }
          }
        }

        _lastLat = pos.latitude;
        _lastLng = pos.longitude;
        await prefs.setDouble(_kLastLat, pos.latitude);
        await prefs.setDouble(_kLastLng, pos.longitude);
      }, onError: (_) {});

      // 2. 5분 주기 타이머: 정차/대기(쿠팡 등) 및 일반 주행 상태를 5분마다 꼬박꼬박 기록
      _periodicTimer?.cancel();
      _periodicTimer = Timer.periodic(
        const Duration(minutes: _kCheckpointIntervalMinutes),
        (_) => _recordCheckpoint(reason: '5분 주기'),
      );
    } catch (_) {}
  }

  /// 5분 주기 또는 고속 주행 시 타임라인에 한 줄을 안전하게 기록합니다.
  static Future<void> _recordCheckpoint({
    double? lat,
    double? lng,
    String reason = '5분 주기',
  }) async {
    if (_isRecordingCheckpoint) return;
    if (_timeline.length >= _kMaxTimelinePoints) return;
    _isRecordingCheckpoint = true;

    try {
      final prefs = await SharedPreferences.getInstance();

      double? curLat = lat ?? _lastLat;
      double? curLng = lng ?? _lastLng;

      // 만약 최근 좌표가 없으면 조용히 1회 수신 시도
      if (curLat == null || curLng == null) {
        final pos = await tryGetSilentCurrentPosition();
        if (pos != null) {
          curLat = pos.latitude;
          curLng = pos.longitude;
          _lastLat = curLat;
          _lastLng = curLng;
        }
      }

      if (curLat == null || curLng == null) return;

      final deltaMeters = _accumulatedMeters - _lastCheckpointMeters;
      final int cumKmVal = _accumulatedMeters >= 100
          ? (_accumulatedMeters / 1000.0).round().clamp(1, 99999)
          : 0;

      // 직전 기록 대비 이동 거리가 150m 미만이면 '정차 / 대기', 150m 이상이면 '운행 중'으로 표시
      final bool isStationary = deltaMeters < 150;
      final String type = isStationary ? '정차 / 대기' : '운행 중';

      // 주소 변환 (실패해도 안전하게 좌표 또는 기본명 사용)
      final addr = await resolveKoreanAddress(
        latitude: curLat,
        longitude: curLng,
      );

      final String finalAddress = addr.isNotEmpty
          ? addr
          : (isStationary ? '정차 및 대기 위치' : '운행 중 위치');

      // 중복 체크: 직전 지점과 시각(분)이 같으면 덮어쓰거나 건너뜀
      final currentHm = _nowKstHm();
      if (_timeline.isNotEmpty &&
          _timeline.last['time'] == currentHm &&
          _timeline.last['type'] == type) {
        return;
      }

      _timeline.add({
        'time': currentHm,
        'type': type,
        'address': finalAddress,
        'lat': curLat,
        'lng': curLng,
        'cumKm': cumKmVal,
      });

      _lastCheckpointMeters = _accumulatedMeters;
      await prefs.setDouble(_kLastCheckpointMeters, _lastCheckpointMeters);
      await prefs.setString(_kTimelineList, jsonEncode(_timeline));
    } catch (_) {
    } finally {
      _isRecordingCheckpoint = false;
    }
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

  /// 안드로이드에서 배터리 사용량 '제한 없음' 원터치 허용 및 알림 권한을 요청합니다.
  static Future<void> ensureBatteryUnrestricted() async {
    if (!Platform.isAndroid) return;
    try {
      await _nativeChannel.invokeMethod<bool>('requestBatteryExemption');
    } catch (_) {}
  }

  /// 안드로이드에서 홈 화면 뒤로가기 시 앱 프로세스를 종료하지 않고 백그라운드로 보냅니다.
  static Future<void> moveToBackground() async {
    if (!Platform.isAndroid) return;
    try {
      await _nativeChannel.invokeMethod<bool>('moveTaskToBack');
    } catch (_) {}
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
    _periodicTimer?.cancel();
    _periodicTimer = null;
    await _sub?.cancel();
    _sub = null;

    if (Platform.isAndroid) {
      try {
        final raw = await _nativeChannel.invokeMethod<Map<Object?, Object?>>(
          'stopAndConsumeNativeGps',
        );
        if (raw != null) {
          final nativeAccum = (raw['accumMeters'] as num?)?.toDouble();
          if (nativeAccum != null && nativeAccum > _accumulatedMeters) {
            _accumulatedMeters = nativeAccum;
          }
          final nativeLat = (raw['lastLat'] as num?)?.toDouble();
          final nativeLng = (raw['lastLng'] as num?)?.toDouble();
          if (nativeLat != null && nativeLng != null) {
            _lastLat = nativeLat;
            _lastLng = nativeLng;
          }
          final nativeTimelineJson = raw['timelineJson'] as String?;
          if (nativeTimelineJson != null && nativeTimelineJson.isNotEmpty) {
            final decoded = jsonDecode(nativeTimelineJson) as List<dynamic>;
            final nativeTimeline = decoded
                .map((e) => Map<String, dynamic>.from(e as Map))
                .toList();
            if (nativeTimeline.isNotEmpty) {
              _timeline = nativeTimeline;
            }
          }
        }
      } catch (_) {}
    }

    final prefs = await SharedPreferences.getInstance();

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

    // 만약 출근 출발 지점이 타임라인에 빠져 있다면 DailyLogs의 출근 위치로 보강
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

    // 퇴근 도착 지점 추가
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
    _lastCheckpointMeters = 0.0;
    _lastLat = null;
    _lastLng = null;
    _timeline = [];

    await prefs.remove(_kAccumMeters);
    await prefs.remove(_kLastCheckpointMeters);
    await prefs.remove(_kLastLat);
    await prefs.remove(_kLastLng);
    await prefs.remove(_kTrackingDate);
    await prefs.remove(_kTimelineList);

    return (totalKm, finalTimeline);
  }
}
