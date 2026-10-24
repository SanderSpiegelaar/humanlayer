import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

import { createOrganizationProcedure } from '../../src/orpc/api/auth/user/organizations-create'
import { createMockApiContextNoOrg, StatefulMockWorkosService } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('organizations.create without billing', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	const userId = 'user_creator_123'

	beforeAll(async () => {
		const testDb = await createTestDb('organizations_create')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	afterEach(() => vi.unstubAllEnvs())

	function createWorkos(email = 'creator@humanlayer.dev') {
		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: userId, email })
		return workos
	}

	function context(workos: StatefulMockWorkosService) {
		return createMockApiContextNoOrg({ auth: { userId }, services: { workos, db, dbReadReplica: db } })
	}

	test('creates an organization, internal metadata, and administrator membership without a customer', async () => {
		const workos = createWorkos()
		const result = await call(
			createOrganizationProcedure,
			{ name: 'Self-hosted organization', eulaAccepted: true },
			{ context: context(workos) },
		)

		const [organization] = await db.select().from(organizations).where(eq(organizations.id, result.organizationId))
		expect(organization).toMatchObject({
			name: result.organizationName,
			workos_organization_id: result.workosOrganizationId,
			stripe_customer_id: null,
			eula_accepted_by: userId,
		})
		expect(workos._organizations.get(result.workosOrganizationId)?.metadata.internal_org_id).toBe(
			result.organizationId,
		)
		const memberships = await workos.userManagement.listOrganizationMemberships({
			userId,
			organizationId: result.workosOrganizationId,
		})
		expect(await memberships.autoPagination()).toMatchObject([
			{ userId, role: { slug: 'admin' }, status: 'active' },
		])
		expect(result).not.toHaveProperty('stripeCustomerId')
	})

	test('sends every initial invitation beyond the former capacity limit', async () => {
		const workos = createWorkos()
		const inviteEmails = Array.from({ length: 8 }, (_, index) => `member${index}@example.com`)
		const result = await call(
			createOrganizationProcedure,
			{ name: `Invitations ${randomUUID()}`, eulaAccepted: true, inviteEmails },
			{ context: context(workos) },
		)

		expect(result.failedInvites).toEqual([])
		expect(
			Array.from(workos._invitations.values())
				.map((invitation) => invitation.email)
				.sort(),
		).toEqual(inviteEmails)
	})

	test('reports invitation delivery failures without losing the organization', async () => {
		const workos = createWorkos()
		const sendInvitation = workos.userManagement.sendInvitation
		workos.userManagement.sendInvitation = async (input) => {
			if (input.email === 'failed@example.com') throw new Error('Invitation delivery unavailable')
			return sendInvitation(input)
		}
		const result = await call(
			createOrganizationProcedure,
			{
				name: `Partial invitations ${randomUUID()}`,
				eulaAccepted: true,
				inviteEmails: ['sent@example.com', 'failed@example.com'],
			},
			{ context: context(workos) },
		)
		expect(result.failedInvites).toEqual(['failed@example.com'])
		expect(workos._organizations.has(result.workosOrganizationId)).toBe(true)
	})

	test('rolls back the local organization and grants no membership when metadata synchronization fails', async () => {
		const workos = createWorkos()
		workos.organizations.updateOrganization = async () => {
			throw new Error('Metadata unavailable')
		}
		const name = `Metadata failure ${randomUUID()}`
		await expect(
			call(createOrganizationProcedure, { name, eulaAccepted: true }, { context: context(workos) }),
		).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
		expect(workos._memberships.size).toBe(0)
		expect(await db.select().from(organizations).where(eq(organizations.name, name))).toEqual([])
	})

	test('WorkOS creation failure prevents local organization creation', async () => {
		const workos = createWorkos()
		workos.organizations.createOrganization = async () => {
			throw new Error('WorkOS unavailable')
		}
		const name = `Creation failure ${randomUUID()}`
		await expect(
			call(createOrganizationProcedure, { name, eulaAccepted: true }, { context: context(workos) }),
		).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
		expect(await db.select().from(organizations).where(eq(organizations.name, name))).toEqual([])
	})

	test('requires authentication', async () => {
		await expect(
			call(
				createOrganizationProcedure,
				{ name: 'Unauthorized', eulaAccepted: true },
				{ context: createMockApiContextNoOrg({ auth: null }) },
			),
		).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
	})

	test('retains the existing development email restriction', async () => {
		vi.stubEnv('STAGE', 'local')
		const workos = createWorkos('user@other.com')
		await expect(
			call(createOrganizationProcedure, { name: 'Restricted', eulaAccepted: true }, { context: context(workos) }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
		expect(workos._organizations.size).toBe(0)
	})

	test('retains the existing organization creation block', async () => {
		vi.stubEnv('BLOCK_NEW_ORG_CREATION', 'true')
		const workos = createWorkos('user@other.com')
		await expect(
			call(createOrganizationProcedure, { name: 'Blocked', eulaAccepted: true }, { context: context(workos) }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })
		expect(workos._organizations.size).toBe(0)
	})

	test.each(['staff@humanlayer.dev', 'staff@humanlayer.com'])(
		'retains the existing staff exception for %s',
		async (email) => {
			vi.stubEnv('STAGE', 'prod')
			vi.stubEnv('BLOCK_NEW_ORG_CREATION', 'true')
			const workos = createWorkos(email)
			const result = await call(
				createOrganizationProcedure,
				{ name: `Staff ${email}`, eulaAccepted: true },
				{ context: context(workos) },
			)
			expect(result.organizationName).toBe(`Staff ${email}`)
		},
	)

	test('allows other email domains outside development', async () => {
		vi.stubEnv('STAGE', 'prod')
		vi.stubEnv('BLOCK_NEW_ORG_CREATION', 'false')
		const workos = createWorkos('user@other.com')
		const result = await call(
			createOrganizationProcedure,
			{ name: 'Production organization', eulaAccepted: true },
			{ context: context(workos) },
		)
		expect(result.organizationName).toBe('Production organization')
	})
})
