import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { asc, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { requireExternalTestServices } from '../utils/external-test-services'
import { migrationsFolder } from '../utils/postgres'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Projects V2 release migration', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined

	beforeAll(async () => {
		const testDb = await createTestDb('projects-v2-release')
		db = testDb.db
		cleanup = testDb.cleanup
	}, 60_000)

	afterAll(async () => {
		await cleanup?.()
	}, 30_000)

	test('the generated backfill changes only access, preserves history and opt-outs, and is safe to retry', async () => {
		const orgIds = [randomUUID(), randomUUID()] as const
		await db
			.insert(organizations)
			.values(
				orgIds.map((id) => ({ id, name: 'Legacy release fixture', workos_organization_id: `workos-${id}` })),
			)
		await db.insert(organizationSettings).values(
			orgIds.map((organization_id) => ({
				organization_id,
				experimental_subagents_enabled: false,
				haiku_research_subagents_enabled: false,
				multiplayer_prompting_enabled: false,
				commit_tracking_enabled: false,
				pr_tracking_enabled: false,
				advanced_metrics_visible_to_all_members: false,
			})),
		)
		const legacyStates = [
			{ projects_v2_enabled: false, projects_v2_assigned_variant: 'v1' },
			{ projects_v2_enabled: false, projects_v2_assigned_variant: null },
			{ projects_v2_enabled: true, projects_v2_assigned_variant: 'v2' },
			{ projects_v2_enabled: true, projects_v2_assigned_variant: 'v1' },
		] as const
		await db.insert(userSettings).values(
			orgIds.flatMap((organization_id) =>
				legacyStates.map((state, index) => ({
					organization_id,
					user_id: `legacy-user-${index}`,
					...state,
					projects_v2_assigned_at: state.projects_v2_assigned_variant === null ? null : 1_700_000_000_001n,
					created_at: 1_700_000_000_002n,
					updated_at: 1_700_000_000_003n,
					onboarding_dismissed_at: 1_700_000_000_004n,
					first_task_completed_at: 1_700_000_000_005n,
					experimental_subagents_enabled: false,
					haiku_research_subagents_enabled: false,
					metrics_advanced_enabled: false,
					prefer_batch_queue_delivery: false,
					experiment_flags: { scratchPadEnabled: false },
				})),
			),
		)
		const readUsers = () =>
			db.select().from(userSettings).orderBy(asc(userSettings.organization_id), asc(userSettings.user_id))
		const beforeUsers = await readUsers()
		const beforeOrgs = await db
			.select()
			.from(organizationSettings)
			.orderBy(asc(organizationSettings.organization_id))
		const migration = await readFile(join(migrationsFolder, '0146_release-projects-v2.sql'), 'utf8')

		for (let attempt = 0; attempt < 2; attempt++) {
			await db.execute(sql.raw(migration))
			expect(await readUsers()).toEqual(beforeUsers.map((row) => ({ ...row, projects_v2_enabled: true })))
			expect(
				await db.select().from(organizationSettings).orderBy(asc(organizationSettings.organization_id)),
			).toEqual(beforeOrgs)
		}
		// No row is created for the missing member; insertion uses the generated DDL default.
		const [inserted] = await db
			.insert(userSettings)
			.values({ organization_id: orgIds[0], user_id: 'previously-missing' })
			.returning()
		expect(inserted?.projects_v2_enabled).toBe(true)
		expect(inserted?.projects_v2_assigned_variant).toBeNull()
		expect(inserted?.projects_v2_assigned_at).toBeNull()
	})
})
