// Preloaded by the CLI test harness (node --import): any network attempt fails
// loudly with a "[no-network]" line on stderr, so a test can prove a command stayed offline.
import net from "node:net";

const blocked = (what) => {
  process.stderr.write(`[no-network] blocked ${what}\n`);
  const err = new TypeError(`fetch failed (network blocked in tests: ${what})`);
  err.cause = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
  return err;
};

globalThis.fetch = async (input) => {
  throw blocked(typeof input === "string" ? input : String(input?.url ?? input));
};

const connect = net.connect;
net.connect = net.createConnection = function (...args) {
  const opts = args[0];
  if (opts && typeof opts === "object" && (opts.path || opts.port === undefined)) return connect.apply(this, args);
  throw blocked(`net.connect ${JSON.stringify(opts)}`);
};
