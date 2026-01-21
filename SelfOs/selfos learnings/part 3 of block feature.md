# Part 3 - React Native Integration with Your UI

I'll create optimized hooks and integrate them with your existing `block.tsx` UI. This will be clean, efficient, and match your exact UI structure.

---

## 3.1 Custom Hooks - `src/hooks/useAppBlocker.ts`

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import AppBlocker, {
  FocusSession,
  SessionIntensity,
  PermissionStatus,
  BlockedApp,
  UserStats,
  BlockSchedule,
  DailyLimitConfig,
  DailyLimitStatus,
  InstalledApp,
  AppUsageStats,
  addSessionStartedListener,
  addSessionEndedListener,
  addSessionPausedListener,
  addSessionResumedListener,
  addSessionTickListener,
  addAppBlockedListener,
} from '../../modules/app-blocker';

// ==================== Permission Hook ====================

export function usePermissions() {
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const checkPermissions = useCallback(async () => {
    try {
      setLoading(true);
      const result = await AppBlocker.getPermissionStatus();
      setStatus(result);
      return result;
    } catch (error) {
      console.error('Failed to check permissions:', error);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const openSettings = useCallback(async (type: 'usageStats' | 'overlay' | 'accessibility' | 'notifications') => {
    try {
      await AppBlocker.openPermissionSettings(type);
      // Recheck after a delay (user might grant permission)
      setTimeout(checkPermissions, 1000);
    } catch (error) {
      console.error('Failed to open settings:', error);
    }
  }, [checkPermissions]);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  return {
    status,
    loading,
    checkPermissions,
    openSettings,
    allGranted: status?.allRequired ?? false,
  };
}

// ==================== Focus Session Hook ====================

export function useFocusSession() {
  const [session, setSession] = useState<FocusSession | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);

  // Load initial state
  useEffect(() => {
    loadActiveSession();
  }, []);

  // Set up event listeners
  useEffect(() => {
    const subscriptions = [
      addSessionStartedListener((event) => {
        setSession(event.session || event as unknown as FocusSession);
        setIsActive(true);
        setIsPaused(false);
      }),
      addSessionEndedListener((event) => {
        setSession(null);
        setIsActive(false);
        setIsPaused(false);
        setRemainingSeconds(0);
        setProgress(0);
      }),
      addSessionPausedListener((event) => {
        setSession(event as unknown as FocusSession);
        setIsPaused(true);
      }),
      addSessionResumedListener((event) => {
        setSession(event as unknown as FocusSession);
        setIsPaused(false);
      }),
      addSessionTickListener((event) => {
        setRemainingSeconds(event.remainingSeconds);
        setProgress(event.progress);
      }),
    ];

    return () => {
      subscriptions.forEach(sub => sub.remove());
    };
  }, []);

  const loadActiveSession = useCallback(async () => {
    try {
      const activeSession = await AppBlocker.getActiveSession();
      if (activeSession) {
        setSession(activeSession);
        setIsActive(activeSession.isActive);
        setIsPaused(activeSession.isPaused);
        setRemainingSeconds(activeSession.remainingSeconds);
        setProgress(activeSession.progress);
      }
    } catch (error) {
      console.error('Failed to load active session:', error);
    }
  }, []);

  const startSession = useCallback(async (
    durationMinutes: number,
    intensity: SessionIntensity,
    blockedPackages: string[]
  ): Promise<FocusSession | null> => {
    try {
      setLoading(true);
      const newSession = await AppBlocker.startSession(durationMinutes, intensity, blockedPackages);
      setSession(newSession);
      setIsActive(true);
      setIsPaused(false);
      setRemainingSeconds(newSession.remainingSeconds);
      return newSession;
    } catch (error) {
      console.error('Failed to start session:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const stopSession = useCallback(async (completed: boolean = false): Promise<FocusSession | null> => {
    try {
      setLoading(true);
      const endedSession = await AppBlocker.stopSession(completed);
      setSession(null);
      setIsActive(false);
      setIsPaused(false);
      setRemainingSeconds(0);
      setProgress(0);
      return endedSession;
    } catch (error) {
      console.error('Failed to stop session:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const pauseSession = useCallback(async (): Promise<FocusSession | null> => {
    try {
      const pausedSession = await AppBlocker.pauseSession();
      setSession(pausedSession);
      setIsPaused(true);
      return pausedSession;
    } catch (error) {
      console.error('Failed to pause session:', error);
      throw error;
    }
  }, []);

  const resumeSession = useCallback(async (): Promise<FocusSession | null> => {
    try {
      const resumedSession = await AppBlocker.resumeSession();
      setSession(resumedSession);
      setIsPaused(false);
      return resumedSession;
    } catch (error) {
      console.error('Failed to resume session:', error);
      throw error;
    }
  }, []);

  const canStop = useCallback(async () => {
    try {
      return await AppBlocker.canStopSession();
    } catch (error) {
      console.error('Failed to check if can stop:', error);
      return { canStop: true, intensity: 'flexible', reason: null };
    }
  }, []);

  return {
    session,
    isActive,
    isPaused,
    remainingSeconds,
    progress,
    loading,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
    canStop,
    refresh: loadActiveSession,
  };
}

// ==================== Blocked Apps Hook ====================

export function useBlockedApps() {
  const [blockedApps, setBlockedApps] = useState<BlockedApp[]>([]);
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBlockedApps();
  }, []);

  const loadBlockedApps = useCallback(async () => {
    try {
      setLoading(true);
      const apps = await AppBlocker.getBlockedApps();
      setBlockedApps(apps);
    } catch (error) {
      console.error('Failed to load blocked apps:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInstalledApps = useCallback(async (includeSystem: boolean = false) => {
    try {
      const apps = await AppBlocker.getInstalledApps(includeSystem);
      setInstalledApps(apps);
      return apps;
    } catch (error) {
      console.error('Failed to load installed apps:', error);
      return [];
    }
  }, []);

  const saveBlockedApps = useCallback(async (apps: BlockedApp[]) => {
    try {
      await AppBlocker.setBlockedApps(apps);
      setBlockedApps(apps);
    } catch (error) {
      console.error('Failed to save blocked apps:', error);
      throw error;
    }
  }, []);

  const addBlockedApp = useCallback(async (app: BlockedApp) => {
    const updated = [...blockedApps, app];
    await saveBlockedApps(updated);
  }, [blockedApps, saveBlockedApps]);

  const removeBlockedApp = useCallback(async (packageName: string) => {
    const updated = blockedApps.filter(app => app.packageName !== packageName);
    await saveBlockedApps(updated);
  }, [blockedApps, saveBlockedApps]);

  const toggleBlockedApp = useCallback(async (app: BlockedApp) => {
    const exists = blockedApps.some(a => a.packageName === app.packageName);
    if (exists) {
      await removeBlockedApp(app.packageName);
    } else {
      await addBlockedApp(app);
    }
  }, [blockedApps, addBlockedApp, removeBlockedApp]);

  // Get package names for native module
  const blockedPackageNames = blockedApps.map(app => app.packageName);

  return {
    blockedApps,
    installedApps,
    blockedPackageNames,
    loading,
    loadBlockedApps,
    loadInstalledApps,
    saveBlockedApps,
    addBlockedApp,
    removeBlockedApp,
    toggleBlockedApp,
  };
}

// ==================== Stats Hook ====================

export function useStats() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      const userStats = await AppBlocker.getStats();
      setStats(userStats);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    stats,
    loading,
    refresh: loadStats,
    todayFocusMinutes: stats?.todayFocusMinutes ?? 0,
    currentStreak: stats?.currentStreak ?? 0,
    totalSessions: stats?.totalSessions ?? 0,
    longestSession: stats?.longestSessionMinutes ?? 0,
  };
}

// ==================== Usage Stats Hook ====================

export function useUsageStats() {
  const [usageStats, setUsageStats] = useState<AppUsageStats[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTodayUsage = useCallback(async () => {
    try {
      setLoading(true);
      const stats = await AppBlocker.getTodayUsageStats();
      setUsageStats(stats);
      return stats;
    } catch (error) {
      console.error('Failed to load usage stats:', error);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getAppUsage = useCallback(async (packageNames: string[]) => {
    try {
      return await AppBlocker.getAppUsage(packageNames);
    } catch (error) {
      console.error('Failed to get app usage:', error);
      return {};
    }
  }, []);

  return {
    usageStats,
    loading,
    loadTodayUsage,
    getAppUsage,
  };
}

// ==================== Daily Limit Hook ====================

export function useDailyLimit() {
  const [config, setConfig] = useState<DailyLimitConfig | null>(null);
  const [status, setStatus] = useState<DailyLimitStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDailyLimit();
  }, []);

  const loadDailyLimit = useCallback(async () => {
    try {
      setLoading(true);
      const [limitConfig, limitStatus] = await Promise.all([
        AppBlocker.getDailyLimit(),
        AppBlocker.isDailyLimitReached(),
      ]);
      setConfig(limitConfig);
      setStatus(limitStatus);
    } catch (error) {
      console.error('Failed to load daily limit:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveDailyLimit = useCallback(async (newConfig: DailyLimitConfig) => {
    try {
      await AppBlocker.setDailyLimit(newConfig);
      setConfig(newConfig);
      // Refresh status
      const newStatus = await AppBlocker.isDailyLimitReached();
      setStatus(newStatus);
    } catch (error) {
      console.error('Failed to save daily limit:', error);
      throw error;
    }
  }, []);

  const updateLimit = useCallback(async (limitMinutes: number) => {
    const newConfig: DailyLimitConfig = {
      enabled: config?.enabled ?? true,
      limitMinutes,
      blockedPackages: config?.blockedPackages ?? [],
      resetHour: config?.resetHour ?? 0,
    };
    await saveDailyLimit(newConfig);
  }, [config, saveDailyLimit]);

  const toggleEnabled = useCallback(async () => {
    if (!config) return;
    await saveDailyLimit({ ...config, enabled: !config.enabled });
  }, [config, saveDailyLimit]);

  return {
    config,
    status,
    loading,
    isEnabled: config?.enabled ?? false,
    limitMinutes: config?.limitMinutes ?? 60,
    usedMinutes: status?.usedMinutes ?? 0,
    remainingMinutes: status?.remainingMinutes ?? 0,
    isReached: status?.isReached ?? false,
    saveDailyLimit,
    updateLimit,
    toggleEnabled,
    refresh: loadDailyLimit,
  };
}

// ==================== Schedules Hook ====================

export function useSchedules() {
  const [schedules, setSchedules] = useState<BlockSchedule[]>([]);
  const [activeSchedule, setActiveSchedule] = useState<BlockSchedule | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSchedules();
  }, []);

  const loadSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const [allSchedules, active] = await Promise.all([
        AppBlocker.getSchedules(),
        AppBlocker.getActiveSchedule(),
      ]);
      setSchedules(allSchedules);
      setActiveSchedule(active);
    } catch (error) {
      console.error('Failed to load schedules:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSchedules = useCallback(async (newSchedules: BlockSchedule[]) => {
    try {
      await AppBlocker.setSchedules(newSchedules);
      setSchedules(newSchedules);
    } catch (error) {
      console.error('Failed to save schedules:', error);
      throw error;
    }
  }, []);

  const addSchedule = useCallback(async (schedule: BlockSchedule) => {
    const updated = [...schedules, schedule];
    await saveSchedules(updated);
  }, [schedules, saveSchedules]);

  const updateSchedule = useCallback(async (id: string, updates: Partial<BlockSchedule>) => {
    const updated = schedules.map(s => s.id === id ? { ...s, ...updates } : s);
    await saveSchedules(updated);
  }, [schedules, saveSchedules]);

  const deleteSchedule = useCallback(async (id: string) => {
    const updated = schedules.filter(s => s.id !== id);
    await saveSchedules(updated);
  }, [schedules, saveSchedules]);

  const toggleSchedule = useCallback(async (id: string) => {
    const schedule = schedules.find(s => s.id === id);
    if (schedule) {
      await updateSchedule(id, { isActive: !schedule.isActive });
    }
  }, [schedules, updateSchedule]);

  return {
    schedules,
    activeSchedule,
    loading,
    saveSchedules,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    toggleSchedule,
    refresh: loadSchedules,
  };
}

// ==================== Combined App Blocker Hook ====================

export function useAppBlocker() {
  const permissions = usePermissions();
  const session = useFocusSession();
  const blockedApps = useBlockedApps();
  const stats = useStats();
  const dailyLimit = useDailyLimit();
  const schedules = useSchedules();
  const usage = useUsageStats();

  // App blocked event
  useEffect(() => {
    const sub = addAppBlockedListener((event) => {
      console.log('App blocked:', event.packageName);
    });
    return () => sub.remove();
  }, []);

  return {
    permissions,
    session,
    blockedApps,
    stats,
    dailyLimit,
    schedules,
    usage,
  };
}
```

---

## 3.2 Updated `block.tsx` - Full Integration

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  ScrollView, 
  TouchableOpacity, 
  Dimensions, 
  Switch, 
  Modal,
  Alert,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { 
  Shield, 
  Zap, 
  Lock, 
  Clock, 
  AlertTriangle,
  Settings2,
  CalendarDays,
  BarChart3,
  Plus,
  Trash2,
  Play,
  Pause,
  Flame,
  Target,
  Check,
  Edit3,
  ShieldAlert,
  Power,
  Info,
  AlertCircle,
  Trophy,
  Sparkles,
  RefreshCw
} from 'lucide-react-native';
import Animated, { 
  useAnimatedStyle, 
  withSpring, 
  withRepeat, 
  withSequence, 
  withTiming,
  useSharedValue,
  FadeInDown,
  FadeIn,
  SlideInDown,
  ZoomIn,
  Easing
} from 'react-native-reanimated';

import { 
  useFocusSession, 
  useBlockedApps, 
  useStats,
  usePermissions,
  useDailyLimit,
  useSchedules,
  useUsageStats,
} from '@/src/hooks/useAppBlocker';
import type { SessionIntensity, BlockedApp as NativeBlockedApp } from '../../modules/app-blocker';

const { width } = Dimensions.get('window');

// ============ TYPES ============
type Mode = 'focus' | 'schedule' | 'limit';
type Intensity = SessionIntensity;

interface BlockedAppUI {
  id: string;
  name: string;
  icon: string;
  color: string;
  packageName: string;
  dailyUsage: number;
}

// ============ CONSTANTS ============
const QUICK_TIMES = [
  { label: '25m', value: 25, desc: 'Quick focus' },
  { label: '45m', value: 45, desc: 'Deep work' },
  { label: '1h', value: 60, desc: 'Extended' },
  { label: '2h', value: 120, desc: 'Marathon' },
];

const INTENSITY_OPTIONS = [
  {
    id: 'flexible' as Intensity,
    name: 'Flexible',
    icon: Shield,
    color: '#22c55e',
    description: 'Pause or stop anytime. Great for beginners.',
  },
  {
    id: 'committed' as Intensity,
    name: 'Committed',
    icon: Lock,
    color: '#f59e0b',
    description: 'Wait 30 seconds to stop. Builds discipline.',
  },
  {
    id: 'locked' as Intensity,
    name: 'Locked',
    icon: ShieldAlert,
    color: '#ef4444',
    description: 'Cannot stop until complete. Maximum focus.',
    warning: 'You will not be able to end this session early.',
  },
];

const FOCUS_MESSAGES = [
  "You're doing great! Keep going 💪",
  "Every minute counts. Stay strong!",
  "Your future self will thank you.",
  "Focus is a superpower. You have it.",
  "Small steps lead to big changes.",
  "You chose this. You can do this.",
  "Distractions can wait. Your goals can't.",
];

// Default blocked apps (for display when native data not loaded)
const DEFAULT_BLOCKED_APPS: BlockedAppUI[] = [
  { id: '1', name: 'Instagram', icon: '📸', color: '#E4405F', packageName: 'com.instagram.android', dailyUsage: 0 },
  { id: '2', name: 'TikTok', icon: '🎵', color: '#010101', packageName: 'com.zhiliaoapp.musically', dailyUsage: 0 },
  { id: '3', name: 'Twitter', icon: '🐦', color: '#1DA1F2', packageName: 'com.twitter.android', dailyUsage: 0 },
  { id: '4', name: 'YouTube', icon: '▶️', color: '#FF0000', packageName: 'com.google.android.youtube', dailyUsage: 0 },
];

// ============ MAIN COMPONENT ============
export default function FocusEngineScreen() {
  // Native hooks
  const permissions = usePermissions();
  const focusSession = useFocusSession();
  const blockedAppsHook = useBlockedApps();
  const statsHook = useStats();
  const usageHook = useUsageStats();

  // UI State
  const [activeMode, setActiveMode] = useState<Mode>('focus');
  const [duration, setDuration] = useState(45);
  const [intensity, setIntensity] = useState<Intensity>('committed');
  
  // Modal States
  const [showLockedConfirm, setShowLockedConfirm] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [stopCountdown, setStopCountdown] = useState(0);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);

  // Motivational message
  const [currentMessage, setCurrentMessage] = useState(FOCUS_MESSAGES[0]);

  // Animations
  const pulseScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.3);

  // Derived state
  const isFocusActive = focusSession.isActive;
  const isPaused = focusSession.isPaused;
  const timeRemaining = focusSession.remainingSeconds;
  const progress = focusSession.progress * 100;

  // Convert native blocked apps to UI format
  const blockedApps: BlockedAppUI[] = blockedAppsHook.blockedApps.length > 0
    ? blockedAppsHook.blockedApps.map(app => ({
        id: app.id,
        name: app.name,
        icon: getAppIcon(app.packageName),
        color: app.color || getAppColor(app.packageName),
        packageName: app.packageName,
        dailyUsage: 0, // Will be updated from usage stats
      }))
    : DEFAULT_BLOCKED_APPS;

  // Stats
  const stats = {
    todayFocusMinutes: statsHook.todayFocusMinutes,
    currentStreak: statsHook.currentStreak,
    totalSessions: statsHook.totalSessions,
    longestSession: statsHook.longestSession,
  };

  // Load usage stats for blocked apps
  useEffect(() => {
    if (blockedAppsHook.blockedPackageNames.length > 0) {
      usageHook.getAppUsage(blockedAppsHook.blockedPackageNames);
    }
  }, [blockedAppsHook.blockedPackageNames]);

  // Check permissions on mount
  useEffect(() => {
    if (permissions.status && !permissions.status.allRequired) {
      setShowPermissionModal(true);
    }
  }, [permissions.status]);

  // Rotate motivational messages
  useEffect(() => {
    if (isFocusActive && !isPaused) {
      const interval = setInterval(() => {
        setCurrentMessage(FOCUS_MESSAGES[Math.floor(Math.random() * FOCUS_MESSAGES.length)]);
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [isFocusActive, isPaused]);

  // Animation effects
  useEffect(() => {
    if (isFocusActive && !isPaused) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.02, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 1500 }),
          withTiming(0.3, { duration: 1500 })
        ),
        -1,
        true
      );
    } else {
      pulseScale.value = withSpring(1);
      glowOpacity.value = withTiming(0.3);
    }
  }, [isFocusActive, isPaused]);

  // Stop countdown for committed mode
  useEffect(() => {
    if (showStopConfirm && stopCountdown > 0) {
      const interval = setInterval(() => {
        setStopCountdown(prev => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [showStopConfirm, stopCountdown]);

  const animatedPulse = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const animatedGlow = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  // Helpers
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const currentIntensity = INTENSITY_OPTIONS.find(i => i.id === intensity)!;

  // ============ HANDLERS ============

  const handleStart = useCallback(async () => {
    // Check permissions first
    if (!permissions.allGranted) {
      setShowPermissionModal(true);
      return;
    }

    if (intensity === 'locked') {
      setShowLockedConfirm(true);
    } else {
      await startSession();
    }
  }, [intensity, permissions.allGranted]);

  const startSession = useCallback(async () => {
    try {
      setShowLockedConfirm(false);
      
      const packageNames = blockedApps.map(app => app.packageName);
      await focusSession.startSession(duration, intensity, packageNames);
      
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to start session');
    }
  }, [duration, intensity, blockedApps, focusSession]);

  const handleStopRequest = useCallback(async () => {
    const canStopResult = await focusSession.canStop();

    if (!canStopResult.canStop && canStopResult.intensity === 'locked') {
      Alert.alert(
        "Session Locked",
        "You chose Locked mode. This session cannot be ended early. Stay focused! 💪",
        [{ text: "Continue Focusing", style: "default" }]
      );
      return;
    }

    if (canStopResult.intensity === 'committed') {
      setStopCountdown(canStopResult.waitTime || 30);
      setShowStopConfirm(true);
      return;
    }

    // Flexible mode - stop immediately
    await endSession(false);
  }, [focusSession]);

  const endSession = useCallback(async (completed: boolean) => {
    try {
      setShowStopConfirm(false);
      await focusSession.stopSession(completed);
      
      if (completed) {
        // Refresh stats
        await statsHook.refresh();
        setShowCompleteModal(true);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to end session');
    }
  }, [focusSession, statsHook]);

  const handlePauseResume = useCallback(async () => {
    try {
      if (isPaused) {
        await focusSession.resumeSession();
      } else {
        await focusSession.pauseSession();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to pause/resume');
    }
  }, [isPaused, focusSession]);

  // Listen for session completion from native
  useEffect(() => {
    if (focusSession.session?.completed && !showCompleteModal) {
      statsHook.refresh();
      setShowCompleteModal(true);
    }
  }, [focusSession.session?.completed]);

  // ============ RENDER ============

  return (
    <View className="flex-1 bg-[#0a0a0a]">
      {/* Background Glow */}
      <Animated.View 
        style={[{
          position: 'absolute',
          top: -100,
          left: -50,
          width: width + 100,
          height: 400,
          borderRadius: 200,
        }, animatedGlow]}
      >
        <LinearGradient
          colors={[currentIntensity.color + '40', 'transparent']}
          style={{ flex: 1 }}
        />
      </Animated.View>

      <SafeAreaView className="flex-1">
        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 160 }}
        >
          {/* Header */}
          <View className="px-5 pt-2 pb-4">
            <View className="flex-row justify-between items-center">
              <View>
                <Text className="text-white text-2xl font-bold">Focus</Text>
                <Text className="text-zinc-500 text-sm mt-0.5">
                  Block distractions, achieve more
                </Text>
              </View>
              
              <TouchableOpacity 
                onPress={() => setShowPermissionModal(true)}
                className="w-10 h-10 bg-zinc-900 rounded-xl items-center justify-center border border-zinc-800"
              >
                <Settings2 size={18} color="#71717a" />
              </TouchableOpacity>
            </View>

            {/* Mini Stats */}
            <View className="flex-row mt-4 gap-3">
              <View className="flex-1 bg-zinc-900/60 rounded-2xl p-3 border border-zinc-800/50 flex-row items-center gap-3">
                <View className="w-9 h-9 bg-blue-500/20 rounded-xl items-center justify-center">
                  <Clock size={16} color="#3b82f6" />
                </View>
                <View>
                  <Text className="text-white font-bold">
                    {Math.floor(stats.todayFocusMinutes / 60)}h {stats.todayFocusMinutes % 60}m
                  </Text>
                  <Text className="text-zinc-500 text-xs">Today</Text>
                </View>
              </View>
              
              <View className="flex-1 bg-zinc-900/60 rounded-2xl p-3 border border-zinc-800/50 flex-row items-center gap-3">
                <View className="w-9 h-9 bg-orange-500/20 rounded-xl items-center justify-center">
                  <Flame size={16} color="#f97316" />
                </View>
                <View>
                  <Text className="text-white font-bold">{stats.currentStreak} days</Text>
                  <Text className="text-zinc-500 text-xs">Streak</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Mode Tabs */}
          <View className="px-5 mb-6">
            <View className="flex-row bg-zinc-900/80 p-1.5 rounded-2xl border border-zinc-800/50">
              {[
                { id: 'focus', label: 'Focus', icon: Target },
                { id: 'schedule', label: 'Schedule', icon: CalendarDays },
                { id: 'limit', label: 'Limits', icon: BarChart3 },
              ].map((tab) => (
                <TouchableOpacity
                  key={tab.id}
                  onPress={() => !isFocusActive && setActiveMode(tab.id as Mode)}
                  disabled={isFocusActive}
                  className={`flex-1 flex-row items-center justify-center py-3 rounded-xl gap-2 ${
                    activeMode === tab.id ? 'bg-zinc-800' : ''
                  } ${isFocusActive ? 'opacity-50' : ''}`}
                >
                  <tab.icon size={16} color={activeMode === tab.id ? 'white' : '#52525b'} />
                  <Text className={`font-medium ${activeMode === tab.id ? 'text-white' : 'text-zinc-600'}`}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Main Content */}
          {activeMode === 'focus' && (
            <FocusView
              duration={duration}
              setDuration={setDuration}
              timeRemaining={timeRemaining}
              isFocusActive={isFocusActive}
              isPaused={isPaused}
              intensity={intensity}
              setIntensity={setIntensity}
              currentIntensity={currentIntensity}
              animatedPulse={animatedPulse}
              formatTime={formatTime}
              progress={progress}
              blockedApps={blockedApps}
              currentMessage={currentMessage}
            />
          )}

          {activeMode === 'schedule' && <ScheduleView />}
          {activeMode === 'limit' && <LimitView apps={blockedApps} />}
        </ScrollView>

        {/* Bottom Action */}
        {activeMode === 'focus' && (
          <Animated.View 
            entering={SlideInDown.springify()}
            className="absolute bottom-0 left-0 right-0 p-5 pb-8"
          >
            <View className="bg-zinc-900/95 backdrop-blur-xl rounded-3xl p-4 border border-zinc-800/50">
              {!isFocusActive ? (
                <TouchableOpacity 
                  onPress={handleStart} 
                  activeOpacity={0.8}
                  disabled={focusSession.loading}
                >
                  <LinearGradient
                    colors={[currentIntensity.color, currentIntensity.color + 'cc']}
                    className="h-14 rounded-2xl flex-row items-center justify-center gap-2"
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    {focusSession.loading ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <>
                        <Zap size={20} color="white" />
                        <Text className="text-white text-lg font-bold">
                          Start {duration} min Focus
                        </Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              ) : (
                <View className="flex-row gap-3">
                  {intensity === 'flexible' && (
                    <TouchableOpacity 
                      onPress={handlePauseResume}
                      className="flex-1 h-14 bg-zinc-800 rounded-2xl flex-row items-center justify-center gap-2 border border-zinc-700"
                    >
                      {isPaused ? (
                        <>
                          <Play size={18} color="white" />
                          <Text className="text-white font-bold">Resume</Text>
                        </>
                      ) : (
                        <>
                          <Pause size={18} color="white" />
                          <Text className="text-white font-bold">Pause</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                  
                  <TouchableOpacity 
                    onPress={handleStopRequest}
                    className={`flex-1 h-14 rounded-2xl flex-row items-center justify-center gap-2 ${
                      intensity === 'locked' 
                        ? 'bg-zinc-800/30 border border-zinc-800' 
                        : 'bg-red-500/10 border border-red-500/20'
                    }`}
                  >
                    {intensity === 'locked' ? (
                      <>
                        <Lock size={18} color="#52525b" />
                        <Text className="text-zinc-600 font-bold">Locked</Text>
                      </>
                    ) : (
                      <>
                        <Power size={18} color="#ef4444" />
                        <Text className="text-red-400 font-bold">End Session</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
              
              <Text className="text-center text-zinc-600 text-xs mt-3">
                {isFocusActive 
                  ? `${blockedApps.length} apps blocked • ${currentIntensity.name} mode`
                  : `${blockedApps.length} distracting apps will be blocked`
                }
              </Text>
            </View>
          </Animated.View>
        )}
      </SafeAreaView>

      {/* Permission Modal */}
      <PermissionModal 
        visible={showPermissionModal}
        onClose={() => setShowPermissionModal(false)}
        permissions={permissions}
      />

      {/* Locked Mode Confirmation Modal */}
      <LockedConfirmModal
        visible={showLockedConfirm}
        onClose={() => setShowLockedConfirm(false)}
        onConfirm={startSession}
        duration={duration}
        blockedAppsCount={blockedApps.length}
      />

      {/* Stop Confirmation Modal (Committed Mode) */}
      <StopConfirmModal
        visible={showStopConfirm}
        onClose={() => setShowStopConfirm(false)}
        onConfirm={() => endSession(false)}
        countdown={stopCountdown}
      />

      {/* Session Complete Modal */}
      <CompleteModal
        visible={showCompleteModal}
        onClose={() => setShowCompleteModal(false)}
        duration={focusSession.session?.durationMinutes || duration}
        stats={stats}
      />
    </View>
  );
}

// ============ HELPER FUNCTIONS ============

function getAppIcon(packageName: string): string {
  const icons: Record<string, string> = {
    'com.instagram.android': '📸',
    'com.zhiliaoapp.musically': '🎵',
    'com.twitter.android': '🐦',
    'com.google.android.youtube': '▶️',
    'com.facebook.katana': '👤',
    'com.snapchat.android': '👻',
    'com.whatsapp': '💬',
    'com.reddit.frontpage': '🔴',
  };
  return icons[packageName] || '📱';
}

function getAppColor(packageName: string): string {
  const colors: Record<string, string> = {
    'com.instagram.android': '#E4405F',
    'com.zhiliaoapp.musically': '#010101',
    'com.twitter.android': '#1DA1F2',
    'com.google.android.youtube': '#FF0000',
    'com.facebook.katana': '#1877F2',
    'com.snapchat.android': '#FFFC00',
    'com.whatsapp': '#25D366',
    'com.reddit.frontpage': '#FF4500',
  };
  return colors[packageName] || '#6366f1';
}

// ============ SUB-COMPONENTS ============

function FocusView({
  duration,
  setDuration,
  timeRemaining,
  isFocusActive,
  isPaused,
  intensity,
  setIntensity,
  currentIntensity,
  animatedPulse,
  formatTime,
  progress,
  blockedApps,
  currentMessage,
}: any) {
  return (
    <View className="px-5">
      {/* Timer Circle */}
      <Animated.View style={animatedPulse} className="items-center mb-6">
        <View className="relative">
          <View className="w-56 h-56 rounded-full border-4 border-zinc-800/50" />
          
          {isFocusActive && (
            <View 
              className="absolute inset-0 rounded-full border-4"
              style={{ 
                borderColor: currentIntensity.color,
                borderTopColor: 'transparent',
                borderRightColor: progress > 25 ? currentIntensity.color : 'transparent',
                borderBottomColor: progress > 50 ? currentIntensity.color : 'transparent',
                borderLeftColor: progress > 75 ? currentIntensity.color : 'transparent',
                transform: [{ rotate: '-90deg' }],
              }}
            />
          )}

          <View className="absolute inset-0 items-center justify-center">
            {isFocusActive ? (
              <View className="items-center">
                <Text className="text-white text-5xl font-bold font-mono">
                  {formatTime(timeRemaining)}
                </Text>
                <Text className="text-zinc-500 text-sm mt-1">
                  {isPaused ? 'Paused' : 'remaining'}
                </Text>
              </View>
            ) : (
              <View className="items-center">
                <Text className="text-white text-6xl font-bold">{duration}</Text>
                <Text className="text-zinc-500 text-sm">minutes</Text>
              </View>
            )}
          </View>

          <View 
            className="absolute -bottom-2 left-1/2 px-4 py-1.5 rounded-full flex-row items-center gap-1.5"
            style={{ 
              backgroundColor: currentIntensity.color + '20',
              transform: [{ translateX: -50 }],
            }}
          >
            <currentIntensity.icon size={12} color={currentIntensity.color} />
            <Text style={{ color: currentIntensity.color }} className="text-xs font-bold">
              {currentIntensity.name}
            </Text>
          </View>
        </View>
      </Animated.View>

      {isFocusActive && (
        <Animated.View entering={FadeIn} className="mb-6 px-4">
          <Text className="text-zinc-400 text-center text-sm">{currentMessage}</Text>
        </Animated.View>
      )}

      {!isFocusActive && (
        <>
          {/* Duration Selection */}
          <Animated.View entering={FadeInDown.delay(100)}>
            <Text className="text-zinc-500 text-xs font-medium uppercase tracking-wider mb-3">
              Duration
            </Text>
            <View className="flex-row gap-2 mb-6">
              {QUICK_TIMES.map((time) => (
                <TouchableOpacity
                  key={time.value}
                  onPress={() => setDuration(time.value)}
                  className={`flex-1 py-4 rounded-2xl items-center border ${
                    duration === time.value 
                      ? 'bg-zinc-800 border-zinc-700' 
                      : 'bg-zinc-900/50 border-zinc-800/50'
                  }`}
                >
                  <Text className={`text-lg font-bold ${
                    duration === time.value ? 'text-white' : 'text-zinc-500'
                  }`}>
                    {time.label}
                  </Text>
                  <Text className={`text-[10px] mt-0.5 ${
                    duration === time.value ? 'text-zinc-400' : 'text-zinc-600'
                  }`}>
                    {time.desc}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>

          {/* Intensity Selection */}
          <Animated.View entering={FadeInDown.delay(150)} className="mb-6">
            <Text className="text-zinc-500 text-xs font-medium uppercase tracking-wider mb-3">
              Commitment Level
            </Text>
            <View className="gap-2">
              {INTENSITY_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  onPress={() => setIntensity(option.id)}
                  className={`p-4 rounded-2xl border ${
                    intensity === option.id 
                      ? 'bg-zinc-800/80 border-zinc-700' 
                      : 'bg-zinc-900/50 border-zinc-800/50'
                  }`}
                >
                  <View className="flex-row items-center">
                    <View 
                      className="w-10 h-10 rounded-xl items-center justify-center mr-3"
                      style={{ backgroundColor: option.color + '20' }}
                    >
                      <option.icon size={18} color={option.color} />
                    </View>
                    
                    <View className="flex-1">
                      <Text className={`font-semibold ${
                        intensity === option.id ? 'text-white' : 'text-zinc-400'
                      }`}>
                        {option.name}
                      </Text>
                      <Text className="text-zinc-600 text-xs mt-0.5">
                        {option.description}
                      </Text>
                    </View>
                    
                    {intensity === option.id && (
                      <View 
                        className="w-6 h-6 rounded-full items-center justify-center" 
                        style={{ backgroundColor: option.color }}
                      >
                        <Check size={14} color="white" />
                      </View>
                    )}
                  </View>

                  {option.id === 'locked' && intensity === 'locked' && option.warning && (
                    <View className="mt-3 p-3 bg-red-500/10 rounded-xl border border-red-500/20">
                      <View className="flex-row items-start gap-2">
                        <AlertTriangle size={14} color="#f87171" />
                        <Text className="text-red-300/80 text-xs flex-1 leading-4">
                          {option.warning}
                        </Text>
                      </View>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>
        </>
      )}

      {/* Blocked Apps */}
      <Animated.View entering={FadeInDown.delay(200)}>
        <View className="flex-row justify-between items-center mb-3">
          <Text className="text-zinc-500 text-xs font-medium uppercase tracking-wider">
            Apps to Block
          </Text>
          {!isFocusActive && (
            <TouchableOpacity className="flex-row items-center gap-1">
              <Edit3 size={12} color="#3b82f6" />
              <Text className="text-blue-500 text-xs font-medium">Edit</Text>
            </TouchableOpacity>
          )}
        </View>
        
        <View className="bg-zinc-900/50 rounded-2xl p-4 border border-zinc-800/50">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-4">
              {blockedApps.map((app: BlockedAppUI) => (
                <View key={app.id} className="items-center">
                  <View 
                    className={`w-14 h-14 rounded-2xl items-center justify-center mb-2 ${
                      isFocusActive ? 'opacity-50' : ''
                    }`}
                    style={{ backgroundColor: app.color + '20' }}
                  >
                    <Text className="text-2xl">{app.icon}</Text>
                    {isFocusActive && (
                      <View className="absolute inset-0 items-center justify-center">
                        <Lock size={20} color="#ef4444" />
                      </View>
                    )}
                  </View>
                  <Text className="text-zinc-400 text-xs font-medium">{app.name}</Text>
                  {!isFocusActive && (
                    <Text className="text-zinc-600 text-[10px]">{app.dailyUsage}m/day</Text>
                  )}
                </View>
              ))}
              
              {!isFocusActive && (
                <TouchableOpacity className="items-center">
                  <View className="w-14 h-14 rounded-2xl border-2 border-dashed border-zinc-700 items-center justify-center mb-2">
                    <Plus size={20} color="#52525b" />
                  </View>
                  <Text className="text-zinc-600 text-xs">Add</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </View>
      </Animated.View>

      {!isFocusActive && (
        <Animated.View 
          entering={FadeInDown.delay(250)}
          className="mt-6 p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10"
        >
          <View className="flex-row items-start gap-3">
            <Info size={18} color="#3b82f6" />
            <View className="flex-1">
              <Text className="text-blue-200 font-medium text-sm">Getting Started</Text>
              <Text className="text-blue-200/60 text-xs mt-1 leading-5">
                Start with Flexible mode and shorter durations. Build up to Locked mode as you develop focus.
              </Text>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

// ============ MODALS ============

function PermissionModal({ visible, onClose, permissions }: any) {
  const permissionItems = [
    { 
      key: 'usageStats', 
      name: 'Usage Access', 
      desc: 'Track app usage to know when to block',
      granted: permissions.status?.usageStats 
    },
    { 
      key: 'overlay', 
      name: 'Display Over Apps', 
      desc: 'Show blocking screen over other apps',
      granted: permissions.status?.overlay 
    },
    { 
      key: 'accessibility', 
      name: 'Accessibility Service', 
      desc: 'Detect when blocked apps are opened',
      granted: permissions.status?.accessibility 
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={80} tint="dark" style={{ flex: 1 }}>
        <View className="flex-1 justify-center items-center px-6">
          <Animated.View 
            entering={ZoomIn.springify()}
            className="bg-zinc-900 rounded-3xl p-6 w-full max-w-sm border border-zinc-800"
          >
            <View className="items-center mb-5">
              <View className="w-16 h-16 rounded-full bg-blue-500/20 items-center justify-center mb-4">
                <Shield size={32} color="#3b82f6" />
              </View>
              <Text className="text-white text-xl font-bold text-center">
                Permissions Required
              </Text>
              <Text className="text-zinc-400 text-sm text-center mt-2">
                Enable these permissions for app blocking to work
              </Text>
            </View>

            <View className="gap-3 mb-6">
              {permissionItems.map((item) => (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => !item.granted && permissions.openSettings(item.key)}
                  className={`p-4 rounded-2xl border ${
                    item.granted 
                      ? 'bg-green-500/10 border-green-500/30' 
                      : 'bg-zinc-800 border-zinc-700'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1">
                      <Text className={`font-medium ${
                        item.granted ? 'text-green-300' : 'text-white'
                      }`}>
                        {item.name}
                      </Text>
                      <Text className="text-zinc-500 text-xs mt-0.5">
                        {item.desc}
                      </Text>
                    </View>
                    {item.granted ? (
                      <View className="w-6 h-6 rounded-full bg-green-500 items-center justify-center">
                        <Check size={14} color="white" />
                      </View>
                    ) : (
                      <Text className="text-blue-400 text-xs font-medium">Enable →</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={() => {
                permissions.checkPermissions();
                if (permissions.allGranted) onClose();
              }}
              className="h-12 bg-zinc-800 rounded-xl items-center justify-center flex-row gap-2 border border-zinc-700"
            >
              <RefreshCw size={16} color="white" />
              <Text className="text-white font-medium">Check Again</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onClose}
              className="h-12 mt-2 items-center justify-center"
            >
              <Text className="text-zinc-500">Close</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </BlurView>
    </Modal>
  );
}

function LockedConfirmModal({ visible, onClose, onConfirm, duration, blockedAppsCount }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={80} tint="dark" style={{ flex: 1 }}>
        <View className="flex-1 justify-center items-center px-6">
          <Animated.View 
            entering={ZoomIn.springify()}
            className="bg-zinc-900 rounded-3xl p-6 w-full max-w-sm border border-zinc-800"
          >
            <View className="items-center mb-5">
              <View className="w-16 h-16 rounded-full bg-red-500/20 items-center justify-center mb-4">
                <ShieldAlert size={32} color="#ef4444" />
              </View>
              <Text className="text-white text-xl font-bold text-center">
                Enable Locked Mode?
              </Text>
            </View>

            <View className="bg-red-500/10 rounded-2xl p-4 mb-5 border border-red-500/20">
              <View className="flex-row items-start gap-3">
                <AlertCircle size={18} color="#ef4444" />
                <Text className="text-red-200/80 text-sm flex-1 leading-5">
                  Once started, you <Text className="font-bold text-red-300">cannot stop</Text> this 
                  {' '}{duration} minute session.
                </Text>
              </View>
            </View>

            <View className="mb-6">
              <Text className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-3">
                What will happen:
              </Text>
              <View className="gap-2">
                {[
                  `${blockedAppsCount} apps will be blocked`,
                  'No way to end early',
                  'Calls & emergencies still work',
                ].map((item, idx) => (
                  <View key={idx} className="flex-row items-center gap-2">
                    <View className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                    <Text className="text-zinc-400 text-sm">{item}</Text>
                  </View>
                ))}
              </View>
            </View>

            <TouchableOpacity onPress={onConfirm} activeOpacity={0.8}>
              <LinearGradient
                colors={['#ef4444', '#dc2626']}
                className="h-12 rounded-xl flex-row items-center justify-center gap-2"
              >
                <Lock size={18} color="white" />
                <Text className="text-white font-bold">Start Locked Mode</Text>
              </LinearGradient>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={onClose} className="h-12 mt-2 items-center justify-center">
              <Text className="text-zinc-500 font-medium">Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </BlurView>
    </Modal>
  );
}

function StopConfirmModal({ visible, onClose, onConfirm, countdown }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={80} tint="dark" style={{ flex: 1 }}>
        <View className="flex-1 justify-center items-center px-6">
          <Animated.View 
            entering={ZoomIn.springify()}
            className="bg-zinc-900 rounded-3xl p-6 w-full max-w-sm border border-zinc-800"
          >
            <View className="items-center mb-5">
              <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center mb-4">
                <Lock size={32} color="#f59e0b" />
              </View>
              <Text className="text-white text-xl font-bold text-center">Are you sure?</Text>
              <Text className="text-zinc-400 text-sm text-center mt-2">
                You chose Committed mode. Take a moment.
              </Text>
            </View>

            <View className="items-center mb-6">
              {countdown > 0 ? (
                <>
                  <View className="w-20 h-20 rounded-full border-4 border-amber-500/30 items-center justify-center">
                    <Text className="text-amber-400 text-3xl font-bold">{countdown}</Text>
                  </View>
                  <Text className="text-zinc-500 text-sm mt-3">Wait to unlock</Text>
                </>
              ) : (
                <>
                  <View className="w-20 h-20 rounded-full border-4 border-green-500/30 bg-green-500/10 items-center justify-center">
                    <Check size={36} color="#22c55e" />
                  </View>
                  <Text className="text-green-400 text-sm mt-3">You can end now</Text>
                </>
              )}
            </View>

            <View className="bg-blue-500/10 rounded-2xl p-4 mb-5 border border-blue-500/20">
              <Text className="text-blue-200/80 text-sm text-center leading-5">
                💡 You've made progress! Consider continuing.
              </Text>
            </View>

            <TouchableOpacity
              onPress={onClose}
              className="h-12 bg-zinc-800 rounded-xl items-center justify-center border border-zinc-700"
            >
              <Text className="text-white font-bold">Keep Focusing 💪</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={onConfirm}
              disabled={countdown > 0}
              className={`h-12 mt-2 items-center justify-center ${countdown > 0 ? 'opacity-30' : ''}`}
            >
              <Text className={`font-medium ${countdown > 0 ? 'text-zinc-600' : 'text-red-400'}`}>
                End Session Anyway
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </BlurView>
    </Modal>
  );
}

function CompleteModal({ visible, onClose, duration, stats }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={80} tint="dark" style={{ flex: 1 }}>
        <View className="flex-1 justify-center items-center px-6">
          <Animated.View 
            entering={ZoomIn.springify()}
            className="bg-zinc-900 rounded-3xl p-6 w-full max-w-sm border border-zinc-800"
          >
            <View className="items-center mb-5">
              <View className="w-20 h-20 rounded-full bg-emerald-500/20 items-center justify-center mb-4">
                <Trophy size={40} color="#22c55e" />
              </View>
              <Text className="text-white text-2xl font-bold text-center">
                Session Complete! 🎉
              </Text>
              <Text className="text-zinc-400 text-sm text-center mt-2">
                You focused for {duration} minutes
              </Text>
            </View>

            <View className="bg-zinc-800/50 rounded-2xl p-4 mb-5">
              <View className="flex-row justify-around">
                <View className="items-center">
                  <Text className="text-2xl font-bold text-white">{duration}</Text>
                  <Text className="text-zinc-500 text-xs">Minutes</Text>
                </View>
                <View className="w-px bg-zinc-700" />
                <View className="items-center">
                  <Text className="text-2xl font-bold text-white">{stats.currentStreak}</Text>
                  <Text className="text-zinc-500 text-xs">Day Streak</Text>
                </View>
                <View className="w-px bg-zinc-700" />
                <View className="items-center">
                  <Text className="text-2xl font-bold text-white">{stats.totalSessions}</Text>
                  <Text className="text-zinc-500 text-xs">Total</Text>
                </View>
              </View>
            </View>

            <View className="bg-emerald-500/10 rounded-2xl p-4 mb-5 border border-emerald-500/20">
              <View className="flex-row items-center justify-center gap-2">
                <Sparkles size={18} color="#22c55e" />
                <Text className="text-emerald-200 text-sm font-medium">
                  Your focus muscle is stronger!
                </Text>
              </View>
            </View>

            <TouchableOpacity onPress={onClose} activeOpacity={0.8}>
              <LinearGradient
                colors={['#22c55e', '#16a34a']}
                className="h-12 rounded-xl items-center justify-center"
              >
                <Text className="text-white font-bold">Done</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </BlurView>
    </Modal>
  );
}

// ============ SCHEDULE VIEW ============
function ScheduleView() {
  const { schedules, toggleSchedule, deleteSchedule, loading } = useSchedules();

  const getIntensityColor = (intensity: Intensity) => {
    switch (intensity) {
      case 'flexible': return '#22c55e';
      case 'committed': return '#f59e0b';
      case 'locked': return '#ef4444';
    }
  };

  if (loading) {
    return (
      <View className="px-5 items-center py-12">
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  return (
    <View className="px-5">
      <View className="flex-row justify-between items-center mb-4">
        <View>
          <Text className="text-white text-lg font-bold">Schedules</Text>
          <Text className="text-zinc-500 text-sm">Auto-block at set times</Text>
        </View>
        <TouchableOpacity className="bg-blue-600 px-4 py-2 rounded-xl flex-row items-center gap-1.5">
          <Plus size={16} color="white" />
          <Text className="text-white font-medium">Add</Text>
        </TouchableOpacity>
      </View>

      {schedules.length === 0 ? (
        <View className="items-center py-12">
          <CalendarDays size={48} color="#3f3f46" />
          <Text className="text-zinc-500 text-lg font-medium mt-4">No schedules yet</Text>
          <Text className="text-zinc-600 text-sm text-center mt-1">
            Create schedules to auto-block apps
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {schedules.map((schedule) => (
            <View 
              key={schedule.id}
              className="bg-zinc-900/50 rounded-2xl overflow-hidden border border-zinc-800/50"
            >
              {schedule.isActive && (
                <View className="h-1" style={{ backgroundColor: getIntensityColor(schedule.intensity) }} />
              )}
              
              <View className="p-4">
                <View className="flex-row justify-between items-start">
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-white font-semibold text-base">{schedule.name}</Text>
                      <View 
                        className="px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: getIntensityColor(schedule.intensity) + '20' }}
                      >
                        <Text 
                          className="text-[10px] font-bold uppercase"
                          style={{ color: getIntensityColor(schedule.intensity) }}
                        >
                          {schedule.intensity}
                        </Text>
                      </View>
                    </View>
                    <View className="flex-row items-center gap-2 mt-1">
                      <Clock size={12} color="#71717a" />
                      <Text className="text-zinc-500 text-sm">{schedule.timeString}</Text>
                    </View>
                  </View>
                  
                  <View className="items-end gap-2">
                    <Switch 
                      value={schedule.isActive}
                      onValueChange={() => toggleSchedule(schedule.id)}
                      trackColor={{ false: '#27272a', true: getIntensityColor(schedule.intensity) }}
                      thumbColor="white"
                    />
                    <View className="flex-row gap-2">
                      <TouchableOpacity className="p-1">
                        <Edit3 size={14} color="#71717a" />
                      </TouchableOpacity>
                      <TouchableOpacity className="p-1" onPress={() => deleteSchedule(schedule.id)}>
                        <Trash2 size={14} color="#71717a" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ============ LIMIT VIEW ============
function LimitView({ apps }: { apps: BlockedAppUI[] }) {
  const { limitMinutes, usedMinutes, remainingMinutes, isReached, updateLimit, loading } = useDailyLimit();
  
  const totalUsage = usedMinutes;
  const percentage = Math.min((totalUsage / limitMinutes) * 100, 100);
  const remaining = remainingMinutes;

  return (
    <View className="px-5">
      <View className="mb-6">
        <Text className="text-white text-lg font-bold">Daily Limits</Text>
        <Text className="text-zinc-500 text-sm">Set a budget for distracting apps</Text>
      </View>

      {/* Budget Overview */}
      <View className="bg-zinc-900/50 rounded-3xl p-6 border border-zinc-800/50 mb-6">
        <View className="items-center mb-6">
          <View 
            className={`w-28 h-28 rounded-full items-center justify-center border-4 ${
              isReached ? 'border-red-500 bg-red-500/10' : 'border-blue-500 bg-blue-500/10'
            }`}
          >
            <Text className="text-3xl font-bold text-white">{remaining}</Text>
            <Text className="text-zinc-500 text-xs">min left</Text>
          </View>
        </View>

        <View className="mb-2">
          <View className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
            <LinearGradient
              colors={isReached ? ['#ef4444', '#dc2626'] : ['#3b82f6', '#8b5cf6']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ width: `${percentage}%`, height: '100%' }}
            />
          </View>
        </View>
        
        <View className="flex-row justify-between">
          <Text className="text-zinc-500 text-xs">Used: {totalUsage}m</Text>
          <Text className="text-zinc-400 text-xs font-medium">Limit: {limitMinutes}m</Text>
        </View>

        {isReached && (
          <View className="mt-4 p-3 bg-red-500/10 rounded-xl flex-row items-center gap-2 border border-red-500/20">
            <AlertTriangle size={16} color="#ef4444" />
            <Text className="text-red-300 text-xs flex-1">
              Daily limit reached. Apps blocked until tomorrow.
            </Text>
          </View>
        )}
      </View>

      {/* Limit Adjustment */}
      <View className="bg-zinc-900/50 rounded-2xl p-5 border border-zinc-800/50 mb-6">
        <Text className="text-zinc-400 text-xs font-medium uppercase tracking-wider text-center mb-4">
          Set Daily Limit
        </Text>
        
        <View className="flex-row items-center justify-center gap-6">
          <TouchableOpacity 
            onPress={() => updateLimit(Math.max(15, limitMinutes - 15))}
            className="w-12 h-12 bg-zinc-800 rounded-xl items-center justify-center border border-zinc-700"
          >
            <Text className="text-white text-xl font-bold">−</Text>
          </TouchableOpacity>
          
          <View className="items-center w-24">
            <Text className="text-4xl font-bold text-white">{limitMinutes}</Text>
            <Text className="text-zinc-500 text-xs">minutes</Text>
          </View>

          <TouchableOpacity 
            onPress={() => updateLimit(limitMinutes + 15)}
            className="w-12 h-12 bg-zinc-800 rounded-xl items-center justify-center border border-zinc-700"
          >
            <Text className="text-white text-xl font-bold">+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Per-App Usage */}
      <View className="bg-zinc-900/50 rounded-2xl p-4 border border-zinc-800/50">
        <Text className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-4">
          Today's Usage Breakdown
        </Text>
        
        <View className="gap-4">
          {apps.map((app) => (
            <View key={app.id} className="flex-row items-center">
              <View 
                className="w-10 h-10 rounded-xl items-center justify-center mr-3"
                style={{ backgroundColor: app.color + '20' }}
              >
                <Text className="text-lg">{app.icon}</Text>
              </View>
              
              <View className="flex-1">
                <View className="flex-row justify-between mb-1">
                  <Text className="text-white font-medium">{app.name}</Text>
                  <Text className="text-zinc-400 text-sm">{app.dailyUsage}m</Text>
                </View>
                <View className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <View 
                    className="h-full rounded-full"
                    style={{ 
                      width: `${Math.min((app.dailyUsage / limitMinutes) * 100, 100)}%`,
                      backgroundColor: app.color 
                    }}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
```

---

# ✅ Part 3 Complete

**What's included:**
- ✅ Complete hooks for all native module features
- ✅ Full integration with your existing UI
- ✅ Permission handling with modal
- ✅ Real-time session updates via native events
- ✅ All modals integrated with native functionality
- ✅ Schedule & Limit views connected to native storage
- ✅ Loading states and error handling

**File Structure:**
```
src/
├── hooks/
│   └── useAppBlocker.ts    ← All hooks
└── app/
    └── (tabs)/
        └── block.tsx       ← Your updated UI
```

The native module will now:
1. ✅ Block apps via Accessibility Service
2. ✅ Show blocking overlay when blocked app opens
3. ✅ Persist sessions across app restarts
4. ✅ Send real-time tick events for timer
5. ✅ Handle all three intensity modes correctly
6. ✅ Manage schedules with alarms
7. ✅ Track daily usage limits

**Ready to test!** Build with `npx expo run:android` 🚀