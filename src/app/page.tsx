import { loadWorkspace } from "@/lib/data";
import { Workspace } from "@/components/Workspace";

export default function Home() {
  const { design, catalog, accessories } = loadWorkspace("standing-desk");

  return (
    <Workspace
      design={design}
      catalog={catalog}
      accessoryCatalog={accessories}
    />
  );
}
