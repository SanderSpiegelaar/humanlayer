import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { listAdminUsersProcedure } from '../../src/orpc/api/auth/admin/users-list'
import { createMockApiContext, StatefulMockWorkosService } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('admin user list', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const workosOrganizationId = `workos_${randomUUID()}`

	beforeAll(async () => {
		const testDb = await createTestDb('users_list')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Members', workos_organization_id: workosOrganizationId })
			.returning()
		if (!organization) throw new Error('Organization was not created')
		organizationId = organization.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function buildContext() {
		const workos = new StatefulMockWorkosService()
		workos.addOrganization({ id: workosOrganizationId, name: 'Members' })
		for (const status of ['active', 'inactive', 'pending'] as const) {
			const userId = `user_${status}`
			workos.addUser({ id: userId, email: `${status}@example.com` })
			workos.addMembership({ id: `om_${status}`, userId, organizationId: workosOrganizationId, status })
		}
		return {
			workos,
			context: createMockApiContext({
				auth: { userId: 'admin', organizationId, workosOrganizationId, role: 'admin' },
				services: { db, dbReadReplica: db, workos },
			}),
		}
	}

	test('lists active and inactive memberships with status', async () => {
		const { context } = buildContext()
		const result = await call(listAdminUsersProcedure, {}, { context })
		expect(result.users).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'user_active', membershipId: 'om_active', status: 'active' }),
				expect.objectContaining({ id: 'user_inactive', membershipId: 'om_inactive', status: 'inactive' }),
			]),
		)
	})

	test('excludes pending memberships even when WorkOS returns them', async () => {
		const { context, workos } = buildContext()
		const listMemberships = workos.userManagement.listOrganizationMemberships
		workos.userManagement.listOrganizationMemberships = (options) =>
			listMemberships({ ...options, statuses: ['active', 'inactive', 'pending'] })
		const result = await call(listAdminUsersProcedure, {}, { context })
		expect(result.users.find((user) => user.id === 'user_pending')).toBeUndefined()
	})

	test('reports per-user advanced metrics collection preferences', async () => {
		await db
			.insert(userSettings)
			.values({ user_id: 'user_active', organization_id: organizationId, metrics_advanced_enabled: false })
		const { context } = buildContext()
		const result = await call(listAdminUsersProcedure, {}, { context })
		expect(result.users.find((user) => user.id === 'user_active')?.metricsAdvancedEnabled).toBe(false)
		expect(result.users.find((user) => user.id === 'user_inactive')?.metricsAdvancedEnabled).toBe(true)
	})
})
