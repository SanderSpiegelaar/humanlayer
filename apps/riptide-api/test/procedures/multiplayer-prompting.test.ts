import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect } from 'effect'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { PostgresDb } from '../../src/effects/services/postgres/postgres-db.service'
import {
	getSessionAccessControlLevel,
	getSessionAccessControlLevelForClassicProcedure,
} from '../../src/lib/session-multiplayer-prompting-auth'
import { updateMultiplayerPromptingEffectProcedure } from '../../src/orpc/api/sessions/multiplayer-prompting/update.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('multiplayer prompting database defaults', () => {
	let db: PostgresJsDatabase
	let cleanupTestDb: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let updateProcedure: typeof updateMultiplayerPromptingEffectProcedure
	const nowMillis = 1_800_000_000_000

	beforeAll(async () => {
		const testDb = await createTestDb('multiplayer_prompting_defaults')
		db = testDb.db
		cleanupTestDb = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
		updateProcedure = bindProcedureToRuntime(updateMultiplayerPromptingEffectProcedure, runtime)
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30_000)

	async function createFixture() {
		const organizationId = uuidv7()
		const ownerId = `owner-${uuidv7()}`
		const guestId = `guest-${uuidv7()}`
		const hostId = uuidv7()
		const taskId = uuidv7()
		const sessionId = uuidv7()
		await db.insert(organizations).values({
			id: organizationId,
			name: 'Multiplayer defaults test',
			workos_organization_id: `workos-${organizationId}`,
		})
		await db.insert(onlineHosts).values({ host_id: hostId, organization_id: organizationId, user_id: ownerId })
		await db.insert(tasks).values({
			id: taskId,
			organization_id: organizationId,
			name: 'Private multiplayer task',
			created_by: ownerId,
			resource_owner_user_id: ownerId,
		})
		await db.insert(sessions).values({
			id: sessionId,
			organization_id: organizationId,
			created_by: ownerId,
			resource_owner_user_id: ownerId,
			host_id: hostId,
			task_id: taskId,
			status: 'interrupted',
			prompt: 'Test multiplayer access',
			working_directory: '/tmp',
		})
		return { organizationId, ownerId, guestId, taskId, sessionId }
	}

	function contextFor(fixture: Awaited<ReturnType<typeof createFixture>>, userId: string) {
		return createMockApiContext({
			auth: createMockApiAuth({
				userId,
				organizationId: fixture.organizationId,
				workosOrganizationId: `workos-${fixture.organizationId}`,
			}),
			services: { db, dbReadReplica: db },
		})
	}

	async function readBoth(fixture: Awaited<ReturnType<typeof createFixture>>, actorUserId: string) {
		const input = { organizationId: fixture.organizationId, sessionId: fixture.sessionId, actorUserId }
		const classic = await getSessionAccessControlLevelForClassicProcedure(db, input, nowMillis)
		const effect = await runtime.runPromise(
			Effect.gen(function* () {
				const postgres = yield* PostgresDb
				return yield* postgres.transaction((transaction) =>
					getSessionAccessControlLevel(transaction, input, nowMillis),
				)
			}),
		)
		return [classic, effect]
	}

	test('availability alone grants neither an invitation nor a task permission; the owner can invite without settings', async () => {
		const fixture = await createFixture()
		expect(await readBoth(fixture, fixture.guestId)).toEqual(['no_access', 'no_access'])
		expect(await db.select().from(taskUserAcl).where(eq(taskUserAcl.task_id, fixture.taskId))).toEqual([])
		await expect(
			call(
				updateProcedure,
				{
					sessionId: fixture.sessionId,
					settings: { enabled: true, addUserIds: [fixture.ownerId], duration: 'unlimited' },
				},
				{ context: contextFor(fixture, fixture.guestId) },
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		await call(
			updateProcedure,
			{
				sessionId: fixture.sessionId,
				settings: { enabled: true, addUserIds: [fixture.guestId], duration: 'unlimited' },
			},
			{ context: contextFor(fixture, fixture.ownerId) },
		)
		const [session] = await db.select().from(sessions).where(eq(sessions.id, fixture.sessionId))
		expect(session?.multiplayer_prompting_user_ids).toEqual([fixture.guestId])
		expect(session?.multiplayer_prompting_started_at).not.toBeNull()
		expect(session?.multiplayer_prompting_expires_at).toBeNull()
		const [acl] = await db.select().from(taskUserAcl).where(eq(taskUserAcl.task_id, fixture.taskId))
		expect(acl).toMatchObject({ subject_user_id: fixture.guestId, permission_level: 'edit' })
		expect(await readBoth(fixture, fixture.guestId)).toEqual(['prompt', 'prompt'])
		expect(
			await db
				.select()
				.from(organizationSettings)
				.where(eq(organizationSettings.organization_id, fixture.organizationId)),
		).toEqual([])

		await expect(
			call(
				updateProcedure,
				{
					sessionId: fixture.sessionId,
					settings: { enabled: false },
				},
				{ context: contextFor(fixture, fixture.guestId) },
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
		await call(
			updateProcedure,
			{
				sessionId: fixture.sessionId,
				settings: { enabled: false },
			},
			{ context: contextFor(fixture, fixture.ownerId) },
		)
		expect(await readBoth(fixture, fixture.guestId)).toEqual(['view', 'view'])
	})

	test.each(['active', 'uninvited', 'expired', 'read-only', 'no task access', 'organization disabled'] as const)(
		'both authorization readers enforce %s grants with database settings',
		async (scenario) => {
			const fixture = await createFixture()
			await db
				.update(sessions)
				.set({
					multiplayer_prompting_user_ids: scenario === 'uninvited' ? [] : [fixture.guestId],
					multiplayer_prompting_started_at: BigInt(nowMillis - 1000),
					multiplayer_prompting_expires_at: scenario === 'expired' ? BigInt(nowMillis) : null,
				})
				.where(eq(sessions.id, fixture.sessionId))
			if (scenario !== 'no task access') {
				await db.insert(taskUserAcl).values({
					task_id: fixture.taskId,
					subject_user_id: fixture.guestId,
					organization_id: fixture.organizationId,
					resource_owner_user_id: fixture.ownerId,
					permission_level: scenario === 'read-only' ? 'read' : 'edit',
					granted_by: fixture.ownerId,
				})
			}
			if (scenario === 'organization disabled') {
				await db.insert(organizationSettings).values({
					organization_id: fixture.organizationId,
					multiplayer_prompting_enabled: false,
				})
				await expect(
					call(
						updateProcedure,
						{
							sessionId: fixture.sessionId,
							settings: { enabled: true, duration: '1h' },
						},
						{ context: contextFor(fixture, fixture.ownerId) },
					),
				).rejects.toMatchObject({ code: 'FORBIDDEN' })
				const [settings] = await db
					.select()
					.from(organizationSettings)
					.where(eq(organizationSettings.organization_id, fixture.organizationId))
				expect(settings?.multiplayer_prompting_enabled).toBe(false)
				const [session] = await db.select().from(sessions).where(eq(sessions.id, fixture.sessionId))
				expect(session?.multiplayer_prompting_expires_at).toBeNull()
			}
			const expected = scenario === 'active' ? 'prompt' : scenario === 'no task access' ? 'no_access' : 'view'
			expect(await readBoth(fixture, fixture.guestId)).toEqual([expected, expected])
		},
	)
})
