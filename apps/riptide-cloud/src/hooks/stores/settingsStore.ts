import { create } from 'zustand'

type CloudSettingsTab = 'sync'
type SyncForceMode = 'auto' | 'electric' | 'query'

interface CloudSettingsState {
	// UI state (NOT persisted)
	isOpen: boolean
	activeTab: CloudSettingsTab

	// Sync force mode (NOT persisted - session-only override)
	syncForceMode: SyncForceMode

	// UI actions
	open: (tab?: CloudSettingsTab) => void
	close: () => void
	setActiveTab: (tab: CloudSettingsTab) => void

	// Sync force mode actions
	setSyncForceMode: (mode: SyncForceMode) => void
}

export const useSettingsStore = create<CloudSettingsState>()((set) => ({
	isOpen: false,
	activeTab: 'sync',
	syncForceMode: 'auto',
	open: (tab) => set({ isOpen: true, activeTab: tab ?? 'sync' }),
	close: () => set({ isOpen: false }),
	setActiveTab: (tab) => set({ activeTab: tab }),
	setSyncForceMode: (mode) => set({ syncForceMode: mode }),
}))
