import pc from "picocolors";

export function printKimiStreamEvent(line: string, debug = false) {
  if (debug) {
    console.log(pc.dim(`[kimi] ${line}`));
    return;
  }
  console.log(line);
}
