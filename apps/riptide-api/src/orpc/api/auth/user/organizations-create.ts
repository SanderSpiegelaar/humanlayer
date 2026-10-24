import { organizations } from '@humanlayer/db/tables/organizations'
import * as Sentry from '@sentry/node'
import { DomainDataState, type Organization } from '@workos-inc/node'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { OnboardingService } from '../../../../effects/services/onboarding/onboarding.service'
import {
	BLOCK_NEW_ORG_CREATION_MESSAGE,
	isDevEnvironment,
	isHumanlayerEmailDomain,
	isHumanlayerStaffEmail,
	isNewOrgCreationBlocked,
} from '../../../../lib/environment'
import { logger } from '../../../../logger'
import { apiBaseNoOrg } from '../../../base'

export const createOrganizationProcedure = apiBaseNoOrg.auth.user.organizations.create.handler(
	async ({ context, input, errors }) => {
		const {
			auth,
			services: { workos, db },
		} = context

		if (isNewOrgCreationBlocked()) {
			// HumanLayer staff (humanlayer.dev / humanlayer.com) can still create
			// orgs even on environments where new org creation is blocked.
			const user = await workos.userManagement.getUser(auth.userId)
			if (!isHumanlayerStaffEmail(user.email)) {
				throw errors.BAD_REQUEST({
					data: { message: BLOCK_NEW_ORG_CREATION_MESSAGE },
				})
			}
		}

		if (isDevEnvironment()) {
			const user = await workos.userManagement.getUser(auth.userId)
			if (!isHumanlayerEmailDomain(user.email)) {
				throw errors.FORBIDDEN({
					data: {
						message:
							'Organization creation is restricted to humanlayer.dev email domains in dev environments',
					},
				})
			}
		}

		const CONSUMER_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com']
		const HOSTNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/
		if (input.domains && input.domains.length > 0) {
			if (input.domains.length > 5) {
				throw errors.BAD_REQUEST({ data: { message: 'Maximum 5 domains allowed' } })
			}
			for (const domain of input.domains) {
				if (!HOSTNAME_REGEX.test(domain)) {
					throw errors.BAD_REQUEST({ data: { message: `Invalid domain: ${domain}` } })
				}
				if (CONSUMER_DOMAINS.includes(domain.toLowerCase())) {
					throw errors.BAD_REQUEST({ data: { message: `Consumer domain not allowed: ${domain}` } })
				}
			}
		}

		let workosOrg: Organization
		try {
			workosOrg = await workos.organizations.createOrganization({
				name: input.name,
				domainData:
					input.domains?.map((domain) => ({
						domain,
						state: DomainDataState.Pending,
					})) ?? [],
			})
		} catch (error) {
			logger.error({ err: error }, 'Failed to create organization in WorkOS')
			throw errors.INTERNAL_SERVER_ERROR()
		}

		let dbOrg: typeof organizations.$inferSelect
		try {
			const [inserted] = await db
				.insert(organizations)
				.values({
					name: input.name,
					workos_organization_id: workosOrg.id,
					eula_accepted_by: auth.userId,
					eula_accepted_at: Date.now(),
				})
				.returning()

			if (!inserted) {
				throw new Error('No organization returned from insert')
			}

			dbOrg = inserted
		} catch (error) {
			const e = error as Error
			logger.error(
				{ message: e.message, stack: e.stack, name: e.name },
				'Failed to create organization in database',
			)
			throw errors.INTERNAL_SERVER_ERROR()
		}

		try {
			await workos.organizations.updateOrganization({
				organization: workosOrg.id,
				metadata: {
					internal_org_id: dbOrg.id,
				},
			})
		} catch (error) {
			logger.error(
				{
					err: error,
					organizationId: dbOrg.id,
					workosOrganizationId: workosOrg.id,
				},
				'Failed to write internal organization metadata',
			)
			Sentry.captureException(error)
			try {
				await db.delete(organizations).where(eq(organizations.id, dbOrg.id))
			} catch (cleanupError) {
				logger.error(
					{ err: cleanupError, organizationId: dbOrg.id },
					'Failed to roll back local organization after metadata synchronization failed',
				)
				Sentry.captureException(cleanupError)
			}
			throw errors.INTERNAL_SERVER_ERROR()
		}

		try {
			await workos.userManagement.createOrganizationMembership({
				userId: auth.userId,
				organizationId: workosOrg.id,
				roleSlug: 'admin',
			})
		} catch (error) {
			logger.error({ err: error }, 'Failed to create organization membership')
			throw errors.INTERNAL_SERVER_ERROR()
		}

		const failedInvites: string[] = []
		if (input.inviteEmails && input.inviteEmails.length > 0) {
			const results = await Promise.allSettled(
				input.inviteEmails.map((email) =>
					workos.userManagement.sendInvitation({
						email,
						organizationId: workosOrg.id,
						inviterUserId: auth.userId,
						roleSlug: 'member',
						expiresInDays: 7,
					}),
				),
			)

			results.forEach((result, index) => {
				const email = input.inviteEmails[index]
				if (result.status === 'rejected' && email) {
					failedInvites.push(email)
					Sentry.captureException(result.reason, {
						extra: { email, orgId: workosOrg.id },
					})
				}
			})
		}

		logger.info(
			{
				organizationId: dbOrg.id,
			},
			'Created organization',
		)

		// Fire-and-forget onboarding enrollment on the shared app Effect runtime.
		// `runFork` returns synchronously with a background root fiber, so organization
		// creation never blocks on Resend/WorkOS. Failures are captured to Sentry and
		// swallowed so they can't surface to the caller.
		const enrollmentInput = { userId: auth.userId, organizationId: dbOrg.id }
		context.services.effectRuntime.runFork(
			Effect.gen(function* () {
				const onboarding = yield* OnboardingService
				yield* onboarding.enrollMember(enrollmentInput)
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						yield* Effect.logError('Detached onboarding enrollment failed').pipe(
							Effect.annotateLogs(enrollmentInput),
						)
						yield* Effect.sync(() =>
							Sentry.captureException(error, {
								tags: { error_type: 'onboarding_detached_failure' },
								extra: enrollmentInput,
							}),
						)
					}),
				),
			),
		)

		return {
			organizationId: dbOrg.id,
			workosOrganizationId: workosOrg.id,
			organizationName: workosOrg.name,
			failedInvites,
		}
	},
)
