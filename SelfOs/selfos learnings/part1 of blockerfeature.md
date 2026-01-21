# Part 1 (Corrected) - Modern Expo Module Approach

You're absolutely right! Let me rewrite this following modern Expo module practices - **no XML layouts, programmatic UI, minimal resources**.

---

## Module Structure (Clean)

```
modules/
└── app-blocker/
    ├── android/
    │   ├── build.gradle
    │   └── src/main/
    │       ├── AndroidManifest.xml
    │       ├── java/expo/modules/appblocker/
    │       │   ├── AppBlockerModule.kt
    │       │   ├── models/
    │       │   │   └── BlockerModels.kt
    │       │   ├── storage/
    │       │   │   └── BlockerStorage.kt
    │       │   ├── permissions/
    │       │   │   └── PermissionManager.kt
    │       │   ├── services/
    │       │   │   ├── BlockerAccessibilityService.kt
    │       │   │   ├── BlockerForegroundService.kt
    │       │   │   └── SessionManager.kt
    │       │   ├── usage/
    │       │   │   └── UsageTracker.kt
    │       │   ├── scheduling/
    │       │   │   └── ScheduleManager.kt
    │       │   ├── receivers/
    │       │   │   ├── BootReceiver.kt
    │       │   │   └── ScheduleAlarmReceiver.kt
    │       │   └── ui/
    │       │       └── BlockingOverlayActivity.kt
    │       └── res/
    │           └── xml/
    │               └── accessibility_config.xml  ← Only XML needed (Android requires it)
    ├── src/
    │   └── index.ts
    ├── expo-module.config.json
    └── index.ts
```

---

## 1.1 `modules/app-blocker/expo-module.config.json`

```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["expo.modules.appblocker.AppBlockerModule"]
  }
}
```

---

## 1.2 `modules/app-blocker/android/build.gradle`

```gradle
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'

group = 'expo.modules.appblocker'
version = '1.0.0'

android {
    namespace "expo.modules.appblocker"
    compileSdk 34

    defaultConfig {
        minSdk 24
        targetSdk 34
    }

    buildTypes {
        release {
            minifyEnabled false
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation project(':expo-modules-core')
    implementation "org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.22"
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3"
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3"
    implementation "androidx.core:core-ktx:1.12.0"
    implementation "androidx.appcompat:appcompat:1.6.1"
    implementation "androidx.lifecycle:lifecycle-service:2.7.0"
    implementation "com.google.code.gson:gson:2.10.1"
}
```

---

## 1.3 `modules/app-blocker/android/src/main/AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" tools:ignore="ProtectedPermissions" />
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" tools:ignore="QueryAllPackagesPermission" />

    <application>
        
        <service
            android:name=".services.BlockerAccessibilityService"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
            android:exported="false">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/accessibility_config" />
        </service>

        <service
            android:name=".services.BlockerForegroundService"
            android:foregroundServiceType="specialUse"
            android:exported="false">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Digital wellbeing focus session blocking" />
        </service>

        <receiver
            android:name=".receivers.BootReceiver"
            android:exported="false"
            android:enabled="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
            </intent-filter>
        </receiver>

        <receiver
            android:name=".receivers.ScheduleAlarmReceiver"
            android:exported="false" />

        <activity
            android:name=".ui.BlockingOverlayActivity"
            android:theme="@android:style/Theme.Translucent.NoTitleBar.Fullscreen"
            android:launchMode="singleInstance"
            android:taskAffinity=""
            android:excludeFromRecents="true"
            android:noHistory="true"
            android:exported="false" />

    </application>
</manifest>
```

---

## 1.4 `modules/app-blocker/android/src/main/res/xml/accessibility_config.xml`

**(This is the ONLY XML file needed - Android requires it for accessibility services)**

```xml
<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagIncludeNotImportantViews"
    android:canRetrieveWindowContent="false"
    android:notificationTimeout="50"
    android:description="@string/accessibility_description" />
```

## 1.5 `modules/app-blocker/android/src/main/res/values/strings.xml`

**(Minimal - only what Android requires for accessibility)**

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="accessibility_description">Monitors app launches to block distracting apps during focus sessions.</string>
</resources>
```

---

## 1.6 Models - `android/src/main/java/expo/modules/appblocker/models/BlockerModels.kt`

