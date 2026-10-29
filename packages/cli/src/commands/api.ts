import type { Command } from "commander";
import {
  flattenAll,
  groupRoutes,
  ImstudiumError,
  loadRouteCatalog,
  matchRoute,
  searchRoutes,
  type JsonApiQuery,
} from "@imstudium/sdk";
import { act, getSdk, globalOpts, output, type Sdk } from "../runtime.js";
import { optionalLimit } from "../kit/args.js";
import { meId } from "../me.js";

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parsePairs(pairs: string[] | undefined, flag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new ImstudiumError(`--${flag} expects key=value, got "${pair}"`, "BAD_ARGS");
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

/** /users/me/… and {me} expand to your user id so any per-user route works directly. */
async function expandMe(sdk: Sdk, path: string): Promise<string> {
  if (!/\/users\/me\/|\{me\}/.test(path)) return path;
  const id = await meId(sdk);
  return path.replace(/\/users\/me\//, `/users/${id}/`).replace(/\{me\}/g, id);
}

export function registerApi(program: Command): void {
  program
    .command("routes")
    .description("Every JSON:API route this Stud.IP offers (cached from /discovery)")
    .argument("[query]", "Filter by substring, e.g. forum, courseware, users")
    .option("--method <method>", "Only routes with this HTTP method", "GET")
    .option("--all-methods", "Include POST/PATCH/DELETE routes")
    .option("--refresh", "Fetch the catalog again")
    .action(
      act(async (query: string | undefined, opts: { method: string; allMethods?: boolean; refresh?: boolean }) => {
        const sdk = await getSdk();
        const catalog = await loadRouteCatalog(sdk.config.instanceOrigin, { refresh: opts.refresh });
        if (!catalog) {
          throw new ImstudiumError("Could not load the route catalog", "ROUTE_NOT_FOUND", undefined, "Check your connection");
        }
        const routes = searchRoutes(catalog, query, opts.allMethods ? undefined : opts.method);
        const groups = groupRoutes(routes);
        const lines = [
          `Stud.IP ${catalog.studipVersion ?? "?"} · ${routes.length}/${catalog.routes.length} routes · ${new URL(catalog.origin).host}`,
          "",
          ...Object.entries(groups).flatMap(([group, rs]) => [
            `${group}`,
            ...rs.map((r) => `  ${r.methods.join(",").padEnd(opts.allMethods ? 18 : 4)} ${r.pattern}`),
          ]),
          "",
          "Call any GET route: imstudium api /courses/<id>/news --flat",
        ];
        output({ studipVersion: catalog.studipVersion, fetchedAt: catalog.fetchedAt, count: routes.length, routes }, lines.join("\n"));
      }),
    );

  program
    .command("api")
    .description("Call any Stud.IP JSON:API route — the escape hatch for agents")
    .argument("<path>", "Route path, e.g. /users/me/courses or /courses/<id>/forum-categories")
    .option("-i, --include <rels>", "JSON:API include, comma-separated")
    .option("-f, --filter <key=value>", "filter[key]=value (repeatable)", collect)
    .option("--fields <type=a,b>", "Sparse fieldset (repeatable)", collect)
    .option("-p, --param <key=value>", "Raw query parameter (repeatable)", collect)
    .option("-n, --limit <n>", "Page size / max items")
    .option("--all", "Follow pagination to the end")
    .option("--flat", "Flatten resources: attributes up front, relationships as ids")
    .option("-X, --method <method>", "HTTP method (non-GET needs --write)", "GET")
    .option("-d, --data <json>", "Request body for POST/PATCH")
    .option("--write", "Allow a request that changes data in Stud.IP")
    .action(
      act(
        async (
          rawPath: string,
          opts: {
            include?: string;
            filter?: string[];
            fields?: string[];
            param?: string[];
            limit?: string;
            all?: boolean;
            flat?: boolean;
            method: string;
            data?: string;
            write?: boolean;
          },
        ) => {
          const sdk = await getSdk();
          const method = opts.method.toUpperCase();
          const path = await expandMe(sdk, rawPath.startsWith("/") ? rawPath : `/${rawPath}`);

          const catalog = await loadRouteCatalog(sdk.config.instanceOrigin);
          const route = catalog ? matchRoute(catalog, path, method) : null;
          if (catalog && !route) {
            const near = searchRoutes(catalog, path.split("/").filter(Boolean)[0]).slice(0, 8);
            throw new ImstudiumError(
              `No ${method} route matches ${path}`,
              "ROUTE_NOT_FOUND",
              404,
              near.length ? `Close: ${near.map((r) => r.pattern).join("  ")}` : "Run imstudium routes",
            );
          }

          if (method !== "GET" && method !== "HEAD") {
            if (!opts.write) {
              throw new ImstudiumError(
                `${method} changes data in Stud.IP.`,
                "WRITE_NOT_ALLOWED",
                undefined,
                "Add --write if you really mean it. Agents: only on the student's explicit request.",
              );
            }
            const body = opts.data ? JSON.parse(opts.data) : undefined;
            const doc = await sdk.client.request(method, path, { body });
            output({ route: route?.pattern, method, ...doc });
            return;
          }

          const fields: Record<string, string> = {};
          for (const [type, list] of Object.entries(parsePairs(opts.fields, "fields"))) fields[type] = list;
          const query: JsonApiQuery = {
            ...parsePairs(opts.param, "param"),
            include: opts.include,
            filter: parsePairs(opts.filter, "filter"),
            fields: Object.keys(fields).length ? fields : undefined,
          };
          const limit = optionalLimit(opts.limit);

          if (opts.all) {
            const page = await sdk.client.paginate(path, { ...query, page: limit ? { limit: Math.min(limit, 100) } : undefined }, { max: limit });
            const data = opts.flat ? flattenAll(page.data) : page.data;
            const included = opts.flat ? flattenAll(page.included) : page.included;
            printDoc({ route: route?.pattern, count: page.data.length, total: page.total, data, included });
            return;
          }

          const doc = await sdk.client.get(path, { ...query, page: limit ? { limit } : undefined });
          if (opts.flat) {
            const list = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
            const flat = flattenAll(list);
            printDoc({
              route: route?.pattern,
              total: doc.meta?.page?.total,
              data: Array.isArray(doc.data) ? flat : flat[0] ?? null,
              included: flattenAll(doc.included ?? []),
              next: doc.links?.next ?? null,
            });
            return;
          }
          printDoc({ route: route?.pattern, ...doc });
        },
      ),
    );
}

/** api output is always JSON — it's for agents and jq. */
function printDoc(doc: Record<string, unknown>) {
  const clean = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
  if (globalOpts.json) output(clean);
  else console.log(JSON.stringify(clean, null, 2));
}
