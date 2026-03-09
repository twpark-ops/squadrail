import pc from "picocolors";
import { PRIMARY_CLI_COMMAND } from "./branding.js";

const BANNER_TITLE = "SQUADRAIL";
const TAGLINE = "Autonomous squad orchestration with protocol-first guardrails";

export function printSquadrailCliBanner(): void {
  const lines = [
    "",
    pc.bold(pc.cyan(`  ${BANNER_TITLE}`)),
    pc.blue("  ───────────────────────────────────────────────────────"),
    pc.bold(pc.white(`  ${TAGLINE}`)),
    pc.dim(`  command: ${PRIMARY_CLI_COMMAND}`),
    "",
  ];

  console.log(lines.join("\n"));
}
