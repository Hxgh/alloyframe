import type { Design } from "./schema";

/** 客户端安全的数据契约，不依赖文件系统或服务端运行时。 */
export type ProjectRecord = {
  design: Design;
  fingerprint: string;
  updatedAt: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  revision: number;
  partCount: number;
  updatedAt: string;
  status: "valid" | "empty" | "invalid";
  error?: string;
  archived: boolean;
  fingerprint: string;
};

export type ProjectLibrary = {
  projects: ProjectSummary[];
  archived: ProjectSummary[];
  writable: boolean;
};

export type ValidationIssue = {
  level: "error" | "warning";
  path: string;
  partId?: string;
  message: string;
};
