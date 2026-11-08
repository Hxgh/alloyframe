export function getProjectEnv(suffix: "DATA_DIR" | "READ_ONLY" | "TRUSTED_ORIGINS"): string | undefined {
  return process.env[`ALLOYFRAME_${suffix}`] ?? process.env[`SUNMAO_${suffix}`];
}
