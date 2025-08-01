import { App, Notice } from 'obsidian';
import { PluginSettings, LLMSuggestion, SuggestionBatch, CalendarEvent, Transaction } from '../types';
import { IntelligenceBrokerService } from './llm-service';
import { SuggestionStorageService } from './suggestion-storage-service';
import { SuggestionApplicationService } from './suggestion-application-service';

/**
 * Main orchestration service for the LLM suggestion system
 * Coordinates between generation, storage, and application of suggestions
 */
export class SuggestionManagementService {
	private app: App;
	private settings: PluginSettings;
	private llmService: IntelligenceBrokerService;
	private storageService: SuggestionStorageService;
	private applicationService: SuggestionApplicationService;

	constructor(
		app: App, 
		settings: PluginSettings,
		llmService: IntelligenceBrokerService
	) {
		this.app = app;
		this.settings = settings;
		this.llmService = llmService;
		this.storageService = new SuggestionStorageService(app, settings);
		this.applicationService = new SuggestionApplicationService(app, settings);
	}

	/**
	 * Initialize the suggestion management system
	 */
	async initialize(): Promise<void> {
		if (!this.settings.suggestionSystem.enabled) {
			console.log('Suggestion system is disabled');
			return;
		}

		await this.storageService.initialize();
		console.log('Suggestion management service initialized');
	}

	// ===========================================
	// BATCH PROCESSING FOR EVENTS/TRANSACTIONS
	// ===========================================

	/**
	 * Process calendar events and generate suggestions
	 */
	async processCalendarEvents(events: CalendarEvent[], sourceOperation: string = 'calendar-sync'): Promise<SuggestionBatch> {
		if (!this.settings.suggestionSystem.enabled) {
			throw new Error('Suggestion system is disabled');
		}

		console.log(`Processing ${events.length} calendar events for suggestions`);

		const suggestions = await this.llmService.generateBatchEventEnhancements(events);
		
		const batch: SuggestionBatch = {
			id: this.generateBatchId('calendar'),
			type: 'calendar-sync',
			sourceOperation,
			timestamp: new Date().toISOString(),
			suggestions,
			batchStatus: 'pending',
			totalSuggestions: suggestions.length,
			approvedCount: 0,
			rejectedCount: 0,
			appliedCount: 0
		};

		// Auto-approve high confidence suggestions if enabled
		if (this.settings.suggestionSystem.autoApproveHighConfidence) {
			this.autoApproveHighConfidenceSuggestions(batch);
		}

		await this.storageService.storeSuggestionBatch(batch);

		// Notify user
		if (this.settings.suggestionSystem.notifyOnNewSuggestions) {
			const pendingCount = suggestions.filter(s => s.status === 'pending').length;
			const autoApprovedCount = suggestions.filter(s => s.status === 'approved').length;
			
			let message = `Generated ${suggestions.length} event suggestions`;
			if (autoApprovedCount > 0) {
				message += ` (${autoApprovedCount} auto-approved, ${pendingCount} pending review)`;
			} else {
				message += ` pending review`;
			}
			
			new Notice(message);
		}

		return batch;
	}

	/**
	 * Process transactions and generate suggestions
	 */
	async processTransactions(transactions: Transaction[], sourceOperation: string = 'transaction-import'): Promise<SuggestionBatch> {
		if (!this.settings.suggestionSystem.enabled) {
			throw new Error('Suggestion system is disabled');
		}

		console.log(`Processing ${transactions.length} transactions for suggestions`);

		const suggestions: LLMSuggestion[] = [];
		
		for (const transaction of transactions) {
			try {
				const suggestion = await this.llmService.generateTransactionEnhancements(transaction);
				suggestions.push(suggestion);
			} catch (error) {
				console.error(`Failed to enhance transaction ${transaction.id}:`, error);
				// Create minimal error suggestion
				suggestions.push(this.createErrorSuggestion(transaction, 'transaction'));
			}
		}

		const batch: SuggestionBatch = {
			id: this.generateBatchId('transaction'),
			type: 'transaction-import',
			sourceOperation,
			timestamp: new Date().toISOString(),
			suggestions,
			batchStatus: 'pending',
			totalSuggestions: suggestions.length,
			approvedCount: 0,
			rejectedCount: 0,
			appliedCount: 0
		};

		// Auto-approve high confidence suggestions if enabled
		if (this.settings.suggestionSystem.autoApproveHighConfidence) {
			this.autoApproveHighConfidenceSuggestions(batch);
		}

		await this.storageService.storeSuggestionBatch(batch);

		// Notify user
		if (this.settings.suggestionSystem.notifyOnNewSuggestions) {
			const pendingCount = suggestions.filter(s => s.status === 'pending').length;
			new Notice(`Generated ${suggestions.length} transaction suggestions (${pendingCount} pending review)`);
		}

		return batch;
	}