```kotlin
package expo.modules.appblocker.models

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.reflect.TypeToken
import java.util.Calendar

// ==================== Enums ====================

enum class SessionIntensity(val value: String) {
    FLEXIBLE("flexible"),
    COMMITTED("committed"),
    LOCKED("locked");

    companion object {
        fun fromString(value: String): SessionIntensity =
            entries.find { it.value.equals(value, ignoreCase = true) } ?: FLEXIBLE
    }
}

// ==================== Data Classes ====================

data class BlockedApp(
    val id: String,
    val packageName: String,
    val name: String,
    val icon: String? = null,
    val color: String? = null,
    val dailyLimitMinutes: Int? = null
)

data class FocusSession(
    val id: String,
    val startTime: Long,
    val durationMinutes: Int,
    val intensity: SessionIntensity,
    val blockedPackages: List<String>,
    val isPaused: Boolean = false,
    val pausedAt: Long? = null,
    val totalPausedTime: Long = 0L,
    val completed: Boolean = false,
    val endTime: Long? = null
) {
    val expectedEndTime: Long
        get() = startTime + (durationMinutes * 60 * 1000L) + totalPausedTime

    val remainingMillis: Long
        get() {
            if (completed) return 0L
            val now = System.currentTimeMillis()
            return if (isPaused && pausedAt != null) {
                expectedEndTime - pausedAt
            } else {
                maxOf(0L, expectedEndTime - now)
            }
        }

    val remainingSeconds: Long get() = remainingMillis / 1000

    val isActive: Boolean get() = !completed && remainingMillis > 0

    val progress: Float
        get() {
            if (completed) return 1f
            val total = durationMinutes * 60 * 1000f
            val elapsed = total - remainingMillis
            return (elapsed / total).coerceIn(0f, 1f)
        }

    fun isAppBlocked(packageName: String): Boolean =
        isActive && !isPaused && blockedPackages.contains(packageName)

    fun pause(): FocusSession {
        if (intensity != SessionIntensity.FLEXIBLE || isPaused) return this
        return copy(isPaused = true, pausedAt = System.currentTimeMillis())
    }

    fun resume(): FocusSession {
        if (!isPaused || pausedAt == null) return this
        val pauseDuration = System.currentTimeMillis() - pausedAt
        return copy(isPaused = false, pausedAt = null, totalPausedTime = totalPausedTime + pauseDuration)
    }

    fun complete(): FocusSession = copy(completed = true, endTime = System.currentTimeMillis())

    companion object {
        fun create(
            durationMinutes: Int,
            intensity: SessionIntensity,
            blockedPackages: List<String>
        ) = FocusSession(
            id = System.currentTimeMillis().toString(),
            startTime = System.currentTimeMillis(),
            durationMinutes = durationMinutes,
            intensity = intensity,
            blockedPackages = blockedPackages
        )
    }
}

data class BlockSchedule(
    val id: String,
    val name: String,
    val startTimeMinutes: Int,
    val endTimeMinutes: Int,
    val daysOfWeek: List<Int>,
    val intensity: SessionIntensity,
    val blockedPackages: List<String>,
    val isActive: Boolean = true
) {
    fun isCurrentlyActive(): Boolean {
        if (!isActive) return false
        val now = Calendar.getInstance()
        val currentDay = now.get(Calendar.DAY_OF_WEEK)
        val currentMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)

        if (!daysOfWeek.contains(currentDay)) return false

        return if (startTimeMinutes <= endTimeMinutes) {
            currentMinutes in startTimeMinutes until endTimeMinutes
        } else {
            currentMinutes >= startTimeMinutes || currentMinutes < endTimeMinutes
        }
    }

    fun getTimeString(): String {
        fun format(minutes: Int): String {
            val h = minutes / 60
            val m = minutes % 60
            val amPm = if (h < 12) "AM" else "PM"
            val hour = when { h == 0 -> 12; h > 12 -> h - 12; else -> h }
            return "%d:%02d %s".format(hour, m, amPm)
        }
        return "${format(startTimeMinutes)} - ${format(endTimeMinutes)}"
    }
}

data class DailyLimitConfig(
    val enabled: Boolean = false,
    val limitMinutes: Int = 60,
    val blockedPackages: List<String> = emptyList(),
    val resetHour: Int = 0
)

data class AppUsageStats(
    val packageName: String,
    val appName: String,
    val usageTimeMinutes: Long,
    val lastUsed: Long,
    val launchCount: Int
)

data class InstalledAppInfo(
    val packageName: String,
    val appName: String,
    val isSystemApp: Boolean
)

data class PermissionStatus(
    val usageStats: Boolean,
    val overlay: Boolean,
    val accessibility: Boolean,
    val notifications: Boolean
) {
    val allRequired: Boolean get() = usageStats && overlay && accessibility
}

data class UserStats(
    val totalSessions: Int = 0,
    val totalFocusMinutes: Long = 0,
    val longestSessionMinutes: Int = 0,
    val currentStreak: Int = 0,
    val lastSessionDate: String? = null,
    val todayFocusMinutes: Long = 0
)

// ==================== Events ====================

object BlockerEvents {
    const val SESSION_STARTED = "onSessionStarted"
    const val SESSION_ENDED = "onSessionEnded"
    const val SESSION_PAUSED = "onSessionPaused"
    const val SESSION_RESUMED = "onSessionResumed"
    const val SESSION_TICK = "onSessionTick"
    const val APP_BLOCKED = "onAppBlocked"
    const val LIMIT_REACHED = "onLimitReached"
    const val SCHEDULE_TRIGGERED = "onScheduleTriggered"
}

// ==================== JSON Helper ====================

object Json {
    private val gson: Gson = GsonBuilder().setLenient().create()

    fun <T> toJson(obj: T): String = gson.toJson(obj)

    inline fun <reified T> fromJson(json: String): T? = try {
        gson.fromJson(json, T::class.java)
    } catch (e: Exception) { null }

    inline fun <reified T> fromJsonList(json: String): List<T> = try {
        val type = TypeToken.getParameterized(List::class.java, T::class.java).type
        gson.fromJson(json, type) ?: emptyList()
    } catch (e: Exception) { emptyList() }
}
```

