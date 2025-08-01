import { google } from 'googleapis';
import { PluginSettings, CalendarEvent, GoogleAccount } from '../types';
const moment = require('moment');

export class GoogleAccountManager {
	private settings: PluginSettings;
	private accountClients: Map<string, any> = new Map(); // accountId -> calendar client

	constructor(settings: PluginSettings) {
		this.settings = settings;
	}

	async initialize(): Promise<void> {
		// Initialize OAuth2 clients for all accounts
		for (const account of this.settings.masterCalendar.googleAccounts) {
			if (account.enabled) {
				await this.initializeAccountClient(account);
			}
		}
	}

	/**
	 * Initialize OAuth2 client for a specific account
	 */
	async initializeAccountClient(account: GoogleAccount): Promise<void> {
		try {
			const auth = new google.auth.OAuth2(
				account.clientId,
				account.clientSecret,
				'urn:ietf:wg:oauth:2.0:oob'
			);

			// Set up token refresh handling
			auth.on('tokens', (tokens) => {
				if (tokens.refresh_token) {
					// Update stored tokens for this account
					const currentTokens = account.tokens ? JSON.parse(account.tokens) : {};
					const updatedTokens = { ...currentTokens, ...tokens };
					account.tokens = JSON.stringify(updatedTokens);
					console.log(`OAuth2 tokens refreshed for account ${account.email}`);
				}
			});

			// Load existing tokens if available
			if (account.tokens) {
				const tokens = JSON.parse(account.tokens);
				auth.setCredentials(tokens);
			}

			const calendar = google.calendar({ version: 'v3', auth });
			this.accountClients.set(account.id, calendar);

		} catch (error) {
			console.error(`Failed to initialize Google Calendar client for ${account.email}:`, error);
		}
	}

	/**
	 * Add a new account and initialize its client
	 */
	async addAccount(account: GoogleAccount): Promise<void> {
		await this.initializeAccountClient(account);
	}

	/**
	 * Remove an account and its client
	 */
	async removeAccount(accountId: string): Promise<void> {
		this.accountClients.delete(accountId);
	}

	/**
	 * Get the authorization URL for a new account
	 */
	getAuthorizationUrl(account: GoogleAccount): string {
		const auth = new google.auth.OAuth2(
			account.clientId,
			account.clientSecret,
			'urn:ietf:wg:oauth:2.0:oob'
		);

		const scopes = [
			'https://www.googleapis.com/auth/calendar.readonly',
			'https://www.googleapis.com/auth/calendar.events'
		];

		return auth.generateAuthUrl({
			access_type: 'offline',
			scope: scopes.join(' '),
			prompt: 'consent'
		});
	}

	/**
	 * Exchange authorization code for tokens
	 */
	async exchangeCodeForTokens(account: GoogleAccount, code: string): Promise<void> {
		const auth = new google.auth.OAuth2(
			account.clientId,
			account.clientSecret,
			'urn:ietf:wg:oauth:2.0:oob'
		);

		try {
			const { tokens } = await auth.getToken(code);
			account.tokens = JSON.stringify(tokens);
			
			// Initialize the client with new tokens
			await this.initializeAccountClient(account);
			
		} catch (error) {
			console.error(`Failed to exchange code for tokens for ${account.email}:`, error);
			throw error;
		}
	}

	/**
	 * Get all calendars for an account
	 */
	async getCalendarsForAccount(accountId: string): Promise<any[]> {
		const client = this.accountClients.get(accountId);
		if (!client) {
			throw new Error(`No client found for account ${accountId}`);
		}

		try {
			const response = await client.calendarList.list({
				maxResults: 250,
				showDeleted: false,
				showHidden: false
			});

			return response.data.items || [];
		} catch (error) {
			console.error(`Failed to get calendars for account ${accountId}:`, error);
			throw error;
		}
	}

