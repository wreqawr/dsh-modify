/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-banma-skills-workbench`.
 * @module @deepseek-ai/dsh-client-banma-skills-workbench/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-banma-skills-workbench'

/** Cordis companion plugin name. */
export const name = 'client-banma-skills-workbench-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the sidebar and details registrations are
 * registry-owned contributions whose disposal is proven by the HMR-safety
 * spec, the trace is a pure projection of the session conversation snapshot,
 * and the catalog rides the read-only connection skill.list RPC. They emit no
 * cordis events and own no cross-plugin mutable state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
