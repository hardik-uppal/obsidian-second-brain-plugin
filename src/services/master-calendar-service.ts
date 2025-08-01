import { App, TFile, Notice } from 'obsidian';
import { PluginSettings, CalendarEvent, GoogleAccount, SelectedCalendar, MasterCalendarSettings } from '../types';
import { GoogleAccountManager } from './google-account-manager';
import { EventTemplateService } from './event-template-service';
import type { SuggestionManagementService } from './suggestion-management-service';
const moment = require('moment');

export class MasterCalendarService {
	private app: App;
	private settings: PluginSettings;
	public accountManager: GoogleAccountManager;
	private templateService: EventTemplateService;
	private allEvents: Map<string, CalendarEvent[]> = new Map(); // calendarId -> events
	private suggestionService?: SuggestionManagementService; // Optional injection

	constructor(app: App, settings: PluginSettings) {
		this.app = app;
		this.settings = settings;
		this.accountManager = new GoogleAccountManager(settings);
		this.templateService = new EventTemplateService(app, settings);
	}

	/**
	 * Initialize the master calendar system
	 */
	async initialize(): Promise<void> {
		// if (!this.settings.masterCalendar.enabled) {
		// 	console.log('Master calendar is disabled');
		// 	return;
		// }

		await this.accountManager.initialize();
		await this.templateService.initialize();
		
		console.log('Master calendar service initialized');
	}

	/**
	 * Add a new Google account for calendar integration
	 */
	async addGoogleAccount(account: Omit<GoogleAccount, 'id'>): Promise<GoogleAccount> {
		const newAccount: GoogleAccount = {
			...account,
			id: this.generateAccountId(),
			enabled: true,
		};

		this.settings.masterCalendar.googleAccounts.push(newAccount);
		await this.accountManager.addAccount(newAccount);
		
		return newAccount;
	}

	/**
	 * Remove a Google account
	 */
	async removeGoogleAccount(accountId: string): Promise<void> {
		// Remove from settings
		this.settings.masterCalendar.googleAccounts = 
			this.settings.masterCalendar.googleAccounts.filter(acc => acc.id !== accountId);
		
		// Remove selected calendars from this account
		this.settings.masterCalendar.selectedCalendars = 
			this.settings.masterCalendar.selectedCalendars.filter(cal => cal.accountId !== accountId);
		
		// Remove from account manager
		await this.accountManager.removeAccount(accountId);
		
		// Clear cached events
		const eventsToDelete: string[] = [];
		this.allEvents.forEach((events, calendarId) => {
			if (calendarId.startsWith(accountId + ':')) {
				eventsToDelete.push(calendarId);
			}
		});
		eventsToDelete.forEach(calendarId => this.allEvents.delete(calendarId));
	}

	/**
	 * Get available calendars for an account
	 */
	async getAccountCalendars(accountId: string): Promise<any[]> {
		return await this.accountManager.getCalendarsForAccount(accountId);
	}

	/**
	 * Add a calendar to the selected calendars list
	 */
	addSelectedCalendar(calendar: SelectedCalendar): void {
		// Check if already selected
		const existing = this.settings.masterCalendar.selectedCalendars.find(
			cal => cal.accountId === calendar.accountId && cal.calendarId === calendar.calendarId
		);

		if (existing) {
			// Update existing
			Object.assign(existing, calendar);
		} else {
			// Add new
			this.settings.masterCalendar.selectedCalendars.push(calendar);
		}
	}

	/**
	 * Remove a calendar from the selected calendars list
	 */
	removeSelectedCalendar(accountId: string, calendarId: string): void {
		this.settings.masterCalendar.selectedCalendars = 
			this.settings.masterCalendar.selectedCalendars.filter(
				cal => !(cal.accountId === accountId && cal.calendarId === calendarId)
			);
		
		// Clear cached events for this calendar
		const fullCalendarId = `${accountId}:${calendarId}`;
		this.allEvents.delete(fullCalendarId);
	}

