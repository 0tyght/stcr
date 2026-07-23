import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";

import { runtimeConfig } from "../config/runtime";
import { apiClient } from "../services/apiClient";
import type {
  OvenCreateInput,
  OvenDeleteCheck,
} from "../services/api/contracts";
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
  saveLimits: (ovenId: string, limits: LimitMap) => Promise<Oven>;
  updateOven: (ovenId: string, input: OvenUpdateInput) => Promise<Oven>;
  addOven: (input: OvenCreateInput) => Promise<Oven>;
  getOvenDeleteCheck: (ovenId: string) => Promise<OvenDeleteCheck>;
  deleteOven: (ovenId: string) => Promise<void>;
  loadAlarms: (filter?: AlarmFilter) => Promise<void>;
  acknowledgeAlarm: (alarmId: string) => Promise<void>;
};

const AppDataContext = createContext<AppDataContextValue | undefined>(
  undefined,
);

function replaceOven(current: Oven[], updated: Oven): Oven[] {
  return current.map((oven) => (oven.id === updated.id ? updated : oven));
}

export function AppDataProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { pathname } = useLocation();
  const pauseBackgroundPolling = pathname.startsWith("/reports");

  const [ovens, setOvens] = useState<Oven[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [alarmError, setAlarmError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<
    string | null
  >(null);

  const mountedRef = useRef(true);
  const realtimeSequenceRef = useRef(0);
  const alarmSequenceRef = useRef(0);
  const initialSequenceRef = useRef(0);
  const realtimeRequestRef = useRef<Promise<void> | null>(null);
  const alarmRequestRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      realtimeSequenceRef.current += 1;
      alarmSequenceRef.current += 1;
      initialSequenceRef.current += 1;
    };
  }, []);

  const markRealtimeSuccess = useCallback(() => {
    if (!mountedRef.current) return;

    setRealtimeError(null);
    setLastSuccessfulSyncAt(new Date().toISOString());
  }, []);

  const loadAuditEvents = useCallback(async () => {
    try {
      const nextAuditEvents = await apiClient.getAuditEvents();
      if (!mountedRef.current) return;

      setAuditEvents(nextAuditEvents);
      setAuditError(null);
    } catch (nextError) {
      if (mountedRef.current) {
        setAuditError(getErrorMessage(nextError));
      }
    }
  }, []);

  const loadInitialData = useCallback(
    async (showLoading = false) => {
      const sequence = ++initialSequenceRef.current;

      if (mountedRef.current && showLoading) {
        setLoading(true);
      }

      try {
        const [nextOvens, nextAlarms, nextAuditEvents] = await Promise.all([
          apiClient.getOvens(),
          apiClient.getAlarms(),
          apiClient.getAuditEvents(),
        ]);

        if (
          !mountedRef.current ||
          sequence !== initialSequenceRef.current
        ) {
          return;
        }

        setOvens(nextOvens);
        setAlarms(nextAlarms);
        setAuditEvents(nextAuditEvents);
        setRealtimeError(null);
        setAlarmError(null);
        setAuditError(null);
        setLastSuccessfulSyncAt(new Date().toISOString());
      } catch (nextError) {
        if (
          mountedRef.current &&
          sequence === initialSequenceRef.current
        ) {
          setRealtimeError(getErrorMessage(nextError));
        }
      } finally {
        if (
          mountedRef.current &&
          showLoading &&
          sequence === initialSequenceRef.current
        ) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const syncRealtime = useCallback((): Promise<void> => {
    if (realtimeRequestRef.current) {
      return realtimeRequestRef.current;
    }

    const sequence = ++realtimeSequenceRef.current;

    const request = (async () => {
      try {
        const nextOvens = await apiClient.getRealtimeOvens();

        if (
          !mountedRef.current ||
          sequence !== realtimeSequenceRef.current
        ) {
          return;
        }

        setOvens(nextOvens);
        markRealtimeSuccess();
      } catch (nextError) {
        if (
          mountedRef.current &&
          sequence === realtimeSequenceRef.current
        ) {
          setRealtimeError(getErrorMessage(nextError));
        }
      } finally {
        realtimeRequestRef.current = null;
      }
    })();

    realtimeRequestRef.current = request;
    return request;
  }, [markRealtimeSuccess]);

  const syncAlarms = useCallback((): Promise<void> => {
    if (alarmRequestRef.current) {
      return alarmRequestRef.current;
    }

    const sequence = ++alarmSequenceRef.current;

    const request = (async () => {
      try {
        const nextAlarms = await apiClient.getAlarms();

        if (
          !mountedRef.current ||
          sequence !== alarmSequenceRef.current
        ) {
          return;
        }

        setAlarms(nextAlarms);
        setAlarmError(null);
      } catch (nextError) {
        if (
          mountedRef.current &&
          sequence === alarmSequenceRef.current
        ) {
          setAlarmError(getErrorMessage(nextError));
        }
      } finally {
        alarmRequestRef.current = null;
      }
    })();

    alarmRequestRef.current = request;
    return request;
  }, []);

  const refresh = useCallback(async () => {
    if (mountedRef.current) {
      setRefreshing(true);
    }

    try {
      await Promise.all([syncRealtime(), syncAlarms()]);
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [syncAlarms, syncRealtime]);

  useEffect(() => {
    void loadInitialData(true);
  }, [loadInitialData]);

  useEffect(() => {
    if (pauseBackgroundPolling) return;

    void syncRealtime();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void syncRealtime();
      }
    }, runtimeConfig.pollIntervalMs);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void syncRealtime();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pauseBackgroundPolling, syncRealtime]);

  useEffect(() => {
    if (pauseBackgroundPolling) return;

    void syncAlarms();

    const alarmIntervalMs = Math.max(
      15_000,
      runtimeConfig.pollIntervalMs,
    );

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void syncAlarms();
      }
    }, alarmIntervalMs);

    return () => window.clearInterval(timer);
  }, [pauseBackgroundPolling, syncAlarms]);

  const saveLimits = useCallback(
    async (ovenId: string, limits: LimitMap) => {
      const updated = await apiClient.saveLimits(ovenId, limits);

      if (mountedRef.current) {
        setOvens((current) => replaceOven(current, updated));
      }

      void loadAuditEvents();
      return updated;
    },
    [loadAuditEvents],
  );

  const updateOven = useCallback(
    async (ovenId: string, input: OvenUpdateInput) => {
      const updated = await apiClient.updateOven(ovenId, input);

      if (mountedRef.current) {
        setOvens((current) => replaceOven(current, updated));
      }

      void loadAuditEvents();
      return updated;
    },
    [loadAuditEvents],
  );

  const addOven = useCallback(
    async (input: OvenCreateInput) => {
      const created = await apiClient.addOven(input);

      if (mountedRef.current) {
        setOvens((current) =>
          [...current, created].sort((left, right) => left.number - right.number),
        );
      }

      void loadAuditEvents();
      return created;
    },
    [loadAuditEvents],
  );

  const getOvenDeleteCheck = useCallback((ovenId: string) => {
    return apiClient.getOvenDeleteCheck(ovenId);
  }, []);

  const deleteOven = useCallback(
    async (ovenId: string) => {
      await apiClient.deleteOven(ovenId);

      if (mountedRef.current) {
        setOvens((current) =>
          current.filter((oven) => oven.id !== ovenId),
        );
      }

      void loadAuditEvents();
    },
    [loadAuditEvents],
  );

  const loadAlarms = useCallback(async (filter?: AlarmFilter) => {
    const sequence = ++alarmSequenceRef.current;

    try {
      const nextAlarms = await apiClient.getAlarms(filter);

      if (
        !mountedRef.current ||
        sequence !== alarmSequenceRef.current
      ) {
        return;
      }

      setAlarms(nextAlarms);
      setAlarmError(null);
    } catch (nextError) {
      if (
        mountedRef.current &&
        sequence === alarmSequenceRef.current
      ) {
        setAlarmError(getErrorMessage(nextError));
      }

      throw nextError;
    }
  }, []);

  const acknowledgeAlarm = useCallback(async (alarmId: string) => {
    const nextAlarms = await apiClient.acknowledgeAlarm(alarmId);

    if (mountedRef.current) {
      setAlarms(nextAlarms);
    }
  }, []);

  const error = realtimeError ?? alarmError ?? auditError;

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
      getOvenDeleteCheck,
      deleteOven,
      loadAlarms,
      acknowledgeAlarm,
    }),
    [
      acknowledgeAlarm,
      addOven,
      alarms,
      auditEvents,
      deleteOven,
      error,
      getOvenDeleteCheck,
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

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext);

  if (!value) {
    throw new Error("useAppData must be used inside AppDataProvider");
  }

  return value;
}
