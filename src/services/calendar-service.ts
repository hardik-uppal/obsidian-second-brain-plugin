import { google } from 'googleapis';
import { PluginSettings, CalendarEvent, CalendarInfo, CalendarSyncSettings, ConflictingEvent, SyncResult } from '../types';
import { Notice } from 'obsidian';

export class CalendarService {
	private settings: PluginSettings;
	private calendar: any;
	private availableCalendars: CalendarInfo[] = [];
	private lastSyncResults: Map<string, SyncResult> = new Map();

	constructor(settings: PluginSettings) {
		this.settings = settings;
		this.initializeClient();
	}

	private initializeClient(): void {
		try {
			if (this.settings.googleCalendarClientId && this.settings.googleCalendarClientSecret) {
				// Always use OOB for desktop applications
				const auth = new google.auth.OAuth2(
					this.settings.googleCalendarClientId,
					this.settings.googleCalendarClientSecret,
					'urn:ietf:wg:oauth:2.0:oob'
				);

				// Set up token refresh handling (legacy - now handled by MasterCalendarService)
				auth.on('tokens', (tokens) => {
					if (tokens.refresh_token) {
						// Note: Token refresh is now handled by the MasterCalendarService
						console.log('OAuth2 tokens refreshed (legacy service)');
					}
				});

				// Load existing tokens if available (legacy compatibility)
				// Note: New system stores tokens per account in masterCalendar.googleAccounts
				const legacyTokens = this.getLegacyTokens();
				if (legacyTokens) {
					auth.setCredentials(legacyTokens);
				}

				this.calendar = google.calendar({ version: 'v3', auth });
			}
		} catch (error) {
			console.error('Failed to initialize Google Calendar client:', error);
		}
	}

	async testConnection(): Promise<boolean> {
		try {
			if (!this.calendar) {
				throw new Error('Calendar client not initialized');
			}

			const response = await this.calendar.calendarList.list({
				maxResults: 1
			});

			return response.status === 200;
		} catch (error) {
			console.error('Calendar connection test failed:', error);
			return false;
		}
	}

	async getCalendars(): Promise<any[]> {
		try {
			if (!this.calendar) {
				throw new Error('Calendar client not initialized');
			}

			const response = await this.calendar.calendarList.list();
			return response.data.items || [];
		} catch (error) {
			console.error('Failed to fetch calendars:', error);
			throw error;
		}
	}

	async getEventsFromMultipleCalendars(): Promise<Map<string, CalendarEvent[]>> {
		const { timeMin, timeMax } = this.getDateRange();
		const eventsPerCalendar = new Map<string, CalendarEvent[]>();
		const maxResults = this.getLegacySyncSettings().maxEventsPerSync;

		for (const calendarId of this.getEnabledCalendarIds()) {
			try {
				const events = await this.getEventsFromCalendar(calendarId, timeMin, timeMax, maxResults);
				eventsPerCalendar.set(calendarId, events);
			} catch (error) {
				console.error(`Failed to fetch events from calendar ${calendarId}:`, error);
				eventsPerCalendar.set(calendarId, []);
			}
		}

		return eventsPerCalendar;
	}

	private async getEventsFromCalendar(
		calendarId: string, 
		timeMin: string, 
		timeMax: string, 
		maxResults: number
	): Promise<CalendarEvent[]> {
		try {
			if (!this.calendar) {
				throw new Error('Calendar client not initialized');
			}

			const response = await this.calendar.events.list({
				calendarId: calendarId,
				timeMin: timeMin,
				timeMax: timeMax,
				maxResults: maxResults,
				singleEvents: true,
				orderBy: 'startTime',
			});

			const calendarInfo = this.availableCalendars.find(cal => cal.id === calendarId);
			const calendarName = calendarInfo?.name || calendarId;

			return (response.data.items || []).map((event: any) => this.convertToCalendarEvent(event, calendarId, calendarName));
		} catch (error) {
			console.error(`Failed to fetch events from calendar ${calendarId}:`, error);
			throw error;
		}
	}

	private convertToCalendarEvent(event: any, calendarId: string, calendarName: string): CalendarEvent {
		const startDate = new Date(event.start?.dateTime || event.start?.date);
		const endDate = new Date(event.end?.dateTime || event.end?.date);

		return {
			id: `${calendarId}:${event.id}`,
			title: event.summary || 'Untitled Event',
			date: startDate.toISOString().split('T')[0],
			startTime: event.start?.dateTime ? startDate.toLocaleTimeString() : 'All Day',
			endTime: event.end?.dateTime ? endDate.toLocaleTimeString() : 'All Day',
			location: event.location || '',
			description: event.description || '',
			attendees: event.attendees?.map((a: any) => a.email) || [],
			tags: [],
			rawData: event,
			sourceCalendarId: calendarId,
			sourceCalendarName: calendarName,
			lastModified: event.updated || new Date().toISOString(),
			syncStatus: 'pending'
		};
	}

