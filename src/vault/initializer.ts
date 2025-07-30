import { App, TFolder, Notice } from 'obsidian';
import { PluginSettings } from '../types';
import { NOTE_TEMPLATES } from '../utils/templates';

export class VaultInitializer {
	private app: App;
	private settings: PluginSettings;

	constructor(app: App, settings: PluginSettings) {
		this.app = app;
		this.settings = settings;
	}

	async initializeVault(): Promise<boolean> {
		try {
			new Notice('Initializing Second Brain vault structure...');
			
			// Create folder structure
			await this.createFolderStructure();
			
			// Create template files
			await this.createTemplateFiles();
			
			// Check for required plugins
			await this.checkRequiredPlugins();
			
			// Create sample data
			await this.createSampleData();
			
			new Notice('Second Brain vault initialized successfully!');
			return true;
		} catch (error) {
			console.error('Vault initialization failed:', error);
			new Notice(`Vault initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
			return false;
		}
	}

	private async createFolderStructure(): Promise<void> {
		const folders = [
			this.settings.notesFolder,
			this.settings.transactionsFolder,
			this.settings.eventsFolder,
			this.settings.tasksFolder,
			this.settings.templatesFolder
		];

		for (const folderPath of folders) {
			await this.ensureFolderExists(folderPath);
		}
	}

	private async ensureFolderExists(path: string): Promise<TFolder> {
		const folder = this.app.vault.getAbstractFileByPath(path);
		
		if (folder && folder instanceof TFolder) {
			return folder;
		}
		
		// Create folder if it doesn't exist
		return await this.app.vault.createFolder(path);
	}

	private async createTemplateFiles(): Promise<void> {
		const templateFolder = this.settings.templatesFolder;
		
		// Create template files for each note type
		for (const [templateType, template] of Object.entries(NOTE_TEMPLATES)) {
			const templatePath = `${templateFolder}/${template.name}.md`;
			const templateContent = template.frontmatter + '\n\n' + template.content;
			
			// Check if template already exists
			const existingFile = this.app.vault.getAbstractFileByPath(templatePath);
			if (!existingFile) {
				await this.app.vault.create(templatePath, templateContent);
			}
		}
	}

	private async checkRequiredPlugins(): Promise<void> {
		const requiredPlugins = [
			{ id: 'dataview', name: 'Dataview', essential: true },
			{ id: 'obsidian-tasks-plugin', name: 'Tasks', essential: true },
			{ id: 'calendar', name: 'Calendar', essential: false },
			{ id: 'templater-obsidian', name: 'Templater', essential: false }
		];

		const missingEssential: string[] = [];
		const missingOptional: string[] = [];

		for (const plugin of requiredPlugins) {
			// @ts-ignore - Obsidian API typing issue
			const isEnabled = this.app.plugins?.enabledPlugins?.has(plugin.id) || false;
			
			if (!isEnabled) {
				if (plugin.essential) {
					missingEssential.push(plugin.name);
				} else {
					missingOptional.push(plugin.name);
				}
			}
		}

		if (missingEssential.length > 0) {
			new Notice(`⚠️ Essential plugins missing: ${missingEssential.join(', ')}. Please install and enable them for full functionality.`, 8000);
		}

		if (missingOptional.length > 0) {
			new Notice(`💡 Optional plugins recommended: ${missingOptional.join(', ')}`, 5000);
		}
	}

	private async createSampleData(): Promise<void> {
		// Create sample transaction
		const sampleTransactionPath = `${this.settings.transactionsFolder}/2024-01-15-sample-transaction.md`;
		const sampleTransactionContent = `---
type: transaction
date: "2024-01-15"
amount: "25.99"
merchant: "Coffee Shop"
category: "Food & Drink"
account: "checking"
tags: [finance, expense, food-drink]
transaction_id: "sample-001"
created: "${new Date().toISOString()}"
---

# Coffee Shop - $25.99

**Date:** 2024-01-15
**Category:** Food & Drink
**Account:** checking
**Amount:** $25.99

## Description
Morning coffee and pastry

## Auto-Generated Tags
auto-generated, needs-review

## Notes
<!-- Add your personal notes here -->

## Related
<!-- Links to related notes will appear here -->
`;

		// Create sample event
		const sampleEventPath = `${this.settings.eventsFolder}/2024-01-20-team-meeting.md`;
		const sampleEventContent = `---
type: event
date: "2024-01-20"
start_time: "10:00 AM"
end_time: "11:00 AM"
location: "Conference Room A"
attendees: ["john@example.com", "jane@example.com"]
tags: [calendar, meeting]
event_id: "sample-event-001"
created: "${new Date().toISOString()}"
---

# Team Meeting

**Date:** 2024-01-20
**Time:** 10:00 AM - 11:00 AM
**Location:** Conference Room A

## Description
Weekly team sync and project updates

## Attendees
- john@example.com
- jane@example.com

## Preparation Notes
<!-- Add preparation notes here -->

## Follow-up Actions
<!-- Add follow-up tasks here -->

## Related
<!-- Links to related notes will appear here -->
`;

		// Create sample task
		const sampleTaskPath = `${this.settings.tasksFolder}/review-quarterly-budget.md`;
		const sampleTaskContent = `---
type: task
title: "Review Quarterly Budget"
due_date: "2024-01-31"
priority: "high"
completed: false
project: "Financial Planning"
tags: [tasks, high-priority, deadline]
task_id: "sample-task-001"
created: "${new Date().toISOString()}"
---

# Review Quarterly Budget

**Due Date:** 2024-01-31
**Priority:** high
**Project:** Financial Planning
**Status:** ⏳ Pending

## Description
Review and analyze Q1 budget performance and prepare adjustments for Q2

## Subtasks
- [ ] Gather expense reports
- [ ] Compare against projections
- [ ] Identify cost-saving opportunities
- [ ] Prepare recommendations

## Notes
<!-- Add your notes here -->

## Related
<!-- Links to related notes will appear here -->
`;

		// Create sample general note
		const sampleNotePath = `${this.settings.notesFolder}/second-brain-setup.md`;
		const sampleNoteContent = `---
type: note
title: "Second Brain Setup"
tags: [setup, productivity, knowledge-management]
created: "${new Date().toISOString()}"
---

# Second Brain Setup

## Content
Welcome to your Second Brain Integration! This plugin helps you automatically capture and organize:

- **Transactions** from Plaid
- **Calendar Events** from Google Calendar
- **Tasks** from external sources
- **Notes** with ML-powered suggestions

## Getting Started
1. Configure your API keys in plugin settings
2. Run sync commands to import data
3. Use Dataview queries to analyze your data
4. Export graph data for advanced analysis

## Related
- [[Sample Transaction]]
- [[Sample Event]]
- [[Sample Task]]
`;

		// Only create sample files if they don't exist
		const sampleFiles = [
			{ path: sampleTransactionPath, content: sampleTransactionContent },
			{ path: sampleEventPath, content: sampleEventContent },
			{ path: sampleTaskPath, content: sampleTaskContent },
			{ path: sampleNotePath, content: sampleNoteContent }
		];

		for (const file of sampleFiles) {
			const existingFile = this.app.vault.getAbstractFileByPath(file.path);
			if (!existingFile) {
				await this.app.vault.create(file.path, file.content);
			}
		}
	}

	async isVaultInitialized(): Promise<boolean> {
		// Check if all required folders exist
		const requiredFolders = [
			this.settings.notesFolder,
			this.settings.transactionsFolder,
			this.settings.eventsFolder,
			this.settings.tasksFolder,
			this.settings.templatesFolder
		];

		for (const folderPath of requiredFolders) {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder || !(folder instanceof TFolder)) {
				return false;
			}
		}

		// Check if template files exist
		for (const template of Object.values(NOTE_TEMPLATES)) {
			const templatePath = `${this.settings.templatesFolder}/${template.name}.md`;
			const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
			if (!templateFile) {
				return false;
			}
		}

		return true;
	}

	async resetVault(): Promise<void> {
		const confirmation = confirm(
			'This will delete all Second Brain folders and recreate them. This action cannot be undone. Continue?'
		);

		if (!confirmation) {
			return;
		}

		try {
			// Delete existing folders
			const foldersToDelete = [
				this.settings.notesFolder,
				this.settings.transactionsFolder,
				this.settings.eventsFolder,
				this.settings.tasksFolder,
				this.settings.templatesFolder
			];

			for (const folderPath of foldersToDelete) {
				const folder = this.app.vault.getAbstractFileByPath(folderPath);
				if (folder && folder instanceof TFolder) {
					await this.app.vault.delete(folder, true);
				}
			}

			// Reinitialize
			await this.initializeVault();
			
		} catch (error) {
			console.error('Vault reset failed:', error);
			new Notice(`Vault reset failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}
}
