import { App, TFile, Notice } from 'obsidian';
import { PluginSettings, LLMSuggestion, SuggestionBatch } from '../types';

/**
 * Manages storage and retrieval of LLM suggestions
 * Uses optimized storage strategy to minimize graph clutter
 */
export class SuggestionStorageService {
	private app: App;
	private settings: PluginSettings;
	private storageFolder: string;

	constructor(app: App, settings: PluginSettings) {
		this.app = app;
		this.settings = settings;
		this.storageFolder = settings.suggestionSystem.storageLocation;
	}

	/**
	 * Initialize the suggestion storage system
	 */
	async initialize(): Promise<void> {
		await this.ensureStorageFoldersExist();
		console.log('Suggestion storage service initialized');
	}

	/**
	 * Ensure required storage folders exist
	 */
	private async ensureStorageFoldersExist(): Promise<void> {
		const folders = [
			this.storageFolder,
			`${this.storageFolder}/logs`
		];

		for (const folder of folders) {
			// First check if folder already exists
			const existingFolder = this.app.vault.getAbstractFileByPath(folder);
			if (existingFolder) {
				console.log(`Folder already exists: ${folder}`);
				continue; // Skip to next folder
			}
			
			// Try to create the folder
			try {
				console.log(`Creating suggestion storage folder: ${folder}`);
				await this.app.vault.createFolder(folder);
				console.log(`Successfully created folder: ${folder}`);
			} catch (error: any) {
				console.error(`Error creating folder ${folder}:`, error);
				
				// Check if the error is because folder already exists
				if (error.message && error.message.includes('already exists')) {
					console.log(`Folder was created by another process: ${folder}`);
					continue; // Skip to next folder, this is not a real error
				}
				
				// For any other error, throw it
				throw new Error(`Failed to create suggestion storage folder ${folder}: ${error.message || error}`);
			}
		}
	}

	/**
	 * Store a new suggestion batch
	 */
	async storeSuggestionBatch(batch: SuggestionBatch): Promise<void> {
		try {
			// Store in JSON format (hidden from graph)
			const dataPath = `${this.storageFolder}/pending.json`;
			const existingData = await this.loadPendingSuggestions();
			
			existingData.batches = existingData.batches || [];
			existingData.batches.push(batch);
			
			// Keep only recent batches to avoid bloat
			if (existingData.batches.length > this.settings.suggestionSystem.maxPendingSuggestions) {
				existingData.batches = existingData.batches.slice(-this.settings.suggestionSystem.maxPendingSuggestions);
			}

			await this.saveData(dataPath, existingData);

			// Optionally create user-friendly summary log
			if (this.settings.suggestionSystem.createSummaryLogs) {
				await this.createBatchSummaryLog(batch);
			}

			console.log(`Stored suggestion batch: ${batch.id} with ${batch.suggestions.length} suggestions`);
		} catch (error) {
			console.error('Failed to store suggestion batch:', error);
			throw error;
		}
	}

	/**
	 * Load all pending suggestions
	 */
	async loadPendingSuggestions(): Promise<{ batches: SuggestionBatch[] }> {
		try {
			const dataPath = `${this.storageFolder}/pending.json`;
			return await this.loadData(dataPath) || { batches: [] };
		} catch (error) {
			console.warn('Failed to load pending suggestions, returning empty:', error);
			return { batches: [] };
		}
	}

	/**
	 * Update a suggestion's status
	 */
	async updateSuggestion(suggestionId: string, updates: Partial<LLMSuggestion>): Promise<void> {
		const data = await this.loadPendingSuggestions();
		let found = false;

		for (const batch of data.batches) {
			for (const suggestion of batch.suggestions) {
				if (suggestion.id === suggestionId) {
					Object.assign(suggestion, updates);
					found = true;
					break;
				}
			}
			if (found) break;
		}

		if (found) {
			const dataPath = `${this.storageFolder}/pending.json`;
			await this.saveData(dataPath, data);
			
			// Update batch status
			await this.updateBatchStatuses(data.batches);
		} else {
			throw new Error(`Suggestion not found: ${suggestionId}`);
		}
	}

	/**
	 * Move approved/rejected suggestions to archive
	 */
	async archiveCompletedBatches(): Promise<void> {
		const data = await this.loadPendingSuggestions();
		const completedBatches: SuggestionBatch[] = [];
		const activeBatches: SuggestionBatch[] = [];

		for (const batch of data.batches) {
			if (batch.batchStatus === 'completed') {
				completedBatches.push(batch);
			} else {
				activeBatches.push(batch);
			}
		}

		if (completedBatches.length > 0) {
			// Archive completed batches
			await this.archiveBatches(completedBatches);
			
			// Update pending with only active batches
			const pendingPath = `${this.storageFolder}/pending.json`;
			await this.saveData(pendingPath, { batches: activeBatches });

			console.log(`Archived ${completedBatches.length} completed batches`);
		}
	}

	/**
	 * Get suggestion by ID
	 */
	async getSuggestion(suggestionId: string): Promise<LLMSuggestion | null> {
		const data = await this.loadPendingSuggestions();
		
		for (const batch of data.batches) {
			for (const suggestion of batch.suggestions) {
				if (suggestion.id === suggestionId) {
					return suggestion;
				}
			}
		}
		
		return null;
	}

