# Part 2 - Services, Usage Tracking & Blocking Logic

Building on Part 1, here are all the remaining components with proper integration.

---

## 2.1 Session Manager - `android/src/main/java/expo/modules/appblocker/services/SessionManager.kt`

```kotlin
package expo.modules.appblocker.services

import android.content.Context
import expo.modules.appblocker.models.FocusSession
import expo.modules.appblocker.models.SessionIntensity
import expo.modules.appblocker.storage.BlockerStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SessionManager private constructor(private val context: Context) {

    private val storage: BlockerStorage get() = BlockerStorage.getInstance(context)

    companion object {
        @Volatile
        private var instance: SessionManager? = null

        fun getInstance(context: Context): SessionManager =
            instance ?: synchronized(this) {
                instance ?: SessionManager(context.applicationContext).also { instance = it }
            }
    }

    suspend fun startSession(
        durationMinutes: Int,
        intensity: SessionIntensity,
        blockedPackages: List<String>
    ): FocusSession = withContext(Dispatchers.IO) {
        // Create new session
        val session = FocusSession.create(
            durationMinutes = durationMinutes,
            intensity = intensity,
            blockedPackages = blockedPackages
        )

        // Save to storage
        storage.saveSession(session)

        session
    }

    suspend fun stopSession(completed: Boolean): FocusSession? = withContext(Dispatchers.IO) {
        val current = storage.getSession() ?: return@withContext null

        // Complete the session
        val completedSession = current.complete()

        // Clear active session
        storage.clearSession()

        // If completed successfully, update stats and history
        if (completed && current.isActive) {
            storage.updateStats(completedSession)
            storage.addToHistory(completedSession)
        }

        completedSession
    }

    suspend fun pauseSession(): FocusSession? = withContext(Dispatchers.IO) {
        val current = storage.getSession() ?: return@withContext null

        // Can only pause flexible mode
        if (current.intensity != SessionIntensity.FLEXIBLE) {
            return@withContext null
        }

        if (current.isPaused || !current.isActive) {
            return@withContext null
        }

        val paused = current.pause()
        storage.saveSession(paused)

        paused
    }

    suspend fun resumeSession(): FocusSession? = withContext(Dispatchers.IO) {
        val current = storage.getSession() ?: return@withContext null

        if (!current.isPaused) {
            return@withContext null
        }

        val resumed = current.resume()
        storage.saveSession(resumed)

        resumed
    }

    suspend fun getActiveSession(): FocusSession? = withContext(Dispatchers.IO) {
        val session = storage.getSession()

        // Check if session has expired
        if (session != null && !session.isActive && !session.completed) {
            // Session expired naturally - complete it
            val completed = session.complete()
            storage.clearSession()
            storage.updateStats(completed)
            storage.addToHistory(completed)
            return@withContext null
        }

        session?.takeIf { it.isActive }
    }

    fun getActiveSessionSync(): FocusSession? {
        val session = storage.getSessionSync()

        if (session != null && !session.isActive && !session.completed) {
            val completed = session.complete()
            storage.clearSessionSync()
            // Note: stats update will happen async
            return null
        }

        return session?.takeIf { it.isActive }
    }

    fun isAppBlocked(packageName: String): Boolean {
        val session = getActiveSessionSync() ?: return false
        return session.isAppBlocked(packageName)
    }

    fun getBlockedPackages(): List<String> {
        return getActiveSessionSync()?.blockedPackages ?: emptyList()
    }

    fun getCurrentIntensity(): SessionIntensity? {
        return getActiveSessionSync()?.intensity
    }

    fun getRemainingSeconds(): Long {
        return getActiveSessionSync()?.remainingSeconds ?: 0
    }

    fun isSessionActive(): Boolean {
        return getActiveSessionSync() != null
    }
}
```

---

## 2.2 Usage Tracker - `android/src/main/java/expo/modules/appblocker/usage/UsageTracker.kt`