	async getNewEvents(): Promise<CalendarEvent[]> {
		try {
			const lastSync = this.settings.lastEventSync;
			let startDate: string;
			
			if (lastSync) {
				startDate = lastSync;
			} else {
				// If no last sync, use the configured sync range
				const { timeMin } = this.getDateRange();
				startDate = timeMin;
			}

			const { timeMax } = this.getDateRange();
			const allEvents: CalendarEvent[] = [];

			// Get events from all enabled calendars
			for (const calendarId of this.getEnabledCalendarIds()) {
				try {
					const events = await this.getEventsFromCalendar(calendarId, startDate, timeMax, this.getLegacySyncSettings().maxEventsPerSync);
					allEvents.push(...events);
				} catch (error) {
					console.error(`Failed to fetch new events from calendar ${calendarId}:`, error);
				}
			}

			return allEvents;
		} catch (error) {
			console.error('Failed to fetch new events:', error);
			throw error;
		}
	}

	async syncEvents(): Promise<{ success: boolean; count: number; errors: string[] }> {
		const result = {
			success: false,
			count: 0,
			errors: [] as string[]
		};

		try {
			new Notice('Syncing events from Google Calendar...');

			const events = await this.getNewEvents();
			result.count = events.length;

			if (events.length === 0) {
				new Notice('No new events found');
				result.success = true;
				return result;
			}

			// Process events (this would be handled by the main plugin)
			new Notice(`Found ${events.length} new events`);
			result.success = true;

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			result.errors.push(errorMessage);
			new Notice(`Event sync failed: ${errorMessage}`);
			return result;
		}
	}

	// OAuth flow helpers with enhanced error handling
	generateAuthUrl(forceConsent: boolean = false): string {
		try {
			if (!this.settings.googleCalendarClientId || !this.settings.googleCalendarClientSecret) {
				throw new Error('Google Calendar OAuth2 credentials not configured');
			}

			// For desktop applications, use OOB (Out-of-Band) flow
			const auth = new google.auth.OAuth2(
				this.settings.googleCalendarClientId,
				this.settings.googleCalendarClientSecret,
				'urn:ietf:wg:oauth:2.0:oob' // Always use OOB for desktop apps
			);

			const scopes = [
				'https://www.googleapis.com/auth/calendar.readonly',
				'https://www.googleapis.com/auth/calendar.events'
			];

			const authUrl = auth.generateAuthUrl({
				access_type: 'offline',
				scope: scopes,
				prompt: forceConsent ? 'consent' : 'select_account', // Allow account selection
				include_granted_scopes: true
			});

			return authUrl;
		} catch (error) {
			console.error('Failed to generate auth URL:', error);
			throw error;
		}
	}

	async exchangeCodeForTokens(code: string): Promise<any> {
		try {
			if (!this.settings.googleCalendarClientId || !this.settings.googleCalendarClientSecret) {
				throw new Error('Google Calendar OAuth2 credentials not configured');
			}

			// Use OOB flow for desktop applications
			const auth = new google.auth.OAuth2(
				this.settings.googleCalendarClientId,
				this.settings.googleCalendarClientSecret,
				'urn:ietf:wg:oauth:2.0:oob' // Always use OOB for desktop apps
			);

			const { tokens } = await auth.getToken(code);
			return tokens;
		} catch (error) {
			console.error('Failed to exchange code for tokens:', error);
			throw error;
		}
	}