	/**
	 * Process chat thread end and generate suggestions
	 */
	async processChatThreadEnd(threadId: string): Promise<SuggestionBatch | null> {
		if (!this.settings.suggestionSystem.enabled) {
			return null;
		}

		console.log('Processing chat thread end for suggestions');

		// End the thread and get suggestion from IntelligenceBrokerService
		const suggestion = await this.llmService.endCurrentThread();

		if (!suggestion) {
			console.log('No suggestions generated from chat thread');
			return null;
		}

		const batch: SuggestionBatch = {
			id: this.generateBatchId('chat'),
			type: 'chat-thread-end',
			sourceOperation: 'chat-thread-end',
			timestamp: new Date().toISOString(),
			suggestions: [suggestion],
			batchStatus: 'pending',
			totalSuggestions: 1,
			approvedCount: 0,
			rejectedCount: 0,
			appliedCount: 0
		};

		// Auto-approve high confidence suggestions if enabled
		if (this.settings.suggestionSystem.autoApproveHighConfidence) {
			this.autoApproveHighConfidenceSuggestions(batch);
		}

		await this.storageService.storeSuggestionBatch(batch);

		if (this.settings.suggestionSystem.notifyOnNewSuggestions) {
			new Notice(`Generated suggestion from chat conversation`);
		}

		return batch;
	}

	/**
	 * Add a single suggestion to the system (for direct integration)
	 */
	async addSuggestion(suggestion: LLMSuggestion): Promise<void> {
		if (!this.settings.suggestionSystem.enabled) {
			return;
		}

		// Create a single-item batch for this suggestion
		const batch: SuggestionBatch = {
			id: this.generateBatchId('single'),
			type: suggestion.type === 'chat-thread' ? 'chat-thread-end' : 'note-analysis',
			sourceOperation: suggestion.type,
			timestamp: new Date().toISOString(),
			suggestions: [suggestion],
			batchStatus: 'pending',
			totalSuggestions: 1,
			approvedCount: suggestion.status === 'approved' ? 1 : 0,
			rejectedCount: suggestion.status === 'rejected' ? 1 : 0,
			appliedCount: suggestion.status === 'applied' ? 1 : 0
		};

		await this.storageService.storeSuggestionBatch(batch);

		if (this.settings.suggestionSystem.notifyOnNewSuggestions) {
			new Notice(`New suggestion: ${suggestion.originalData.title}`);
		}
	}

	// ===========================================
	// SUGGESTION APPROVAL AND APPLICATION
	// ===========================================

	/**
	 * Approve a suggestion
	 */
	async approveSuggestion(suggestionId: string): Promise<void> {
		await this.storageService.updateSuggestion(suggestionId, { status: 'approved' });
		console.log(`Approved suggestion: ${suggestionId}`);
	}

	/**
	 * Reject a suggestion
	 */
	async rejectSuggestion(suggestionId: string, reason?: string): Promise<void> {
		const updates: Partial<LLMSuggestion> = { status: 'rejected' };
		if (reason) {
			updates.userDecisions = { 
				approvedSuggestions: [], 
				rejectedSuggestions: [reason],
				notes: reason 
			};
		}
		
		await this.storageService.updateSuggestion(suggestionId, updates);
		console.log(`Rejected suggestion: ${suggestionId}`);
	}

	/**
	 * Apply an approved suggestion
	 */
	async applySuggestion(suggestionId: string): Promise<boolean> {
		const suggestion = await this.storageService.getSuggestion(suggestionId);
		if (!suggestion) {
			throw new Error('Suggestion not found');
		}

		if (suggestion.status !== 'approved') {
			throw new Error('Suggestion must be approved before applying');
		}

		const validation = await this.applicationService.validateSuggestion(suggestion);
		if (!validation.valid) {
			throw new Error(`Cannot apply suggestion: ${validation.reason}`);
		}

		const success = await this.applicationService.applySuggestion(suggestion);
		
		if (success) {
			await this.storageService.updateSuggestion(suggestionId, { status: 'applied' });
			new Notice(`Applied suggestion: ${suggestion.originalData.title}`);
		}

		return success;
	}

