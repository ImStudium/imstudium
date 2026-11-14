/**
 * keytar, loaded so that all of it arrives.
 *
 * keytar is CommonJS and exports `module.exports = { getPassword: function … }`.
 * Node's ESM loader guesses named exports with cjs-module-lexer, which stops at
 * the first function value: `await import("keytar")` exposes `getPassword` as a
 * named export and nothing else. Reading worked, `setPassword` was undefined,
 * and every session fell through to the plain 0600 file on any OS and Node
 * version. The whole API is on `default`.
 */

export interface Keytar {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/** The keytar API from whatever `import("keytar")` returned, or null if it is incomplete. */
export function keytarApi(mod: unknown): Keytar | null {
  const m = mod as { default?: unknown } | null | undefined;
  for (const candidate of [m?.default, m]) {
    const k = candidate as Partial<Keytar> | null | undefined;
    if (k && typeof k.getPassword === "function" && typeof k.setPassword === "function" && typeof k.deletePassword === "function") return k as Keytar;
  }
  return null;
}

/** keytar, or null when it isn't installed or its native module doesn't load. */
export async function loadKeytar(): Promise<Keytar | null> {
  try {
    return keytarApi(await import("keytar"));
  } catch {
    return null;
  }
}
