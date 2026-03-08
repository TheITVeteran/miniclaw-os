import { execSync } from "node:child_process";

export function readCookieFromVault(vaultBin: string): string | null {
  try {
    const out = execSync(`${vaultBin} get substack-sid`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function saveCookieToVault(vaultBin: string, sid: string): void {
  execSync(`${vaultBin} set substack-sid "${sid}"`, { stdio: "inherit" });
}
