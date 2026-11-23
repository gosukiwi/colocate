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

export function formatMessage(finding: Finding): string {
  return TEMPLATES[finding.kind].replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => finding.data[key] ?? "",
  );
}
