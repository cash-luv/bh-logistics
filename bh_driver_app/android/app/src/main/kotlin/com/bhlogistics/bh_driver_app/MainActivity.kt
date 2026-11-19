package com.bhlogistics.bh_driver_app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.annotation.NonNull
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val nativeGpsChannel = "com.bhlogistics.bh_driver_app/native_gps"
    private val notificationReqCode = 9001
    private val fineLocationReqCode = 9002
    private var attemptedFineLocationPrompt = false
    private var attemptedNotificationPrompt = false

    override fun configureFlutterEngine(@NonNull flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, nativeGpsChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "startNativeGps" -> {
                        val workDate = call.argument<String>("workDate") ?: ""
                        val initialLat = call.argument<Double>("initialLat")
                        val initialLng = call.argument<Double>("initialLng")
                        val initialAddress = call.argument<String>("initialAddress") ?: ""
                        val reset = call.argument<Boolean>("reset") ?: false

                        BhGpsForegroundService.startService(
                            applicationContext,
                            workDate,
                            initialLat,
                            initialLng,
                            initialAddress,
                            reset
                        )
                        result.success(true)
                    }

                    "checkRequiredPermissions" -> {
                        result.success(getPermissionStatusMap())
                    }

                    "openLocationSettings" -> {
                        try {
                            startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                        } catch (_: Exception) {
                        }
                        result.success(true)
                    }

                    "requestFineLocation" -> {
                        requestFineLocationPermission()
                        result.success(true)
                    }

                    "requestBatteryUnrestricted", "requestBatteryExemption" -> {
                        launchBatteryUnrestrictedPrompt()
                        result.success(true)
                    }

                    "requestNotificationPermission" -> {
                        requestNotificationOrOpenSettings()
                        result.success(true)
                    }

                    "stopAndConsumeNativeGps" -> {
                        val state = BhGpsForegroundService.consumeAndClearState(applicationContext)
                        result.success(state)
                    }

                    "moveTaskToBack" -> {
                        moveTaskToBack(true)
                        result.success(true)
                    }

                    else -> result.notImplemented()
                }
            }
    }

    private fun getPermissionStatusMap(): Map<String, Boolean> {
        val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        val gpsEnabled = try {
            lm?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true
        } catch (_: Exception) {
            false
        }

        val fineLocationGranted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

        val batteryUnrestricted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
            pm?.isIgnoringBatteryOptimizations(packageName) == true
        } else {
            true
        }

        val notifEnabled = NotificationManagerCompat.from(this).areNotificationsEnabled()
        val notificationGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifEnabled &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            notifEnabled
        }

        return hashMapOf(
            "gpsEnabled" to gpsEnabled,
            "fineLocationGranted" to fineLocationGranted,
            "batteryUnrestricted" to batteryUnrestricted,
            "notificationGranted" to notificationGranted
        )
    }

    private fun requestFineLocationPermission() {
        val fineGranted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (fineGranted) return

        val shouldShowRationale = ActivityCompat.shouldShowRequestPermissionRationale(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION
        )

        if (!attemptedFineLocationPrompt || shouldShowRationale) {
            attemptedFineLocationPrompt = true
            ActivityCompat.requestPermissions(
                this,
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                ),
                fineLocationReqCode
            )
        } else {
            openAppDetailsSettings()
        }
    }

    @SuppressLint("BatteryLife")
    private fun launchBatteryUnrestrictedPrompt() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        if (pm.isIgnoringBatteryOptimizations(packageName)) return

        try {
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        } catch (_: Exception) {
            try {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (_: Exception) {
                openAppDetailsSettings()
            }
        }
    }

    private fun requestNotificationOrOpenSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val postGranted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (!postGranted) {
                val shouldShowRationale = ActivityCompat.shouldShowRequestPermissionRationale(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                )
                if (!attemptedNotificationPrompt || shouldShowRationale) {
                    attemptedNotificationPrompt = true
                    ActivityCompat.requestPermissions(
                        this,
                        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                        notificationReqCode
                    )
                    return
                }
            }
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                }
                startActivity(intent)
            } else {
                openAppDetailsSettings()
            }
        } catch (_: Exception) {
            openAppDetailsSettings()
        }
    }

    private fun openAppDetailsSettings() {
        try {
            val intent = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        } catch (_: Exception) {
        }
    }
}
