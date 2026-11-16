import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema } from "../lib/schema";

for (const [path, schema] of [
  ["../../data/design.schema.json", DesignSchema],
  ["../../data/catalog/profiles.schema.json", CatalogSchema],
  ["../../data/catalog/accessories.schema.json", AccessoryCatalogSchema],
] as const) {
  const editorSchema = z.toJSONSchema(schema);
  if (schema !== DesignSchema) editorSchema.properties!.$schema = { type: "string" };
  await writeFile(new URL(path, import.meta.url), `${JSON.stringify(editorSchema, null, 2)}\n`);
}
