import { call } from '@orpc/server'
import { describe, expect, test } from 'vitest'

import { adminDeactivateUserProcedure } from '../../src/orpc/api/auth/admin/users-deactivate'
import { adminReactivateUserProcedure } from '../../src/orpc/api/auth/admin/users-reactivate'
import { adminRemoveUserProcedure } from '../../src/orpc/api/auth/admin/users-remove'
import { adminUpdateUserRoleProcedure } from '../../src/orpc/api/auth/admin/users-update-role'
import { createMockApiContext, StatefulMockWorkosService } from '../mocks'

describe('membership mutations without billing dependencies', () => {
	function setup() {
		const workos = new StatefulMockWorkosService()
		workos.addOrganization({ id: 'workos_org', name: 'Members' })
		for (const [userId, role, status] of [
			['admin', 'admin', 'active'],
			['other_admin', 'admin', 'active'],
			['member', 'member', 'active'],
			['inactive', 'member', 'inactive'],
		] as const) {
			workos.addUser({ id: userId, email: `${userId}@example.com` })
			workos.addMembership({
				id: `om_${userId}`,
				userId,
				organizationId: 'workos_org',
				role: { slug: role },
				status,
			})
		}
		const context = createMockApiContext({
			auth: { userId: 'admin', role: 'admin', organizationId: 'local_org', workosOrganizationId: 'workos_org' },
			services: { workos },
		})
		return { context, workos }
	}

	test.each(['member', 'inactive'])('removes %s without a customer or subscription', async (userId) => {
		const { context, workos } = setup()
		expect(await call(adminRemoveUserProcedure, { userId }, { context })).toEqual({ success: true })
		expect(workos._memberships.has(`om_${userId}`)).toBe(false)
	})

	test('deactivates a member without billing storage', async () => {
		const { context, workos } = setup()
		expect(await call(adminDeactivateUserProcedure, { userId: 'member' }, { context })).toEqual({ success: true })
		expect(workos._memberships.get('om_member')?.status).toBe('inactive')
	})

	test('reactivates beyond the former three-member capacity', async () => {
		const { context, workos } = setup()
		for (let index = 0; index < 8; index++)
			workos.addMembership({ userId: `extra_${index}`, organizationId: 'workos_org' })
		expect(await call(adminReactivateUserProcedure, { userId: 'inactive' }, { context })).toEqual({ success: true })
		expect(workos._memberships.get('om_inactive')?.status).toBe('active')
	})

	test('updates a role without billing synchronization', async () => {
		const { context, workos } = setup()
		expect(await call(adminUpdateUserRoleProcedure, { userId: 'member', roleSlug: 'admin' }, { context })).toEqual({
			success: true,
		})
		expect(workos._memberships.get('om_member')?.role.slug).toBe('admin')
	})

	test('rejects self-deactivation', async () => {
		const { context, workos } = setup()
		await expect(call(adminDeactivateUserProcedure, { userId: 'admin' }, { context })).rejects.toMatchObject({
			code: 'CANNOT_DEACTIVATE_SELF',
		})
		expect(workos._memberships.get('om_admin')?.status).toBe('active')
	})

	test('rejects deactivation of the last active administrator', async () => {
		const { context, workos } = setup()
		await workos.userManagement.deactivateOrganizationMembership('om_admin')
		await expect(call(adminDeactivateUserProcedure, { userId: 'other_admin' }, { context })).rejects.toMatchObject({
			code: 'LAST_ADMIN',
		})
		expect(workos._memberships.get('om_other_admin')?.status).toBe('active')
	})

	test('rejects removal of a user outside the organization', async () => {
		const { context, workos } = setup()
		workos.addMembership({ id: 'foreign', userId: 'foreign', organizationId: 'other_org' })
		await expect(call(adminRemoveUserProcedure, { userId: 'foreign' }, { context })).rejects.toMatchObject({
			code: 'USER_NOT_FOUND',
		})
		expect(workos._memberships.has('foreign')).toBe(true)
	})

	test('rejects non-admin membership changes', async () => {
		const { context, workos } = setup()
		const memberContext = createMockApiContext({
			auth: { ...context.auth, role: 'member', roles: ['member'] },
			services: context.services,
		})
		await expect(
			call(adminRemoveUserProcedure, { userId: 'inactive' }, { context: memberContext }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
		expect(workos._memberships.has('om_inactive')).toBe(true)
	})

	test('rejects missing organization context', async () => {
		const { context, workos } = setup()
		const noOrgContext = createMockApiContext({
			auth: { role: 'admin', organizationId: undefined, workosOrganizationId: undefined },
			services: context.services,
		})
		await expect(
			call(adminReactivateUserProcedure, { userId: 'inactive' }, { context: noOrgContext }),
		).rejects.toMatchObject({ code: 'ORGANIZATION_REQUIRED' })
		expect(workos._memberships.get('om_inactive')?.status).toBe('inactive')
	})
})
