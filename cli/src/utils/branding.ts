export const PRODUCT_NAME = "Squadrail";
export const PRIMARY_CLI_COMMAND = "squadrail";
export const PRIMARY_HOME_DIRNAME = ".squadrail";

export function formatCliCommand(command: string): string {
  return `${PRIMARY_CLI_COMMAND} ${command}`.trim();
}

export function formatPnpmCliCommand(command: string): string {
  return `pnpm ${formatCliCommand(command)}`.trim();
}

export function squadrailDataDirHelpText(): string {
  return `${PRODUCT_NAME} data directory root (isolates state from ~/${PRIMARY_HOME_DIRNAME.slice(1)})`;
}
