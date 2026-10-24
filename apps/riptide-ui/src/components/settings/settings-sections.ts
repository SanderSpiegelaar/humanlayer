import { useNavigate } from '@tanstack/react-router'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useMountEffect } from '@/hooks/useMountEffect'

/**
 * The settings sections. These map 1:1 to the static route files under
 * `routes/settings/` (and to the tabs of the former settings modal).
 */
export type SettingsSection =
	| 'general'
	| 'keybindings'
	| 'agent-sign-in'
	| 'agent'
	| 'tips'
	| 'experiments'
	| 'projects'
	| 'personal-access-tokens'
	| 'access-requests'
	| 'users'
	| 'daemons'
	| 'sync'
	| 'diagnostics'
	| 'updates'

export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'general'

/** The route path for a given section, e.g. `/settings/general`. */
export const SETTINGS_SECTION_PATHS = {
	general: '/settings/general',
	keybindings: '/settings/keybindings',
	'agent-sign-in': '/settings/agent-sign-in',
	agent: '/settings/agent',
	tips: '/settings/tips',
	experiments: '/settings/experiments',
	projects: '/settings/projects',
	'personal-access-tokens': '/settings/personal-access-tokens',
	'access-requests': '/settings/access-requests',
	users: '/settings/users',
	daemons: '/settings/daemons',
	sync: '/settings/sync',
	diagnostics: '/settings/diagnostics',
	updates: '/settings/updates',
} as const satisfies Record<SettingsSection, `/settings/${SettingsSection}`>

export const SETTINGS_SECTION_LABELS = {
	general: 'General',
	keybindings: 'Keybindings',
	'agent-sign-in': 'Sign-in',
	agent: 'Defaults',
	tips: 'Tips',
	experiments: 'Experiments',
	projects: 'Projects',
	'personal-access-tokens': 'Personal access tokens',
	'access-requests': 'Access requests',
	users: 'Users',
	daemons: 'Hosts',
	sync: 'Sync',
	diagnostics: 'Diagnostics',
	updates: 'Updates',
} as const satisfies Record<SettingsSection, string>

const SETTINGS_SECTION_TITLES: Partial<Record<SettingsSection, string>> = {
	'agent-sign-in': 'Coding agent sign-in',
	agent: 'Coding agent defaults',
}

export function getSettingsSectionTitle(section: SettingsSection): string {
	return SETTINGS_SECTION_TITLES[section] ?? SETTINGS_SECTION_LABELS[section]
}

/** Type guard for narrowing a raw path segment to a known `SettingsSection`. */
export function isSettingsSection(value: string | undefined): value is SettingsSection {
	return value !== undefined && value in SETTINGS_SECTION_LABELS
}

export function shouldSuppressSettingsSectionTitle(section: string | undefined): boolean {
	return section === 'access-requests'
}

export interface SettingsVisibilityContext {
	/** WorkOS roles for the current user (from `useBrowserAuth().roles`). */
	roles: string[] | null | undefined
	projectsV2Enabled?: boolean
}

/** Whether a section is visible for the current user/context. */
export function isSettingsSectionVisible(section: SettingsSection, context: SettingsVisibilityContext): boolean {
	switch (section) {
		case 'projects':
			return context.projectsV2Enabled === true
		case 'access-requests':
		case 'users':
			return context.roles?.includes('admin') ?? false
		default:
			return true
	}
}

/**
 * Reads the live visibility context from auth + the settings store. Use inside
 * components/routes to evaluate `isSettingsSectionVisible` reactively.
 */
export function useSettingsVisibilityContext(): SettingsVisibilityContext {
	const { roles } = useBrowserAuth()
	const projectsV2Enabled = useSettingsStore((s) => s.projectsV2Enabled)
	return { roles, projectsV2Enabled }
}

export interface SettingsSectionGroup {
	/** Optional group header label; ungrouped (top) sections omit this. */
	label?: string
	sections: SettingsSection[]
}

export const SETTINGS_SECTION_GROUPS: SettingsSectionGroup[] = [
	{ sections: ['general', 'projects', 'keybindings', 'tips', 'experiments'] },
	{ label: 'Coding agents', sections: ['agent-sign-in', 'agent'] },
	{ label: 'Account', sections: ['personal-access-tokens'] },
	{ label: 'Administration', sections: ['access-requests', 'users'] },
	{ label: 'System', sections: ['daemons', 'sync', 'diagnostics', 'updates'] },
]

export function useRedirectIfSettingsSectionHidden(section: SettingsSection): void {
	const navigate = useNavigate()
	const context = useSettingsVisibilityContext()
	const visible = isSettingsSectionVisible(section, context)

	// Guarding a route is a mount-time concern: opening a hidden section (deep
	// link or in-app navigation mounting this route component) bounces to General.
	// useMountEffect keeps this out of a reactive useEffect per the no-useEffect
	// rule — the nav already hides the item, so a live visibility flip doesn't need
	// to redirect a section the user already has open.
	useMountEffect(() => {
		if (!visible) {
			navigate({ to: SETTINGS_SECTION_PATHS[DEFAULT_SETTINGS_SECTION], replace: true })
		}
	})
}
