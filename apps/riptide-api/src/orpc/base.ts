import { RiptideApiContract, RiptideDaemonApiContract } from '@humanlayer/riptide-api-contract/contract-router'
import { implement, ORPCError } from '@orpc/server'
import * as Sentry from '@sentry/node'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import z from 'zod/v4'

import type { DaemonAuthContext } from '../auth/context'
import type { AuthContext, AuthContextOptionalOrg } from '../auth/jwt-validator'
import type { AppRuntime } from '../effects/app-runtime'
import { sharesMetricsWithMembers } from '../effects/services/metrics/metrics-audience'
import type { IJiraService } from '../lib/jira-service'
import type { ILinearService } from '../lib/linear-service'
import type { IS3Service } from '../lib/s3-service'
import type { WorkosSdkAdapter } from '../lib/workos-service'

/**
 * Injectable services available in context.
 */
export type Services = {
	workos: WorkosSdkAdapter
	s3: IS3Service
	jira: IJiraService
	linear: ILinearService
	db: PostgresJsDatabase
	dbReadReplica: PostgresJsDatabase
	/**
	 * App-wide Effect runtime seam. Legacy procedures that need to fork detached
	 * Effect work (e.g. onboarding enrollment) run it through this runtime instead
	 * of owning a bespoke `ManagedRuntime`. Shared by API and daemon contexts.
	 */
	effectRuntime: AppRuntime
}

/**
 * Full API context including auth and injectable services.
 */
export type ApiContext = {
	auth: AuthContextOptionalOrg | null
	services: Services
	headers?: Headers | Record<string, string | undefined>
	requestIp?: string
}

export const os = implement(RiptideApiContract).$context<ApiContext>()

function captureUnexpected(error: unknown, path?: readonly string[]): void {
	// Only report genuine server faults. Skip declared oRPC errors and any 4xx: a
	// NOT_FOUND/FORBIDDEN/BAD_REQUEST is a client/business outcome, not a server bug.
	// Classic procedures already mark declared errors `defined`, so the 4xx guard is
	// belt-and-suspenders — it keeps behavior identical to the effect base (see RIPTIDE-API-CD).
	if (error instanceof ORPCError && (error.defined || error.status < 500)) return
	Sentry.captureException(error, {
		fingerprint: path ? ['{{ default }}', path.join('.')] : ['{{ default }}'],
		tags: path ? { operation: path.join('.'), route_group: path[0] } : undefined,
	})
}

/**
 * Type guard to verify auth context has valid organization
 * Returns true if organizationId and workosOrganizationId are non-empty strings
 */
export function isAuthContextWithOrg(auth: AuthContextOptionalOrg | null): auth is AuthContext {
	if (!auth) return false
	return (
		typeof auth.organizationId === 'string' &&
		auth.organizationId.length > 0 &&
		typeof auth.workosOrganizationId === 'string' &&
		auth.workosOrganizationId.length > 0
	)
}

/**
 * Reusable middleware that requires organization context
 * Throws ORGANIZATION_REQUIRED if org is missing, narrows type to AuthContext
 */
export const requireOrganization = os.middleware(async ({ context, next, errors }) => {
	if (!isAuthContextWithOrg(context.auth)) {
		throw errors.ORGANIZATION_REQUIRED({
			data: { message: 'Please select an organization to continue' },
		})
	}
	// TypeScript knows auth is AuthContext after type guard
	return next({ context: { auth: context.auth, services: context.services } })
})

/**
 * Api base with auth and error capture
 * Now uses requireOrganization middleware - but JWT still validates org, so no behavior change
 */
export const apiBaseOrgRequired = os
	// First: Check auth exists, narrow from null
	.use(async ({ context, next, errors }) => {
		if (!context.auth) throw errors.UNAUTHORIZED()
		return next({ context: { auth: context.auth, services: context.services } })
	})
	// Second: Require organization, narrow to AuthContext
	.use(requireOrganization)
	// Third: Sentry error capture
	.use(async ({ context, next, path }) => {
		try {
			return await next({ context })
		} catch (error) {
			captureUnexpected(error, path)
			throw error
		}
	})

/**
 * Api base for org-optional routes (auth required, org optional)
 * Use this for bootstrap routes like organizations.list, organizations.create, invitations.*
 */
export const apiBaseNoOrg = os
	.use(async ({ context, next, errors }) => {
		const auth = context.auth
		if (!auth) throw errors.UNAUTHORIZED()

		return next({
			context: { auth, services: context.services },
		})
	})
	// Sentry error capture
	.use(async ({ context, next, path }) => {
		try {
			return await next({ context })
		} catch (error) {
			captureUnexpected(error, path)
			throw error
		}
	})

