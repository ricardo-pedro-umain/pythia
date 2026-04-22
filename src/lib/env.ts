// Central env config. Validate required secrets once, up front, and fail
// loudly with a readable message instead of letting downstream code explode
// with `Cannot read properties of undefined` when an API call fires.
//
// Import `env` anywhere you previously reached for `process.env.*` directly —
// that way adding a new required var is a single-location change and typos
// like TAVILY_API_KY become TypeScript errors instead of silent nulls.

const REQUIRED_KEYS = ["TAVILY_API_KEY"] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

function loadEnv(): Record<RequiredKey, string> {
  const missing: string[] = [];
  const values = {} as Record<RequiredKey, string>;

  for (const key of REQUIRED_KEYS) {
    const v = process.env[key];
    if (!v || v.trim() === "") {
      missing.push(key);
    } else {
      values[key] = v;
    }
  }

  if (missing.length > 0) {
    // Build-time and test environments may legitimately not have these set;
    // only throw when code actually tries to USE a missing var (see the
    // Proxy below). Collecting the miss-list here is still useful for the
    // error message when it fires.
  }

  return values;
}

const loaded = loadEnv();

/**
 * Lazily-validated environment variables. Accessing a missing key throws a
 * descriptive error at the call site, rather than at module load — this
 * keeps `next build` working even when build-time doesn't have production
 * secrets, while still catching missing vars at first actual use.
 */
export const env = new Proxy(loaded, {
  get(target, prop: string) {
    if (!REQUIRED_KEYS.includes(prop as RequiredKey)) {
      throw new Error(`env: unknown key "${prop}"`);
    }
    const v = target[prop as RequiredKey];
    if (!v) {
      throw new Error(
        `env: missing required environment variable "${prop}". ` +
          `Set it in .env.local or your deployment environment.`
      );
    }
    return v;
  },
}) as Record<RequiredKey, string>;
