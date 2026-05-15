/**
 * Fakes that stand in for the Supabase client + the `requireUser` helper in
 * route-handler tests. The fakes are intentionally small: they return
 * canned shapes for the calls the routes actually make, so a failing test
 * surfaces a real bug instead of a mock-setup error.
 */
import { vi } from "vitest";

type RpcReturn = { data: unknown; error: null | { message: string } };
type RpcHandler = (args?: unknown) => RpcReturn;

export type FakeSupabase = {
  auth: {
    getUser: ReturnType<typeof vi.fn>;
  };
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
  __state: {
    rpc_handlers: Record<string, RpcHandler>;
    rpc_calls: { name: string; args: unknown }[];
    select_singles: Record<string, unknown>;
    select_lists: Record<string, unknown[]>;
    insert_returns: Record<string, unknown>;
    inserted: { table: string; row: unknown }[];
    updated: { table: string; row: unknown; eq?: [string, unknown] }[];
    signed_url: string;
  };
};

export function makeFakeSupabase(): FakeSupabase {
  const state: FakeSupabase["__state"] = {
    rpc_handlers: {},
    rpc_calls: [],
    select_singles: {},
    select_lists: {},
    insert_returns: {},
    inserted: [],
    updated: [],
    signed_url: "https://signed.example.com/track.mp3",
  };

  function from(table: string) {
    const builder: Record<string, unknown> = {
      _table: table,
      _filters: [] as [string, string, unknown][],
      _limit: undefined as number | undefined,
      _order: undefined as { col: string; ascending: boolean } | undefined,
    };
    builder.select = function _select() {
      return builder;
    };
    builder.eq = function _eq(col: string, val: unknown) {
      (builder._filters as [string, string, unknown][]).push(["eq", col, val]);
      return builder;
    };
    builder.lt = function _lt(col: string, val: unknown) {
      (builder._filters as [string, string, unknown][]).push(["lt", col, val]);
      return builder;
    };
    builder.in = function _in(col: string, vals: unknown[]) {
      (builder._filters as [string, string, unknown][]).push(["in", col, vals]);
      return builder;
    };
    builder.order = function _order(col: string, opts?: { ascending?: boolean }) {
      builder._order = { col, ascending: opts?.ascending ?? true };
      return builder;
    };
    builder.limit = function _limit(n: number) {
      builder._limit = n;
      return builder;
    };
    builder.single = function _single() {
      return Promise.resolve({
        data: state.select_singles[table] ?? null,
        error: state.select_singles[table] ? null : { message: "no row" },
      });
    };
    builder.maybeSingle = function _maybeSingle() {
      return Promise.resolve({
        data: state.select_singles[table] ?? null,
        error: null,
      });
    };
    builder.insert = function _insert(row: unknown) {
      state.inserted.push({ table, row });
      return {
        select() {
          return {
            single() {
              return Promise.resolve({
                data: state.insert_returns[table] ?? null,
                error: state.insert_returns[table] ? null : { message: "insert returned no row" },
              });
            },
          };
        },
      };
    };
    builder.update = function _update(row: unknown) {
      return {
        eq(col: string, val: unknown) {
          state.updated.push({ table, row, eq: [col, val] });
          return Promise.resolve({ data: null, error: null });
        },
      };
    };
    // Default thenable for list reads
    (builder as { then: (resolve: (v: unknown) => void) => void }).then = (
      resolve,
    ) => {
      resolve({ data: state.select_lists[table] ?? [], error: null });
    };
    return builder;
  }

  function rpc(name: string, args?: unknown) {
    state.rpc_calls.push({ name, args });
    const handler = state.rpc_handlers[name];
    return Promise.resolve(
      handler ? handler(args) : { data: null, error: { message: `no handler for ${name}` } },
    );
  }

  function storage_from(_bucket: string) {
    return {
      createSignedUrl: (_path: string, _ttl: number) =>
        Promise.resolve({ data: { signedUrl: state.signed_url }, error: null }),
    };
  }

  return {
    auth: { getUser: vi.fn() },
    from: vi.fn((table: string) => from(table)),
    rpc: vi.fn((name: string, args?: unknown) => rpc(name, args)),
    storage: { from: vi.fn((bucket: string) => storage_from(bucket)) },
    __state: state,
  };
}