	// Utility methods
	formatEventForTemplate(event: any): Record<string, any> {
		const startDate = new Date(event.start?.dateTime || event.start?.date);
		const endDate = new Date(event.end?.dateTime || event.end?.date);

		return {
			id: event.id,
			title: event.summary || 'Untitled Event',
			date: startDate.toISOString().split('T')[0],
			start_time: event.start?.dateTime ? startDate.toLocaleTimeString() : 'All Day',
			end_time: event.end?.dateTime ? endDate.toLocaleTimeString() : 'All Day',
			location: event.location || '',
			description: event.description || '',
			attendees: event.attendees?.map((a: any) => a.email) || [],
			rawData: event
		};
	}

	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
		this.initializeClient();
	}

	isConfigured(): boolean {
		return !!(
			this.settings.googleCalendarClientId &&
			this.settings.googleCalendarClientSecret
		);
	}

	getConfigurationStatus(): { configured: boolean; missing: string[] } {
		const missing: string[] = [];
		
		if (!this.settings.googleCalendarClientId) {
			missing.push('Client ID');
		}
		if (!this.settings.googleCalendarClientSecret) {
			missing.push('Client Secret');
		}

		return {
			configured: missing.length === 0,
			missing
		};
	}

	// Check if OAuth2 tokens are available
	hasValidTokens(): boolean {
		return !!(this.getLegacyTokens());
	}

	// Get connection status including token availability
	getConnectionStatus(): { configured: boolean; authenticated: boolean; missing: string[] } {
		const configStatus = this.getConfigurationStatus();
		return {
			configured: configStatus.configured,
			authenticated: this.hasValidTokens(),
			missing: configStatus.missing
		};
	}

	// Helper method to get calendar ID from calendar list
	async findCalendarByName(name: string): Promise<string | null> {
		try {
			const calendars = await this.getCalendars();
			const calendar = calendars.find(cal => 
				cal.summary?.toLowerCase().includes(name.toLowerCase())
			);
			return calendar?.id || null;
		} catch (error) {
			console.error('Failed to find calendar by name:', error);
			return null;
		}
	}

	// Create event (if using OAuth with write permissions)
	async createEvent(eventData: {
		summary: string;
		description?: string;
		start: { dateTime: string; timeZone?: string };
		end: { dateTime: string; timeZone?: string };
		location?: string;
		attendees?: { email: string }[];
	}): Promise<any> {
		try {
			if (!this.calendar) {
				throw new Error('Calendar client not initialized');
			}

			const calendarId = 'primary'; // Default to primary calendar

			const response = await this.calendar.events.insert({
				calendarId: calendarId,
				resource: eventData,
			});

			return response.data;
		} catch (error) {
			console.error('Failed to create event:', error);
			throw error;
		}
	}

	// Helper method for OAuth troubleshooting
	getOAuthTroubleshootingInfo(): string {
		return `
To fix Google Calendar OAuth setup:

1. Go to Google Cloud Console (console.cloud.google.com)
2. Navigate to "APIs & Services" > "OAuth consent screen"
3. Set Publishing status to "Testing" (not "In production")
4. Add your Google account to "Test users"
5. Make sure these scopes are added:
   - https://www.googleapis.com/auth/calendar.readonly
   - https://www.googleapis.com/auth/calendar.events

6. In "Credentials", make sure you have:
   - Application type: "Desktop application" 
   - No redirect URI needed (automatically uses OOB flow)

For the authorization flow:
1. Click "Connect to Google Calendar" 
2. Complete OAuth in browser
3. Copy the authorization code from the final page
4. Use "Exchange Google Calendar Auth Code" command to paste it

Note: Desktop apps don't need redirect URIs - Google handles this automatically!
		`.trim();
	}

	// Extract authorization code from callback URL
	extractCodeFromCallback(callbackUrl: string): string | null {
		try {
			const url = new URL(callbackUrl);
			return url.searchParams.get('code');
		} catch (error) {
			console.error('Failed to extract code from callback URL:', error);
			return null;
		}
	}

	// Multiple Calendar Management Methods
	
	async discoverAndCacheCalendars(): Promise<CalendarInfo[]> {
		// Legacy method - delegate to master calendar service
		try {
			// Use the first connected account to discover calendars
			const firstAccount = this.settings.masterCalendar.googleAccounts[0];
			if (!firstAccount) {
				throw new Error('No Google accounts configured');
			}

			// This is a simplified stub - in reality, the UI should handle calendar discovery
			console.log('Legacy discoverAndCacheCalendars called - consider using MasterCalendarService directly');
			return [];
		} catch (error) {
			console.error('Failed to discover calendars (legacy):', error);
			return [];
		}
	}

	getAvailableCalendars(): CalendarInfo[] {
		return this.availableCalendars;
	}

	async updateEnabledCalendars(calendarIds: string[]): Promise<void> {
		// Legacy method - should use MasterCalendarService.updateAccountSettings instead
		console.log('Legacy updateEnabledCalendars called - consider using MasterCalendarService directly');
		// No-op for legacy compatibility
	}

	private getDateRange(): { timeMin: string; timeMax: string } {
		const now = new Date();
		const settings = this.getLegacySyncSettings();
		
		let startDate: Date;
		let endDate: Date;

		// Use a simple 30-day range as default since legacy sync settings are deprecated
		startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
		endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

		return {
			timeMin: startDate.toISOString(),
			timeMax: endDate.toISOString()
		};
	}

	// Conflict Detection and Resolution
	
	async syncMultipleCalendarsWithConflictResolution(): Promise<SyncResult> {
		const startTime = Date.now();
		const result: SyncResult = {
			success: false,
			calendarsProcessed: 0,
			eventsImported: 0,
			eventsUpdated: 0,
			eventsSkipped: 0,
			conflicts: [],
			errors: [],
			duration: 0
		};

		try {
			new Notice('Syncing events from multiple calendars...');

			// Refresh calendar list
			await this.discoverAndCacheCalendars();

			// Get events from all calendars
			const eventsPerCalendar = await this.getEventsFromMultipleCalendars();
			result.calendarsProcessed = eventsPerCalendar.size;

			// Flatten all events for conflict detection
			const allEvents: CalendarEvent[] = [];
			for (const [calendarId, events] of eventsPerCalendar) {
				allEvents.push(...events);
				console.log(`Calendar ${calendarId}: ${events.length} events`);
			}

			console.log(`Total events before conflict detection: ${allEvents.length}`);

			// Detect conflicts
			const conflicts = this.detectConflicts(allEvents);
			result.conflicts = conflicts;
			console.log(`Detected ${conflicts.length} conflicts`);

			// Store conflicts for later access
			this.lastSyncResults.set('latest', result);

			// Process events based on conflict resolution strategy
			const processedEvents = await this.resolveConflicts(allEvents, conflicts);
			console.log(`Processed ${processedEvents.length} events after conflict resolution`);

			// Update counts - only count events with syncStatus === 'synced'
			result.eventsImported = processedEvents.filter(e => e.syncStatus === 'synced' && !e.obsidianPath).length;
			result.eventsUpdated = processedEvents.filter(e => e.syncStatus === 'synced' && e.obsidianPath).length;
			result.eventsSkipped = processedEvents.filter(e => e.syncStatus === 'conflict' || e.syncStatus === 'error').length;

			result.success = true;
			result.duration = Date.now() - startTime;

			const conflictMessage = conflicts.length > 0 ? ` (${conflicts.length} conflicts detected)` : '';
			new Notice(`Sync complete: ${result.eventsImported} imported, ${result.eventsUpdated} updated${conflictMessage}`);

			return result;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			result.errors.push(errorMsg);
			result.duration = Date.now() - startTime;
			console.error('Sync failed:', error);
			new Notice(`Sync failed: ${errorMsg}`);
			return result;
		}
	}

	private detectConflicts(events: CalendarEvent[]): ConflictingEvent[] {
		const conflicts: ConflictingEvent[] = [];
		const eventGroups: Map<string, CalendarEvent[]> = new Map();

		console.log(`Starting conflict detection for ${events.length} events`);

		// Group events by potential conflicts (same time + similar details)
		for (const event of events) {
			const key = this.generateConflictKey(event);
			if (!eventGroups.has(key)) {
				eventGroups.set(key, []);
			}
			eventGroups.get(key)!.push(event);
		}

		console.log(`Created ${eventGroups.size} event groups`);

		// Find groups with multiple events from DIFFERENT calendars (potential conflicts)
		for (const [key, eventGroup] of eventGroups) {
			if (eventGroup.length > 1) {
				// Check if events are from different calendars
				const uniqueCalendars = new Set(eventGroup.map(e => e.sourceCalendarId));
				
				if (uniqueCalendars.size > 1) {
					console.log(`Found potential conflict group: ${eventGroup.length} events from ${uniqueCalendars.size} calendars`);
					
					// Check if they're actually similar enough to be considered conflicts
					const similarity = this.calculateGroupSimilarity(eventGroup);
					
					if (similarity > 0.6) { // Only consider high similarity as conflicts
						const conflictType = this.determineConflictType(eventGroup);
						const primaryEvent = this.selectPrimaryEvent(eventGroup);
						const otherEvents = eventGroup.filter(e => e.id !== primaryEvent.id);

						conflicts.push({
							obsidianEvent: primaryEvent,
							googleEvents: otherEvents.map(e => ({
								event: e,
								calendarId: e.sourceCalendarId,
								calendarName: e.sourceCalendarName
							})),
							conflictType: conflictType,
							similarity: similarity
						});

						console.log(`Added conflict: ${primaryEvent.title} vs ${otherEvents.length} other events`);
					}
				}
			}
		}

		console.log(`Final conflict count: ${conflicts.length}`);
		return conflicts;
	}

	private generateConflictKey(event: CalendarEvent): string {
		// Generate a key based on date and start time for grouping similar events
		const date = event.date;
		const startTime = event.startTime;
		// Use a looser grouping - just date and hour
		const hour = startTime.includes(':') ? startTime.split(':')[0] : 'allday';
		return `${date}:${hour}`;
	}

	private calculateGroupSimilarity(events: CalendarEvent[]): number {
		if (events.length < 2) return 0;
		
		let totalSimilarity = 0;
		let comparisons = 0;
		
		for (let i = 0; i < events.length; i++) {
			for (let j = i + 1; j < events.length; j++) {
				totalSimilarity += this.calculateSimilarity(events[i], events[j]);
				comparisons++;
			}
		}
		
		return comparisons > 0 ? totalSimilarity / comparisons : 0;
	}

	private determineConflictType(events: CalendarEvent[]): 'time_overlap' | 'duplicate' | 'title_similar' | 'location_same' {
		// Simple logic to determine conflict type
		const titles = events.map(e => e.title.toLowerCase());
		const locations = events.map(e => e.location?.toLowerCase() || '');
		
		// Check for exact title matches
		if (new Set(titles).size === 1) {
			return 'duplicate';
		}
		
		// Check for similar titles
		if (this.hasSimilarTitles(titles)) {
			return 'title_similar';
		}
		
		// Check for same location
		if (locations.some(loc => loc !== '') && new Set(locations.filter(loc => loc !== '')).size === 1) {
			return 'location_same';
		}
		
		return 'time_overlap';
	}

	private hasSimilarTitles(titles: string[]): boolean {
		// Simple similarity check - could be enhanced with fuzzy matching
		for (let i = 0; i < titles.length; i++) {
			for (let j = i + 1; j < titles.length; j++) {
				if (this.calculateStringSimilarity(titles[i], titles[j]) > 0.7) {
					return true;
				}
			}
		}
		return false;
	}

	private calculateSimilarity(event1: CalendarEvent, event2: CalendarEvent): number {
		const titleSim = this.calculateStringSimilarity(event1.title.toLowerCase(), event2.title.toLowerCase());
		const locationSim = this.calculateStringSimilarity(
			event1.location?.toLowerCase() || '', 
			event2.location?.toLowerCase() || ''
		);
		const timeSim = (event1.startTime === event2.startTime && event1.endTime === event2.endTime) ? 1.0 : 0.5;
		
		return (titleSim * 0.5 + locationSim * 0.2 + timeSim * 0.3);
	}

	private calculateStringSimilarity(str1: string, str2: string): number {
		// Simple Jaccard similarity
		if (str1 === str2) return 1.0;
		if (!str1 || !str2) return 0.0;
		
		const set1 = new Set(str1.split(' '));
		const set2 = new Set(str2.split(' '));
		const intersection = new Set([...set1].filter(x => set2.has(x)));
		const union = new Set([...set1, ...set2]);
		
		return intersection.size / union.size;
	}

	private selectPrimaryEvent(events: CalendarEvent[]): CalendarEvent {
		// Select primary event based on calendar priority and other factors
		return events.reduce((primary, current) => {
			const primaryCalInfo = this.availableCalendars.find(cal => cal.id === primary.sourceCalendarId);
			const currentCalInfo = this.availableCalendars.find(cal => cal.id === current.sourceCalendarId);
			
			const primaryPriority = primaryCalInfo?.priority || 0;
			const currentPriority = currentCalInfo?.priority || 0;
			
			// Higher priority wins, if same priority, newest event wins
			if (currentPriority > primaryPriority) {
				return current;
			} else if (currentPriority === primaryPriority) {
				return new Date(current.lastModified) > new Date(primary.lastModified) ? current : primary;
			}
			return primary;
		});
	}

	private async resolveConflicts(events: CalendarEvent[], conflicts: ConflictingEvent[]): Promise<CalendarEvent[]> {
		const resolvedEvents: CalendarEvent[] = [];
		const conflictIds = new Set(conflicts.flatMap(c => [c.obsidianEvent.id, ...c.googleEvents.map(ge => ge.event.id)]));
		
		// Handle non-conflicting events first
		for (const event of events) {
			if (!conflictIds.has(event.id)) {
				event.syncStatus = 'synced';
				resolvedEvents.push(event);
			}
		}

		// Handle conflicts based on resolution strategy
		const strategy: string = 'manual'; // Default to manual resolution for legacy compatibility
		
		for (const conflict of conflicts) {
			switch (strategy) {
				case 'newest':
					const newestEvent = this.selectNewestEvent([conflict.obsidianEvent, ...conflict.googleEvents.map(ge => ge.event)]);
					newestEvent.syncStatus = 'synced';
					resolvedEvents.push(newestEvent);
					break;
					
				case 'primary':
					// Use the event from the primary calendar or highest priority calendar
					const primaryEvent = this.selectPrimaryEvent([conflict.obsidianEvent, ...conflict.googleEvents.map(ge => ge.event)]);
					primaryEvent.syncStatus = 'synced';
					resolvedEvents.push(primaryEvent);
					break;
					
				case 'merge':
					const mergedEvent = this.mergeEvents([conflict.obsidianEvent, ...conflict.googleEvents.map(ge => ge.event)]);
					mergedEvent.syncStatus = 'synced';
					resolvedEvents.push(mergedEvent);
					break;
					
				case 'manual':
				default:
					// Mark all events in conflict for manual resolution
					conflict.obsidianEvent.syncStatus = 'conflict';
					conflict.obsidianEvent.conflictsWith = conflict.googleEvents.map(ge => ge.event.id);
					resolvedEvents.push(conflict.obsidianEvent);
					
					for (const googleEvent of conflict.googleEvents) {
						googleEvent.event.syncStatus = 'conflict';
						googleEvent.event.conflictsWith = [conflict.obsidianEvent.id];
						resolvedEvents.push(googleEvent.event);
					}
					break;
			}
		}

		return resolvedEvents;
	}

	private selectNewestEvent(events: CalendarEvent[]): CalendarEvent {
		return events.reduce((newest, current) => 
			new Date(current.lastModified) > new Date(newest.lastModified) ? current : newest
		);
	}

	private mergeEvents(events: CalendarEvent[]): CalendarEvent {
		// Merge multiple events into one, combining information
		const primary = this.selectPrimaryEvent(events);
		const merged = { ...primary };
		
		// Combine descriptions
		const descriptions = events.map(e => e.description).filter(d => d && d.trim() !== '');
		if (descriptions.length > 1) {
			merged.description = descriptions.join('\n\n---\n\n');
		}
		
		// Combine attendees
		const allAttendees = new Set(events.flatMap(e => e.attendees));
		merged.attendees = Array.from(allAttendees);
		
		// Combine tags
		const allTags = new Set(events.flatMap(e => e.tags));
		merged.tags = Array.from(allTags);
		
		// Add source information to tags
		const sources = events.map(e => e.sourceCalendarName).filter((name, index, arr) => arr.indexOf(name) === index);
		merged.tags.push(...sources.map(source => `source:${source}`));
		
		return merged;
	}

	getLastSyncResults(): Map<string, SyncResult> {
		return this.lastSyncResults;
	}

	getConflictSummary(): { total: number; byType: Record<string, number> } {
		// Get conflicts from the most recent sync
		const latestResult = this.lastSyncResults.get('latest');
		const allConflicts = latestResult?.conflicts || [];
		
		const byType: Record<string, number> = {};
		
		for (const conflict of allConflicts) {
			byType[conflict.conflictType] = (byType[conflict.conflictType] || 0) + 1;
		}
		
		console.log(`Conflict summary: ${allConflicts.length} total conflicts`, byType);
		
		return {
			total: allConflicts.length,
			byType
		};
	}

	/**
	 * Get legacy tokens from the first connected account (compatibility layer)
	 */
	private getLegacyTokens(): any | null {
		const firstAccount = this.settings.masterCalendar.googleAccounts.find(acc => acc.tokens);
		if (firstAccount && firstAccount.tokens) {
			try {
				return JSON.parse(firstAccount.tokens);
			} catch (error) {
				console.error('Failed to parse legacy tokens:', error);
				return null;
			}
		}
		return null;
	}

	/**
	 * Get legacy sync settings (compatibility layer)
	 */
	private getLegacySyncSettings() {
		return this.settings.masterCalendar.syncSettings;
	}

	/**
	 * Get enabled calendar IDs (compatibility layer)
	 */
	private getEnabledCalendarIds(): string[] {
		return this.settings.masterCalendar.selectedCalendars
			.filter(cal => cal.enabled)
			.map(cal => cal.calendarId);
	}
}
