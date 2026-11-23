import type { Finding, FindingKind } from "./project/project.js";

const TEMPLATES: Record<FindingKind, string> = {
  privateOutsideOwner:
    "File is imported by a single owner but sits outside that owner's folder; move it into '{{destination}}'.",
  sharedTooHigh:
    "File is imported by multiple owners but sits above their common ancestor directory; move it into '{{destination}}'.",
  sharedInsideOwner:
    "File is imported by multiple owners but sits inside a single owner's folder; move it into '{{destination}}'.",
  singletonFolder:
    "Directory contains a single source file with no companion CSS; colocate or flatten the file into '{{destination}}'.",
  namedDoorReexport:
    "Named door '{{door}}' re-exports '{{target}}'; use an index.ts in the same folder for a multi-file public surface, or export only what this file declares.",
  reachesPastEntry:
    "'{{target}}' is inside module '{{module}}'; import it through '{{entry}}', or move it out of '{{module}}' if it is not part of it.",
};

const STANDALONE_OWNER_TEMPLATE =
  "File is imported only by the standalone file '{{owner}}'; move both files into a new folder '{{destination}}' so the owner becomes its entry.";

function templateFor(finding: Finding): string {
  if (finding.kind === "privateOutsideOwner" && "owner" in finding.data) {
    return STANDALONE_OWNER_TEMPLATE;
  }
  return TEMPLATES[finding.kind];
}

export function formatMessage(finding: Finding): string {
  return templateFor(finding).replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => finding.data[key] ?? "",
  );
}