---

## 1.7 Storage - `android/src/main/java/expo/modules/appblocker/storage/BlockerStorage.kt`

```kotlin
package expo.modules.appblocker.storage

import android.content.Context
import android.content.SharedPreferences
import expo.modules.appblocker.models.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate

class BlockerStorage private constructor(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS_NAME = "expo_app_blocker"
        private const val KEY_SESSION = "active_session"
        private const val KEY_APPS = "blocked_apps"
        private const val KEY_SCHEDULES = "schedules"
        private const val KEY_LIMIT = "daily_limit"
        private const val KEY_USAGE = "today_usage"
        private const val KEY_RESET_DATE = "reset_date"
        private const val KEY_HISTORY = "session_history"
        private const val KEY_STATS = "user_stats"

        @Volatile private var instance: BlockerStorage? = null

        fun getInstance(context: Context): BlockerStorage =
            instance ?: synchronized(this) {
                instance ?: BlockerStorage(context.applicationContext).also { instance = it }
            }
    }

    // ==================== Session ====================

    suspend fun saveSession(session: FocusSession) = withContext(Dispatchers.IO) {
        prefs.edit().putString(KEY_SESSION, Json.toJson(session)).apply()
    }

    fun saveSessionSync(session: FocusSession) {
        prefs.edit().putString(KEY_SESSION, Json.toJson(session)).apply()
    }

    suspend fun getSession(): FocusSession? = withContext(Dispatchers.IO) { getSessionSync() }

    fun getSessionSync(): FocusSession? =
        prefs.getString(KEY_SESSION, null)?.let { Json.fromJson<FocusSession>(it) }

    suspend fun clearSession() = withContext(Dispatchers.IO) { clearSessionSync() }

    fun clearSessionSync() = prefs.edit().remove(KEY_SESSION).apply()

    fun hasActiveSession(): Boolean = getSessionSync()?.isActive == true

    // ==================== Blocked Apps ====================

    suspend fun saveBlockedApps(apps: List<BlockedApp>) = withContext(Dispatchers.IO) {
        prefs.edit().putString(KEY_APPS, Json.toJson(apps)).apply()
    }

    suspend fun getBlockedApps(): List<BlockedApp> = withContext(Dispatchers.IO) { getBlockedAppsSync() }

    fun getBlockedAppsSync(): List<BlockedApp> =
        prefs.getString(KEY_APPS, null)?.let { Json.fromJsonList<BlockedApp>(it) } ?: emptyList()

    // ==================== Schedules ====================

    suspend fun saveSchedules(schedules: List<BlockSchedule>) = withContext(Dispatchers.IO) {
        prefs.edit().putString(KEY_SCHEDULES, Json.toJson(schedules)).apply()
    }

    suspend fun getSchedules(): List<BlockSchedule> = withContext(Dispatchers.IO) { getSchedulesSync() }

    fun getSchedulesSync(): List<BlockSchedule> =
        prefs.getString(KEY_SCHEDULES, null)?.let { Json.fromJsonList<BlockSchedule>(it) } ?: emptyList()

    // ==================== Daily Limit ====================

    suspend fun saveDailyLimit(config: DailyLimitConfig) = withContext(Dispatchers.IO) {
        prefs.edit().putString(KEY_LIMIT, Json.toJson(config)).apply()
    }

    suspend fun getDailyLimit(): DailyLimitConfig? = withContext(Dispatchers.IO) { getDailyLimitSync() }

    fun getDailyLimitSync(): DailyLimitConfig? =
        prefs.getString(KEY_LIMIT, null)?.let { Json.fromJson<DailyLimitConfig>(it) }

    // ==================== Usage Tracking ====================

    private fun today(): String = LocalDate.now().toString()

    private fun ensureReset() {
        val lastReset = prefs.getString(KEY_RESET_DATE, null)
        if (lastReset != today()) {
            prefs.edit()
                .putString(KEY_USAGE, "{}")
                .putString(KEY_RESET_DATE, today())
                .apply()
        }
    }

    private fun getUsageMap(): MutableMap<String, Long> {
        ensureReset()
        return prefs.getString(KEY_USAGE, null)
            ?.let { Json.fromJson<Map<String, Long>>(it)?.toMutableMap() }
            ?: mutableMapOf()
    }

    private fun saveUsageMap(map: Map<String, Long>) {
        prefs.edit().putString(KEY_USAGE, Json.toJson(map)).apply()
    }

    suspend fun addUsage(packageName: String, minutes: Long) = withContext(Dispatchers.IO) {
        val map = getUsageMap()
        map[packageName] = (map[packageName] ?: 0L) + minutes
        saveUsageMap(map)
    }

    suspend fun getTodayUsage(packageName: String): Long = withContext(Dispatchers.IO) {
        getUsageMap()[packageName] ?: 0L
    }

    suspend fun getTotalTodayUsage(): Long = withContext(Dispatchers.IO) {
        getUsageMap().values.sum()
    }

    fun getTotalTodayUsageSync(): Long = getUsageMap().values.sum()

    // ==================== History ====================

    suspend fun addToHistory(session: FocusSession) = withContext(Dispatchers.IO) {
        val history = getHistory().toMutableList()
        history.add(0, session)
        prefs.edit().putString(KEY_HISTORY, Json.toJson(history.take(100))).apply()
    }

    suspend fun getHistory(): List<FocusSession> = withContext(Dispatchers.IO) {
        prefs.getString(KEY_HISTORY, null)?.let { Json.fromJsonList<FocusSession>(it) } ?: emptyList()
    }

    // ==================== Stats ====================

    suspend fun getStats(): UserStats = withContext(Dispatchers.IO) { getStatsSync() }

    fun getStatsSync(): UserStats {
        val stats = prefs.getString(KEY_STATS, null)?.let { Json.fromJson<UserStats>(it) } ?: UserStats()
        return if (stats.lastSessionDate != today() && stats.todayFocusMinutes > 0) {
            stats.copy(todayFocusMinutes = 0)
        } else stats
    }

    suspend fun updateStats(session: FocusSession) = withContext(Dispatchers.IO) {
        if (!session.completed) return@withContext

        val current = getStatsSync()
        val yesterday = LocalDate.now().minusDays(1).toString()

        val newStreak = when (current.lastSessionDate) {
            today() -> current.currentStreak
            yesterday -> current.currentStreak + 1
            else -> 1
        }

        val todayMinutes = if (current.lastSessionDate == today()) {
            current.todayFocusMinutes + session.durationMinutes
        } else {
            session.durationMinutes.toLong()
        }

        val newStats = UserStats(
            totalSessions = current.totalSessions + 1,
            totalFocusMinutes = current.totalFocusMinutes + session.durationMinutes,
            longestSessionMinutes = maxOf(current.longestSessionMinutes, session.durationMinutes),
            currentStreak = newStreak,
            lastSessionDate = today(),
            todayFocusMinutes = todayMinutes
        )

        prefs.edit().putString(KEY_STATS, Json.toJson(newStats)).apply()
    }

    suspend fun clearAll() = withContext(Dispatchers.IO) {
        prefs.edit().clear().apply()
    }
}
```

