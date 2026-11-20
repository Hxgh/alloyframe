import { io } from "next/cache";
import { archiveProject, getProject, getRawProject, getStoreWritable, renameProject, restoreProject, saveProject } from "@/lib/project-store";
import { assertWriteRequest, canWriteRequest, projectErrorResponse, projectJson, readProjectJson, SaveProjectRequestSchema, UpdateProjectRequestSchema } from "@/lib/project-http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await io();
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const archived = url.searchParams.get("archived") === "true";
    // ?raw=true 返回原文与校验问题（不要求有效），供无效项目的修复界面使用。
    if (url.searchParams.get("raw") === "true") {
      return projectJson({ raw: await getRawProject(id, archived), writable: getStoreWritable() && canWriteRequest(request) });
    }
    return projectJson({ project: await getProject(id, archived), writable: getStoreWritable() && canWriteRequest(request) });
  } catch (error) { return projectErrorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertWriteRequest(request);
    const { id } = await context.params;
    const body = SaveProjectRequestSchema.parse(await readProjectJson(request));
    return projectJson(await saveProject(id, body.design, body.fingerprint));
  } catch (error) { return projectErrorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertWriteRequest(request);
    const { id } = await context.params;
    const body = UpdateProjectRequestSchema.parse(await readProjectJson(request));
    switch (body.action) {
      case "rename": return projectJson(await renameProject(id, body.name, body.fingerprint));
      case "archive": await archiveProject(id, body.fingerprint); return projectJson({ id });
      case "restore": await restoreProject(id, body.fingerprint); return projectJson({ id });
    }
  } catch (error) { return projectErrorResponse(error); }
}
