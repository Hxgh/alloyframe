import { io } from "next/cache";
import { archiveProject, getProject, getStoreWritable, renameProject, restoreProject, saveProject } from "@/lib/project-store";
import { assertWriteRequest, canWriteRequest, projectErrorResponse, projectJson, readProjectJson, SaveProjectRequestSchema, UpdateProjectRequestSchema } from "@/lib/project-http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await io();
  try {
    const { id } = await context.params;
    const archived = new URL(request.url).searchParams.get("archived") === "true";
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