```kotlin
package expo.modules.appblocker.usage

import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.appblocker.models.AppUsageStats
import expo.modules.appblocker.models.InstalledAppInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Calendar

class UsageTracker private constructor(private val context: Context) {

    private val usageStatsManager: UsageStatsManager by lazy {
        context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    }

    private val packageManager: PackageManager by lazy {
        context.packageManager
    }

    companion object {
        @Volatile
        private var instance: UsageTracker? = null

        fun getInstance(context: Context): UsageTracker =
            instance ?: synchronized(this) {
                instance ?: UsageTracker(context.applicationContext).also { instance = it }
            }

        // Common apps to exclude (launchers, system UI, etc.)
        private val EXCLUDED_PACKAGES = setOf(
            "com.android.launcher",
            "com.android.launcher3",
            "com.google.android.apps.nexuslauncher",
            "com.android.systemui",
            "com.android.settings",
            "com.android.vending", // Play Store
            "com.google.android.packageinstaller",
            "com.android.packageinstaller"
        )
    }

    suspend fun getInstalledApps(includeSystem: Boolean = false): List<InstalledAppInfo> =
        withContext(Dispatchers.IO) {
            try {
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong())
                } else {
                    @Suppress("DEPRECATION")
                    PackageManager.GET_META_DATA
                }

                val apps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    packageManager.getInstalledApplications(
                        PackageManager.ApplicationInfoFlags.of(0)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getInstalledApplications(0)
                }

                apps.asSequence()
                    .filter { app ->
                        // Must have a launcher activity
                        packageManager.getLaunchIntentForPackage(app.packageName) != null
                    }
                    .filter { app ->
                        // Exclude our own app
                        app.packageName != context.packageName
                    }
                    .filter { app ->
                        // Exclude common system packages
                        !EXCLUDED_PACKAGES.any { app.packageName.startsWith(it) }
                    }
                    .filter { app ->
                        // Filter system apps if requested
                        if (includeSystem) true
                        else (app.flags and ApplicationInfo.FLAG_SYSTEM) == 0
                    }
                    .map { app ->
                        InstalledAppInfo(
                            packageName = app.packageName,
                            appName = packageManager.getApplicationLabel(app).toString(),
                            isSystemApp = (app.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                        )
                    }
                    .sortedBy { it.appName.lowercase() }
                    .toList()
            } catch (e: Exception) {
                e.printStackTrace()
                emptyList()
            }
        }

    suspend fun getTodayStats(): List<AppUsageStats> = withContext(Dispatchers.IO) {
        try {
            val calendar = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }

            val startTime = calendar.timeInMillis
            val endTime = System.currentTimeMillis()

            val usageStats = usageStatsManager.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY,
                startTime,
                endTime
            )

            usageStats
                ?.asSequence()
                ?.filter { it.totalTimeInForeground > 0 }
                ?.filter { stats ->
                    // Only include apps with launcher activity
                    packageManager.getLaunchIntentForPackage(stats.packageName) != null
                }
                ?.filter { stats ->
                    // Exclude system packages
                    !EXCLUDED_PACKAGES.any { stats.packageName.startsWith(it) }
                }
                ?.map { stats ->
                    AppUsageStats(
                        packageName = stats.packageName,
                        appName = getAppName(stats.packageName),
                        usageTimeMinutes = stats.totalTimeInForeground / 1000 / 60,
                        lastUsed = stats.lastTimeUsed,
                        launchCount = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            stats.appLaunchCount
                        } else {
                            0
                        }
                    )
                }
                ?.sortedByDescending { it.usageTimeMinutes }
                ?.toList()
                ?: emptyList()
        } catch (e: Exception) {
            e.printStackTrace()
            emptyList()
        }
    }

    suspend fun getUsageForApps(packageNames: List<String>): Map<String, Long> =
        withContext(Dispatchers.IO) {
            try {
                val calendar = Calendar.getInstance().apply {
                    set(Calendar.HOUR_OF_DAY, 0)
                    set(Calendar.MINUTE, 0)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                }

                val startTime = calendar.timeInMillis
                val endTime = System.currentTimeMillis()

                val usageStats = usageStatsManager.queryUsageStats(
                    UsageStatsManager.INTERVAL_DAILY,
                    startTime,
                    endTime
                )

                val result = mutableMapOf<String, Long>()

                packageNames.forEach { pkg ->
                    result[pkg] = 0L
                }

                usageStats?.forEach { stats ->
                    if (packageNames.contains(stats.packageName)) {
                        result[stats.packageName] = stats.totalTimeInForeground / 1000 / 60
                    }
                }

                result
            } catch (e: Exception) {
                e.printStackTrace()
                packageNames.associateWith { 0L }
            }
        }

    fun getCurrentForegroundApp(): String? {
        return try {
            val endTime = System.currentTimeMillis()
            val startTime = endTime - 10000 // Last 10 seconds

            val usageStats = usageStatsManager.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY,
                startTime,
                endTime
            )

            usageStats
                ?.filter { it.lastTimeUsed > startTime }
                ?.maxByOrNull { it.lastTimeUsed }
                ?.packageName
        } catch (e: Exception) {
            null
        }
    }

    private fun getAppName(packageName: String): String {
        return try {
            val appInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getApplicationInfo(
                    packageName,
                    PackageManager.ApplicationInfoFlags.of(0)
                )
            } else {
                @Suppress("DEPRECATION")
                packageManager.getApplicationInfo(packageName, 0)
            }
            packageManager.getApplicationLabel(appInfo).toString()
        } catch (e: Exception) {
            packageName
        }
    }
}
```