	/**
	 * Get events for a specific calendar
	 */
	async getEventsForCalendar(
		accountId: string, 
		calendarId: string, 
		dateRange: { start: string; end: string }
	): Promise<CalendarEvent[]> {
		const client = this.accountClients.get(accountId);
		if (!client) {
			throw new Error(`No client found for account ${accountId}`);
		}

		try {
			const timeMin = moment(dateRange.start).toISOString();
			const timeMax = moment(dateRange.end).endOf('day').toISOString();

			const response = await client.events.list({
				calendarId: calendarId,
				timeMin: timeMin,
				timeMax: timeMax,
				maxResults: this.settings.masterCalendar.syncSettings.maxEventsPerSync,
				singleEvents: true,
				orderBy: 'startTime',
				showDeleted: false
			});

			const events = response.data.items || [];
			return events.map((event: any) => this.convertGoogleEventToCalendarEvent(event, accountId, calendarId));

		} catch (error) {
			console.error(`Failed to get events for calendar ${calendarId}:`, error);
			throw error;
		}
	}

	/**
	 * Convert Google Calendar event to our CalendarEvent format
	 */
	private convertGoogleEventToCalendarEvent(googleEvent: any, accountId: string, calendarId: string): CalendarEvent {
		let date: string;
		let startTime: string;
		let endTime: string;

		if (googleEvent.start.date) {
			// All-day event
			date = googleEvent.start.date;
			startTime = 'All Day';
			endTime = 'All Day';
		} else {
			// Timed event
			const startMoment = moment(googleEvent.start.dateTime);
			const endMoment = moment(googleEvent.end.dateTime);
			
			date = startMoment.format('YYYY-MM-DD');
			startTime = startMoment.format('HH:mm');
			endTime = endMoment.format('HH:mm');
		}

		// Get account info for calendar name
		const account = this.settings.masterCalendar.googleAccounts.find(acc => acc.id === accountId);
		const sourceCalendarName = account ? `${account.name || account.email} - ${calendarId}` : calendarId;

		// Extract attendees
		const attendees = (googleEvent.attendees || [])
			.map((attendee: any) => attendee.email || attendee.displayName)
			.filter((email: string) => email);

		// Generate tags
		const tags = ['calendar'];
		if (googleEvent.location) tags.push('location');
		if (attendees.length > 0) tags.push('meeting');
		if (googleEvent.recurrence) tags.push('recurring');

		return {
			id: googleEvent.id,
			title: googleEvent.summary || 'Untitled Event',
			date: date,
			startTime: startTime,
			endTime: endTime,
			location: googleEvent.location,
			description: googleEvent.description,
			attendees: attendees,
			tags: tags,
			sourceCalendarId: calendarId,
			sourceCalendarName: sourceCalendarName,
			lastModified: googleEvent.updated,
			syncStatus: 'synced',
			rawData: googleEvent
		};
	}

	/**
	 * Test account connectivity
	 */
	async testAccountConnection(accountId: string): Promise<boolean> {
		const client = this.accountClients.get(accountId);
		if (!client) {
			return false;
		}

		try {
			await client.calendarList.list({ maxResults: 1 });
			return true;
		} catch (error) {
			console.error(`Account ${accountId} connection test failed:`, error);
			return false;
		}
	}

	/**
	 * Update settings reference
	 */
	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
	}

	/**
	 * Refresh tokens for all accounts
	 */
	async refreshAllTokens(): Promise<void> {
		const refreshPromises = this.settings.masterCalendar.googleAccounts
			.filter(account => account.enabled && account.tokens)
			.map(account => this.refreshAccountTokens(account));

		await Promise.allSettled(refreshPromises);
	}

	/**
	 * Refresh tokens for a specific account
	 */
	private async refreshAccountTokens(account: GoogleAccount): Promise<void> {
		try {
			const auth = new google.auth.OAuth2(
				account.clientId,
				account.clientSecret,
				'urn:ietf:wg:oauth:2.0:oob'
			);

			if (account.tokens) {
				const tokens = JSON.parse(account.tokens);
				auth.setCredentials(tokens);
				
				// This will trigger the 'tokens' event if tokens are refreshed
				await auth.getAccessToken();
			}
		} catch (error) {
			console.error(`Failed to refresh tokens for account ${account.email}:`, error);
		}
	}
}
