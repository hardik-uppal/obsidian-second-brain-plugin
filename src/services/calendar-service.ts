import { google } from 'googleapis';
import { PluginSettings, CalendarEvent } from '../types';
import { Notice } from 'obsidian';

export class CalendarService {
	private settings: PluginSettings;
	private calendar: any;

	constructor(settings: PluginSettings) {
		this.settings = settings;
		this.initializeClient();
	}

	private initializeClient(): void {
		try {
			if (this.settings.googleCalendarCredentials) {
				const credentials = JSON.parse(this.settings.googleCalendarCredentials);
				const auth = new google.auth.OAuth2(
					credentials.client_id,
					credentials.client_secret,
					credentials.redirect_uri
				);

				if (credentials.refresh_token) {
					auth.setCredentials({
						refresh_token: credentials.refresh_token,
						access_token: credentials.access_token
					});
				}

				this.calendar = google.calendar({ version: 'v3', auth });
			} else if (this.settings.googleCalendarApiKey) {
				// Use API key for read-only access
				this.calendar = google.calendar({
					version: 'v3',
					auth: this.settings.googleCalendarApiKey
				});
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

	async getEvents(startDate?: string, endDate?: string, maxResults: number = 100): Promise<any[]> {
		try {
			if (!this.calendar) {
				throw new Error('Calendar client not initialized');
			}

			// Default to next 30 days if no dates provided
			const timeMin = startDate || new Date().toISOString();
			const timeMax = endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

			const calendarId = this.settings.googleCalendarId || 'primary';

			const response = await this.calendar.events.list({
				calendarId: calendarId,
				timeMin: timeMin,
				timeMax: timeMax,
				maxResults: maxResults,
				singleEvents: true,
				orderBy: 'startTime',
			});

			return response.data.items || [];
		} catch (error) {
			console.error('Failed to fetch events:', error);
			throw error;
		}
	}

	async getNewEvents(): Promise<any[]> {
		try {
			const lastSync = this.settings.lastEventSync;
			const startDate = lastSync || new Date().toISOString();
			const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

			return await this.getEvents(startDate, endDate);
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

	// OAuth flow helpers
	generateAuthUrl(): string {
		try {
			if (!this.settings.googleCalendarCredentials) {
				throw new Error('Google Calendar credentials not configured');
			}

			const credentials = JSON.parse(this.settings.googleCalendarCredentials);
			const auth = new google.auth.OAuth2(
				credentials.client_id,
				credentials.client_secret,
				credentials.redirect_uri
			);

			const scopes = [
				'https://www.googleapis.com/auth/calendar.readonly',
				'https://www.googleapis.com/auth/calendar.events'
			];

			return auth.generateAuthUrl({
				access_type: 'offline',
				scope: scopes,
			});
		} catch (error) {
			console.error('Failed to generate auth URL:', error);
			throw error;
		}
	}

	async exchangeCodeForTokens(code: string): Promise<any> {
		try {
			if (!this.settings.googleCalendarCredentials) {
				throw new Error('Google Calendar credentials not configured');
			}

			const credentials = JSON.parse(this.settings.googleCalendarCredentials);
			const auth = new google.auth.OAuth2(
				credentials.client_id,
				credentials.client_secret,
				credentials.redirect_uri
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
			(this.settings.googleCalendarApiKey || this.settings.googleCalendarCredentials) &&
			this.settings.googleCalendarId
		);
	}

	getConfigurationStatus(): { configured: boolean; missing: string[] } {
		const missing: string[] = [];
		
		if (!this.settings.googleCalendarApiKey && !this.settings.googleCalendarCredentials) {
			missing.push('API Key or OAuth Credentials');
		}
		if (!this.settings.googleCalendarId) {
			missing.push('Calendar ID');
		}

		return {
			configured: missing.length === 0,
			missing
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

			const calendarId = this.settings.googleCalendarId || 'primary';

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
}
