import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who the current code is acting for. Every per-user query filters on this.
 *
 * - Background work (scheduler, Telegram webhook) runs inside `withUser(id, fn)`.
 * - Web requests resolve the signed-in user from the session cookie through a resolver
 *   that the Next.js side registers (see auth.ts), so pages and actions need no wrapping.
 * - With neither, `uid()` throws: data is never read or written without an owner.
 */

// Kept on globalThis so every bundle that includes this module (pages, route handlers,
// server actions) shares one store and one resolver.
const g = globalThis as unknown as {
  __pfUserStore?: AsyncLocalStorage<{ userId: string }>;
  __pfUserResolver?: (() => Promise<string | null>) | null;
};
const store = (g.__pfUserStore ??= new AsyncLocalStorage<{ userId: string }>());

export class NoUserError extends Error {
  constructor() {
    super("Not signed in.");
  }
}

export function withUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ userId }, fn);
}

export function setRequestUserResolver(fn: (() => Promise<string | null>) | null) {
  g.__pfUserResolver = fn;
}

/** The current user's id, or null when there is none. */
export async function currentUserId(): Promise<string | null> {
  const fromStore = store.getStore()?.userId;
  if (fromStore) return fromStore;
  const resolver = g.__pfUserResolver;
  if (!resolver) return null;
  try {
    return await resolver();
  } catch {
    // Outside a request (no cookies available): there is no signed-in user.
    return null;
  }
}

/** The current user's id. Throws when nobody is signed in. */
export async function uid(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new NoUserError();
  return id;
}