---

## 2.3 Schedule Manager - `android/src/main/java/expo/modules/appblocker/scheduling/ScheduleManager.kt`

```kotlin
package expo.modules.appblocker.scheduling

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.appblocker.models.BlockSchedule
import expo.modules.appblocker.receivers.ScheduleAlarmReceiver
import expo.modules.appblocker.storage.BlockerStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Calendar

class ScheduleManager private constructor(private val context: Context) {

    private val alarmManager: AlarmManager by lazy {
        context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    }

    private val storage: BlockerStorage get() = BlockerStorage.getInstance(context)

    companion object {
        @Volatile
        private var instance: ScheduleManager? = null

        fun getInstance(context: Context): ScheduleManager =
            instance ?: synchronized(this) {
                instance ?: ScheduleManager(context.applicationContext).also { instance = it }
            }

        private const val REQUEST_CODE_BASE = 10000
    }

    suspend fun updateAlarms(schedules: List<BlockSchedule>) = withContext(Dispatchers.IO) {
        // Cancel all existing alarms
        cancelAllAlarms()

        // Set new alarms for active schedules
        schedules.filter { it.isActive }.forEach { schedule ->
            setAlarmForSchedule(schedule)
        }
    }

    private fun setAlarmForSchedule(schedule: BlockSchedule) {
        // Set alarm for start time
        val startIntent = Intent(context, ScheduleAlarmReceiver::class.java).apply {
            action = ScheduleAlarmReceiver.ACTION_START
            putExtra(ScheduleAlarmReceiver.EXTRA_SCHEDULE_ID, schedule.id)
        }

        val startPendingIntent = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE_BASE + schedule.id.hashCode(),
            startIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Calculate next trigger time
        val nextTrigger = getNextTriggerTime(schedule.startTimeMinutes, schedule.daysOfWeek)

        if (nextTrigger > 0) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (alarmManager.canScheduleExactAlarms()) {
                        alarmManager.setExactAndAllowWhileIdle(
                            AlarmManager.RTC_WAKEUP,
                            nextTrigger,
                            startPendingIntent
                        )
                    } else {
                        // Fallback to inexact alarm
                        alarmManager.setAndAllowWhileIdle(
                            AlarmManager.RTC_WAKEUP,
                            nextTrigger,
                            startPendingIntent
                        )
                    }
                } else {
                    alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        nextTrigger,
                        startPendingIntent
                    )
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun getNextTriggerTime(timeMinutes: Int, daysOfWeek: List<Int>): Long {
        val now = Calendar.getInstance()
        val currentDay = now.get(Calendar.DAY_OF_WEEK)
        val currentMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)

        // Find the next valid day
        for (daysAhead in 0..7) {
            val checkDay = ((currentDay - 1 + daysAhead) % 7) + 1

            if (daysOfWeek.contains(checkDay)) {
                // If it's today, check if time hasn't passed
                if (daysAhead == 0 && currentMinutes >= timeMinutes) {
                    continue
                }

                val calendar = Calendar.getInstance().apply {
                    add(Calendar.DAY_OF_YEAR, daysAhead)
                    set(Calendar.HOUR_OF_DAY, timeMinutes / 60)
                    set(Calendar.MINUTE, timeMinutes % 60)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                }

                return calendar.timeInMillis
            }
        }

        return -1
    }

    private fun cancelAllAlarms() {
        val schedules = storage.getSchedulesSync()

        schedules.forEach { schedule ->
            val intent = Intent(context, ScheduleAlarmReceiver::class.java)
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                REQUEST_CODE_BASE + schedule.id.hashCode(),
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )

            pendingIntent?.let {
                alarmManager.cancel(it)
                it.cancel()
            }
        }
    }

    fun getCurrentlyActive(): BlockSchedule? {
        return storage.getSchedulesSync().find { it.isCurrentlyActive() }
    }

    suspend fun getCurrentlyActiveAsync(): BlockSchedule? = withContext(Dispatchers.IO) {
        storage.getSchedules().find { it.isCurrentlyActive() }
    }

    fun isScheduleActive(): Boolean {
        return getCurrentlyActive() != null
    }

    fun getActiveBlockedPackages(): List<String> {
        return getCurrentlyActive()?.blockedPackages ?: emptyList()
    }
}
```

