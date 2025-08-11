import { App, TFile, Notice } from 'obsidian';
import { PluginSettings, LLMSuggestion, SuggestionBatch } from '../types';

/**
 * Learning data point for GraphNN training
 */
export interface LearningDataPoint {
	id: string;
	timestamp: string;
	
	// Context
	noteSource: string;
	noteType: string;
	vaultContext: {
		totalNotes: number;
		relatedNotesCount: number;
		entityOverlap: string[];
		timeContext: string;
	};
	
	// Suggestion details
	suggestionType: string;
	suggestionSource: 'llm' | 'rule-based';
	ruleType?: string;
	confidence: number;
	reasoning: string;
	
	// User decision
	userDecision: 'approved' | 'rejected';
	userReason?: string;
	userConfidence?: number;
	
	// Features for GraphNN
	features: {
		// Node features
		sourceNodeFeatures: number[];
		targetNodeFeatures?: number[];
		
		// Edge features
		temporalDistance?: number;
		entitySimilarity?: number;
		locationDistance?: number;
		tagOverlap?: number;
		
		// Context features
		vaultDensity: number;
		userActivity: number;
		timeOfDay: number;
	};
}

/**
 * Learning database structure
 */
export interface LearningDatabase {
	suggestions: LearningDataPoint[];
	userPatterns: {
		userId: string;
		approvalRates: Record<string, number>; // by suggestion type
		preferredRules: string[];
		rejectionReasons: Record<string, number>;
		lastUpdated: string;
	};
	modelPerformance: {
		version: string;
		accuracy: number;
		precision: number;
		recall: number;
		lastTrained: string;
	};
}

/**
 * Manages storage and retrieval of LLM suggestions
 * Uses optimized storage strategy to minimize graph clutter
 */
export class SuggestionStorageService {
	private app: App;
	private settings: PluginSettings;
	private storageFolder: string;
	private writeQueue: Map<string, Promise<void>> = new Map();

	constructor(app: App, settings: PluginSettings) {
		this.app = app;
		this.settings = settings;
		this.storageFolder = settings.suggestionSystem.storageLocation;
	}

	/**
	 * Initialize the suggestion storage system
	 */
	async initialize(): Promise<void> {
		console.log(`🚀 Initializing suggestion storage service`);
		console.log(`📂 Storage folder setting: "${this.storageFolder}"`);
		console.log(`⚙️ Settings object:`, {
			enabled: this.settings.suggestionSystem?.enabled,
			storageLocation: this.settings.suggestionSystem?.storageLocation,
			maxPendingSuggestions: this.settings.suggestionSystem?.maxPendingSuggestions
		});
		
		// Check for migration from hidden folder
		await this.migrateFromHiddenFolder();
		
		await this.ensureStorageFoldersExist();
		console.log('✅ Suggestion storage service initialized');
	}