	/**
	 * Apply all approved suggestions in a batch
	 */
	async applyBatchSuggestions(batchId: string): Promise<{ applied: number; failed: number; errors: string[] }> {
		const data = await this.storageService.loadPendingSuggestions();
		const batch = data.batches.find(b => b.id === batchId);
		
		if (!batch) {
			throw new Error('Batch not found');
		}

		const approvedSuggestions = batch.suggestions.filter(s => s.status === 'approved');
		const result = await this.applicationService.applyMultipleSuggestions(approvedSuggestions);

		// Update applied suggestions
		for (const suggestion of approvedSuggestions) {
			if (!result.errors.some(err => err.includes(suggestion.originalData.title))) {
				await this.storageService.updateSuggestion(suggestion.id, { status: 'applied' });
			}
		}

		new Notice(`Applied ${result.applied} suggestions, ${result.failed} failed`);
		return result;
	}

	/**
	 * Approve all suggestions in a batch
	 */
	async approveAllInBatch(batchId: string): Promise<void> {
		const data = await this.storageService.loadPendingSuggestions();
		const batch = data.batches.find(b => b.id === batchId);
		
		if (!batch) {
			throw new Error('Batch not found');
		}

		for (const suggestion of batch.suggestions) {
			if (suggestion.status === 'pending') {
				await this.storageService.updateSuggestion(suggestion.id, { status: 'approved' });
			}
		}

		new Notice(`Approved all ${batch.suggestions.length} suggestions in batch`);
	}

	// ===========================================
	// UTILITY AND MANAGEMENT
	// ===========================================

	/**
	 * Get pending suggestions for UI display
	 */
	async getPendingSuggestions(): Promise<SuggestionBatch[]> {
		const data = await this.storageService.loadPendingSuggestions();
		return data.batches.filter(batch => batch.batchStatus !== 'completed');
	}

	/**
	 * Get suggestion counts for UI
	 */
	async getSuggestionCounts(): Promise<Record<string, number>> {
		return await this.storageService.getSuggestionCounts();
	}

	/**
	 * Preview what changes a suggestion would make
	 */
	async previewSuggestion(suggestionId: string): Promise<{ original: string; enhanced: string }> {
		const suggestion = await this.storageService.getSuggestion(suggestionId);
		if (!suggestion) {
			throw new Error('Suggestion not found');
		}

		return await this.applicationService.previewSuggestion(suggestion);
	}

	/**
	 * Clean up completed batches
	 */
	async cleanupCompletedBatches(): Promise<void> {
		await this.storageService.archiveCompletedBatches();
	}

	// ===========================================
	// PRIVATE HELPER METHODS
	// ===========================================

	/**
	 * Generate a unique batch ID
	 */
	private generateBatchId(type: string): string {
		const timestamp = Date.now();
		const random = Math.random().toString(36).substr(2, 6);
		return `batch_${type}_${timestamp}_${random}`;
	}

	/**
	 * Auto-approve high confidence suggestions
	 */
	private autoApproveHighConfidenceSuggestions(batch: SuggestionBatch): void {
		let autoApproved = 0;
		
		for (const suggestion of batch.suggestions) {
			if (suggestion.confidence >= this.settings.suggestionSystem.highConfidenceThreshold) {
				suggestion.status = 'approved';
				autoApproved++;
			}
		}

		if (autoApproved > 0) {
			batch.approvedCount = autoApproved;
			console.log(`Auto-approved ${autoApproved} high confidence suggestions`);
		}
	}

	/**
	 * Create error suggestion for failed processing
	 */
	private createErrorSuggestion(data: any, type: string): LLMSuggestion {
		return {
			id: this.generateSuggestionId(),
			type: type as LLMSuggestion['type'],
			sourceId: data.id || 'unknown',
			timestamp: new Date().toISOString(),
			status: 'rejected',
			priority: 'low',
			originalData: {
				title: data.title || data.merchant || 'Unknown',
				type,
				summary: 'Failed to process for suggestions'
			},
			suggestions: {},
			confidence: 0
		};
	}

	/**
	 * Generate unique suggestion ID
	 */
	private generateSuggestionId(): string {
		return `sug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Update settings across all services
	 */
	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
		this.storageService.updateSettings(newSettings);
		this.applicationService.updateSettings(newSettings);
	}

	/**
	 * Get service for external access
	 */
	getStorageService(): SuggestionStorageService {
		return this.storageService;
	}

	getApplicationService(): SuggestionApplicationService {
		return this.applicationService;
	}
}
