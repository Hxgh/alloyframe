import type { Design } from "./schema";

/** 客户端安全的数据契约，不依赖文件系统或服务端运行时。 */
export type ProjectRecord = {
  design: Design;
  fingerprint: string;
  updatedAt: string;
};

/**
 * 无效项目的原文读取结果：design 无法解析或校验失败时，
 * 仍须把文件原文与问题列表交回界面，供用户就地修复。
 */
export type RawProject = {
  /** 文件原文；无法解码为 UTF-8 时为空字符串。 */
  text: string;
  fingerprint: string;
  updatedAt: string;
  issues: ValidationIssue[];
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
