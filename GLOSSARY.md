# Colocate

Checks that a project's file layout follows its import graph: files live with the code that depends on them, and modules are entered through their entry file.

## Language

**Rule**:
One of the named layout policies a project can enable: `ownership` or `entry`.
_Avoid_: Check, lint

**Finding**:
One violation of a Rule in one file, with its kind and, when it points at specific code, a location in that file.
_Avoid_: Crossing, issue, report, error

**Baseline**:
The recorded set of Findings a project has accepted for now; only Findings outside it fail a run.
_Avoid_: Allowlist, snapshot, suppressions
