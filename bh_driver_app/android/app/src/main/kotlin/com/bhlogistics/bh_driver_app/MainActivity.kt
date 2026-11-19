package com.bhlogistics.bh_driver_app

import androidx.annotation.NonNull
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val nativeGpsChannel = "com.bhlogistics.bh_driver_app/native_gps"

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
}
