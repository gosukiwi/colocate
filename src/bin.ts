#!/usr/bin/env node
import { run } from "./cli/run.js";

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
