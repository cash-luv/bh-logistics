package com.bhlogistics.bh_driver_app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * 안드로이드 독립 백그라운드 GPS 전경 서비스.
 * - android:stopWithTask="false" + START_STICKY 로 동작하므로
 *   기사님이 뒤로가기나 최근 앱 스와이프로 앱을 닫아도 퇴근 전까지 계속 위치를 기록합니다.
 */
class BhGpsForegroundService : Service(), LocationListener {

    private var locationManager: LocationManager? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val checkpointExecutor = Executors.newSingleThreadExecutor()

    @Volatile
    private var isTrackingListenersActive = false

    private val periodicCheckpointRunnable = object : Runnable {
        override fun run() {
            if (!getIsActive(this@BhGpsForegroundService)) return
            checkpointExecutor.execute {
                recordCheckpoint(lat = null, lng = null)
            }
            mainHandler.postDelayed(this, CHECKPOINT_INTERVAL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action

        if (action == ACTION_STOP) {
            stopTrackingInternals()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            stopSelf()
            return START_NOT_STICKY
        }

        val workDate = intent?.getStringExtra(EXTRA_WORK_DATE)
        val hasReset = intent?.hasExtra(EXTRA_RESET) == true
        val reset = intent?.getBooleanExtra(EXTRA_RESET, false) == true

        if (workDate != null && hasReset) {
            val initLat = if (intent.hasExtra(EXTRA_INITIAL_LAT)) {
                intent.getDoubleExtra(EXTRA_INITIAL_LAT, Double.NaN).takeIf { !it.isNaN() }
            } else {
                null
            }
            val initLng = if (intent.hasExtra(EXTRA_INITIAL_LNG)) {
                intent.getDoubleExtra(EXTRA_INITIAL_LNG, Double.NaN).takeIf { !it.isNaN() }
            } else {
                null
            }
            val initAddr = intent.getStringExtra(EXTRA_INITIAL_ADDRESS) ?: ""
            initializeOrRestoreState(this, workDate, initLat, initLng, initAddr, reset)
        }

        if (!getIsActive(this)) {
            stopSelf()
            return START_NOT_STICKY
        }

        promoteToForeground(buildStatusText(this))
        acquireWakeLock()
        startLocationUpdates()
        schedulePeriodicCheckpoints()

        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // 앱을 최근 앱 목록에서 스와이프로 닫아도 퇴근 전이면 서비스를 종료하지 않고 유지합니다.
        if (getIsActive(this)) {
            promoteToForeground(buildStatusText(this))
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        stopTrackingInternals()
        checkpointExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun stopTrackingInternals() {
        mainHandler.removeCallbacks(periodicCheckpointRunnable)
        if (isTrackingListenersActive) {
            try {
                locationManager?.removeUpdates(this)
            } catch (_: Exception) {
            }
            isTrackingListenersActive = false
        }
        releaseWakeLock()
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java) ?: return
            if (manager.getNotificationChannel(NOTIFICATION_CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "BH 기사앱 운행 상태",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "운행 중 상단 알림 표시"
                    setSound(null, null)
                    enableVibration(false)
                    setShowBadge(false)
                }
                manager.createNotificationChannel(channel)
            }
        }
    }

    private fun buildNotification(text: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(this, 0, it, pendingFlags)
        }

        val smallIcon = if (applicationInfo.icon != 0) {
            applicationInfo.icon
        } else {
            android.R.drawable.ic_menu_mylocation
        }

        val builder = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("BH 기사앱 운행 중")
            .setContentText(text)
            .setSmallIcon(smallIcon)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setOnlyAlertOnce(true)

        if (contentIntent != null) {
            builder.setContentIntent(contentIntent)
        }
        return builder.build()
    }

    private fun promoteToForeground(text: String) {
        ensureNotificationChannel()
        val notification = buildNotification(text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun acquireWakeLock() {
        try {
            if (wakeLock?.isHeld == true) return
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (_: Exception) {
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Exception) {
        }
        wakeLock = null
    }

    private fun startLocationUpdates() {
        if (isTrackingListenersActive) return
        val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
        locationManager = lm

        var registeredAny = false
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    LOCATION_MIN_TIME_MS,
                    LOCATION_MIN_DISTANCE_M,
                    this,
                    Looper.getMainLooper()
                )
                registeredAny = true
            }
        } catch (_: SecurityException) {
        } catch (_: Exception) {
        }

        try {
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    LOCATION_MIN_TIME_MS,
                    LOCATION_MIN_DISTANCE_M,
                    this,
                    Looper.getMainLooper()
                )
                registeredAny = true
            }
        } catch (_: SecurityException) {
        } catch (_: Exception) {
        }