---

## 1.8 Permissions - `android/src/main/java/expo/modules/appblocker/permissions/PermissionManager.kt`

```kotlin
package expo.modules.appblocker.permissions

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.AppOpsManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import expo.modules.appblocker.models.PermissionStatus
import expo.modules.appblocker.services.BlockerAccessibilityService

class PermissionManager private constructor(private val context: Context) {

    companion object {
        @Volatile private var instance: PermissionManager? = null

        fun getInstance(context: Context): PermissionManager =
            instance ?: synchronized(this) {
                instance ?: PermissionManager(context.applicationContext).also { instance = it }
            }
    }

    fun getStatus(): PermissionStatus = PermissionStatus(
        usageStats = hasUsageStats(),
        overlay = hasOverlay(),
        accessibility = hasAccessibility(),
        notifications = hasNotifications()
    )

    fun hasAllRequired(): Boolean = hasUsageStats() && hasOverlay() && hasAccessibility()

    fun hasUsageStats(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun hasOverlay(): Boolean = Settings.canDrawOverlays(context)

    fun hasAccessibility(): Boolean {
        val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        val services = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
        val expected = "${context.packageName}/${BlockerAccessibilityService::class.java.canonicalName}"
        return services.any { "${it.resolveInfo.serviceInfo.packageName}/${it.resolveInfo.serviceInfo.name}" == expected }
    }

    fun hasNotifications(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()
        } else true
    }

    fun openSettings(type: String) {
        val intent = when (type.lowercase()) {
            "usagestats", "usage" -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
            "accessibility" -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            "notifications" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
            }
            else -> return
        }
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        context.startActivity(intent)
    }
}
```

---

## 1.9 Main Module - `android/src/main/java/expo/modules/appblocker/AppBlockerModule.kt`

