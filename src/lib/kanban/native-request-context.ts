import { AsyncLocalStorage } from "node:async_hooks";
import type { NativeProjectAccessContext } from "./native-project-access";

/**
 * The one verified native context of the current call chain.
 *
 * The dispatcher authenticates a native caller once and then drives the
 * existing execution route in-process. The verified context never leaves the
 * process, so an external request can never inject it and the route keeps a
 * single authorization path: the native assertion or the board identity.
 */
const storage = new AsyncLocalStorage<NativeProjectAccessContext>();

/** Run the given work with the verified native context of the caller. */
export function withNativeProjectContext<T>(context: NativeProjectAccessContext, run: () => T): T {
  return storage.run(context, run);
}

/** The verified native context of the current call chain, if there is one. */
export function currentNativeProjectContext(): NativeProjectAccessContext | undefined {
  return storage.getStore();
}
