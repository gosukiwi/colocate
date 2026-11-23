import type { Finding, MessageId } from "./project/project.js";

const TEMPLATES: Record<MessageId, string> = {
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
  privateOutsideStandaloneOwner:
    "File is imported only by the standalone file '{{owner}}'; move '{{moving}}' and '{{owner}}' into the folder '{{destination}}' so the owner becomes its entry.",
  privateOutsideStandaloneOwnerOnly:
    "File is imported only by the standalone file '{{owner}}' beside its folder; move '{{owner}}' into '{{destination}}' so it becomes the folder's entry.",
  reachesPastEntry:
    "'{{target}}' is inside module '{{module}}'; import it through '{{entry}}', or move it out of '{{module}}' if it is not part of it.",
};

export function formatMessage(finding: Finding): string {
  return TEMPLATES[finding.messageId].replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => finding.data[key] ?? "",
  );
}