```kotlin
package expo.modules.appblocker

import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.appblocker.models.*
import expo.modules.appblocker.permissions.PermissionManager
import expo.modules.appblocker.storage.BlockerStorage
import expo.modules.appblocker.services.BlockerForegroundService
import expo.modules.appblocker.services.SessionManager
import expo.modules.appblocker.usage.UsageTracker
import expo.modules.appblocker.scheduling.ScheduleManager
import kotlinx.coroutines.*

class AppBlockerModule : Module() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val context: Context
        get() = appContext.reactContext ?: throw IllegalStateException("Context not available")

    private val permissions: PermissionManager get() = PermissionManager.getInstance(context)
    private val storage: BlockerStorage get() = BlockerStorage.getInstance(context)
    private val sessions: SessionManager get() = SessionManager.getInstance(context)
    private val usage: UsageTracker get() = UsageTracker.getInstance(context)
    private val schedules: ScheduleManager get() = ScheduleManager.getInstance(context)

    override fun definition() = ModuleDefinition {

        Name("AppBlocker")

        Events(
            BlockerEvents.SESSION_STARTED,
            BlockerEvents.SESSION_ENDED,
            BlockerEvents.SESSION_PAUSED,
            BlockerEvents.SESSION_RESUMED,
            BlockerEvents.SESSION_TICK,
            BlockerEvents.APP_BLOCKED,
            BlockerEvents.LIMIT_REACHED,
            BlockerEvents.SCHEDULE_TRIGGERED
        )

        // ==================== Permissions ====================

        AsyncFunction("getPermissionStatus") { promise: Promise ->
            try {
                val status = permissions.getStatus()
                promise.resolve(mapOf(
                    "usageStats" to status.usageStats,
                    "overlay" to status.overlay,
                    "accessibility" to status.accessibility,
                    "notifications" to status.notifications,
                    "allRequired" to status.allRequired
                ))
            } catch (e: Exception) {
                promise.reject("ERROR", e.message, e)
            }
        }

        AsyncFunction("openPermissionSettings") { type: String, promise: Promise ->
            try {
                permissions.openSettings(type)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("ERROR", e.message, e)
            }
        }

        AsyncFunction("hasAllPermissions") { promise: Promise ->
            promise.resolve(permissions.hasAllRequired())
        }

        // ==================== Sessions ====================

        AsyncFunction("startSession") { durationMinutes: Int, intensity: String, blockedPackages: List<String>, promise: Promise ->
            scope.launch {
                try {
                    if (!permissions.hasAllRequired()) {
                        promise.reject("PERMISSION_REQUIRED", "Required permissions not granted", null)
                        return@launch
                    }

                    if (storage.hasActiveSession()) {
                        promise.reject("SESSION_ACTIVE", "A session is already active", null)
                        return@launch
                    }

                    val session = sessions.startSession(
                        durationMinutes,
                        SessionIntensity.fromString(intensity),
                        blockedPackages
                    )

                    startService()
                    sendEvent(BlockerEvents.SESSION_STARTED, session.toMap())
                    promise.resolve(session.toMap())
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("stopSession") { completed: Boolean, promise: Promise ->
            scope.launch {
                try {
                    val current = storage.getSession()

                    if (current?.intensity == SessionIntensity.LOCKED && current.isActive && !completed) {
                        promise.reject("SESSION_LOCKED", "Cannot stop locked session early", null)
                        return@launch
                    }

                    val session = sessions.stopSession(completed)
                    stopService()

                    if (session != null) {
                        sendEvent(BlockerEvents.SESSION_ENDED, mapOf(
                            "session" to session.toMap(),
                            "completedSuccessfully" to completed
                        ))
                        promise.resolve(session.toMap())
                    } else {
                        promise.resolve(null)
                    }
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("pauseSession") { promise: Promise ->
            scope.launch {
                try {
                    val session = sessions.pauseSession()
                    if (session != null) {
                        sendEvent(BlockerEvents.SESSION_PAUSED, session.toMap())
                        promise.resolve(session.toMap())
                    } else {
                        promise.reject("PAUSE_ERROR", "Cannot pause session", null)
                    }
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("resumeSession") { promise: Promise ->
            scope.launch {
                try {
                    val session = sessions.resumeSession()
                    if (session != null) {
                        sendEvent(BlockerEvents.SESSION_RESUMED, session.toMap())
                        promise.resolve(session.toMap())
                    } else {
                        promise.reject("RESUME_ERROR", "Cannot resume session", null)
                    }
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("getActiveSession") { promise: Promise ->
            scope.launch {
                try {
                    val session = storage.getSession()
                    if (session != null && session.isActive) {
                        promise.resolve(session.toMap())
                    } else {
                        session?.let { storage.clearSession() }
                        promise.resolve(null)
                    }
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("getSessionState") { promise: Promise ->
            scope.launch {
                try {
                    val session = storage.getSession()
                    if (session != null && session.isActive) {
                        promise.resolve(mapOf(
                            "isActive" to true,
                            "isPaused" to session.isPaused,
                            "remainingMillis" to session.remainingMillis,
                            "remainingSeconds" to session.remainingSeconds,
                            "progress" to session.progress,
                            "intensity" to session.intensity.value,
                            "durationMinutes" to session.durationMinutes,
                            "blockedPackages" to session.blockedPackages
                        ))
                    } else {
                        promise.resolve(mapOf("isActive" to false))
                    }
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("canStopSession") { promise: Promise ->
            scope.launch {
                try {
                    val session = storage.getSession()
                    val result = when {
                        session == null || !session.isActive -> mapOf("canStop" to true, "intensity" to "none")
                        session.intensity == SessionIntensity.LOCKED -> mapOf(
                            "canStop" to false,
                            "intensity" to "locked",
                            "reason" to "Session is locked",
                            "remainingSeconds" to session.remainingSeconds
                        )
                        session.intensity == SessionIntensity.COMMITTED -> mapOf(
                            "canStop" to true,
                            "intensity" to "committed",
                            "reason" to "Requires 30 second wait",
                            "waitTime" to 30
                        )
                        else -> mapOf("canStop" to true, "intensity" to "flexible")
                    }
                    promise.resolve(result)
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        // ==================== Blocked Apps ====================

        AsyncFunction("getInstalledApps") { includeSystem: Boolean, promise: Promise ->
            scope.launch {
                try {
                    val apps = usage.getInstalledApps(includeSystem)
                    promise.resolve(apps.map { mapOf(
                        "packageName" to it.packageName,
                        "appName" to it.appName,
                        "isSystemApp" to it.isSystemApp
                    )})
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("setBlockedApps") { appsJson: String, promise: Promise ->
            scope.launch {
                try {
                    val apps = Json.fromJsonList<BlockedApp>(appsJson)
                    storage.saveBlockedApps(apps)
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("getBlockedApps") { promise: Promise ->
            scope.launch {
                try {
                    val apps = storage.getBlockedApps()
                    promise.resolve(apps.map { it.toMap() })
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        // ==================== Usage Stats ====================

        AsyncFunction("getTodayUsageStats") { promise: Promise ->
            scope.launch {
                try {
                    if (!permissions.hasUsageStats()) {
                        promise.reject("PERMISSION_REQUIRED", "Usage Stats permission required", null)
                        return@launch
                    }
                    val stats = usage.getTodayStats()
                    promise.resolve(stats.map { mapOf(
                        "packageName" to it.packageName,
                        "appName" to it.appName,
                        "usageTimeMinutes" to it.usageTimeMinutes,
                        "lastUsed" to it.lastUsed,
                        "launchCount" to it.launchCount
                    )})
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("getAppUsage") { packageNames: List<String>, promise: Promise ->
            scope.launch {
                try {
                    val result = usage.getUsageForApps(packageNames)
                    promise.resolve(result)
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        // ==================== Daily Limits ====================

        AsyncFunction("setDailyLimit") { configJson: String, promise: Promise ->
            scope.launch {
                try {
                    val config = Json.fromJson<DailyLimitConfig>(configJson)
                    if (config != null) {
                        storage.saveDailyLimit(config)
                        promise.resolve(true)
                    } else {
                        promise.reject("PARSE_ERROR", "Invalid config", null)
                    }
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("getDailyLimit") { promise: Promise ->
            scope.launch {
                try {
                    val config = storage.getDailyLimit()
                    promise.resolve(config?.let { mapOf(
                        "enabled" to it.enabled,
                        "limitMinutes" to it.limitMinutes,
                        "blockedPackages" to it.blockedPackages,
                        "resetHour" to it.resetHour
                    )})
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("isDailyLimitReached") { promise: Promise ->
            scope.launch {
                try {
                    val config = storage.getDailyLimit()
                    val total = storage.getTotalTodayUsage()
                    val limit = config?.limitMinutes ?: 0
                    promise.resolve(mapOf(
                        "isReached" to (config?.enabled == true && total >= limit),
                        "usedMinutes" to total,
                        "limitMinutes" to limit,
                        "remainingMinutes" to maxOf(0L, limit - total)
                    ))
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        // ==================== Schedules ====================

        AsyncFunction("setSchedules") { schedulesJson: String, promise: Promise ->
            scope.launch {
                try {
                    val list = Json.fromJsonList<BlockSchedule>(schedulesJson)
                    storage.saveSchedules(list)
                    schedules.updateAlarms(list)
                    promise.resolve(true)
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("getSchedules") { promise: Promise ->
            scope.launch {
                try {
                    val list = storage.getSchedules()
                    promise.resolve(list.map { mapOf(
                        "id" to it.id,
                        "name" to it.name,
                        "startTimeMinutes" to it.startTimeMinutes,
                        "endTimeMinutes" to it.endTimeMinutes,
                        "daysOfWeek" to it.daysOfWeek,
                        "intensity" to it.intensity.value,
                        "blockedPackages" to it.blockedPackages,
                        "isActive" to it.isActive,
                        "timeString" to it.getTimeString()
                    )})
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("getActiveSchedule") { promise: Promise ->
            scope.launch {
                try {
                    val schedule = schedules.getCurrentlyActive()
                    promise.resolve(schedule?.let { mapOf(
                        "id" to it.id,
                        "name" to it.name,
                        "intensity" to it.intensity.value,
                        "blockedPackages" to it.blockedPackages
                    )})
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        // ==================== Stats ====================

        AsyncFunction("getStats") { promise: Promise ->
            scope.launch {
                try {
                    val stats = storage.getStats()
                    promise.resolve(mapOf(
                        "totalSessions" to stats.totalSessions,
                        "totalFocusMinutes" to stats.totalFocusMinutes,
                        "longestSessionMinutes" to stats.longestSessionMinutes,
                        "currentStreak" to stats.currentStreak,
                        "lastSessionDate" to stats.lastSessionDate,
                        "todayFocusMinutes" to stats.todayFocusMinutes
                    ))
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        AsyncFunction("getSessionHistory") { limit: Int, promise: Promise ->
            scope.launch {
                try {
                    val history = storage.getHistory().take(limit)
                    promise.resolve(history.map { it.toMap() })
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }

        // ==================== Lifecycle ====================

        OnDestroy { scope.cancel() }
    }

    // ==================== Helpers ====================

    private fun startService() {
        try {
            context.startForegroundService(
                Intent(context, BlockerForegroundService::class.java).apply {
                    action = BlockerForegroundService.ACTION_START
                }
            )
        } catch (e: Exception) { e.printStackTrace() }
    }

    private fun stopService() {
        try {
            context.startService(
                Intent(context, BlockerForegroundService::class.java).apply {
                    action = BlockerForegroundService.ACTION_STOP
                }
            )
        } catch (e: Exception) { e.printStackTrace() }
    }

    private fun FocusSession.toMap(): Map<String, Any?> = mapOf(
        "id" to id,
        "startTime" to startTime,
        "durationMinutes" to durationMinutes,
        "intensity" to intensity.value,
        "blockedPackages" to blockedPackages,
        "isPaused" to isPaused,
        "pausedAt" to pausedAt,
        "totalPausedTime" to totalPausedTime,
        "completed" to completed,
        "endTime" to endTime,
        "remainingMillis" to remainingMillis,
        "remainingSeconds" to remainingSeconds,
        "progress" to progress,
        "isActive" to isActive
    )

    private fun BlockedApp.toMap(): Map<String, Any?> = mapOf(
        "id" to id,
        "packageName" to packageName,
        "name" to name,
        "icon" to icon,
        "color" to color,
        "dailyLimitMinutes" to dailyLimitMinutes
    )
}
```