	/**
	 * Sync events from all selected calendars
	 */
	async syncAllCalendars(): Promise<void> {
		console.log('🔄 Starting calendar sync...');
		
		// if (!this.settings.masterCalendar.enabled) {
		// 	console.log('❌ Master calendar is disabled');
		// 	new Notice('Master Calendar is disabled in settings');
		// 	return;
		// }

		const enabledCalendars = this.settings.masterCalendar.selectedCalendars.filter(cal => cal.enabled);
		if (enabledCalendars.length === 0) {
			console.log('❌ No calendars enabled for sync');
			new Notice('No calendars are enabled for sync');
			return;
		}

		console.log(`📅 Syncing ${enabledCalendars.length} enabled calendars`);

		const syncPromises = enabledCalendars.map(calendar => this.syncCalendar(calendar));

		try {
			await Promise.all(syncPromises);
			console.log('✅ All calendars synced successfully');
			
			// Process events to create notes if enabled
			if (this.settings.masterCalendar.eventSettings.createEventNotes) {
				console.log('📝 Processing events to create notes...');
				await this.processEventsToNotes();
			} else {
				console.log('ℹ️ Event note creation is disabled');
			}
			
			new Notice(`Synced ${enabledCalendars.length} calendars`);
		} catch (error) {
			console.error('❌ Failed to sync calendars:', error);
			new Notice('Failed to sync some calendars - check console for details');
		}
	}

	/**
	 * Sync events from a specific calendar
	 */
	private async syncCalendar(calendar: SelectedCalendar): Promise<void> {
		try {
			const events = await this.accountManager.getEventsForCalendar(
				calendar.accountId,
				calendar.calendarId,
				this.getSyncDateRange()
			);

			// Store events with full calendar ID
			const fullCalendarId = `${calendar.accountId}:${calendar.calendarId}`;
			this.allEvents.set(fullCalendarId, events);

			console.log(`Synced ${events.length} events from ${calendar.calendarName}`);
		} catch (error) {
			console.error(`Failed to sync calendar ${calendar.calendarName}:`, error);
		}
	}

	/**
	 * Get the date range for syncing based on settings
	 */
	private getSyncDateRange(): { start: string; end: string } {
		const today = moment();
		const syncSettings = this.settings.masterCalendar.syncSettings;
		
		let start: moment.Moment;
		let end: moment.Moment;

		switch (syncSettings.syncRange) {
			case 'week':
				start = today.clone().startOf('week');
				end = today.clone().endOf('week');
				break;
			case 'month':
				start = today.clone().startOf('month');
				end = today.clone().endOf('month');
				break;
			case 'quarter':
				start = today.clone().startOf('quarter');
				end = today.clone().endOf('quarter');
				break;
			case 'custom':
				if (syncSettings.customStartDate && syncSettings.customEndDate) {
					start = moment(syncSettings.customStartDate);
					end = moment(syncSettings.customEndDate);
				} else {
					// Fallback to current month if custom dates not set
					start = today.clone().startOf('month');
					end = today.clone().endOf('month');
				}
				break;
			default:
				start = today.clone().startOf('month');
				end = today.clone().endOf('month');
		}

		return {
			start: start.format('YYYY-MM-DD'),
			end: end.format('YYYY-MM-DD')
		};
	}

	/**
	 * Get all events for a specific date
	 */
	getEventsForDate(date: string): CalendarEvent[] {
		const allDateEvents: CalendarEvent[] = [];
		
		this.allEvents.forEach((events) => {
			const dateEvents = events.filter(event => event.date === date);
			allDateEvents.push(...dateEvents);
		});

		// Sort by start time
		return allDateEvents.sort((a, b) => {
			if (a.startTime === 'All Day' && b.startTime !== 'All Day') return -1;
			if (a.startTime !== 'All Day' && b.startTime === 'All Day') return 1;
			if (a.startTime === 'All Day' && b.startTime === 'All Day') return 0;
			return a.startTime.localeCompare(b.startTime);
		});
	}

	/**
	 * Get all events within a date range
	 */
	getEventsInRange(startDate: string, endDate: string): CalendarEvent[] {
		const allEvents: CalendarEvent[] = [];
		
		this.allEvents.forEach((events) => {
			const rangeEvents = events.filter(event => 
				event.date >= startDate && event.date <= endDate
			);
			allEvents.push(...rangeEvents);
		});

		return allEvents.sort((a, b) => {
			const dateCompare = a.date.localeCompare(b.date);
			if (dateCompare !== 0) return dateCompare;
			
			if (a.startTime === 'All Day' && b.startTime !== 'All Day') return -1;
			if (a.startTime !== 'All Day' && b.startTime === 'All Day') return 1;
			if (a.startTime === 'All Day' && b.startTime === 'All Day') return 0;
			return a.startTime.localeCompare(b.startTime);
		});
	}