export const apiBasePublic = os.use(async ({ context, next, path }) => {
	try {
		return await next({ context })
	} catch (error) {
		captureUnexpected(error, path)
		throw error
	}
})

/**
 * Middleware that requires admin role.
 * Checks both singular role and plural roles for compatibility.
 */
export const requireAdmin = os.middleware(async ({ context, next, errors }) => {
	const auth = context.auth
	if (!auth) throw errors.UNAUTHORIZED()
	const isAdmin = auth.role === 'admin' || auth.roles?.includes('admin')
	if (!isAdmin) {
		throw errors.FORBIDDEN()
	}
	return next({ context })
})

/** Api base for sync v2 endpoints: auth + requireOrg + Sentry. */
export const apiBaseSyncV2 = os
	// First: Check auth exists, narrow from null
	.use(async ({ context, next, errors }) => {
		if (!context.auth) throw errors.UNAUTHORIZED()
		return next({ context: { auth: context.auth, services: context.services } })
	})
	// Second: Require organization, narrow to AuthContext
	.use(requireOrganization)
	// Third: Sentry error capture
	.use(async ({ context, next }) => {
		try {
			return await next({ context })
		} catch (error) {
			captureUnexpected(error)
			throw error
		}
	})

export function isOrganizationAdmin(auth: Pick<AuthContext, 'role' | 'roles'>): boolean {
	return auth.role === 'admin' || (auth.roles?.includes('admin') ?? false)
}

/**
 * Api base for organization admin routes: auth + requireOrg + requireAdmin + Sentry
 */
export const apiBaseForOrganizationAdmin = os
	// First: Check auth exists
	.use(async ({ context, next, errors }) => {
		if (!context.auth) throw errors.UNAUTHORIZED()
		return next({ context: { auth: context.auth, services: context.services } })
	})
	// Second: Require organization
	.use(requireOrganization)
	// Third: Require admin role
	.use(async ({ context, next, errors }) => {
		if (!isOrganizationAdmin(context.auth)) {
			throw errors.FORBIDDEN()
		}
		return next({ context })
	})
	// Fourth: Sentry error capture
	.use(async ({ context, next }) => {
		try {
			return await next({ context })
		} catch (error) {
			captureUnexpected(error)
			throw error
		}
	})

export const apiBaseForAdvancedMetrics = apiBaseOrgRequired.use(async ({ context, next, errors }) => {
	const shares = await sharesMetricsWithMembers(context.services.effectRuntime, {
		organizationId: context.auth.organizationId,
		isAdmin: isOrganizationAdmin(context.auth),
	})
	if (!shares) throw errors.FORBIDDEN()
	return next({ context })
})

export type LaunchTokenContext = {
	launchTokenAuth: { userId: string; organizationId: string }
	services: Services
}

const LaunchTokenEnvelope = z.object({ launchToken: z.string() }).passthrough()

/**
 * Api base for launch-token-authenticated routes.
 * Does NOT check context.auth (which is null — no WorkOS JWT on these requests).
 * Instead validates the launch token from the input body.
 */
export const apiBaseLaunchToken = os
	.use(
		os.middleware(async ({ context, next, errors }, input) => {
			const { validateLaunchToken } = await import('../auth/daemon-tokens')
			const parsedInput = LaunchTokenEnvelope.safeParse(input)
			if (!parsedInput.success) {
				throw errors.UNAUTHORIZED()
			}
			const claims = await validateLaunchToken(parsedInput.data.launchToken)
			if (!claims) throw errors.UNAUTHORIZED()
			return next({
				context: {
					launchTokenAuth: { userId: claims.userId, organizationId: claims.organizationId },
					services: context.services,
				},
			})
		}),
	)
	.use(async ({ context, next }) => {
		try {
			return await next({ context })
		} catch (error) {
			captureUnexpected(error)
			throw error
		}
	})

export type { DaemonAuthContext } from '../auth/context'

/**
 * Daemon context including auth and injectable services.
 */
export type DaemonContext = {
	auth: DaemonAuthContext | null
	services: Services
}

const daemonOs = implement(RiptideDaemonApiContract).$context<DaemonContext>()

export const daemonBase = daemonOs
	.use(async ({ context, next, errors }) => {
		const auth = context.auth
		if (!auth) throw errors.UNAUTHORIZED()

		return next({
			context: { auth, services: context.services },
		})
	})
	// Sentry error capture
	.use(async ({ context, next, path }) => {
		try {
			return await next({ context })
		} catch (error) {
			captureUnexpected(error, path)
			throw error
		}
	})
