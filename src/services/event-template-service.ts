import { App, TFile, TFolder } from 'obsidian';
import { PluginSettings, CalendarEvent } from '../types';
const moment = require('moment');

export class EventTemplateService {
	private app: App;
	private settings: PluginSettings;
	private processedEvents: Set<string> = new Set(); // Track events that have been processed

	constructor(app: App, settings: PluginSettings) {
		this.app = app;
		this.settings = settings;
	}

	async initialize(): Promise<void> {
		await this.ensureFoldersExist();
		console.log('Event template service initialized');
	}

	/**
	 * Ensure required folders exist
	 */
	private async ensureFoldersExist(): Promise<void> {
		const eventSettings = this.settings.masterCalendar.eventSettings;
		
		// Ensure events folder exists
		if (eventSettings.eventNotesFolder) {
			await this.ensureFolderExists(eventSettings.eventNotesFolder);
		}

		// Ensure template folder exists
		if (eventSettings.useEventTemplates && eventSettings.templateFolder) {
			await this.ensureFolderExists(eventSettings.templateFolder);
			await this.createDefaultTemplates();
		}
	}

	/**
	 * Ensure a folder exists, create if it doesn't
	 */
	private async ensureFolderExists(folderPath: string): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	/**
	 * Create default event templates if they don't exist
	 */
	private async createDefaultTemplates(): Promise<void> {
		const templateFolder = this.settings.masterCalendar.eventSettings.templateFolder;
		const templates = [
			{
				name: 'default-event.md',
				content: this.getDefaultEventTemplate()
			},
			{
				name: 'meeting-event.md',
				content: this.getMeetingEventTemplate()
			},
			{
				name: 'all-day-event.md',
				content: this.getAllDayEventTemplate()
			}
		];

		for (const template of templates) {
			const templatePath = `${templateFolder}/${template.name}`;
			const existingTemplate = this.app.vault.getAbstractFileByPath(templatePath);
			
			if (!existingTemplate) {
				await this.app.vault.create(templatePath, template.content);
			}
		}
	}

	/**
	 * Create a note for a calendar event
	 */
	async createEventNote(event: CalendarEvent): Promise<TFile | null> {
		console.log(`createEventNote called for event: ${event.title}`);
		console.log('Event data:', event);
		console.log('Settings:', this.settings.masterCalendar.eventSettings);
		
		if (!this.settings.masterCalendar.eventSettings.createEventNotes) {
			console.log('createEventNotes setting is false, returning null');
			return null;
		}

		// Check if event should be included
		if (!this.shouldIncludeEvent(event)) {
			console.log('Event should not be included, returning null');
			return null;
		}

		// Check if we've already processed this event
		const eventKey = `${event.sourceCalendarId}:${event.id}`;
		console.log(`Event key: ${eventKey}`);
		if (this.processedEvents.has(eventKey)) {
			console.log('Event already processed, returning null');
			return null;
		}

		try {
			// Ensure event notes folder exists before creating note
			await this.ensureFolderExists(this.settings.masterCalendar.eventSettings.eventNotesFolder);
			
			const notePath = this.getEventNotePath(event);
			console.log(`Generated note path: ${notePath}`);
			
			// Check if note already exists
			const existingNote = this.app.vault.getAbstractFileByPath(notePath);
			if (existingNote instanceof TFile) {
				console.log(`Event note already exists: ${notePath}`);
				this.processedEvents.add(eventKey);
				return existingNote;
			}

			// Generate content from template
			console.log('Generating event content...');
			const content = await this.generateEventContent(event);
			console.log('Generated content length:', content.length);
			
			// Create the note
			console.log(`Creating note at path: ${notePath}`);
			const noteFile = await this.app.vault.create(notePath, content);
			this.processedEvents.add(eventKey);
			
			console.log(`Created event note: ${notePath}`);
			return noteFile;

		} catch (error) {
			console.error(`Failed to create event note for ${event.title}:`, error);
			console.error('Event data:', event);
			console.error('Settings:', this.settings.masterCalendar.eventSettings);
			
			// Provide more specific error information
			if (error instanceof Error) {
				if (error.message.includes('ENOENT')) {
					console.error('Directory does not exist - folder creation may have failed');
				} else if (error.message.includes('file already exists')) {
					console.error('File already exists but was not detected by our check');
				}
			}
			
			return null;
		}
	}

	/**
	 * Check if an event should be included based on settings
	 */
	private shouldIncludeEvent(event: CalendarEvent): boolean {
		const eventSettings = this.settings.masterCalendar.eventSettings;
		
		// For now, always include events if event notes are enabled
		// Future: Add more filtering logic based on user preferences
		return eventSettings.createEventNotes;
	}

	/**
	 * Generate the file path for an event note
	 */
	private getEventNotePath(event: CalendarEvent): string {
		const eventSettings = this.settings.masterCalendar.eventSettings;
		const fileName = this.generateEventFileName(event);
		
		const fullPath = `${eventSettings.eventNotesFolder}/${fileName}.md`;
		console.log('Generated file path:', fullPath);
		console.log('Event notes folder:', eventSettings.eventNotesFolder);
		
		return fullPath;
	}