---

## 2.4 Accessibility Service - `android/src/main/java/expo/modules/appblocker/services/BlockerAccessibilityService.kt`

```kotlin
package expo.modules.appblocker.services

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import expo.modules.appblocker.scheduling.ScheduleManager
import expo.modules.appblocker.storage.BlockerStorage
import expo.modules.appblocker.ui.BlockingOverlayActivity

class BlockerAccessibilityService : AccessibilityService() {

    private val storage: BlockerStorage by lazy { BlockerStorage.getInstance(this) }
    private val sessionManager: SessionManager by lazy { SessionManager.getInstance(this) }
    private val scheduleManager: ScheduleManager by lazy { ScheduleManager.getInstance(this) }

    private var lastBlockedPackage: String? = null
    private var lastBlockTime: Long = 0

    companion object {
        private const val BLOCK_COOLDOWN_MS = 1000L // Prevent rapid re-blocking

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        isRunning = true
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val packageName = event.packageName?.toString() ?: return

        // Skip our own app and system UI
        if (packageName == this.packageName) return
        if (packageName == "com.android.systemui") return
        if (packageName.startsWith("com.android.launcher")) return

        // Check if this package should be blocked
        if (shouldBlockPackage(packageName)) {
            blockApp(packageName)
        }
    }

    private fun shouldBlockPackage(packageName: String): Boolean {
        // Check active focus session first
        if (sessionManager.isAppBlocked(packageName)) {
            return true
        }

        // Check active schedule
        val activeSchedule = scheduleManager.getCurrentlyActive()
        if (activeSchedule != null && activeSchedule.blockedPackages.contains(packageName)) {
            return true
        }

        // Check daily limit
        val limitConfig = storage.getDailyLimitSync()
        if (limitConfig != null && limitConfig.enabled) {
            if (limitConfig.blockedPackages.contains(packageName)) {
                val totalUsage = storage.getTotalTodayUsageSync()
                if (totalUsage >= limitConfig.limitMinutes) {
                    return true
                }
            }
        }

        return false
    }

    private fun blockApp(packageName: String) {
        val now = System.currentTimeMillis()

        // Cooldown to prevent rapid re-blocking
        if (packageName == lastBlockedPackage && (now - lastBlockTime) < BLOCK_COOLDOWN_MS) {
            return
        }

        lastBlockedPackage = packageName
        lastBlockTime = now

        // Get remaining time and intensity
        val session = sessionManager.getActiveSessionSync()
        val schedule = scheduleManager.getCurrentlyActive()

        val remainingSeconds = session?.remainingSeconds ?: 0L
        val intensity = session?.intensity?.value ?: schedule?.intensity?.value ?: "flexible"

        // Launch blocking overlay
        val intent = Intent(this, BlockingOverlayActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra(BlockingOverlayActivity.EXTRA_PACKAGE_NAME, packageName)
            putExtra(BlockingOverlayActivity.EXTRA_REMAINING_SECONDS, remainingSeconds)
            putExtra(BlockingOverlayActivity.EXTRA_INTENSITY, intensity)
        }

        startActivity(intent)
    }

    override fun onInterrupt() {
        // Service interrupted
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
    }
}
```

---

## 2.5 Foreground Service - `android/src/main/java/expo/modules/appblocker/services/BlockerForegroundService.kt`

