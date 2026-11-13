import { io } from "next/cache";
import { copyProject, createProject, getProjectLibrary, getStoreWritable, importProject } from "@/lib/project-store";
import { assertWriteRequest, canWriteRequest, CreateProjectRequestSchema, projectErrorResponse, projectJson, readProjectJson } from "@/lib/project-http";

export async function GET(request: Request) {
  await io();
  try {
    const library = await getProjectLibrary();
    return projectJson({ ...library, writable: getStoreWritable() && canWriteRequest(request) });
  } catch (error) { return projectErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertWriteRequest(request);
    const body = CreateProjectRequestSchema.parse(await readProjectJson(request));
    switch (body.action) {
      case "create": return projectJson(await createProject(body.name, body.templateId), 201);
      case "import": return projectJson(await importProject(body.design, body.name), 201);
      case "copy": return projectJson(await copyProject(body.id, body.name, body.fingerprint), 201);
    }
  } catch (error) { return projectErrorResponse(error); }
}