        isTrackingListenersActive = registeredAny
    }

    private fun schedulePeriodicCheckpoints() {
        mainHandler.removeCallbacks(periodicCheckpointRunnable)
        mainHandler.postDelayed(periodicCheckpointRunnable, CHECKPOINT_INTERVAL_MS)
    }

    override fun onLocationChanged(location: Location) {
        if (!getIsActive(this)) return
        if (location.hasAccuracy() && location.accuracy > 150f) return

        var shouldRecordFastCheckpoint = false
        synchronized(stateLock) {
            val prefs = prefs(this)
            if (!prefs.getBoolean(KEY_IS_ACTIVE, false)) return

            var accumMeters = prefs.getString(KEY_ACCUM_METERS, "0.0")?.toDoubleOrNull() ?: 0.0
            val lastChkMeters = prefs.getString(KEY_LAST_CHK_METERS, "0.0")?.toDoubleOrNull() ?: 0.0
            val prevLat = prefs.getString(KEY_LAST_LAT, null)?.toDoubleOrNull()
            val prevLng = prefs.getString(KEY_LAST_LNG, null)?.toDoubleOrNull()

            if (prevLat != null && prevLng != null) {
                val results = FloatArray(1)
                Location.distanceBetween(prevLat, prevLng, location.latitude, location.longitude, results)
                val deltaMeters = results[0]
                if (deltaMeters in 30f..50000f) {
                    accumMeters += deltaMeters
                    if (accumMeters - lastChkMeters >= 5000.0) {
                        shouldRecordFastCheckpoint = true
                    }
                }
            }

            prefs.edit()
                .putString(KEY_ACCUM_METERS, accumMeters.toString())
                .putString(KEY_LAST_LAT, location.latitude.toString())
                .putString(KEY_LAST_LNG, location.longitude.toString())
                .apply()
        }

        if (shouldRecordFastCheckpoint) {
            val lat = location.latitude
            val lng = location.longitude
            checkpointExecutor.execute {
                recordCheckpoint(lat = lat, lng = lng)
            }
        }
    }

    @Deprecated("Deprecated in Android API 29")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    override fun onProviderEnabled(provider: String) {}

    override fun onProviderDisabled(provider: String) {}

    private fun recordCheckpoint(lat: Double?, lng: Double?) {
        var curLat: Double?
        var curLng: Double?
        var accumMetersSnapshot: Double
        var lastChkSnapshot: Double

        synchronized(stateLock) {
            val p = prefs(this)
            if (!p.getBoolean(KEY_IS_ACTIVE, false)) return
            curLat = lat ?: p.getString(KEY_LAST_LAT, null)?.toDoubleOrNull()
            curLng = lng ?: p.getString(KEY_LAST_LNG, null)?.toDoubleOrNull()
            accumMetersSnapshot = p.getString(KEY_ACCUM_METERS, "0.0")?.toDoubleOrNull() ?: 0.0
            lastChkSnapshot = p.getString(KEY_LAST_CHK_METERS, "0.0")?.toDoubleOrNull() ?: 0.0
        }

        if (curLat == null || curLng == null) {
            val fallback = getLastKnownSilentLocation()
            if (fallback != null) {
                curLat = fallback.latitude
                curLng = fallback.longitude
                synchronized(stateLock) {
                    val p = prefs(this)
                    if (p.getBoolean(KEY_IS_ACTIVE, false)) {
                        p.edit()
                            .putString(KEY_LAST_LAT, curLat.toString())
                            .putString(KEY_LAST_LNG, curLng.toString())
                            .apply()
                    }
                }
            }
        }

        val finalLat = curLat ?: return
        val finalLng = curLng ?: return

        val resolvedAddr = resolveKoreanAddressSync(this, finalLat, finalLng)

        var updatedSummaryText: String? = null
        synchronized(stateLock) {
            val p = prefs(this)
            if (!p.getBoolean(KEY_IS_ACTIVE, false)) return

            accumMetersSnapshot = p.getString(KEY_ACCUM_METERS, "0.0")?.toDoubleOrNull() ?: accumMetersSnapshot
            lastChkSnapshot = p.getString(KEY_LAST_CHK_METERS, "0.0")?.toDoubleOrNull() ?: lastChkSnapshot

            val rawTimeline = p.getString(KEY_TIMELINE_JSON, "[]") ?: "[]"
            val timeline = try {
                JSONArray(rawTimeline)
            } catch (_: Exception) {
                JSONArray()
            }

            if (timeline.length() >= MAX_TIMELINE_POINTS) return

            val deltaMeters = accumMetersSnapshot - lastChkSnapshot
            val cumKm = if (accumMetersSnapshot >= 100.0) {
                (accumMetersSnapshot / 1000.0).roundToInt().coerceIn(1, 99999)
            } else {
                0
            }
            val isStationary = deltaMeters < 150.0
            val type = if (isStationary) "정차 / 대기" else "운행 중"
            val address = if (resolvedAddr.isNotEmpty()) {
                resolvedAddr
            } else if (isStationary) {
                "정차 및 대기 위치"
            } else {
                "운행 중 위치"
            }

            val currentHm = nowKstHm()
            if (timeline.length() > 0) {
                val lastObj = timeline.optJSONObject(timeline.length() - 1)
                if (lastObj != null &&
                    lastObj.optString("time") == currentHm &&
                    lastObj.optString("type") == type
                ) {
                    return
                }
            }

            val entry = JSONObject().apply {
                put("time", currentHm)
                put("type", type)
                put("address", address)
                put("lat", finalLat)
                put("lng", finalLng)
                put("cumKm", cumKm)
            }
            timeline.put(entry)

            p.edit()
                .putString(KEY_LAST_CHK_METERS, accumMetersSnapshot.toString())
                .putString(KEY_TIMELINE_JSON, timeline.toString())
                .apply()

            updatedSummaryText = "오늘도 안전 운행하세요."
        }

        updatedSummaryText?.let { text ->
            mainHandler.post {
                if (getIsActive(this)) {
                    updateNotification(text)
                }
            }
        }
    }

    private fun getLastKnownSilentLocation(): Location? {
        val lm = locationManager
            ?: (getSystemService(Context.LOCATION_SERVICE) as? LocationManager)
            ?: return null
        return try {
            lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
        } catch (_: SecurityException) {
            null
        } catch (_: Exception) {
            null
        }
    }

    private fun resolveKoreanAddressSync(context: Context, lat: Double, lng: Double): String {
        return try {
            val geocoder = Geocoder(context, Locale.KOREA)
            @Suppress("DEPRECATION")
            val list = geocoder.getFromLocation(lat, lng, 1)
            if (list.isNullOrEmpty()) return ""
            val addr = list[0]
            val parts = mutableListOf<String>()
            val candidates = listOf(
                addr.adminArea,
                addr.locality ?: addr.subAdminArea,
                addr.subLocality ?: addr.thoroughfare
            )
            for (raw in candidates) {
                val clean = raw?.trim().orEmpty()
                if (clean.isNotEmpty() && !parts.contains(clean)) {
                    parts.add(clean)
                }
            }
            if (parts.isNotEmpty()) {
                parts.joinToString(" ")
            } else {
                addr.getAddressLine(0)?.trim().orEmpty()
            }
        } catch (_: Exception) {
            ""
        }
    }

    companion object {
        private const val PREFS_NAME = "bh_native_gps_prefs"
        private const val KEY_WORK_DATE = "work_date"
        private const val KEY_ACCUM_METERS = "accum_meters"
        private const val KEY_LAST_CHK_METERS = "last_chk_meters"
        private const val KEY_LAST_LAT = "last_lat"
        private const val KEY_LAST_LNG = "last_lng"
        private const val KEY_TIMELINE_JSON = "timeline_json"
        private const val KEY_IS_ACTIVE = "is_active"

        private const val NOTIFICATION_CHANNEL_ID = "bh_gps_running_channel_v2"
        private const val NOTIFICATION_ID = 88415
        private const val WAKELOCK_TAG = "BhGpsService::WakeLock"

        private const val LOCATION_MIN_TIME_MS = 15000L
        private const val LOCATION_MIN_DISTANCE_M = 25f
        private const val CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000L
        private const val MAX_TIMELINE_POINTS = 300

        private const val ACTION_START = "com.bhlogistics.bh_driver_app.START_GPS"
        private const val ACTION_STOP = "com.bhlogistics.bh_driver_app.STOP_GPS"

        private const val EXTRA_WORK_DATE = "workDate"
        private const val EXTRA_INITIAL_LAT = "initialLat"
        private const val EXTRA_INITIAL_LNG = "initialLng"
        private const val EXTRA_INITIAL_ADDRESS = "initialAddress"
        private const val EXTRA_RESET = "reset"

        private val stateLock = Any()

        private fun prefs(context: Context) =
            context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        private fun getIsActive(context: Context): Boolean =
            prefs(context).getBoolean(KEY_IS_ACTIVE, false)

        private fun nowKstHm(): String {
            val fmt = SimpleDateFormat("HH:mm", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("Asia/Seoul")
            }
            return fmt.format(Date())
        }

        private fun buildStatusText(context: Context): String =
            "오늘도 안전 운행하세요."

        private fun initializeOrRestoreState(
            context: Context,
            workDate: String,
            initialLat: Double?,
            initialLng: Double?,
            initialAddress: String,
            reset: Boolean
        ) {
            synchronized(stateLock) {
                val p = prefs(context)
                val savedDate = p.getString(KEY_WORK_DATE, null)
                if (!reset && savedDate == workDate) {
                    p.edit().putBoolean(KEY_IS_ACTIVE, true).apply()
                    return
                }

                val timeline = JSONArray()
                if (initialLat != null && initialLng != null) {
                    timeline.put(JSONObject().apply {
                        put("time", nowKstHm())
                        put("type", "출근 출발")
                        put("address", initialAddress.ifEmpty { "출근 출발 위치" })
                        put("lat", initialLat)
                        put("lng", initialLng)
                        put("cumKm", 0)
                    })
                }

                val editor = p.edit()
                    .putString(KEY_WORK_DATE, workDate)
                    .putString(KEY_ACCUM_METERS, "0.0")
                    .putString(KEY_LAST_CHK_METERS, "0.0")
                    .putString(KEY_TIMELINE_JSON, timeline.toString())
                    .putBoolean(KEY_IS_ACTIVE, true)

                if (initialLat != null && initialLng != null) {
                    editor.putString(KEY_LAST_LAT, initialLat.toString())
                    editor.putString(KEY_LAST_LNG, initialLng.toString())
                } else {
                    editor.remove(KEY_LAST_LAT)
                    editor.remove(KEY_LAST_LNG)
                }
                editor.apply()
            }
        }

        @JvmStatic
        fun startService(
            context: Context,
            workDate: String,
            initialLat: Double?,
            initialLng: Double?,
            initialAddress: String,
            reset: Boolean
        ) {
            val appCtx = context.applicationContext
            initializeOrRestoreState(appCtx, workDate, initialLat, initialLng, initialAddress, reset)

            val intent = Intent(appCtx, BhGpsForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_WORK_DATE, workDate)
                putExtra(EXTRA_RESET, reset)
                putExtra(EXTRA_INITIAL_ADDRESS, initialAddress)
                if (initialLat != null && initialLng != null) {
                    putExtra(EXTRA_INITIAL_LAT, initialLat)
                    putExtra(EXTRA_INITIAL_LNG, initialLng)
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appCtx.startForegroundService(intent)
            } else {
                appCtx.startService(intent)
            }
        }

        @JvmStatic
        fun consumeAndClearState(context: Context): Map<String, Any?> {
            val appCtx = context.applicationContext
            val result: Map<String, Any?>

            synchronized(stateLock) {
                val p = prefs(appCtx)
                val accumMeters = p.getString(KEY_ACCUM_METERS, "0.0")?.toDoubleOrNull() ?: 0.0
                val lastLat = p.getString(KEY_LAST_LAT, null)?.toDoubleOrNull()
                val lastLng = p.getString(KEY_LAST_LNG, null)?.toDoubleOrNull()
                val timelineJson = p.getString(KEY_TIMELINE_JSON, "[]") ?: "[]"

                result = hashMapOf(
                    "accumMeters" to accumMeters,
                    "lastLat" to lastLat,
                    "lastLng" to lastLng,
                    "timelineJson" to timelineJson
                )

                p.edit()
                    .putBoolean(KEY_IS_ACTIVE, false)
                    .remove(KEY_ACCUM_METERS)
                    .remove(KEY_LAST_CHK_METERS)
                    .remove(KEY_LAST_LAT)
                    .remove(KEY_LAST_LNG)
                    .remove(KEY_WORK_DATE)
                    .remove(KEY_TIMELINE_JSON)
                    .apply()
            }

            try {
                appCtx.stopService(Intent(appCtx, BhGpsForegroundService::class.java))
            } catch (_: Exception) {
            }

            return result
        }
    }
}
