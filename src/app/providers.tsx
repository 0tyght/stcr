import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiClient } from "../services/apiClient";
import type { Alarm, AlarmFilter, AuditEvent, LimitMap, Oven, OvenUpdateInput } from "../types";

type AppDataContextValue = {
  ovens: Oven[];
  alarms: Alarm[];
  auditEvents: AuditEvent[];
  loading: boolean;
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

  const refresh = useCallback(async () => {
    const [nextOvens, nextAlarms, nextAuditEvents] = await Promise.all([
      apiClient.getOvens(),
      apiClient.getAlarms(),
      apiClient.getAuditEvents(),
    ]);
    setOvens(nextOvens);
    setAlarms(nextAlarms);
    setAuditEvents(nextAuditEvents);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const nextOvens = await apiClient.advanceRealtime();
      const nextAlarms = await apiClient.getAlarms();
      setOvens(nextOvens);
      setAlarms(nextAlarms);
    }, 7000);

    return () => window.clearInterval(timer);
  }, []);

  const saveLimits = useCallback(
    async (ovenId: string, limits: LimitMap) => {
      const updated = await apiClient.saveLimits(ovenId, limits);
      setOvens((current) => current.map((oven) => (oven.id === ovenId ? updated : oven)));
      await refresh();
    },
    [refresh],
  );

  const updateOven = useCallback(
    async (ovenId: string, input: OvenUpdateInput) => {
      const updated = await apiClient.updateOven(ovenId, input);
      setOvens((current) => current.map((oven) => (oven.id === ovenId ? updated : oven)));
      await refresh();
    },
    [refresh],
  );

  const addOven = useCallback(async () => {
    const oven = await apiClient.addOven();
    await refresh();
    return oven;
  }, [refresh]);

  const loadAlarms = useCallback(async (filter?: AlarmFilter) => {
    setAlarms(await apiClient.getAlarms(filter));
  }, []);

  const acknowledgeAlarm = useCallback(
    async (alarmId: string) => {
      setAlarms(await apiClient.acknowledgeAlarm(alarmId));
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<AppDataContextValue>(
    () => ({
      ovens,
      alarms,
      auditEvents,
      loading,
      refresh,
      saveLimits,
      updateOven,
      addOven,
      loadAlarms,
      acknowledgeAlarm,
    }),
    [addOven, acknowledgeAlarm, alarms, auditEvents, loadAlarms, loading, ovens, refresh, saveLimits, updateOven],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext);
  if (!value) {
    throw new Error("useAppData must be used inside AppDataProvider");
  }
  return value;
}