	/**
	 * Get suggestions by status
	 */
	async getSuggestionsByStatus(status: LLMSuggestion['status']): Promise<LLMSuggestion[]> {
		const data = await this.loadPendingSuggestions();
		const suggestions: LLMSuggestion[] = [];
		
		for (const batch of data.batches) {
			for (const suggestion of batch.suggestions) {
				if (suggestion.status === status) {
					suggestions.push(suggestion);
				}
			}
		}
		
		return suggestions;
	}

	/**
	 * Get suggestion count by status
	 */
	async getSuggestionCounts(): Promise<Record<string, number>> {
		const data = await this.loadPendingSuggestions();
		const counts = {
			pending: 0,
			approved: 0,
			rejected: 0,
			applied: 0
		};

		for (const batch of data.batches) {
			for (const suggestion of batch.suggestions) {
				counts[suggestion.status] = (counts[suggestion.status] || 0) + 1;
			}
		}

		return counts;
	}

	/**
	 * Create a user-friendly summary log for a batch
	 */
	private async createBatchSummaryLog(batch: SuggestionBatch): Promise<void> {
		const logPath = `${this.storageFolder}/logs/batch-${batch.id}.md`;
		
		const content = `---
type: suggestion-batch-log
batch-id: "${batch.id}"
source: "${batch.sourceOperation}"
created: "${batch.timestamp}"
total-suggestions: ${batch.totalSuggestions}
status: "${batch.batchStatus}"
---

# Suggestion Batch: ${batch.type}
*Generated from ${batch.sourceOperation} on ${new Date(batch.timestamp).toLocaleDateString()}*

## Summary
- **Total suggestions**: ${batch.totalSuggestions}
- **Status**: ${batch.batchStatus}
- **Batch ID**: \`${batch.id}\`

## Suggestions Overview

${batch.suggestions.map((suggestion, index) => `
### ${index + 1}. ${suggestion.originalData.title}
- **Type**: ${suggestion.type}
- **Priority**: ${suggestion.priority}
- **Confidence**: ${(suggestion.confidence * 100).toFixed(0)}%
- **Target**: ${suggestion.targetNotePath ? `[[${suggestion.targetNotePath}]]` : 'TBD'}
- **Status**: ${suggestion.status}

**Enhancements**:
${suggestion.suggestions.tags?.length ? `- Tags: ${suggestion.suggestions.tags.join(', ')}` : ''}
${suggestion.suggestions.actionItems?.length ? `- Action Items: ${suggestion.suggestions.actionItems.length} items` : ''}
${suggestion.suggestions.preparationItems?.length ? `- Preparation: ${suggestion.suggestions.preparationItems.length} items` : ''}
${suggestion.suggestions.insights ? `- Insights: ${suggestion.suggestions.insights.substring(0, 100)}...` : ''}
`).join('\n')}

---
*Review suggestions in the LLM Suggestions sidebar*
`;

		try {
			await this.app.vault.create(logPath, content);
		} catch (error) {
			console.warn('Failed to create batch summary log:', error);
		}
	}

	/**
	 * Update batch statuses based on suggestion statuses
	 */
	private async updateBatchStatuses(batches: SuggestionBatch[]): Promise<void> {
		for (const batch of batches) {
			const suggestions = batch.suggestions;
			const pending = suggestions.filter(s => s.status === 'pending').length;
			const approved = suggestions.filter(s => s.status === 'approved').length;
			const rejected = suggestions.filter(s => s.status === 'rejected').length;
			const applied = suggestions.filter(s => s.status === 'applied').length;

			batch.approvedCount = approved;
			batch.rejectedCount = rejected;
			batch.appliedCount = applied;

			if (pending === 0) {
				batch.batchStatus = 'completed';
			} else if (approved > 0 || rejected > 0 || applied > 0) {
				batch.batchStatus = 'partially-approved';
			} else {
				batch.batchStatus = 'pending';
			}
		}
	}

	/**
	 * Archive completed batches
	 */
	private async archiveBatches(batches: SuggestionBatch[]): Promise<void> {
		const archivePath = `${this.storageFolder}/archived.json`;
		const existingArchive = await this.loadData(archivePath) || { batches: [] };
		
		existingArchive.batches.push(...batches);
		
		// Keep only recent archives (last 50 batches)
		if (existingArchive.batches.length > 50) {
			existingArchive.batches = existingArchive.batches.slice(-50);
		}

		await this.saveData(archivePath, existingArchive);
	}

	/**
	 * Save data to JSON file
	 */
	private async saveData(path: string, data: any): Promise<void> {
		const content = JSON.stringify(data, null, 2);
		
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			await this.app.vault.create(path, content);
		}
	}

	/**
	 * Load data from JSON file
	 */
	private async loadData(path: string): Promise<any> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			return JSON.parse(content);
		}
		return null;
	}

	/**
	 * Update settings
	 */
	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
		this.storageFolder = newSettings.suggestionSystem.storageLocation;
	}

	/**
	 * Clear all suggestions (for testing/reset)
	 */
	async clearAllSuggestions(): Promise<void> {
		const paths = [
			`${this.storageFolder}/pending.json`,
			`${this.storageFolder}/archived.json`
		];

		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				await this.app.vault.delete(file);
			}
		}

		new Notice('All suggestions cleared');
	}
}