```kotlin
package expo.modules.appblocker.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import expo.modules.appblocker.storage.BlockerStorage
import kotlinx.coroutines.*

class BlockerForegroundService : Service() {

    private val serviceScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val handler = Handler(Looper.getMainLooper())
    private var tickRunnable: Runnable? = null

    private val storage: BlockerStorage by lazy { BlockerStorage.getInstance(this) }
    private val sessionManager: SessionManager by lazy { SessionManager.getInstance(this) }

    companion object {
        const val ACTION_START = "expo.modules.appblocker.START"
        const val ACTION_STOP = "expo.modules.appblocker.STOP"

        private const val NOTIFICATION_ID = 9001
        private const val CHANNEL_ID = "focus_session_channel"
        private const val CHANNEL_NAME = "Focus Session"

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startFocusSession()
            ACTION_STOP -> stopFocusSession()
        }

        return START_STICKY
    }

    private fun startFocusSession() {
        isRunning = true

        // Start foreground with notification
        val notification = createNotification(
            title = "Focus Mode Active",
            content = "Blocking distracting apps..."
        )

        startForeground(NOTIFICATION_ID, notification)

        // Start timer updates
        startTickUpdates()
    }

    private fun stopFocusSession() {
        isRunning = false

        // Stop timer
        stopTickUpdates()

        // Stop foreground service
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startTickUpdates() {
        tickRunnable = object : Runnable {
            override fun run() {
                updateNotification()

                // Check if session ended
                val session = sessionManager.getActiveSessionSync()
                if (session == null || !session.isActive) {
                    // Session ended
                    serviceScope.launch {
                        if (session != null && !session.completed) {
                            // Natural expiry - complete the session
                            sessionManager.stopSession(true)
                        }
                    }
                    stopFocusSession()
                    return
                }

                // Schedule next tick
                handler.postDelayed(this, 1000)
            }
        }

        handler.post(tickRunnable!!)
    }

    private fun stopTickUpdates() {
        tickRunnable?.let { handler.removeCallbacks(it) }
        tickRunnable = null
    }

    private fun updateNotification() {
        val session = storage.getSessionSync() ?: return

        val remainingSeconds = session.remainingSeconds
        val minutes = remainingSeconds / 60
        val seconds = remainingSeconds % 60

        val timeText = if (minutes > 0) {
            String.format("%d:%02d remaining", minutes, seconds)
        } else {
            String.format("%d seconds remaining", seconds)
        }

        val statusText = when {
            session.isPaused -> "Paused"
            else -> "Focus Mode Active"
        }

        val notification = createNotification(
            title = statusText,
            content = timeText,
            progress = (session.progress * 100).toInt()
        )

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    private fun createNotification(
        title: String,
        content: String,
        progress: Int? = null
    ): Notification {
        // Create intent to open main app
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

        pendingIntent?.let { builder.setContentIntent(it) }

        progress?.let {
            builder.setProgress(100, it, false)
        }

        return builder.build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows active focus session status"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }

            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        stopTickUpdates()
        serviceScope.cancel()
    }
}
```

---

## 2.6 Blocking Overlay Activity - `android/src/main/java/expo/modules/appblocker/ui/BlockingOverlayActivity.kt`

**(Programmatic UI - No XML needed)**

