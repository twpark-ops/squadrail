import type { GoalLevel, GoalStatus } from "../constants.js";

export interface Goal {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  progressPercent: number;
  targetDate: Date | null;
  sprintName: string | null;
  capacityTargetPoints: number | null;
  capacityCommittedPoints: number | null;
  parentId: string | null;
  ownerAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