	/**
	 * Process synced events to create note files
	 */
	private async processEventsToNotes(): Promise<void> {
		if (!this.settings.masterCalendar.eventSettings.createEventNotes) {
			console.log('Event note creation is disabled in settings');
			return;
		}

		const allEvents: CalendarEvent[] = [];
		this.allEvents.forEach((events) => {
			allEvents.push(...events);
		});

		console.log(`Processing ${allEvents.length} events to create notes`);
		console.log('Event settings:', this.settings.masterCalendar.eventSettings);
		console.log('Debug: Access console via Ctrl+Shift+I (or Cmd+Option+I on Mac) → Console tab');

		// Create basic notes first (without LLM enhancements)
		let createdCount = 0;
		let skippedCount = 0;
		
		for (const event of allEvents) {
			try {
				console.log(`Attempting to create note for event: ${event.title} on ${event.date}`);
				const result = await this.templateService.createEventNote(event);
				if (result) {
					createdCount++;
					console.log(`Successfully created note for: ${event.title}`);
				} else {
					skippedCount++;
					console.log(`Skipped creating note for: ${event.title}`);
				}
			} catch (error) {
				console.error(`Failed to create note for event ${event.title}:`, error);
				skippedCount++;
			}
		}
		
		console.log(`Event note processing complete: ${createdCount} created, ${skippedCount} skipped`);

		// Generate LLM suggestions if suggestion system is enabled
		if (this.settings.suggestionSystem?.enabled && createdCount > 0) {
			try {
				console.log('Generating LLM suggestions for created events...');
				// This would be injected from the main plugin
				if (this.suggestionService) {
					const suggestionBatch = await this.suggestionService.processCalendarEvents(allEvents, 'calendar-sync');
					console.log(`Generated ${suggestionBatch.suggestions.length} suggestions`);
				}
			} catch (error) {
				console.error('Failed to generate suggestions:', error);
			}
		}

		if (createdCount > 0) {
			new Notice(`Created ${createdCount} event notes`);
		}
	}