	/**
	 * Generate a file name for an event
	 */
	private generateEventFileName(event: CalendarEvent): string {
		const nameFormat = this.settings.masterCalendar.eventSettings.eventNoteNameFormat;
		const safeTitle = this.sanitizeFileName(event.title);
		
		let fileName = nameFormat
			.replace(/{{title}}/g, safeTitle)
			.replace(/{{date}}/g, event.date)
			.replace(/{{startTime}}/g, event.startTime.replace(/[:\s]/g, ''))
			.replace(/{{id}}/g, event.id.replace(/[^\w-]/g, '-'))
			.replace(/{{calendar}}/g, this.sanitizeFileName(event.sourceCalendarName));

		// Ensure unique filename by adding timestamp if needed
		const timestamp = moment().format('HHmmss');
		fileName = fileName.replace(/{{timestamp}}/g, timestamp);

		// Final sanitization to ensure no illegal characters
		fileName = this.sanitizeFileName(fileName);
		
		// Ensure filename is not empty
		if (!fileName || fileName.trim() === '') {
			fileName = `event-${event.date}-${timestamp}`;
		}

		return fileName;
	}

	/**
	 * Sanitize a string to be safe for file names
	 */
	private sanitizeFileName(input: string): string {
		return input
			.replace(/[<>:"/\\|?*]/g, '-')
			.replace(/\s+/g, ' ')
			.trim()
			.substring(0, 100); // Limit length
	}

	/**
	 * Generate content for an event note using templates
	 */
	private async generateEventContent(event: CalendarEvent): Promise<string> {
		console.log('generateEventContent called');
		console.log('useEventTemplates:', this.settings.masterCalendar.eventSettings.useEventTemplates);
		
		if (!this.settings.masterCalendar.eventSettings.useEventTemplates) {
			console.log('Templates disabled, using basic content');
			return this.generateBasicEventContent(event);
		}

		const templateName = this.selectTemplate(event);
		console.log('Selected template:', templateName);
		const templateContent = await this.loadTemplate(templateName);
		console.log('Template content loaded:', templateContent ? 'success' : 'failed');
		
		if (!templateContent) {
			console.log('No template content found, falling back to basic content');
			return this.generateBasicEventContent(event);
		}

		console.log('Processing template with event data');
		return this.processTemplate(templateContent, event);
	}

	/**
	 * Select appropriate template based on event characteristics
	 */
	private selectTemplate(event: CalendarEvent): string {
		if (event.startTime === 'All Day') {
			return 'all-day-event.md';
		} else if (event.attendees.length > 0) {
			return 'meeting-event.md';
		} else {
			return 'default-event.md';
		}
	}

	/**
	 * Load template content
	 */
	private async loadTemplate(templateName: string): Promise<string | null> {
		const templatePath = `${this.settings.masterCalendar.eventSettings.templateFolder}/${templateName}`;
		const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
		
		if (templateFile instanceof TFile) {
			return await this.app.vault.read(templateFile);
		}
		
		return null;
	}

	/**
	 * Process template with event data
	 */
	private processTemplate(template: string, event: CalendarEvent): string {
		const formattedDate = moment(event.date).format('dddd, MMMM Do YYYY');
		const timeString = event.startTime === 'All Day' ? 'All Day' : `${event.startTime} - ${event.endTime}`;
		
		let processed = template
			.replace(/{{title}}/g, event.title)
			.replace(/{{date}}/g, event.date)
			.replace(/{{formattedDate}}/g, formattedDate)
			.replace(/{{startTime}}/g, event.startTime)
			.replace(/{{endTime}}/g, event.endTime)
			.replace(/{{timeString}}/g, timeString)
			.replace(/{{location}}/g, event.location || '')
			.replace(/{{description}}/g, event.description || '')
			.replace(/{{attendees}}/g, event.attendees.join(', '))
			.replace(/{{calendar}}/g, event.sourceCalendarName)
			.replace(/{{calendarId}}/g, event.sourceCalendarId)
			.replace(/{{tags}}/g, event.tags.join(', '))
			.replace(/{{id}}/g, event.id)
			.replace(/{{lastModified}}/g, event.lastModified);

		// Handle conditional blocks for location
		if (event.location) {
			processed = processed.replace(/{{#if location}}(.*?){{\/if}}/gs, '$1');
		} else {
			processed = processed.replace(/{{#if location}}.*?{{\/if}}/gs, '');
		}

		// Handle conditional blocks for description
		if (event.description) {
			processed = processed.replace(/{{#if description}}(.*?){{\/if}}/gs, '$1');
		} else {
			processed = processed.replace(/{{#if description}}.*?{{\/if}}/gs, '');
		}

		// Handle attendees list
		if (event.attendees && event.attendees.length > 0) {
			const attendeesList = event.attendees.map(attendee => `- ${attendee}`).join('\n');
			processed = processed.replace(/{{#if attendees}}(.*?){{\/if}}/gs, '$1');
			processed = processed.replace(/{{#each attendees}}.*?{{\/each}}/gs, attendeesList);
		} else {
			processed = processed.replace(/{{#if attendees}}.*?{{\/if}}/gs, '');
			processed = processed.replace(/{{#each attendees}}.*?{{\/each}}/gs, '');
		}

		return processed;
	}

	/**
	 * Generate basic event content without templates
	 */
	private generateBasicEventContent(event: CalendarEvent): string {
		const frontmatter = {
			type: 'calendar-event',
			title: event.title,
			date: event.date,
			'start-time': event.startTime,
			'end-time': event.endTime,
			calendar: event.sourceCalendarName,
			'calendar-id': event.sourceCalendarId,
			'event-id': event.id,
			'last-modified': event.lastModified,
			tags: event.tags
		};

		let content = '---\n';
		for (const [key, value] of Object.entries(frontmatter)) {
			if (Array.isArray(value)) {
				content += `${key}: [${value.map(v => `"${v}"`).join(', ')}]\n`;
			} else {
				content += `${key}: "${value}"\n`;
			}
		}
		content += '---\n\n';
		
		content += `# ${event.title}\n\n`;
		
		if (event.startTime !== 'All Day') {
			content += `**Time:** ${event.startTime} - ${event.endTime}\n`;
		} else {
			content += `**Time:** All Day\n`;
		}
		
		if (event.location) {
			content += `**Location:** ${event.location}\n`;
		}
		
		content += `**Calendar:** ${event.sourceCalendarName}\n\n`;
		
		if (event.description) {
			content += `## Description\n${event.description}\n\n`;
		}
		
		if (event.attendees.length > 0) {
			content += `## Attendees\n`;
			for (const attendee of event.attendees) {
				content += `- ${attendee}\n`;
			}
			content += '\n';
		}
		
		content += `## Notes\n<!-- Add your notes here -->\n`;
		
		return content;
	}

	/**
	 * Get default event template
	 */
	private getDefaultEventTemplate(): string {
		return `---
type: calendar-event
title: "{{title}}"
date: {{date}}
start-time: "{{startTime}}"
end-time: "{{endTime}}"
calendar: "{{calendar}}"
calendar-id: "{{calendarId}}"
event-id: "{{id}}"
last-modified: "{{lastModified}}"
tags: [{{tags}}]
---

# {{title}}

**Date:** {{formattedDate}}  
**Time:** {{timeString}}  
{{#if location}}**Location:** {{location}}  {{/if}}
**Calendar:** {{calendar}}

{{#if description}}
## Description
{{description}}
{{/if}}

{{#if attendees}}
## Attendees
{{#each attendees}}
- {{this}}
{{/each}}
{{/if}}

## Notes
<!-- Add your notes here -->

## Action Items
- [ ] 

## Related
<!-- Link to related notes -->
`;
	}

	/**
	 * Get meeting event template
	 */
	private getMeetingEventTemplate(): string {
		return `---
type: calendar-event
subtype: meeting
title: "{{title}}"
date: {{date}}
start-time: "{{startTime}}"
end-time: "{{endTime}}"
calendar: "{{calendar}}"
calendar-id: "{{calendarId}}"
event-id: "{{id}}"
last-modified: "{{lastModified}}"
tags: [meeting, {{tags}}]
---

# 🤝 {{title}}

**Date:** {{formattedDate}}  
**Time:** {{timeString}}  
{{#if location}}**Location:** {{location}}  {{/if}}
**Calendar:** {{calendar}}

## Attendees
{{#each attendees}}
- {{this}}
{{/each}}

{{#if description}}
## Agenda / Description
{{description}}
{{/if}}

## Meeting Notes
<!-- Take notes during the meeting -->

## Action Items
- [ ] 

## Decisions Made
<!-- Record key decisions -->

## Follow-up
<!-- Next steps and follow-up actions -->

## Related
<!-- Link to related notes, projects, or people -->
`;
	}

	/**
	 * Get all-day event template
	 */
	private getAllDayEventTemplate(): string {
		return `---
type: calendar-event
subtype: all-day
title: "{{title}}"
date: {{date}}
start-time: "All Day"
end-time: "All Day"
calendar: "{{calendar}}"
calendar-id: "{{calendarId}}"
event-id: "{{id}}"
last-modified: "{{lastModified}}"
tags: [all-day, {{tags}}]
---

# 📅 {{title}}

**Date:** {{formattedDate}}  
**Type:** All Day Event  
{{#if location}}**Location:** {{location}}  {{/if}}
**Calendar:** {{calendar}}

{{#if description}}
## Description
{{description}}
{{/if}}

## Notes
<!-- Add your notes here -->

## Preparation
- [ ] 

## Related
<!-- Link to related notes -->
`;
	}

	/**
	 * Update settings
	 */
	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
	}

	/**
	 * Clear processed events cache
	 */
	clearProcessedEventsCache(): void {
		this.processedEvents.clear();
	}
}