```kotlin
package expo.modules.appblocker.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.appblocker.services.SessionManager

class BlockingOverlayActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())
    private var updateRunnable: Runnable? = null

    private lateinit var timeText: TextView
    private lateinit var intensityBadge: TextView

    private var packageName: String = ""
    private var intensity: String = "flexible"

    companion object {
        const val EXTRA_PACKAGE_NAME = "package_name"
        const val EXTRA_REMAINING_SECONDS = "remaining_seconds"
        const val EXTRA_INTENSITY = "intensity"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Make fullscreen and overlay
        setupWindow()

        // Get intent extras
        packageName = intent.getStringExtra(EXTRA_PACKAGE_NAME) ?: ""
        intensity = intent.getStringExtra(EXTRA_INTENSITY) ?: "flexible"

        // Build UI programmatically
        setContentView(createUI())

        // Start time updates
        startTimeUpdates()
    }

    private fun setupWindow() {
        window.apply {
            // Fullscreen flags
            addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
            addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)

            // Make status bar transparent
            statusBarColor = Color.TRANSPARENT
            navigationBarColor = Color.parseColor("#0A0A0A")

            // Fullscreen
            decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
        }
    }

    private fun createUI(): View {
        val sessionManager = SessionManager.getInstance(this)

        // Root layout
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#F0000000"))
            setPadding(dp(32), dp(64), dp(32), dp(48))
        }

        // Shield icon (using text emoji as fallback - you could use a drawable)
        val iconText = TextView(this).apply {
            text = "🛡️"
            textSize = 64f
            gravity = Gravity.CENTER
        }
        root.addView(iconText, linearParams(marginBottom = dp(24)))

        // Title
        val title = TextView(this).apply {
            text = "App Blocked"
            setTextColor(Color.WHITE)
            textSize = 28f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        root.addView(title, linearParams(marginBottom = dp(8)))

        // App name
        val appNameText = TextView(this).apply {
            text = getAppNameFromPackage(packageName)
            setTextColor(Color.parseColor("#A1A1AA"))
            textSize = 16f
            gravity = Gravity.CENTER
        }
        root.addView(appNameText, linearParams(marginBottom = dp(16)))

        // Message
        val message = TextView(this).apply {
            text = "This app is blocked during your focus session"
            setTextColor(Color.parseColor("#71717A"))
            textSize = 14f
            gravity = Gravity.CENTER
        }
        root.addView(message, linearParams(marginBottom = dp(32)))

        // Time remaining
        timeText = TextView(this).apply {
            text = formatTime(sessionManager.getRemainingSeconds())
            setTextColor(Color.parseColor("#3B82F6"))
            textSize = 32f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        root.addView(timeText, linearParams(marginBottom = dp(16)))

        // Intensity badge
        intensityBadge = TextView(this).apply {
            text = intensity.uppercase()
            setTextColor(getIntensityColor())
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dp(16), dp(8), dp(16), dp(8))
            background = createBadgeBackground()
        }
        root.addView(intensityBadge, linearParams(marginBottom = dp(48)))

        // Go back button
        val goBackButton = Button(this).apply {
            text = "Go Back"
            setTextColor(Color.WHITE)
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            background = createButtonBackground(Color.parseColor("#3B82F6"))
            setPadding(dp(24), dp(16), dp(24), dp(16))
            isAllCaps = false
            stateListAnimator = null

            setOnClickListener {
                goBack()
            }
        }
        root.addView(goBackButton, linearParams(
            width = LinearLayout.LayoutParams.MATCH_PARENT,
            height = dp(56),
            marginBottom = dp(24)
        ))

        // Motivational text
        val motivationText = TextView(this).apply {
            text = getMotivationalMessage()
            setTextColor(Color.parseColor("#52525B"))
            textSize = 13f
            gravity = Gravity.CENTER
        }
        root.addView(motivationText)

        return root
    }

    private fun startTimeUpdates() {
        updateRunnable = object : Runnable {
            override fun run() {
                val sessionManager = SessionManager.getInstance(this@BlockingOverlayActivity)
                val remaining = sessionManager.getRemainingSeconds()

                if (remaining <= 0 || !sessionManager.isSessionActive()) {
                    // Session ended - close overlay
                    finish()
                    return
                }

                timeText.text = formatTime(remaining)
                handler.postDelayed(this, 1000)
            }
        }

        handler.post(updateRunnable!!)
    }

    private fun goBack() {
        // Go to home screen
        val homeIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(homeIntent)
        finish()
    }

    private fun formatTime(seconds: Long): String {
        val mins = seconds / 60
        val secs = seconds % 60
        return if (mins > 0) {
            String.format("%d:%02d remaining", mins, secs)
        } else {
            String.format("%d seconds remaining", secs)
        }
    }

    private fun getAppNameFromPackage(packageName: String): String {
        return try {
            val appInfo = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(appInfo).toString()
        } catch (e: Exception) {
            packageName.split(".").lastOrNull() ?: packageName
        }
    }

    private fun getIntensityColor(): Int {
        return when (intensity) {
            "locked" -> Color.parseColor("#EF4444")
            "committed" -> Color.parseColor("#F59E0B")
            else -> Color.parseColor("#22C55E")
        }
    }

    private fun getMotivationalMessage(): String {
        val messages = listOf(
            "You chose to focus. Your future self will thank you. 💪",
            "Every minute of focus makes you stronger.",
            "Distractions can wait. Your goals can't.",
            "Stay strong! You're building better habits.",
            "Focus is a superpower. You have it."
        )
        return messages.random()
    }

    private fun createBadgeBackground(): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(20).toFloat()
            setColor(Color.parseColor("#27272A"))
            setStroke(dp(1), Color.parseColor("#3F3F46"))
        }
    }

    private fun createButtonBackground(color: Int): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(16).toFloat()
            setColor(color)
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun linearParams(
        width: Int = LinearLayout.LayoutParams.WRAP_CONTENT,
        height: Int = LinearLayout.LayoutParams.WRAP_CONTENT,
        marginTop: Int = 0,
        marginBottom: Int = 0
    ): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(width, height).apply {
            topMargin = marginTop
            bottomMargin = marginBottom
        }
    }

    override fun onBackPressed() {
        // Prevent back button - go to home instead
        goBack()
    }

    override fun onDestroy() {
        super.onDestroy()
        updateRunnable?.let { handler.removeCallbacks(it) }
    }
}
```