---

## 1.10 TypeScript - `modules/app-blocker/src/index.ts`

```typescript
import { NativeModulesProxy, EventEmitter } from 'expo-modules-core';

const AppBlockerModule = NativeModulesProxy.AppBlocker;
const emitter = new EventEmitter(AppBlockerModule);

// ==================== Types ====================

export type SessionIntensity = 'flexible' | 'committed' | 'locked';

export interface PermissionStatus {
  usageStats: boolean;
  overlay: boolean;
  accessibility: boolean;
  notifications: boolean;
  allRequired: boolean;
}

export interface FocusSession {
  id: string;
  startTime: number;
  durationMinutes: number;
  intensity: SessionIntensity;
  blockedPackages: string[];
  isPaused: boolean;
  pausedAt: number | null;
  totalPausedTime: number;
  completed: boolean;
  endTime: number | null;
  remainingMillis: number;
  remainingSeconds: number;
  progress: number;
  isActive: boolean;
}

export interface SessionState {
  isActive: boolean;
  isPaused?: boolean;
  remainingMillis?: number;
  remainingSeconds?: number;
  progress?: number;
  intensity?: SessionIntensity;
  durationMinutes?: number;
  blockedPackages?: string[];
}

export interface CanStopResult {
  canStop: boolean;
  intensity: string;
  reason?: string;
  waitTime?: number;
  remainingSeconds?: number;
}

export interface BlockedApp {
  id: string;
  packageName: string;
  name: string;
  icon?: string;
  color?: string;
  dailyLimitMinutes?: number;
}

export interface InstalledApp {
  packageName: string;
  appName: string;
  isSystemApp: boolean;
}

export interface AppUsageStats {
  packageName: string;
  appName: string;
  usageTimeMinutes: number;
  lastUsed: number;
  launchCount: number;
}

export interface DailyLimitConfig {
  enabled: boolean;
  limitMinutes: number;
  blockedPackages: string[];
  resetHour: number;
}

export interface DailyLimitStatus {
  isReached: boolean;
  usedMinutes: number;
  limitMinutes: number;
  remainingMinutes: number;
}

export interface BlockSchedule {
  id: string;
  name: string;
  startTimeMinutes: number;
  endTimeMinutes: number;
  daysOfWeek: number[];
  intensity: SessionIntensity;
  blockedPackages: string[];
  isActive: boolean;
  timeString?: string;
}

export interface UserStats {
  totalSessions: number;
  totalFocusMinutes: number;
  longestSessionMinutes: number;
  currentStreak: number;
  lastSessionDate: string | null;
  todayFocusMinutes: number;
}

// ==================== API ====================

export const getPermissionStatus = (): Promise<PermissionStatus> =>
  AppBlockerModule.getPermissionStatus();

export const openPermissionSettings = (type: string): Promise<boolean> =>
  AppBlockerModule.openPermissionSettings(type);

export const hasAllPermissions = (): Promise<boolean> =>
  AppBlockerModule.hasAllPermissions();

export const startSession = (
  durationMinutes: number,
  intensity: SessionIntensity,
  blockedPackages: string[]
): Promise<FocusSession> =>
  AppBlockerModule.startSession(durationMinutes, intensity, blockedPackages);

export const stopSession = (completed = false): Promise<FocusSession | null> =>
  AppBlockerModule.stopSession(completed);

export const pauseSession = (): Promise<FocusSession> =>
  AppBlockerModule.pauseSession();

export const resumeSession = (): Promise<FocusSession> =>
  AppBlockerModule.resumeSession();

export const getActiveSession = (): Promise<FocusSession | null> =>
  AppBlockerModule.getActiveSession();

export const getSessionState = (): Promise<SessionState> =>
  AppBlockerModule.getSessionState();

export const canStopSession = (): Promise<CanStopResult> =>
  AppBlockerModule.canStopSession();

export const getInstalledApps = (includeSystem = false): Promise<InstalledApp[]> =>
  AppBlockerModule.getInstalledApps(includeSystem);

export const setBlockedApps = (apps: BlockedApp[]): Promise<boolean> =>
  AppBlockerModule.setBlockedApps(JSON.stringify(apps));

export const getBlockedApps = (): Promise<BlockedApp[]> =>
  AppBlockerModule.getBlockedApps();

export const getTodayUsageStats = (): Promise<AppUsageStats[]> =>
  AppBlockerModule.getTodayUsageStats();

export const getAppUsage = (packageNames: string[]): Promise<Record<string, number>> =>
  AppBlockerModule.getAppUsage(packageNames);

export const setDailyLimit = (config: DailyLimitConfig): Promise<boolean> =>
  AppBlockerModule.setDailyLimit(JSON.stringify(config));

export const getDailyLimit = (): Promise<DailyLimitConfig | null> =>
  AppBlockerModule.getDailyLimit();

export const isDailyLimitReached = (): Promise<DailyLimitStatus> =>
  AppBlockerModule.isDailyLimitReached();

export const setSchedules = (schedules: BlockSchedule[]): Promise<boolean> =>
  AppBlockerModule.setSchedules(JSON.stringify(schedules));

export const getSchedules = (): Promise<BlockSchedule[]> =>
  AppBlockerModule.getSchedules();

export const getActiveSchedule = (): Promise<BlockSchedule | null> =>
  AppBlockerModule.getActiveSchedule();

export const getStats = (): Promise<UserStats> =>
  AppBlockerModule.getStats();

export const getSessionHistory = (limit = 50): Promise<FocusSession[]> =>
  AppBlockerModule.getSessionHistory(limit);

// ==================== Events ====================

export const addSessionStartedListener = (cb: (e: { session: FocusSession }) => void) =>
  emitter.addListener('onSessionStarted', cb);

export const addSessionEndedListener = (cb: (e: { session: FocusSession; completedSuccessfully: boolean }) => void) =>
  emitter.addListener('onSessionEnded', cb);

export const addSessionPausedListener = (cb: (e: FocusSession) => void) =>
  emitter.addListener('onSessionPaused', cb);

export const addSessionResumedListener = (cb: (e: FocusSession) => void) =>
  emitter.addListener('onSessionResumed', cb);

export const addSessionTickListener = (cb: (e: { remainingSeconds: number; progress: number }) => void) =>
  emitter.addListener('onSessionTick', cb);

export const addAppBlockedListener = (cb: (e: { packageName: string; appName: string }) => void) =>
  emitter.addListener('onAppBlocked', cb);

// ==================== Default Export ====================

const AppBlocker = {
  getPermissionStatus,
  openPermissionSettings,
  hasAllPermissions,
  startSession,
  stopSession,
  pauseSession,
  resumeSession,
  getActiveSession,
  getSessionState,
  canStopSession,
  getInstalledApps,
  setBlockedApps,
  getBlockedApps,
  getTodayUsageStats,
  getAppUsage,
  setDailyLimit,
  getDailyLimit,
  isDailyLimitReached,
  setSchedules,
  getSchedules,
  getActiveSchedule,
  getStats,
  getSessionHistory,
  addSessionStartedListener,
  addSessionEndedListener,
  addSessionPausedListener,
  addSessionResumedListener,
  addSessionTickListener,
  addAppBlockedListener,
};

export default AppBlocker;
```

---

## 1.11 Module Entry - `modules/app-blocker/index.ts`

```typescript
export * from './src/index';
export { default } from './src/index';
```

---

# ✅ End of Part 1 (Modern Approach)

**What's included:**
- ✅ Minimal XML (only accessibility_config.xml - required by Android)
- ✅ Clean data models
- ✅ Storage layer with SharedPreferences
- ✅ Permission manager
- ✅ Main Expo module with all APIs
- ✅ TypeScript types and exports

---

## Coming in Part 2:
1. `SessionManager.kt` - Session lifecycle
2. `UsageTracker.kt` - Usage statistics
3. `ScheduleManager.kt` - Schedule management
4. `BlockerAccessibilityService.kt` - App detection
5. `BlockerForegroundService.kt` - Persistent service
6. `BlockingOverlayActivity.kt` - Blocking screen (programmatic UI)
7. `BootReceiver.kt` & `ScheduleAlarmReceiver.kt`

**Ready for Part 2?**