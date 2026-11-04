import { api } from "@/shared/lib/api";
import type { GoalSettings, GoalsProgress, Projection } from "./types";

export const goalsApi = {
  settings: () => api.get<GoalSettings>("/goals/settings"),
  saveSettings: (input: GoalSettings) => api.put<GoalSettings>("/goals/settings", input),
  progress: () => api.get<GoalsProgress>("/goals/progress"),
  projection: () => api.get<Projection>("/goals/projection"),
};
