import { NodeCrypto } from '@effect/platform-node'
import * as EffectSentry from '@sentry/effect/server'
import { Config, Crypto, ManagedRuntime } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import type { HttpClient } from 'effect/http/HttpClient'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Tracer from 'effect/Tracer'

import { db, dbReadReplica } from '../db/db'
import { WorkosServiceLive } from '../workos'
import { type AccessRequestService, AccessRequestServiceLive } from './services/access-request/access-request.service'
import type { ArtifactComments } from './services/artifact-comments/artifact-comments'
import { ArtifactCommentsLive } from './services/artifact-comments/artifact-comments-live'
import type { DiffComments } from './services/diff-comments/diff-comments'
import { DiffCommentsLive } from './services/diff-comments/diff-comments-live'
import {
	type DurableStreamsConfig,
	DurableStreamsConfigLive,
} from './services/durable-streams/durable-streams-config.service'
import { type DurableStreamSessionService, DurableStreamSessionServiceLive } from './services/durable-streams/streams'
import {
	type ExperimentAnalyticsService,
	ExperimentAnalyticsServiceLive,
} from './services/experiment-analytics/experiment-analytics.service'
import { type GitHubService, GitHubServiceLive } from './services/github/github.service'
import { type PersonSpendAnalytics, PersonSpendAnalyticsLive } from './services/metrics/person-spend-analytics.service'
import { type OnboardingService, OnboardingServiceLive } from './services/onboarding/onboarding.service'
import { type PostgresDb, PostgresDbLive } from './services/postgres/postgres-db.service'
import {
	type PostgresReadReplicaDb,
	PostgresReadReplicaDbLive,
} from './services/postgres/postgres-read-replica.service'
import { PrStatusStreamLive } from './services/pr-status-stream/pr-status-stream.layer'
import type { PrStatusStream } from './services/pr-status-stream/pr-status-stream.service'
import { type ResendConfig, ResendConfigLive } from './services/resend/resend-config.service'
import { ResendServiceWithFetchHttpClientLive } from './services/resend/resend-service-live'
import { type ResendService } from './services/resend/resend.service'
import { type S3, S3Live } from './services/s3/s3.service'
import {
	type SessionTitleGeneration,
	SessionTitleGenerationLive,
} from './services/session-title-generation/session-title-generation.service'
import { type SlackService, SlackServiceLive } from './services/slack/slack.service'
import {
	type TaskDiffService,
	TaskDiffServiceLive,
} from './services/task-diff-durable-streams/task-diff-durable-streams.service'
import {
	type TaskIntentClassifier,
	TaskIntentClassifierLive,
} from './services/task-intent-classifier/task-intent-classifier.service'
import { TaskLaunchServiceLive } from './services/task-launch/task-launch.live'
import type { TaskLaunchService } from './services/task-launch/task-launch.service'
import type { WorkosService } from './services/workos/workos.service'
import { WorkspaceSetupServiceLive } from './services/workspace-setup/workspace-setup.live'
import { WorkspaceSetupPersistenceLive } from './services/workspace-setup/workspace-setup.persistence'
import type { WorkspaceSetupService } from './services/workspace-setup/workspace-setup.service'

/**
 * Type of all the services the app runtime will need
 */
export type AppRuntimeServices =
	| HttpClient
	| PostgresDb
	| Crypto.Crypto
	| PostgresReadReplicaDb
	| PersonSpendAnalytics
	| S3
	| WorkosService
	| ResendConfig
	| ResendService
	| AccessRequestService
	| DurableStreamsConfig
	| DurableStreamSessionService
	| TaskDiffService
	| OnboardingService
	| SlackService
	| WorkspaceSetupService
	| GitHubService
	| ExperimentAnalyticsService
	| DiffComments
	| ArtifactComments
	| TaskLaunchService
	| TaskIntentClassifier
	| PrStatusStream
	| SessionTitleGeneration

/**
 * The type for the actual runtime
 */
export type AppRuntimeInitializationError = Config.ConfigError

export type AppRuntime = ManagedRuntime.ManagedRuntime<AppRuntimeServices, AppRuntimeInitializationError>

const isLocal = (process.env.SENTRY_ENVIRONMENT ?? 'local') === 'local'

export const EffectTracingLive = isLocal ? Layer.empty : Layer.succeed(Tracer.Tracer, EffectSentry.SentryEffectTracer)

const denseJsonConsoleLogger = Logger.withConsoleLog(Logger.formatJson)

const EffectLoggerLive = Logger.layer(
	isLocal ? [denseJsonConsoleLogger] : [denseJsonConsoleLogger, EffectSentry.SentryEffectLogger],
)

/**
 * Sentry observability for Effect spans, logs, and metrics.
 */
export const SentryEffectLive = Layer.mergeAll(
	EffectTracingLive,
	EffectLoggerLive,
	EffectSentry.SentryEffectMetricsLayer,
)

/**
 * The live app runtime layer tree.
 */
const BaseRuntimeLive = Layer.mergeAll(
	NodeCrypto.layer,
	SentryEffectLive,
	PostgresDbLive(db),
	PostgresReadReplicaDbLive(dbReadReplica),
	S3Live,
	DurableStreamsConfigLive.pipe(Layer.orDie),
	ResendConfigLive,
)
	// The one fetch transport, provided once. GitHub operations declare HttpClient in R and receive
	// this instance ambiently. Other services still wire their own transport; #2415 removes those.
	.pipe(Layer.provideMerge(FetchHttpClient.layer))

const CoreServiceLive = Layer.mergeAll(
	WorkosServiceLive,
	ResendServiceWithFetchHttpClientLive,
	DurableStreamSessionServiceLive,
	TaskDiffServiceLive.pipe(Layer.provide(FetchHttpClient.layer), Layer.orDie),
	SlackServiceLive.pipe(Layer.orDie),
	WorkspaceSetupServiceLive.pipe(Layer.provide(WorkspaceSetupPersistenceLive)),
	GitHubServiceLive.pipe(Layer.orDie),
	// Reads DURABLE_STREAMS_ORIGIN through DurableStreamsConfig, provided by BaseRuntimeLive below.
	PrStatusStreamLive,
).pipe(Layer.provideMerge(BaseRuntimeLive))

const OnboardingServiceWithDependenciesLive = OnboardingServiceLive.pipe(Layer.provide(CoreServiceLive))

const CommentServicesLive = Layer.mergeAll(DiffCommentsLive, ArtifactCommentsLive).pipe(
	Layer.provide(Layer.mergeAll(CoreServiceLive, OnboardingServiceWithDependenciesLive)),
)

export const AppRuntimeLive = Layer.mergeAll(
	AccessRequestServiceLive,
	PersonSpendAnalyticsLive,
	OnboardingServiceWithDependenciesLive,
	ExperimentAnalyticsServiceLive.pipe(Layer.orDie),
	TaskLaunchServiceLive,
	TaskIntentClassifierLive,
	SessionTitleGenerationLive,
	CommentServicesLive,
).pipe(Layer.provideMerge(CoreServiceLive))

/**
 * The managed runtime used by Effect oRPC procedures.
 */
export const appRuntime: AppRuntime = ManagedRuntime.make(AppRuntimeLive)
