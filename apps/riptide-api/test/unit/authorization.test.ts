import { contractBuilder } from '@humanlayer/riptide-api-contract/contract-builder'
import { call, implement } from '@orpc/server'
import { describe, expect, test } from 'vitest'
import z from 'zod/v4'

import { isAuthContextWithOrg, requireOrganization, type ApiContext } from '../../src/orpc/base'
import { createMockApiAuth, createMockApiAuthNoOrg, createMockApiContext, createMockApiContextNoOrg } from '../mocks'

const testOs = implement({ check: contractBuilder.input(z.object({})).output(z.boolean()) }).$context<ApiContext>()
const authenticated = testOs.use(async ({ context, next, errors }) => {
	if (!context.auth) throw errors.UNAUTHORIZED()
	return next({ context: { auth: context.auth, services: context.services } })
})
const orgRequired = authenticated.use(requireOrganization).check.handler(() => true)
const orgOptional = authenticated.check.handler(() => true)

describe('organization authorization without billing', () => {
	test('recognizes only complete organization contexts', () => {
		expect(isAuthContextWithOrg(null)).toBe(false)
		expect(isAuthContextWithOrg(createMockApiAuthNoOrg())).toBe(false)
		expect(isAuthContextWithOrg(createMockApiAuth({ organizationId: '' }))).toBe(false)
		expect(isAuthContextWithOrg(createMockApiAuth({ workosOrganizationId: '' }))).toBe(false)
		expect(isAuthContextWithOrg(createMockApiAuth())).toBe(true)
	})

	test('requires authentication for organization routes', async () => {
		await expect(call(orgRequired, {}, { context: createMockApiContext({ auth: null }) })).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
		})
	})

	test('requires an organization for organization routes', async () => {
		await expect(call(orgRequired, {}, { context: createMockApiContextNoOrg() })).rejects.toMatchObject({
			code: 'ORGANIZATION_REQUIRED',
		})
	})

	test('accepts an authenticated organization without commercial dependencies', async () => {
		expect(await call(orgRequired, {}, { context: createMockApiContext() })).toBe(true)
	})

	test('requires authentication for bootstrap routes', async () => {
		await expect(
			call(orgOptional, {}, { context: createMockApiContextNoOrg({ auth: null }) }),
		).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
	})

	test('accepts bootstrap requests without an organization', async () => {
		expect(await call(orgOptional, {}, { context: createMockApiContextNoOrg() })).toBe(true)
	})

	test('accepts bootstrap requests with an organization', async () => {
		expect(await call(orgOptional, {}, { context: createMockApiContext() })).toBe(true)
	})
})
