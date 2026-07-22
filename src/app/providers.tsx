import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { runtimeConfig } from "../config/runtime";
import { apiClient } from "../services/apiClient";
import { getErrorMessage } from "../services/api/errors";
import type {
  Alarm,
  AlarmFilter,
  AuditEvent,
  LimitMap,
  Oven,
  OvenUpdateInput,
} from "../types";

type AppDataContextValue = {
  ovens: Oven[];
  alarms: Alarm[];
  auditEvents: AuditEvent[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastSuccessfulSyncAt: string | null;
  refresh: () => Promise<void>;
  saveLimits: (ovenId: string, limits: LimitMap) => Promise<void>;
  updateOven: (ovenId: string, input: OvenUpdateInput) => Promise<void>;
  addOven: () => Promise<Oven>;
  loadAlarms: (filter?: AlarmFilter) => Promise<void>;
  acknowledgeAlarm: (alarmId: string) => Promise<void>;
};

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [ovens, setOvens] = useState<Oven[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const realtimeRequestRef = useRef<Promise<void> | null>(null);
  const alarmRequestRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const markSuccess = useCallback(() => {
    if (!mountedRef.current) return;
    setError(null);
    setLastSuccessfulSyncAt(new Date().toISOString());
  }, []);

  const loadInitialData = useCallback(async (showLoading = false) => {
    if (mountedRef.current && showLoading) setLoading(true);
    try {
      const [nextOvens, nextAlarms, nextAuditEvents] = await Promise.all([
        apiClient.getOvens(),
        apiClient.getAlarms(),
        apiClient.getAuditEvents(),
      ]);
      if (!mountedRef.current) return;
      setOvens(nextOvens);
      setAlarms(nextAlarms);
      setAuditEvents(nextAuditEvents);
      markSuccess();
    } catch (nextError) {
      if (mountedRef.current) setError(getErrorMessage(nextError));
    } finally {
      if (mountedRef.current && showLoading) setLoading(false);
    }
  }, [markSuccess]);

  // Poll the realtime oven endpoint every second.
  const syncRealtime = useCallback((): Promise<void> => {
    if (realtimeRequestRef.current) return realtimeRequestRef.current;

    const request = (async () => {
      try {
        const nextOvens = await apiClient.getRealtimeOvens();
        if (!mountedRef.current) return;
        setOvens(nextOvens);
        markSuccess();
      } catch (nextError) {
        if (mountedRef.current) setError(getErrorMessage(nextError));
      } finally {
        realtimeRequestRef.current = null;
      }
    })();

    realtimeRequestRef.current = request;
    return request;
  }, [markSuccess]);

  // Alarms do not need one-second polling; keep their database load lower.
  const syncAlarms = useCallback((): Promise<void> => {
    if (alarmRequestRef.current) return alarmRequestRef.current;

    const request = (async () => {
      try {
        const nextAlarms = await apiClient.getAlarms();
        if (!mountedRef.current) return;
        setAlarms(nextAlarms);
      } catch (nextError) {
        if (mountedRef.current) setError(getErrorMessage(nextError));
      } finally {
        alarmRequestRef.current = null;
      }
    })();

    alarmRequestRef.current = request;
    return request;
  }, []);

  const refresh = useCallback(async () => {
    if (mountedRef.current) setRefreshing(true);
    try {
      await Promise.all([syncRealtime(), syncAlarms()]);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [syncAlarms, syncRealtime]);

  useEffect(() => {
    void loadInitialData(true);
  }, [loadInitialData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncRealtime();
    }, runtimeConfig.pollIntervalMs);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void syncRealtime();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [syncRealtime]);

  useEffect(() => {
    const alarmIntervalMs = Math.max(15_000, runtimeConfig.pollIntervalMs);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncAlarms();
    }, alarmIntervalMs);
    return () => window.clearInterval(timer);
  }, [syncAlarms]);

  const saveLimits = useCallback(
    async (ovenId: string, limits: LimitMap) => {
      const updated = await apiClient.saveLimits(ovenId, limits);
      setOvens((current) =>
        current.map((oven) => (oven.id === ovenId ? updated : oven)),
      );
      await loadInitialData();
    },
    [loadInitialData],
  );

  const updateOven = useCallback(
    async (ovenId: string, input: OvenUpdateInput) => {
      const updated = await apiClient.updateOven(ovenId, input);
      setOvens((current) =>
        current.map((oven) => (oven.id === ovenId ? updated : oven)),
      );
      await loadInitialData();
    },
    [loadInitialData],
  );

  const addOven = useCallback(async () => {
    const oven = await apiClient.addOven();
    await loadInitialData();
    return oven;
  }, [loadInitialData]);

  const loadAlarms = useCallback(async (filter?: AlarmFilter) => {
    try {
      setAlarms(await apiClient.getAlarms(filter));
      markSuccess();
    } catch (nextError) {
      if (mountedRef.current) setError(getErrorMessage(nextError));
    }
  }, [markSuccess]);

  const acknowledgeAlarm = useCallback(
    async (alarmId: string) => {
      setAlarms(await apiClient.acknowledgeAlarm(alarmId));
      await loadInitialData();
    },
    [loadInitialData],
  );

  const value = useMemo<AppDataContextValue>(
    () => ({
      ovens,
      alarms,
      auditEvents,
      loading,
      refreshing,
      error,
      lastSuccessfulSyncAt,
      refresh,
      saveLimits,
      updateOven,
      addOven,
      loadAlarms,
      acknowledgeAlarm,
    }),
    [
      addOven,
      acknowledgeAlarm,
      alarms,
      auditEvents,
      error,
      lastSuccessfulSyncAt,
      loadAlarms,
      loading,
      ovens,
      refresh,
      refreshing,
      saveLimits,
      updateOven,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used inside AppDataProvider");
  return value;
}