	/**
	 * Generate a unique account ID
	 */
	private generateAccountId(): string {
		return `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Update settings and reinitialize if needed
	 */
	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
		this.accountManager.updateSettings(newSettings);
		this.templateService.updateSettings(newSettings);
	}

	/**
	 * Get master calendar settings
	 */
	getSettings(): MasterCalendarSettings {
		return this.settings.masterCalendar;
	}

	/**
	 * Check if auto-sync is enabled and due
	 */
	shouldAutoSync(): boolean {
		if (!this.settings.masterCalendar.syncSettings.autoSync) {
			return false;
		}

		// Check if enough time has passed since last sync
		const now = moment();
		const syncInterval = this.settings.masterCalendar.syncSettings.syncInterval;
		
		for (const account of this.settings.masterCalendar.googleAccounts) {
			if (account.lastSync) {
				const lastSync = moment(account.lastSync);
				if (now.diff(lastSync, 'minutes') >= syncInterval) {
					return true;
				}
			} else {
				return true; // Never synced
			}
		}

		return false;
	}

	/**
	 * Get sync status for all accounts
	 */
	getSyncStatus(): Array<{ accountName: string; status: string; lastSync?: string }> {
		return this.settings.masterCalendar.googleAccounts.map(account => ({
			accountName: account.label,
			status: account.tokens ? 'Connected' : 'Disconnected',
			lastSync: account.lastSync
		}));
	}

	/**
	 * Discover and cache calendars for a specific account
	 */
	async discoverCalendarsForAccount(accountId: string): Promise<any[]> {
		try {
			const calendars = await this.accountManager.getCalendarsForAccount(accountId);
			
			// Update account with discovered calendars and last sync time
			const account = this.settings.masterCalendar.googleAccounts.find(acc => acc.id === accountId);
			if (account) {
				account.lastSync = new Date().toISOString();
			}
			
			return calendars.map(cal => ({
				...cal,
				accountId: accountId,
				accountEmail: account?.email || 'Unknown',
				isSelected: this.isCalendarSelected(accountId, cal.id),
				eventCount: 0 // Will be updated during sync
			}));
		} catch (error) {
			console.error(`Failed to discover calendars for account ${accountId}:`, error);
			throw error;
		}
	}

	/**
	 * Check if a calendar is currently selected for sync
	 */
	private isCalendarSelected(accountId: string, calendarId: string): boolean {
		return this.settings.masterCalendar.selectedCalendars.some(
			cal => cal.accountId === accountId && cal.calendarId === calendarId
		);
	}

	/**
	 * Bulk update calendar selections
	 */
	updateCalendarSelections(accountId: string, calendarUpdates: Array<{calendarId: string, enabled: boolean, priority?: number}>): void {
		for (const update of calendarUpdates) {
			if (update.enabled) {
				this.addSelectedCalendar({
					accountId: accountId,
					calendarId: update.calendarId,
					calendarName: update.calendarId, // Will be updated with proper name
					enabled: true,
					priority: update.priority || 1,
					syncDirection: 'read-only'
				});
			} else {
				this.removeSelectedCalendar(accountId, update.calendarId);
			}
		}
	}

	/**
	 * Get sync statistics
	 */
	getSyncStatistics(): {
		totalAccounts: number;
		activeAccounts: number;
		totalCalendars: number;
		activeCalendars: number;
		totalEvents: number;
		lastSyncTime?: string;
	} {
		const accounts = this.settings.masterCalendar.googleAccounts;
		const calendars = this.settings.masterCalendar.selectedCalendars;
		
		let totalEvents = 0;
		this.allEvents.forEach(events => {
			totalEvents += events.length;
		});

		const lastSyncTimes = accounts
			.filter(acc => acc.lastSync)
			.map(acc => new Date(acc.lastSync!))
			.sort((a, b) => b.getTime() - a.getTime());

		return {
			totalAccounts: accounts.length,
			activeAccounts: accounts.filter(acc => acc.enabled).length,
			totalCalendars: calendars.length,
			activeCalendars: calendars.filter(cal => cal.enabled).length,
			totalEvents: totalEvents,
			lastSyncTime: lastSyncTimes.length > 0 ? lastSyncTimes[0].toISOString() : undefined
		};
	}

	/**
	 * Get event count for a specific date (for calendar dots)
	 */
	getEventCountForDate(date: string): number {
		const events = this.getEventsForDate(date);
		return events.length;
	}

	/**
	 * Get event counts for a date range (for calendar view optimization)
	 */
	getEventCountsForRange(startDate: string, endDate: string): Map<string, number> {
		const eventCounts = new Map<string, number>();
		
		this.allEvents.forEach((events) => {
			events.forEach(event => {
				if (event.date >= startDate && event.date <= endDate) {
					const currentCount = eventCounts.get(event.date) || 0;
					eventCounts.set(event.date, currentCount + 1);
				}
			});
		});

		return eventCounts;
	}

	/**
	 * Generate authorization URL for a new account using shared credentials
	 */
	generateAccountAuthUrl(label: string): string {
		const tempAccount = {
			id: '',
			label,
			email: '',
			name: '',
			clientId: this.settings.googleCalendarClientId,
			clientSecret: this.settings.googleCalendarClientSecret,
			enabled: true
		};

		return this.accountManager.getAuthorizationUrl(tempAccount);
	}

	/**
	 * Complete account setup after OAuth code exchange
	 */
	async completeAccountSetup(label: string, code: string): Promise<void> {
		try {
			// Create the account
			const newAccount: GoogleAccount = {
				id: this.generateAccountId(),
				label,
				email: '', // Will be populated after token exchange
				name: '', // Will be populated after token exchange
				clientId: this.settings.googleCalendarClientId,
				clientSecret: this.settings.googleCalendarClientSecret,
				enabled: true
			};

			// Exchange code for tokens
			await this.accountManager.exchangeCodeForTokens(newAccount, code);

			// Add to settings
			this.settings.masterCalendar.googleAccounts.push(newAccount);

			// Discover calendars for this account
			const calendars = await this.accountManager.getCalendarsForAccount(newAccount.id);
			
			// Add calendars as available (disabled by default)
			for (const calendar of calendars) {
				const selectedCalendar: SelectedCalendar = {
					accountId: newAccount.id,
					calendarId: calendar.id,
					calendarName: calendar.summary || 'Unnamed Calendar',
					enabled: false, // Disabled by default
					priority: 1,
					syncDirection: 'read-only'
				};
				this.addSelectedCalendar(selectedCalendar);
			}

			new Notice(`Google account "${label}" added successfully with ${calendars.length} calendars`);
		} catch (error) {
			console.error('Failed to complete account setup:', error);
			throw error;
		}
	}

	/**
	 * Refresh all accounts and their calendars
	 */
	async refreshAllAccounts(): Promise<void> {
		for (const account of this.settings.masterCalendar.googleAccounts) {
			try {
				// Test and refresh tokens
				await this.accountManager.initializeAccountClient(account);
				
				// Re-discover calendars
				const calendars = await this.accountManager.getCalendarsForAccount(account.id);
				
				// Update last sync time
				account.lastSync = new Date().toISOString();
				
				console.log(`Refreshed account ${account.label}: ${calendars.length} calendars`);
			} catch (error) {
				console.error(`Failed to refresh account ${account.label}:`, error);
			}
		}
		
		new Notice('Account refresh completed');
	}

	/**
	 * Inject suggestion service for LLM enhancements
	 */
	setSuggestionService(suggestionService: SuggestionManagementService): void {
		this.suggestionService = suggestionService;
	}

	/**
	 * Diagnostic method to check sync readiness
	 */
	async diagnosticSyncReadiness(): Promise<{ ready: boolean; issues: string[] }> {
		const issues: string[] = [];
		
		// // Check if master calendar is enabled
		// if (!this.settings.masterCalendar.enabled) {
		// 	issues.push('Master Calendar is disabled in settings');
		// }
		
		// Check for Google accounts
		if (this.settings.masterCalendar.googleAccounts.length === 0) {
			issues.push('No Google accounts configured');
		}
		
		// Check for enabled calendars
		const enabledCalendars = this.settings.masterCalendar.selectedCalendars.filter(cal => cal.enabled);
		if (enabledCalendars.length === 0) {
			issues.push('No calendars are enabled for sync');
		}
		
		// Check event notes settings
		if (this.settings.masterCalendar.eventSettings.createEventNotes) {
			const eventFolder = this.settings.masterCalendar.eventSettings.eventNotesFolder;
			if (!eventFolder) {
				issues.push('Event notes folder is not configured');
			} else {
				// Check if folder exists
				const folder = this.app.vault.getAbstractFileByPath(eventFolder);
				if (!folder) {
					issues.push(`Event notes folder '${eventFolder}' does not exist`);
				}
			}
			
			// Check template settings
			if (this.settings.masterCalendar.eventSettings.useEventTemplates) {
				const templateFolder = this.settings.masterCalendar.eventSettings.templateFolder;
				if (!templateFolder) {
					issues.push('Template folder is not configured');
				} else {
					const folder = this.app.vault.getAbstractFileByPath(templateFolder);
					if (!folder) {
						issues.push(`Template folder '${templateFolder}' does not exist`);
					}
				}
			}
		}
		
		// Check account authentication
		for (const account of this.settings.masterCalendar.googleAccounts) {
			if (!account.tokens) {
				issues.push(`Account '${account.label}' is not authenticated`);
			}
		}
		
		return {
			ready: issues.length === 0,
			issues
		};
	}

	/**
	 * Get detailed sync diagnostics
	 */
	getSyncDiagnostics(): any {
		return {
			// enabled: this.settings.masterCalendar.enabled,
			accountsCount: this.settings.masterCalendar.googleAccounts.length,
			enabledCalendarsCount: this.settings.masterCalendar.selectedCalendars.filter(cal => cal.enabled).length,
			eventSettings: this.settings.masterCalendar.eventSettings,
			cachedEventsCount: Array.from(this.allEvents.values()).reduce((total, events) => total + events.length, 0),
			lastSyncAttempt: 'Check console for last sync details'
		};
	}
}