	/**
	 * Migrate data from hidden .suggestions folder to visible suggestions folder
	 */
	private async migrateFromHiddenFolder(): Promise<void> {
		// Only migrate if current setting is 'suggestions' (non-hidden)
		if (this.storageFolder !== 'suggestions') {
			return;
		}

		const hiddenFolder = '.suggestions';
		console.log(`🔄 Checking for migration from hidden folder: ${hiddenFolder}`);
		
		// Since hidden files are not visible to Obsidian's vault API, 
		// we'll try a different approach: attempt to read the hidden pending.json directly
		try {
			// Try to construct the expected hidden file path
			const hiddenPendingPath = `${hiddenFolder}/pending.json`;
			
			console.log(`🔍 Attempting to detect hidden file existence...`);
			
			// Check if we can find any reference to .suggestions in the file system
			// This is tricky since Obsidian doesn't expose hidden files, but we can try
			// to trigger the migration by checking if the user has an old configuration
			
			// For now, let's add a manual migration trigger
			console.log(`ℹ️ If you have data in a hidden .suggestions folder, please:
1. Move /Users/hardik/Documents/Obsidian\\ Vault/.suggestions to /Users/hardik/Documents/Obsidian\\ Vault/suggestions
2. Or run: mv "/Users/hardik/Documents/Obsidian Vault/.suggestions" "/Users/hardik/Documents/Obsidian Vault/suggestions"
3. Then refresh the suggestion view`);
			
			// Try to create a simple test to see if we can access the hidden data
			// by attempting to load from the hidden path
			console.log(`🧪 Testing hidden path access...`);
			const hiddenData = await this.loadData(hiddenPendingPath);
			if (hiddenData && hiddenData.batches && hiddenData.batches.length > 0) {
				console.log(`🎉 Found data in hidden folder! Attempting migration...`);
				
				// Create the new suggestions folder
				await this.ensureStorageFoldersExist();
				
				// Save the data to the new location
				const newPendingPath = `${this.storageFolder}/pending.json`;
				await this.saveData(newPendingPath, hiddenData);
				
				console.log(`✅ Successfully migrated ${hiddenData.batches.length} batches to visible folder`);
			} else {
				console.log(`📂 No data found in hidden folder or folder doesn't exist`);
			}
			
		} catch (error) {
			console.log(`📂 No hidden folder data found (this is normal for new installations):`, error.message);
		}
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
			console.log(`💾 Storing suggestion batch: ${batch.id} with ${batch.suggestions.length} suggestions`);
			
			// Store in JSON format (hidden from graph)
			const dataPath = `${this.storageFolder}/pending.json`;
			const existingData = await this.loadPendingSuggestions();
			
			existingData.batches = existingData.batches || [];
			
			// Check for duplicate batch ID to prevent double-processing
			const existingBatchIds = new Set(existingData.batches.map(b => b.id));
			if (existingBatchIds.has(batch.id)) {
				console.log(`⚠️ Batch ${batch.id} already exists, skipping duplicate storage`);
				return;
			}
			
			existingData.batches.push(batch);
			
			// Keep only recent batches to avoid bloat
			if (existingData.batches.length > this.settings.suggestionSystem.maxPendingSuggestions) {
				console.log(`🧹 Trimming batches: ${existingData.batches.length} -> ${this.settings.suggestionSystem.maxPendingSuggestions}`);
				existingData.batches = existingData.batches.slice(-this.settings.suggestionSystem.maxPendingSuggestions);
			}

			await this.saveData(dataPath, existingData);

			// Optionally create user-friendly summary log
			if (this.settings.suggestionSystem.createSummaryLogs) {
				await this.createBatchSummaryLog(batch);
			}

			console.log(`✅ Successfully stored suggestion batch: ${batch.id} with ${batch.suggestions.length} suggestions`);
		} catch (error) {
			console.error('❌ Failed to store suggestion batch:', error);
			throw error;
		}
	}

	/**
	 * Load all pending suggestions
	 */
	async loadPendingSuggestions(): Promise<{ batches: SuggestionBatch[] }> {
		try {
			const dataPath = `${this.storageFolder}/pending.json`;
			console.log(`📂 Loading pending suggestions from: ${dataPath}`);
			console.log(`📂 Storage folder: ${this.storageFolder}`);
			
			// Try to refresh vault index first
			await this.refreshVaultForFile(dataPath);
			
			const result = await this.loadData(dataPath) || { batches: [] };
			console.log(`📊 Loaded ${result.batches?.length || 0} batches from storage`);
			
			if (result.batches?.length > 0) {
				console.log('📋 Batch details:', result.batches.map(b => ({
					id: b.id,
					type: b.type,
					status: b.batchStatus,
					suggestionCount: b.suggestions?.length || 0,
					pendingSuggestions: b.suggestions?.filter(s => s.status === 'pending').length || 0
				})));
			}
			
			return result;
		} catch (error) {
			console.error('❌ Failed to load pending suggestions:', error);
			console.warn('Failed to load pending suggestions, returning empty:', error);
			return { batches: [] };
		}
	}

	/**
	 * Try to refresh vault's awareness of a file
	 */
	private async refreshVaultForFile(filePath: string): Promise<void> {
		try {
			console.log(`🔄 Attempting to refresh vault awareness of: ${filePath}`);
			
			// Check if file exists in vault
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file) {
				console.log(`📁 File not found in vault, checking if it exists on disk...`);
				
				// Try to get all files and see if we can find it
				const allFiles = this.app.vault.getAllLoadedFiles();
				const matchingFiles = allFiles.filter(f => f.path === filePath);
				console.log(`🔍 Found ${matchingFiles.length} matching files in vault`);
				
				if (matchingFiles.length === 0) {
					console.log(`⚠️ File not found in vault index. It may need to be created or indexed.`);
					
					// Try to trigger a vault refresh
					if (this.app.vault.adapter && 'reconcileDeletion' in this.app.vault.adapter) {
						console.log(`🔄 Attempting to reconcile vault state...`);
						// This is a private method, but we can try
					}
				}
			} else {
				console.log(`✅ File found in vault: ${file.name}`);
			}
		} catch (error) {
			console.warn(`Failed to refresh vault for file ${filePath}:`, error);
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
			// Check if file already exists and create a unique name if needed
			let finalLogPath = logPath;
			let counter = 1;
			
			while (this.app.vault.getAbstractFileByPath(finalLogPath)) {
				const pathParts = logPath.split('.');
				const extension = pathParts.pop();
				const basePath = pathParts.join('.');
				finalLogPath = `${basePath}-${counter}.${extension}`;
				counter++;
			}
			
			await this.app.vault.create(finalLogPath, content);
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
	 * Save data to JSON file with write queue to prevent concurrent access
	 */
	private async saveData(path: string, data: any): Promise<void> {
		// Check if there's already a write operation in progress for this file
		const existingWrite = this.writeQueue.get(path);
		if (existingWrite) {
			console.log(`⏳ Waiting for existing write operation to complete: ${path}`);
			await existingWrite;
			// After waiting, we need to reload the data and merge our changes
			// This prevents overwriting changes made by the concurrent operation
			const currentData = await this.loadData(path) || { batches: [] };
			if (data.batches && currentData.batches) {
				// Merge new batches with existing ones, avoiding duplicates
				const existingBatchIds = new Set(currentData.batches.map(b => b.id));
				const newBatches = data.batches.filter(b => !existingBatchIds.has(b.id));
				if (newBatches.length > 0) {
					currentData.batches.push(...newBatches);
					data = currentData;
				} else {
					console.log(`📋 No new batches to add, current operation already handled by concurrent write`);
					return; // Nothing to do, concurrent operation already handled our data
				}
			}
		}

		// Create a promise for this write operation
		const writePromise = this.performWrite(path, data);
		this.writeQueue.set(path, writePromise);

		try {
			await writePromise;
		} finally {
			// Remove from queue when done
			this.writeQueue.delete(path);
		}
	}

	/**
	 * Perform the actual write operation
	 */
	private async performWrite(path: string, data: any): Promise<void> {
		const content = JSON.stringify(data, null, 2);
		console.log(`💾 Writing to file: ${path} (${content.length} characters)`);
		
		try {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				console.log(`📝 Modifying existing file: ${path}`);
				await this.app.vault.modify(file, content);
			} else {
				console.log(`📁 Creating new file: ${path}`);
				// Ensure parent directory exists
				const pathParts = path.split('/');
				const fileName = pathParts.pop();
				const dirPath = pathParts.join('/');
				
				if (dirPath && !this.app.vault.getAbstractFileByPath(dirPath)) {
					// Parent directory doesn't exist, create it recursively
					await this.ensureDirectoryExists(dirPath);
				}
				
				try {
					await this.app.vault.create(path, content);
					console.log(`✅ Successfully created file: ${path}`);
				} catch (createError) {
					// Handle race condition - file might have been created between check and create
					if (createError.message?.includes('already exists')) {
						console.log(`🔄 File was created by another process, attempting to modify: ${path}`);
						const existingFile = this.app.vault.getAbstractFileByPath(path);
						if (existingFile instanceof TFile) {
							await this.app.vault.modify(existingFile, content);
							console.log(`✅ Successfully modified concurrent file: ${path}`);
						} else {
							throw createError; // Re-throw if still can't find the file
						}
					} else {
						throw createError; // Re-throw other create errors
					}
				}
			}
		} catch (error) {
			console.error(`❌ Failed to save data to ${path}:`, error);
			throw error;
		}
	}

	/**
	 * Ensure directory exists, creating it if necessary
	 */
	private async ensureDirectoryExists(dirPath: string): Promise<void> {
		const pathParts = dirPath.split('/');
		let currentPath = '';
		
		for (const part of pathParts) {
			if (!part) continue; // Skip empty parts
			
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			
			if (!this.app.vault.getAbstractFileByPath(currentPath)) {
				try {
					await this.app.vault.createFolder(currentPath);
				} catch (error) {
					// Folder might already exist due to race condition, ignore
					if (!error.message?.includes('already exists')) {
						throw error;
					}
				}
			}
		}
	}

	/**
	 * Load data from JSON file
	 */
	private async loadData(path: string): Promise<any> {
		console.log(`🔍 Trying to load data from path: ${path}`);
		console.log(`📂 Storage folder setting: ${this.storageFolder}`);
		
		// Try to get vault base path for debugging
		let vaultBasePath = 'N/A';
		try {
			if (this.app.vault.adapter && 'basePath' in this.app.vault.adapter) {
				vaultBasePath = (this.app.vault.adapter as any).basePath;
			}
		} catch (e) {
			// Ignore error, just for debugging
		}
		console.log(`📍 Vault base path: "${vaultBasePath}"`);
		
		// Try to construct absolute path for debugging
		let absolutePath = path;
		if (vaultBasePath !== 'N/A' && !path.startsWith('/')) {
			absolutePath = `${vaultBasePath}/${path}`;
		}
		console.log(`📍 Constructed absolute path: "${absolutePath}"`);
		
		// For terminal command debugging, show escaped version
		if (vaultBasePath !== 'N/A' && vaultBasePath.includes(' ')) {
			const escapedPath = absolutePath.replace(/ /g, '\\ ');
			console.log(`📍 Escaped path for terminal: ${escapedPath}`);
		}
		
		const file = this.app.vault.getAbstractFileByPath(path);
		console.log(`📁 File found:`, file ? `Yes (${file.name})` : 'No');
		
		// Debug: List all files in the storage folder to see what exists
		if (!file) {
			console.log(`🔍 Debugging: Looking for files in storage folder...`);
			const storageFolder = this.app.vault.getAbstractFileByPath(this.storageFolder);
			if (storageFolder) {
				console.log(`📂 Storage folder exists: ${storageFolder.name} (type: ${storageFolder.constructor.name})`);
				
				// Try to list children if it's a folder
				try {
					if ('children' in storageFolder) {
						const children = (storageFolder as any).children;
						if (children && Array.isArray(children)) {
							console.log(`📋 Files in storage folder:`, children.map((f: any) => f.name || f.path));
						} else {
							console.log(`📋 Storage folder children:`, children);
						}
					} else {
						console.log(`📋 Storage folder has no children property`);
					}
				} catch (e) {
					console.log(`📋 Error listing storage folder contents:`, e);
				}
			} else {
				console.log(`❌ Storage folder not found: ${this.storageFolder}`);
				
				// Check if parent folders exist
				const pathParts = this.storageFolder.split('/');
				let currentPath = '';
				for (const part of pathParts) {
					if (!part) continue;
					currentPath = currentPath ? `${currentPath}/${part}` : part;
					const exists = this.app.vault.getAbstractFileByPath(currentPath);
					console.log(`📁 Path check "${currentPath}": ${exists ? 'EXISTS' : 'MISSING'}`);
				}
			}
			
			// Also check if we can find any files with "pending" in the name
			const allFiles = this.app.vault.getAllLoadedFiles();
			const pendingFiles = allFiles.filter(f => f.name?.includes('pending') || f.path?.includes('pending'));
			console.log(`🔎 Found ${pendingFiles.length} files with 'pending' in name/path:`, pendingFiles.map(f => f.path));
			
			// Check all files in suggestions folder if it exists
			const suggestionsFiles = allFiles.filter(f => f.path?.includes('suggestions'));
			console.log(`🔎 Found ${suggestionsFiles.length} files in suggestions folder:`, suggestionsFiles.map(f => f.path));
			
			// Also try alternative path constructions
			console.log(`🔍 Testing alternative path constructions...`);
			const alternativePaths = [
				path,
				`./${path}`,
				path.replace(/^\.\//, ''),
				path.startsWith('.') ? path.substring(1) : `.${path}`,
			];
			
			for (const altPath of alternativePaths) {
				if (altPath !== path) {
					const altFile = this.app.vault.getAbstractFileByPath(altPath);
					console.log(`🔍 Alternative path "${altPath}": ${altFile ? 'FOUND' : 'NOT FOUND'}`);
					if (altFile) {
						console.log(`✅ Found file using alternative path: ${altPath}`);
						// Use the working path for actual file operations
						path = altPath;
						break;
					}
				}
			}
		}
		
		if (file instanceof TFile) {
			console.log(`📖 Reading file content...`);
			const content = await this.app.vault.read(file);
			console.log(`📄 File content length: ${content.length} characters`);
			try {
				const parsed = JSON.parse(content);
				console.log(`✅ Successfully parsed JSON with ${parsed.batches?.length || 0} batches`);
				return parsed;
			} catch (parseError) {
				console.error(`❌ JSON parse error:`, parseError);
				return null;
			}
		}
		console.log(`❌ File not found or not a TFile`);
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

	// Learning Data Collection Methods for GraphNN Training

	/**
	 * Record a user decision on a suggestion for learning purposes
	 */
	async recordUserDecision(
		suggestionId: string,
		decision: 'approved' | 'rejected',
		reason?: string,
		userConfidence?: number
	): Promise<void> {
		try {
			// Get the suggestion details
			const suggestion = await this.getSuggestion(suggestionId);
			if (!suggestion) {
				throw new Error(`Suggestion not found: ${suggestionId}`);
			}

			// Create learning data point
			const learningDataPoint = await this.createLearningDataPoint(
				suggestion,
				decision,
				reason,
				userConfidence
			);

			// Store learning data
			await this.storeLearningData(learningDataPoint);

			// Update user patterns
			await this.updateUserPatterns(suggestion, decision, reason);

			console.log(`📊 Recorded user decision for suggestion ${suggestionId}: ${decision}`);
		} catch (error) {
			console.error('Failed to record user decision:', error);
			throw error;
		}
	}

	/**
	 * Create a learning data point from a suggestion and user decision
	 */
	private async createLearningDataPoint(
		suggestion: LLMSuggestion,
		decision: 'approved' | 'rejected',
		reason?: string,
		userConfidence?: number
	): Promise<LearningDataPoint> {
		// Get vault context
		const vaultContext = await this.getVaultContext(suggestion);
		
		// Extract features for GraphNN
		const features = await this.extractFeatures(suggestion, vaultContext);

		return {
			id: `learning_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			timestamp: new Date().toISOString(),
			
			// Context
			noteSource: suggestion.type,
			noteType: suggestion.originalData.type,
			vaultContext,
			
			// Suggestion details
			suggestionType: this.determineSuggestionType(suggestion),
			suggestionSource: this.determineSuggestionSource(suggestion),
			ruleType: suggestion.suggestions.metadata?.linkType,
			confidence: suggestion.confidence,
			reasoning: suggestion.suggestions.insights || 'No reasoning provided',
			
			// User decision
			userDecision: decision,
			userReason: reason,
			userConfidence,
			
			// Features for GraphNN
			features
		};
	}

	/**
	 * Get vault context for learning data
	 */
	private async getVaultContext(suggestion: LLMSuggestion): Promise<LearningDataPoint['vaultContext']> {
		const files = this.app.vault.getMarkdownFiles();
		const totalNotes = files.length;
		
		// Count related notes (simplified heuristic)
		const relatedNotesCount = await this.countRelatedNotes(suggestion);
		
		// Extract entity overlap (simplified)
		const entityOverlap = this.extractEntityOverlap(suggestion);
		
		// Time context
		const timeContext = this.getTimeContext();

		return {
			totalNotes,
			relatedNotesCount,
			entityOverlap,
			timeContext
		};
	}

	/**
	 * Extract features for GraphNN training
	 */
	private async extractFeatures(
		suggestion: LLMSuggestion,
		vaultContext: LearningDataPoint['vaultContext']
	): Promise<LearningDataPoint['features']> {
		// Node features (simplified - can be enhanced with embeddings)
		const sourceNodeFeatures = [
			suggestion.confidence,
			suggestion.priority === 'high' ? 1 : suggestion.priority === 'medium' ? 0.5 : 0,
			suggestion.type === 'transaction' ? 1 : 0,
			suggestion.type === 'calendar-event' ? 1 : 0,
			suggestion.suggestions.relationships?.length || 0,
			suggestion.suggestions.tags?.length || 0
		];

		// Context features
		const vaultDensity = vaultContext.totalNotes > 0 ? vaultContext.relatedNotesCount / vaultContext.totalNotes : 0;
		const userActivity = await this.getUserActivityScore();
		const timeOfDay = new Date().getHours() / 24; // Normalized hour of day

		return {
			sourceNodeFeatures,
			vaultDensity,
			userActivity,
			timeOfDay,
			// Additional features can be added here
			temporalDistance: this.calculateTemporalDistance(suggestion),
			entitySimilarity: this.calculateEntitySimilarity(suggestion),
			tagOverlap: this.calculateTagOverlap(suggestion)
		};
	}

	/**
	 * Store learning data point
	 */
	private async storeLearningData(dataPoint: LearningDataPoint): Promise<void> {
		const learningPath = `${this.storageFolder}/learning-data.json`;
		const existingData = await this.loadLearningData();
		
		existingData.suggestions.push(dataPoint);
		
		// Keep only recent learning data (last 1000 points)
		if (existingData.suggestions.length > 1000) {
			existingData.suggestions = existingData.suggestions.slice(-1000);
		}

		await this.saveData(learningPath, existingData);
	}

	/**
	 * Load learning data
	 */
	async loadLearningData(): Promise<LearningDatabase> {
		const learningPath = `${this.storageFolder}/learning-data.json`;
		const data = await this.loadData(learningPath);
		
		if (!data) {
			return {
				suggestions: [],
				userPatterns: {
					userId: 'default',
					approvalRates: {},
					preferredRules: [],
					rejectionReasons: {},
					lastUpdated: new Date().toISOString()
				},
				modelPerformance: {
					version: '1.0.0',
					accuracy: 0,
					precision: 0,
					recall: 0,
					lastTrained: new Date().toISOString()
				}
			};
		}
		
		return data;
	}

	/**
	 * Update user patterns based on decisions
	 */
	private async updateUserPatterns(
		suggestion: LLMSuggestion,
		decision: 'approved' | 'rejected',
		reason?: string
	): Promise<void> {
		const learningData = await this.loadLearningData();
		const patterns = learningData.userPatterns;
		
		// Update approval rates
		const suggestionType = this.determineSuggestionType(suggestion);
		if (!patterns.approvalRates[suggestionType]) {
			patterns.approvalRates[suggestionType] = 0;
		}
		
		// Simple moving average for approval rate
		const currentRate = patterns.approvalRates[suggestionType];
		const newRate = decision === 'approved' ? 1 : 0;
		patterns.approvalRates[suggestionType] = (currentRate * 0.9) + (newRate * 0.1);
		
		// Track preferred rules
		if (decision === 'approved' && suggestion.suggestions.metadata?.linkType) {
			const ruleType = suggestion.suggestions.metadata.linkType;
			if (!patterns.preferredRules.includes(ruleType)) {
				patterns.preferredRules.push(ruleType);
			}
		}
		
		// Track rejection reasons
		if (decision === 'rejected' && reason) {
			patterns.rejectionReasons[reason] = (patterns.rejectionReasons[reason] || 0) + 1;
		}
		
		patterns.lastUpdated = new Date().toISOString();
		
		// Save updated patterns
		const learningPath = `${this.storageFolder}/learning-data.json`;
		await this.saveData(learningPath, learningData);
	}

	/**
	 * Export learning data for PyTorch Geometric
	 */
	async exportForPyTorchGeometric(): Promise<{
		nodes: any[];
		edges: any[];
		node_features: number[][];
		edge_features: number[][];
		labels: number[];
		metadata: any;
	}> {
		const learningData = await this.loadLearningData();
		const files = this.app.vault.getMarkdownFiles();
		
		// Create node mapping
		const nodeMap = new Map<string, number>();
		const nodes: any[] = [];
		let nodeIndex = 0;
		
		// Add all notes as nodes
		for (const file of files) {
			nodeMap.set(file.path, nodeIndex);
			nodes.push({
				id: nodeIndex,
				path: file.path,
				type: this.getNodeType(file),
				created: file.stat.ctime
			});
			nodeIndex++;
		}
		
		// Extract edges and features from learning data
		const edges: any[] = [];
		const edge_features: number[][] = [];
		const labels: number[] = [];
		
		for (const dataPoint of learningData.suggestions) {
			// Create edge if both nodes exist
			const sourceIndex = nodeMap.get(dataPoint.noteSource);
			// For now, using a simplified approach - in real implementation,
			// you'd extract target from the suggestion metadata
			
			if (sourceIndex !== undefined) {
				edges.push([sourceIndex, sourceIndex]); // Self-loop for now
				edge_features.push([
					dataPoint.confidence,
					dataPoint.features.temporalDistance || 0,
					dataPoint.features.entitySimilarity || 0,
					dataPoint.features.tagOverlap || 0
				]);
				labels.push(dataPoint.userDecision === 'approved' ? 1 : 0);
			}
		}
		
		// Extract node features
		const node_features: number[][] = nodes.map(node => [
			node.created / 1000000000, // Normalized timestamp
			node.type === 'transaction' ? 1 : 0,
			node.type === 'calendar-event' ? 1 : 0,
			node.type === 'manual' ? 1 : 0,
			// Add more features as needed
		]);
		
		return {
			nodes,
			edges,
			node_features,
			edge_features,
			labels,
			metadata: {
				total_nodes: nodes.length,
				total_edges: edges.length,
				total_labels: labels.length,
				approval_rate: labels.reduce((a, b) => a + b, 0) / labels.length,
				export_timestamp: new Date().toISOString(),
				user_patterns: learningData.userPatterns
			}
		};
	}

	/**
	 * Get learning statistics
	 */
	async getLearningStatistics(): Promise<{
		totalDecisions: number;
		approvalRate: number;
		rejectionRate: number;
		topApprovedTypes: Array<{ type: string; rate: number }>;
		topRejectionReasons: Array<{ reason: string; count: number }>;
	}> {
		const learningData = await this.loadLearningData();
		const decisions = learningData.suggestions;
		
		const totalDecisions = decisions.length;
		const approved = decisions.filter(d => d.userDecision === 'approved').length;
		const rejected = decisions.filter(d => d.userDecision === 'rejected').length;
		
		const approvalRate = totalDecisions > 0 ? approved / totalDecisions : 0;
		const rejectionRate = totalDecisions > 0 ? rejected / totalDecisions : 0;
		
		// Top approved types
		const approvalRates = learningData.userPatterns.approvalRates;
		const topApprovedTypes = Object.entries(approvalRates)
			.map(([type, rate]) => ({ type, rate }))
			.sort((a, b) => b.rate - a.rate)
			.slice(0, 5);
		
		// Top rejection reasons
		const rejectionReasons = learningData.userPatterns.rejectionReasons;
		const topRejectionReasons = Object.entries(rejectionReasons)
			.map(([reason, count]) => ({ reason, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);
		
		return {
			totalDecisions,
			approvalRate,
			rejectionRate,
			topApprovedTypes,
			topRejectionReasons
		};
	}

	// Helper methods for learning data

	private determineSuggestionType(suggestion: LLMSuggestion): string {
		return suggestion.suggestions.metadata?.linkType || suggestion.type || 'unknown';
	}

	private determineSuggestionSource(suggestion: LLMSuggestion): 'llm' | 'rule-based' {
		return suggestion.suggestions.metadata?.source === 'llm-relationship-discovery' ? 'llm' : 'rule-based';
	}

	private async countRelatedNotes(suggestion: LLMSuggestion): Promise<number> {
		// Simplified implementation - count notes with similar tags or entities
		return suggestion.suggestions.relationships?.length || 0;
	}

	private extractEntityOverlap(suggestion: LLMSuggestion): string[] {
		// Extract entities from suggestion metadata
		return suggestion.suggestions.metadata?.matchedEntities || [];
	}

	private getTimeContext(): string {
		const hour = new Date().getHours();
		if (hour < 6) return 'night';
		if (hour < 12) return 'morning';
		if (hour < 18) return 'afternoon';
		return 'evening';
	}

	private async getUserActivityScore(): Promise<number> {
		// Simplified activity score based on recent suggestions
		const data = await this.loadPendingSuggestions();
		const recentSuggestions = data.batches.filter(batch => 
			Date.now() - new Date(batch.timestamp).getTime() < 24 * 60 * 60 * 1000 // Last 24 hours
		);
		return Math.min(1, recentSuggestions.length / 10); // Normalized to 0-1
	}

	private calculateTemporalDistance(suggestion: LLMSuggestion): number {
		// Calculate time distance from suggestion metadata
		return suggestion.suggestions.metadata?.timeWindow || 0;
	}

	private calculateEntitySimilarity(suggestion: LLMSuggestion): number {
		// Calculate entity similarity score
		const entities = suggestion.suggestions.metadata?.matchedEntities || [];
		return entities.length > 0 ? 1 : 0; // Simplified
	}

	private calculateTagOverlap(suggestion: LLMSuggestion): number {
		// Calculate tag overlap score
		const tags = suggestion.suggestions.tags || [];
		const commonTags = suggestion.suggestions.metadata?.commonTags || [];
		return commonTags.length / Math.max(1, tags.length);
	}

	private getNodeType(file: TFile): string {
		// Determine node type from file path or frontmatter
		if (file.path.includes('Transactions/')) return 'transaction';
		if (file.path.includes('Events/')) return 'calendar-event';
		if (file.path.includes('Chat/')) return 'chat';
		return 'manual';
	}
}
