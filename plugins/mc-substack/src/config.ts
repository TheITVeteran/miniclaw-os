export interface SubstackConfig {
  subdomain: string;
  vaultBin: string;
}

export function resolveConfig(raw: Record<string, unknown>): SubstackConfig {
  return {
    subdomain: (raw.subdomain as string) || "augmentedmike",
    vaultBin: (raw.vaultBin as string) || `${process.env.HOME}/am/miniclaw/system/bin/miniclaw-vault`,
  };
}
