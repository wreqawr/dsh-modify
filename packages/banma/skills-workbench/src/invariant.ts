/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-banma-skills-workbench`.
 * @module @deepseek-ai/dsh-banma-skills-workbench/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-banma-skills-workbench'

/** Cordis companion plugin name. */
export const name = 'banma-skills-workbench-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the Remote methods are stateless fs wrappers whose
 * only shared fact is the service registration itself, and the generated
 * typert manifest is loader-verified at mount. They emit no cordis events and
 * own no cross-plugin mutable state.
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
