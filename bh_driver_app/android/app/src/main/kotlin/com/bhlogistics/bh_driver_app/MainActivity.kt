package com.bhlogistics.bh_driver_app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.annotation.NonNull
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val nativeGpsChannel = "com.bhlogistics.bh_driver_app/native_gps"
    private val notificationReqCode = 9001
    private var promptedBatteryThisSession = false

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
                        requestBatteryAndNotificationPermissions(forceBatteryPrompt = reset)
                        result.success(true)
                    }

                    "requestBatteryExemption" -> {
                        requestBatteryAndNotificationPermissions(forceBatteryPrompt = false)
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

    private fun requestBatteryAndNotificationPermissions(forceBatteryPrompt: Boolean = false) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissions(
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    notificationReqCode
                )
                return
            }
        }
        requestBatteryExemptionIfNeeded(forceBatteryPrompt)
    }

    @SuppressLint("BatteryLife")
    private fun requestBatteryExemptionIfNeeded(forcePrompt: Boolean) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        if (!forcePrompt && promptedBatteryThisSession) return

        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        if (pm.isIgnoringBatteryOptimizations(packageName)) return

        promptedBatteryThisSession = true
        try {
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        } catch (_: Exception) {
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == notificationReqCode) {
            requestBatteryExemptionIfNeeded(forcePrompt = false)
        }
    }
}