---

## 2.7 Boot Receiver - `android/src/main/java/expo/modules/appblocker/receivers/BootReceiver.kt`

```kotlin
package expo.modules.appblocker.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import expo.modules.appblocker.scheduling.ScheduleManager
import expo.modules.appblocker.services.BlockerForegroundService
import expo.modules.appblocker.storage.BlockerStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val pendingResult = goAsync()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val storage = BlockerStorage.getInstance(context)
                val scheduleManager = ScheduleManager.getInstance(context)

                // Check if there's an active session that should resume
                val session = storage.getSession()
                if (session != null && session.isActive) {
                    // Resume the service
                    val serviceIntent = Intent(context, BlockerForegroundService::class.java).apply {
                        action = BlockerForegroundService.ACTION_START
                    }
                    context.startForegroundService(serviceIntent)
                }

                // Re-register schedule alarms
                val schedules = storage.getSchedules()
                if (schedules.isNotEmpty()) {
                    scheduleManager.updateAlarms(schedules)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                pendingResult.finish()
            }
        }
    }
}
```

---

## 2.8 Schedule Alarm Receiver - `android/src/main/java/expo/modules/appblocker/receivers/ScheduleAlarmReceiver.kt`

```kotlin
package expo.modules.appblocker.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import expo.modules.appblocker.models.SessionIntensity
import expo.modules.appblocker.scheduling.ScheduleManager
import expo.modules.appblocker.services.BlockerForegroundService
import expo.modules.appblocker.services.SessionManager
import expo.modules.appblocker.storage.BlockerStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class ScheduleAlarmReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_START = "expo.modules.appblocker.SCHEDULE_START"
        const val ACTION_END = "expo.modules.appblocker.SCHEDULE_END"
        const val EXTRA_SCHEDULE_ID = "schedule_id"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val scheduleId = intent.getStringExtra(EXTRA_SCHEDULE_ID) ?: return

        val pendingResult = goAsync()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val storage = BlockerStorage.getInstance(context)
                val scheduleManager = ScheduleManager.getInstance(context)
                val sessionManager = SessionManager.getInstance(context)

                when (intent.action) {
                    ACTION_START -> {
                        val schedules = storage.getSchedules()
                        val schedule = schedules.find { it.id == scheduleId }

                        if (schedule != null && schedule.isActive) {
                            // Check if no session is currently active
                            if (!storage.hasActiveSession()) {
                                // Calculate duration until end time
                                val now = java.util.Calendar.getInstance()
                                val currentMinutes = now.get(java.util.Calendar.HOUR_OF_DAY) * 60 +
                                        now.get(java.util.Calendar.MINUTE)

                                val durationMinutes = if (schedule.endTimeMinutes > currentMinutes) {
                                    schedule.endTimeMinutes - currentMinutes
                                } else {
                                    // Overnight schedule
                                    (24 * 60 - currentMinutes) + schedule.endTimeMinutes
                                }

                                // Start a session
                                sessionManager.startSession(
                                    durationMinutes = durationMinutes,
                                    intensity = schedule.intensity,
                                    blockedPackages = schedule.blockedPackages
                                )

                                // Start foreground service
                                val serviceIntent = Intent(context, BlockerForegroundService::class.java).apply {
                                    action = BlockerForegroundService.ACTION_START
                                }
                                context.startForegroundService(serviceIntent)
                            }
                        }

                        // Re-schedule for next occurrence
                        scheduleManager.updateAlarms(schedules)
                    }

                    ACTION_END -> {
                        // End the scheduled session
                        val currentSession = storage.getSession()
                        if (currentSession != null && currentSession.isActive) {
                            sessionManager.stopSession(true)

                            val serviceIntent = Intent(context, BlockerForegroundService::class.java).apply {
                                action = BlockerForegroundService.ACTION_STOP
                            }
                            context.startService(serviceIntent)
                        }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                pendingResult.finish()
            }
        }
    }
}
```

---

## 2.9 Update Main Module to Handle Events Properly

Add this to `AppBlockerModule.kt` to properly emit tick events:

```kotlin
// Add at class level
private var tickJob: Job? = null

// Add this method
private fun startTickEmitter() {
    tickJob?.cancel()
    tickJob = scope.launch {
        while (isActive) {
            delay(1000)
            val session = storage.getSession()
            if (session != null && session.isActive && !session.isPaused) {
                sendEvent(BlockerEvents.SESSION_TICK, mapOf(
                    "remainingSeconds" to session.remainingSeconds,
                    "progress" to session.progress
                ))

                // Check if session just completed
                if (session.remainingMillis <= 0) {
                    sessions.stopSession(true)
                    stopService()
                    sendEvent(BlockerEvents.SESSION_ENDED, mapOf(
                        "session" to session.complete().toMap(),
                        "completedSuccessfully" to true
                    ))
                    tickJob?.cancel()
                }
            } else {
                tickJob?.cancel()
            }
        }
    }
}

private fun stopTickEmitter() {
    tickJob?.cancel()
    tickJob = null
}
```

Update the `startSession` function to call `startTickEmitter()`:

```kotlin
AsyncFunction("startSession") { durationMinutes: Int, intensity: String, blockedPackages: List<String>, promise: Promise ->
    scope.launch {
        try {
            // ... existing code ...

            startService()
            startTickEmitter() // Add this line

            sendEvent(BlockerEvents.SESSION_STARTED, session.toMap())
            promise.resolve(session.toMap())
        } catch (e: Exception) {
            promise.reject("ERROR", e.message, e)
        }
    }
}
```

Update `stopSession` to call `stopTickEmitter()`:

```kotlin
AsyncFunction("stopSession") { completed: Boolean, promise: Promise ->
    scope.launch {
        try {
            // ... existing code ...

            stopTickEmitter() // Add this line
            stopService()

            // ... rest of code ...
        } catch (e: Exception) {
            promise.reject("ERROR", e.message, e)
        }
    }
}
```

---

## 2.10 Complete Updated `AppBlockerModule.kt`

Here's the complete updated module with tick emitter:

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
    private var tickJob: Job? = null

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
                    startTickEmitter()

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

                    stopTickEmitter()
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
                        stopTickEmitter()
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
                        startTickEmitter()
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

        OnDestroy {
            stopTickEmitter()
            scope.cancel()
        }
    }

    // ==================== Private Helpers ====================

    private fun startService() {
        try {
            context.startForegroundService(
                Intent(context, BlockerForegroundService::class.java).apply {
                    action = BlockerForegroundService.ACTION_START
                }
            )
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun stopService() {
        try {
            context.startService(
                Intent(context, BlockerForegroundService::class.java).apply {
                    action = BlockerForegroundService.ACTION_STOP
                }
            )
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun startTickEmitter() {
        tickJob?.cancel()
        tickJob = scope.launch {
            while (isActive) {
                delay(1000)
                try {
                    val session = storage.getSession()
                    if (session != null && session.isActive && !session.isPaused) {
                        sendEvent(BlockerEvents.SESSION_TICK, mapOf(
                            "remainingSeconds" to session.remainingSeconds,
                            "progress" to session.progress
                        ))

                        // Check if session naturally completed
                        if (session.remainingMillis <= 0) {
                            val completed = sessions.stopSession(true)
                            stopService()
                            if (completed != null) {
                                sendEvent(BlockerEvents.SESSION_ENDED, mapOf(
                                    "session" to completed.toMap(),
                                    "completedSuccessfully" to true
                                ))
                            }
                            tickJob?.cancel()
                            break
                        }
                    } else if (session == null || !session.isActive) {
                        tickJob?.cancel()
                        break
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }

    private fun stopTickEmitter() {
        tickJob?.cancel()
        tickJob = null
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

# ✅ End of Part 2

**What's included:**
- ✅ SessionManager - Complete session lifecycle
- ✅ UsageTracker - App usage statistics
- ✅ ScheduleManager - Schedule alarms
- ✅ BlockerAccessibilityService - App detection
- ✅ BlockerForegroundService - Persistent notification
- ✅ BlockingOverlayActivity - Programmatic blocking UI
- ✅ BootReceiver - Resume after restart
- ✅ ScheduleAlarmReceiver - Handle scheduled sessions
- ✅ Tick emitter for real-time updates

---

## Part 3 Preview: React Native Integration

Coming next:
1. React Native hooks for easy usage
2. Updated UI component integration
3. Permission flow UI
4. Complete working example

**Ready for Part 3?**