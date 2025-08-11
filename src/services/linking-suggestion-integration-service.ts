import { App, Notice } from 'obsidian';
import { PluginSettings, LLMSuggestion, SuggestionBatch, CalendarEvent, Transaction } from '../types';
import { NoteLinkingService, LinkSuggestion, LinkAnalysisResult } from './note-linking-service';
import { SuggestionManagementService } from './suggestion-management-service';
import { IntelligenceBrokerService } from './llm-service';

/**
 * Integration service that bridges the note linking system with LLM suggestions
 * Combines rule-based linking with AI-powered relationship discovery
 */
export class LinkingSuggestionIntegrationService {
	private app: App;
	private settings: PluginSettings;
	private linkingService: NoteLinkingService;
	private suggestionService: SuggestionManagementService;
	private llmService: IntelligenceBrokerService;
	
	constructor(
		app: App,
		settings: PluginSettings,
		linkingService: NoteLinkingService,
		suggestionService: SuggestionManagementService,
		llmService: IntelligenceBrokerService
	) {
		this.app = app;
		this.settings = settings;
		this.linkingService = linkingService;
		this.suggestionService = suggestionService;
		this.llmService = llmService;
	}
	
	/**
	 * Initialize the integration service
	 */
	async initialize(): Promise<void> {
		console.log('🔗🤖 Initializing Linking-Suggestion Integration Service...');
		
		await this.linkingService.initialize();
		
		console.log('✅ Linking-Suggestion Integration Service initialized');
	}
	
	/**
	 * Process a new transaction note for automatic linking and suggestions
	 */
	async processNewTransactionNote(
		transaction: Transaction, 
		notePath: string
	): Promise<{ links: LinkAnalysisResult; suggestions?: SuggestionBatch }> {
		console.log(`🔗💰 Processing transaction note for linking: ${notePath}`);
		
		// 1. Apply rule-based linking
		const linkAnalysis = await this.linkingService.analyzeNote(notePath);
		
		// 2. Auto-apply high confidence links
		if (linkAnalysis.autoAppliedLinks.length > 0) {
			await this.linkingService.applyHighConfidenceLinks(linkAnalysis.autoAppliedLinks);
		}
		
		// 3. Convert medium confidence links to LLM suggestions for enhancement
		let suggestions: SuggestionBatch | undefined;
		if (linkAnalysis.queuedForReview.length > 0 && this.settings.suggestionSystem?.enabled) {
			suggestions = await this.convertLinksToSuggestions(
				linkAnalysis.queuedForReview,
				transaction,
				'transaction-linking'
			);
			
			// Use duplicate detection for automated transaction linking suggestions
			await this.suggestionService.addSuggestionWithDuplicateCheck(suggestions.suggestions[0], false);
		}
		
		// 4. Generate additional LLM-powered relationship suggestions
		if (this.settings.suggestionSystem?.enabled) {
			const llmSuggestions = await this.generateLLMRelationshipSuggestions(
				transaction,
				notePath,
				'transaction'
			);
			
			if (llmSuggestions.length > 0) {
				const llmBatch = await this.createLLMSuggestionBatch(llmSuggestions, 'transaction-llm-linking');
				
				// Add to existing suggestions or create new batch
				if (suggestions) {
					suggestions.suggestions.push(...llmBatch.suggestions);
					suggestions.totalSuggestions += llmBatch.totalSuggestions;
				} else {
					suggestions = llmBatch;
				}
			}
		}
		
		this.logLinkingResults(linkAnalysis, 'transaction');
		
		return { links: linkAnalysis, suggestions };
	}
	
	/**
	 * Process a new calendar event note for automatic linking and suggestions
	 */
	async processNewCalendarNote(
		event: CalendarEvent, 
		notePath: string
	): Promise<{ links: LinkAnalysisResult; suggestions?: SuggestionBatch }> {
		console.log(`🔗📅 Processing calendar note for linking: ${notePath}`);
		
		// 1. Apply rule-based linking
		const linkAnalysis = await this.linkingService.analyzeNote(notePath);
		
		// 2. Auto-apply high confidence links
		if (linkAnalysis.autoAppliedLinks.length > 0) {
			await this.linkingService.applyHighConfidenceLinks(linkAnalysis.autoAppliedLinks);
		}
		
		// 3. Convert medium confidence links to LLM suggestions
		let suggestions: SuggestionBatch | undefined;
		if (linkAnalysis.queuedForReview.length > 0 && this.settings.suggestionSystem?.enabled) {
			suggestions = await this.convertLinksToSuggestions(
				linkAnalysis.queuedForReview,
				event,
				'calendar-linking'
			);
			
			// Use duplicate detection for automated calendar linking suggestions  
			await this.suggestionService.addSuggestionWithDuplicateCheck(suggestions.suggestions[0], false);
		}
		
		// 4. Generate LLM relationship suggestions
		if (this.settings.suggestionSystem?.enabled) {
			const llmSuggestions = await this.generateLLMRelationshipSuggestions(
				event,
				notePath,
				'calendar-event'
			);
			
			if (llmSuggestions.length > 0) {
				const llmBatch = await this.createLLMSuggestionBatch(llmSuggestions, 'calendar-llm-linking');
				
				if (suggestions) {
					suggestions.suggestions.push(...llmBatch.suggestions);
					suggestions.totalSuggestions += llmBatch.totalSuggestions;
				} else {
					suggestions = llmBatch;
				}
			}
		}
		
		this.logLinkingResults(linkAnalysis, 'calendar');
		
		return { links: linkAnalysis, suggestions };
	}
	
	/**
	 * Convert rule-based link suggestions to LLM suggestions for user review
	 */
	private async convertLinksToSuggestions(
		linkSuggestions: LinkSuggestion[],
		sourceData: Transaction | CalendarEvent,
		operation: string
	): Promise<SuggestionBatch> {
		const suggestions: LLMSuggestion[] = [];
		
		for (const link of linkSuggestions) {
			const suggestion: LLMSuggestion = {
				id: this.generateSuggestionId(),
				type: this.isTransaction(sourceData) ? 'transaction' : 'calendar-event',
				sourceId: this.isTransaction(sourceData) ? sourceData.id : sourceData.id,
				timestamp: new Date().toISOString(),
				status: 'pending',
				priority: this.mapConfidenceToPriority(link.confidence),
				
				originalData: {
					title: this.isTransaction(sourceData) 
						? `${sourceData.merchant} - $${sourceData.amount}`
						: sourceData.title,
					type: this.isTransaction(sourceData) ? 'transaction' : 'calendar-event',
					path: link.sourceNotePath,
					summary: this.createLinkSummary(link, sourceData)
				},
				
				suggestions: {
					relationships: [this.getNoteTitleFromPath(link.targetNotePath)],
					insights: this.createLinkInsight(link),
					metadata: {
						linkType: link.linkType,
						confidence: link.confidence,
						evidence: link.evidence,
						targetPath: link.targetNotePath
					}
				},
				
				confidence: link.confidence,
				targetNotePath: link.sourceNotePath
			};
			
			suggestions.push(suggestion);
		}
		
		const batch: SuggestionBatch = {
			id: this.generateBatchId(operation),
			type: this.isTransaction(sourceData) ? 'transaction-import' : 'calendar-sync',
			sourceOperation: operation,
			timestamp: new Date().toISOString(),
			suggestions,
			batchStatus: 'pending',
			totalSuggestions: suggestions.length,
			approvedCount: 0,
			rejectedCount: 0,
			appliedCount: 0
		};
		
		return batch;
	}
	
	/**
	 * Generate LLM-powered relationship suggestions using vault context
	 */
	private async generateLLMRelationshipSuggestions(
		sourceData: Transaction | CalendarEvent,
		notePath: string,
		type: 'transaction' | 'calendar-event'
	): Promise<LLMSuggestion[]> {
		try {
			// Get related notes from vault for context
			const relatedNotes = await this.findRelatedNotesForContext(sourceData, type);
			
			// Create enhanced prompt for relationship discovery
			const prompt = this.buildRelationshipDiscoveryPrompt(sourceData, relatedNotes, type);
			
			// Call LLM for relationship analysis
			const response = await this.llmService.generateSuggestions(prompt, type);
			
			if (!response || response.length === 0) {
				return [];
			}
			
			// Convert LLM response to suggestions
			return this.convertLLMResponseToLinkSuggestions(response, sourceData, notePath, type);
			
		} catch (error) {
			console.error('Failed to generate LLM relationship suggestions:', error);
			return [];
		}
	}
	
	/**
	 * Find related notes that could provide context for LLM analysis
	 */
	private async findRelatedNotesForContext(
		sourceData: Transaction | CalendarEvent,
		type: 'transaction' | 'calendar-event'
	): Promise<string[]> {
		const relatedNotes: string[] = [];
		
		// Get files from relevant folders
		const files = this.app.vault.getMarkdownFiles();
		
		// Simple heuristics to find potentially related notes
		const searchTerms = this.extractSearchTerms(sourceData, type);
		
		for (const file of files) {
			const content = await this.app.vault.read(file);
			const title = file.basename;
			
			// Check if any search terms appear in title or content
			for (const term of searchTerms) {
				if (title.toLowerCase().includes(term.toLowerCase()) ||
					content.toLowerCase().includes(term.toLowerCase())) {
					relatedNotes.push(title);
					break;
				}
			}
			
			// Limit to prevent prompt bloat
			if (relatedNotes.length >= 10) break;
		}
		
		return relatedNotes;
	}
	
	/**
	 * Extract search terms for finding related notes
	 */
	private extractSearchTerms(
		sourceData: Transaction | CalendarEvent,
		type: 'transaction' | 'calendar-event'
	): string[] {
		const terms: string[] = [];
		
		if (this.isTransaction(sourceData)) {
			terms.push(sourceData.merchant);
			terms.push(sourceData.category);
			if (sourceData.tags) {
				terms.push(...sourceData.tags);
			}
		} else {
			terms.push(sourceData.title);
			if (sourceData.attendees) {
				terms.push(...sourceData.attendees);
			}
			if (sourceData.location) {
				terms.push(sourceData.location);
			}
			if (sourceData.tags) {
				terms.push(...sourceData.tags);
			}
		}
		
		return terms.filter(term => term && term.length > 2);
	}
	
	/**
	 * Build relationship discovery prompt for LLM
	 */
	private buildRelationshipDiscoveryPrompt(
		sourceData: Transaction | CalendarEvent,
		relatedNotes: string[],
		type: 'transaction' | 'calendar-event'
	): string {
		let prompt = `Analyze this ${type} and suggest relationships to existing notes in my knowledge base.\n\n`;
		
		if (this.isTransaction(sourceData)) {
			prompt += `Transaction Details:
- Merchant: ${sourceData.merchant}
- Amount: $${sourceData.amount}
- Date: ${sourceData.date}
- Category: ${sourceData.category}
- Description: ${sourceData.description}
`;
		} else {
			prompt += `Event Details:
- Title: ${sourceData.title}
- Date: ${sourceData.date}
- Time: ${sourceData.startTime} - ${sourceData.endTime}
- Location: ${sourceData.location || 'No location'}
- Attendees: ${sourceData.attendees?.join(', ') || 'No attendees'}
- Description: ${sourceData.description || 'No description'}
`;
		}
		
		if (relatedNotes.length > 0) {
			prompt += `\nExisting related notes in my vault: ${relatedNotes.join(', ')}\n`;
		}
		
		prompt += `
Based on this information, suggest:
1. Which existing notes this ${type} should be linked to and why
2. What new notes might be worth creating as a follow-up
3. What tags would help organize this better
4. What insights about patterns or connections you notice

Focus on practical, actionable suggestions that would help build a connected knowledge base.
Return your suggestions as a simple array of note titles or topics, one per line.`;
		
		return prompt;
	}
	
	/**
	 * Convert LLM response to link suggestions
	 */
	private convertLLMResponseToLinkSuggestions(
		llmResponse: string[],
		sourceData: Transaction | CalendarEvent,
		notePath: string,
		type: 'transaction' | 'calendar-event'
	): LLMSuggestion[] {
		const suggestions: LLMSuggestion[] = [];
		
		for (const suggestion of llmResponse) {
			if (!suggestion || suggestion.trim().length === 0) continue;
			
			const llmSuggestion: LLMSuggestion = {
				id: this.generateSuggestionId(),
				type: type === 'transaction' ? 'transaction' : 'calendar-event',
				sourceId: this.isTransaction(sourceData) ? sourceData.id : sourceData.id,
				timestamp: new Date().toISOString(),
				status: 'pending',
				priority: 'medium',
				
				originalData: {
					title: this.isTransaction(sourceData) 
						? `${sourceData.merchant} - $${sourceData.amount}`
						: sourceData.title,
					type,
					path: notePath,
					summary: `LLM-suggested relationship: ${suggestion.substring(0, 100)}...`
				},
				
				suggestions: {
					relationships: [suggestion.trim()],
					insights: `AI suggested this connection based on content analysis`,
					metadata: {
						source: 'llm-relationship-discovery',
						suggestedAction: 'create-link-or-note'
					}
				},
				
				confidence: 0.6, // Medium confidence for LLM suggestions
				targetNotePath: notePath
			};
			
			suggestions.push(llmSuggestion);
		}
		
		return suggestions;
	}
	
	/**
	 * Create a suggestion batch from LLM suggestions
	 */
	private async createLLMSuggestionBatch(
		llmSuggestions: LLMSuggestion[],
		operation: string
	): Promise<SuggestionBatch> {
		return {
			id: this.generateBatchId(operation),
			type: 'note-analysis',
			sourceOperation: operation,
			timestamp: new Date().toISOString(),
			suggestions: llmSuggestions,
			batchStatus: 'pending',
			totalSuggestions: llmSuggestions.length,
			approvedCount: 0,
			rejectedCount: 0,
			appliedCount: 0
		};
	}
	
	// Helper methods
	
	private isTransaction(data: Transaction | CalendarEvent): data is Transaction {
		return 'merchant' in data && 'amount' in data;
	}
	
	private mapConfidenceToPriority(confidence: number): 'low' | 'medium' | 'high' {
		if (confidence >= 0.8) return 'high';
		if (confidence >= 0.5) return 'medium';
		return 'low';
	}
	
	private createLinkSummary(link: LinkSuggestion, sourceData: Transaction | CalendarEvent): string {
		const targetTitle = this.getNoteTitleFromPath(link.targetNotePath);
		const sourceTitle = this.isTransaction(sourceData) 
			? `${sourceData.merchant} transaction`
			: `${sourceData.title} event`;
		
		return `Suggested ${link.linkType} connection between ${sourceTitle} and ${targetTitle} (${Math.round(link.confidence * 100)}% confidence)`;
	}
	
	private createLinkInsight(link: LinkSuggestion): string {
		switch (link.linkType) {
			case 'time-based':
				return `These items occurred within ${link.evidence.timeWindow} minutes of each other, suggesting they may be related activities.`;
			case 'entity-based':
				return `Both items involve ${link.evidence.matchedEntities?.join(', ')}, indicating a shared connection.`;
			case 'location-based':
				return `Both items occurred at or near the same location (${link.evidence.locationDistance}m apart).`;
			case 'category-based':
				return `These items share common tags or categories: ${link.evidence.commonTags?.join(', ')}.`;
			case 'uid-based':
				return `These items have matching unique identifiers (${link.evidence.uidMatch}), indicating they are directly related.`;
			default:
				return `System detected a potential relationship between these items.`;
		}
	}
	
	private getNoteTitleFromPath(path: string): string {
		return path.replace(/\.md$/, '').split('/').pop() || path;
	}
	
	private generateSuggestionId(): string {
		return `sug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}
	
	private generateBatchId(operation: string): string {
		return `batch_${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}
	
	private logLinkingResults(linkAnalysis: LinkAnalysisResult, type: string): void {
		const { autoAppliedLinks, queuedForReview, rejected } = linkAnalysis;
		
		console.log(`📊 ${type} linking results:`);
		console.log(`  🔗 Auto-applied: ${autoAppliedLinks.length}`);
		console.log(`  ⏳ Queued for review: ${queuedForReview.length}`);
		console.log(`  ❌ Rejected (low confidence): ${rejected.length}`);
		
		if (autoAppliedLinks.length > 0) {
			console.log(`  Applied link types: ${autoAppliedLinks.map(l => l.linkType).join(', ')}`);
		}
		
		if (queuedForReview.length > 0) {
			new Notice(`📝 Found ${queuedForReview.length} potential links for review`);
		}
		
		if (autoAppliedLinks.length > 0) {
			new Notice(`🔗 Applied ${autoAppliedLinks.length} automatic links`);
		}
	}
	
	/**
	 * Update settings
	 */
	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
		this.linkingService.updateSettings(newSettings);
	}
	
	/**
	 * Refresh indices when vault changes
	 */
	async refreshIndices(): Promise<void> {
		await this.linkingService.refreshIndices();
	}

	// Two-Phase Note Creation Methods

	/**
	 * Create a basic note and queue it for enhancement (unified approach)
	 */
	async createBasicNote(
		source: 'calendar' | 'transaction' | 'manual' | 'chat',
		sourceData: any,
		templateType: string,
		priority: 'high' | 'medium' | 'low' = 'medium'
	): Promise<string> {
		console.log(`📝 Creating basic ${source} note with template: ${templateType}`);

		// 1. Create basic note using template system
		const notePath = await this.createNoteFromTemplate(sourceData, templateType);

		// 2. Queue for enhancement (don't process immediately)
		await this.linkingService.queueForEnhancement(notePath, {
			source,
			sourceData,
			priority
		});

		console.log(`✅ Created basic note: ${notePath} (queued for enhancement)`);
		return notePath;
	}

	/**
	 * Create a transaction note using two-phase approach
	 */
	async createTransactionNote(transaction: Transaction): Promise<string> {
		return await this.createBasicNote('transaction', transaction, 'transaction', 'medium');
	}

	/**
	 * Create a calendar event note using two-phase approach
	 */
	async createCalendarNote(event: CalendarEvent): Promise<string> {
		return await this.createBasicNote('calendar', event, 'event', 'medium');
	}

	/**
	 * Create a manual note using two-phase approach
	 */
	async createManualNote(noteData: any): Promise<string> {
		return await this.createBasicNote('manual', noteData, 'manual', 'low');
	}

	/**
	 * Create a chat note using two-phase approach
	 */
	async createChatNote(chatData: any): Promise<string> {
		return await this.createBasicNote('chat', chatData, 'chat', 'low');
	}

	/**
	 * Process enhancement queue - wrapper for the linking service method
	 */
	async processEnhancementQueue(batchSize: number = 10): Promise<void> {
		console.log(`🔄 Processing enhancement queue (batch size: ${batchSize})...`);
		
		const queueStatus = this.linkingService.getQueueStatus();
		if (queueStatus.queued === 0) {
			console.log('📋 Enhancement queue is empty');
			new Notice('No notes queued for enhancement');
			return;
		}

		new Notice(`Processing ${queueStatus.queued} notes for enhancement...`);

		try {
			// Process the queue and collect results for suggestion conversion
			const results: any[] = [];
			
			// Get items to process
			const itemsToProcess = await this.getQueuedItems(batchSize);
			
			for (const item of itemsToProcess) {
				try {
					// Process individual note
					const linkAnalysis = await this.linkingService.analyzeNote(item.notePath);
					
					// Apply high-confidence links automatically
					await this.linkingService.applyHighConfidenceLinks(linkAnalysis.autoAppliedLinks);
					
					// Collect results for suggestion conversion
					if (linkAnalysis.queuedForReview.length > 0) {
						results.push({
							notePath: item.notePath,
							sourceData: item.sourceData,
							linkAnalysis: linkAnalysis
						});
					}
					
					console.log(`✅ Enhanced note: ${item.notePath}`);
				} catch (error) {
					console.error(`❌ Failed to enhance note ${item.notePath}:`, error);
				}
			}
			
			// Convert linking results to suggestions for UI
			if (results.length > 0) {
				await this.convertEnhancementResultsToSuggestions(results);
			}
			
			// Process the actual queue to update statuses
			await this.linkingService.processEnhancementQueue(batchSize);
			
			const newStatus = this.linkingService.getQueueStatus();
			const processed = queueStatus.queued - newStatus.queued;
			
			new Notice(`✅ Processed ${processed} notes for enhancement`);
			console.log(`✅ Enhancement queue processing completed. Processed: ${processed}, Remaining: ${newStatus.queued}`);
		} catch (error) {
			console.error('❌ Enhancement queue processing failed:', error);
			new Notice(`❌ Enhancement processing failed: ${error.message}`);
		}
	}

	/**
	 * Convert enhancement results to LLM suggestions for the UI
	 */
	private async convertEnhancementResultsToSuggestions(results: any[]): Promise<void> {
		if (!this.settings.suggestionSystem?.enabled) {
			return;
		}

		const allSuggestions: LLMSuggestion[] = [];

		for (const result of results) {
			if (!result.linkAnalysis || !result.linkAnalysis.queuedForReview) {
				continue;
			}

			// Convert each queued link suggestion to an LLM suggestion
			for (const linkSuggestion of result.linkAnalysis.queuedForReview) {
				const llmSuggestion = await this.convertLinkSuggestionToLLMSuggestion(
					linkSuggestion,
					result.notePath,
					result.sourceData
				);
				
				if (llmSuggestion) {
					allSuggestions.push(llmSuggestion);
				}
			}
		}

		// Create and store suggestion batch if we have suggestions
		if (allSuggestions.length > 0) {
			const batch: SuggestionBatch = {
				id: this.generateBatchId('enhancement-queue'),
				type: 'note-analysis',
				sourceOperation: 'enhancement-queue-processing',
				timestamp: new Date().toISOString(),
				suggestions: allSuggestions,
				batchStatus: 'pending',
				totalSuggestions: allSuggestions.length,
				approvedCount: 0,
				rejectedCount: 0,
				appliedCount: 0
			};

			// Store the batch via suggestion management service
			await this.suggestionService.getStorageService().storeSuggestionBatch(batch);
			
			new Notice(`📝 Generated ${allSuggestions.length} linking suggestions for review`);
			console.log(`📝 Created suggestion batch with ${allSuggestions.length} linking suggestions`);
		}
	}

	/**
	 * Convert a LinkSuggestion to an LLMSuggestion
	 */
	private async convertLinkSuggestionToLLMSuggestion(
		linkSuggestion: any,
		notePath: string,
		sourceData: any
	): Promise<LLMSuggestion | null> {
		try {
			// Get note title from path
			const noteTitle = this.getNoteTitleFromPath(notePath);
			const targetTitle = this.getNoteTitleFromPath(linkSuggestion.targetNotePath);

			// Determine note type from source data or path
			const noteType = this.determineNoteType(sourceData, notePath);

			const llmSuggestion: LLMSuggestion = {
				id: this.generateSuggestionId(),
				type: noteType,
				sourceId: sourceData?.id || notePath,
				timestamp: new Date().toISOString(),
				status: 'pending',
				priority: this.mapConfidenceToPriority(linkSuggestion.confidence),
				
				originalData: {
					title: noteTitle,
					type: noteType,
					path: notePath,
					summary: `Link suggestion: Connect "${noteTitle}" to "${targetTitle}"`
				},
				
				suggestions: {
					relationships: [targetTitle],
					insights: this.createLinkInsight(linkSuggestion),
					metadata: {
						linkType: linkSuggestion.linkType,
						confidence: linkSuggestion.confidence,
						evidence: linkSuggestion.evidence,
						targetPath: linkSuggestion.targetNotePath,
						sourceOperation: 'note-linking-analysis'
					}
				},
				
				confidence: linkSuggestion.confidence,
				targetNotePath: notePath // The note being enhanced
			};

			return llmSuggestion;
		} catch (error) {
			console.error('Failed to convert link suggestion to LLM suggestion:', error);
			return null;
		}
	}

	/**
	 * Determine note type from source data or path
	 */
	private determineNoteType(sourceData: any, notePath: string): 'transaction' | 'calendar-event' | 'chat-thread' | 'note-enhancement' {
		// Check source data first
		if (sourceData?.source === 'transaction' || sourceData?.merchant) {
			return 'transaction';
		}
		if (sourceData?.source === 'calendar' || sourceData?.startTime) {
			return 'calendar-event';
		}
		if (sourceData?.source === 'chat') {
			return 'chat-thread';
		}

		// Check path patterns
		if (notePath.includes('Transactions/') || notePath.includes('transactions/')) {
			return 'transaction';
		}
		if (notePath.includes('Events/') || notePath.includes('events/')) {
			return 'calendar-event';
		}
		if (notePath.includes('Chat/') || notePath.includes('chat/')) {
			return 'chat-thread';
		}

		return 'note-enhancement'; // Use valid type instead of 'manual-note'
	}

	/**
	 * Get queued items for processing (helper method)
	 */
	private async getQueuedItems(batchSize: number): Promise<any[]> {
		// This is a simplified implementation - in reality, we'd get this from the linking service
		// For now, we'll work with the existing queue processing approach
		const queueStatus = this.linkingService.getQueueStatus();
		
		// Return empty array since we'll process through the linking service directly
		// This method exists to satisfy the TypeScript compiler
		return [];
	}

	/**
	 * Get enhancement queue status
	 */
	getEnhancementQueueStatus(): {
		queued: number;
		processing: number;
		completed: number;
		failed: number;
		total: number;
	} {
		return this.linkingService.getQueueStatus();
	}

	/**
	 * Clear completed items from enhancement queue
	 */
	async clearCompletedFromQueue(): Promise<void> {
		await this.linkingService.clearCompletedFromQueue();
		new Notice('🧹 Cleared completed items from enhancement queue');
	}

	/**
	 * Create note from template (helper method)
	 */
	private async createNoteFromTemplate(sourceData: any, templateType: string): Promise<string> {
		// This would integrate with your existing template system
		// For now, creating a simple implementation
		
		let notePath: string;
		let content: string;

		switch (templateType) {
			case 'transaction':
				notePath = `Transactions/${sourceData.date} - ${sourceData.merchant}.md`;
				content = this.generateTransactionTemplate(sourceData);
				break;
			
			case 'event':
				notePath = `Events/${sourceData.date} - ${sourceData.title}.md`;
				content = this.generateEventTemplate(sourceData);
				break;
			
			case 'manual':
				notePath = `Notes/${new Date().toISOString().split('T')[0]} - ${sourceData.title || 'Manual Note'}.md`;
				content = this.generateManualTemplate(sourceData);
				break;
			
			case 'chat':
				notePath = `Chat/${new Date().toISOString().split('T')[0]} - Chat Session.md`;
				content = this.generateChatTemplate(sourceData);
				break;
			
			default:
				throw new Error(`Unknown template type: ${templateType}`);
		}

		// Create the note file
		await this.app.vault.create(notePath, content);
		
		return notePath;
	}

	/**
	 * Generate transaction note template
	 */
	private generateTransactionTemplate(transaction: Transaction): string {
		// Use extended fields if available, fall back to basic fields
		const accountId = transaction.account_id || transaction.account || 'Unknown';
		const currency = transaction.currency || 'USD';
		const paymentChannel = transaction.payment_channel || 'unknown';
		const categoryTag = transaction.category ? transaction.category.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'uncategorized';
		
		return `---
type: transaction
source: plaid
transaction_id: ${transaction.id}
account_id: ${accountId}
date: ${transaction.date}
merchant: ${transaction.merchant}
amount: ${transaction.amount}
category: ${transaction.category}
currency: ${currency}
payment_channel: ${paymentChannel}
tags: [transaction, ${categoryTag}]
status: basic
---

# ${transaction.merchant} - $${transaction.amount}

**Date:** ${transaction.date}
**Amount:** $${transaction.amount}
**Category:** ${transaction.category}
**Account:** ${accountId}
**Payment Method:** ${paymentChannel}
**Description:** ${transaction.description || 'No description'}

## Details
- **Account ID:** ${accountId}
- **Transaction ID:** ${transaction.id}
- **Currency:** ${currency}

## Notes
*This note was created automatically and is queued for enhancement.*

## Related
*Links will be added during enhancement processing.*
`;
	}

	/**
	 * Generate event note template
	 */
	private generateEventTemplate(event: CalendarEvent): string {
		// Extract additional linkable information
		const attendeesList = event.attendees && event.attendees.length > 0 
			? event.attendees.join(', ') 
			: '';
		const attendeesArray = event.attendees || [];
		const calendarSource = event.sourceCalendarName || 'Unknown Calendar';
		const eventTags = event.tags && event.tags.length > 0 
			? event.tags.map(tag => tag.toLowerCase().replace(/[^a-z0-9]/g, '_'))
			: ['calendar'];
		
		return `---
type: calendar-event
source: google-calendar
event_id: ${event.id}
calendar_source: ${calendarSource}
calendar_id: ${event.sourceCalendarId || ''}
date: ${event.date}
start_time: ${event.startTime}
end_time: ${event.endTime}
duration_minutes: ${this.calculateEventDuration(event.startTime, event.endTime)}
location: ${event.location || ''}
attendees: [${attendeesList}]
attendee_count: ${attendeesArray.length}
meeting_type: ${this.determineMeetingType(event)}
tags: [event, calendar, ${eventTags.join(', ')}]
status: basic
---

# ${event.title}

**Date:** ${event.date}
**Time:** ${event.startTime} - ${event.endTime}
**Duration:** ${this.calculateEventDuration(event.startTime, event.endTime)} minutes
**Location:** ${event.location || 'No location specified'}
**Calendar:** ${calendarSource}

## Attendees (${attendeesArray.length})
${attendeesArray.length > 0 ? attendeesArray.map(a => `- ${a}`).join('\n') : 'No attendees listed'}

## Description
${event.description || 'No description provided'}

## Meeting Details
- **Type:** ${this.determineMeetingType(event)}
- **Recurring:** ${this.isRecurringEvent(event) ? 'Yes' : 'No'}
- **Event ID:** ${event.id}

## Notes
*This note was created automatically and is queued for enhancement.*

## Related
*Links will be added during enhancement processing.*
`;
	}

	/**
	 * Generate manual note template
	 */
	private generateManualTemplate(noteData: any): string {
		return `---
type: manual-note
source: user
created: ${new Date().toISOString()}
tags: [manual]
status: basic
---

# ${noteData.title || 'Manual Note'}

${noteData.content || 'Add your content here...'}

## Notes
*This note was created manually and is queued for enhancement.*

## Related
*Links will be added during enhancement processing.*
`;
	}

	/**
	 * Generate chat note template
	 */
	private generateChatTemplate(chatData: any): string {
		return `---
type: chat-session
source: llm-chat
session_id: ${chatData.sessionId || 'unknown'}
created: ${new Date().toISOString()}
tags: [chat, llm]
status: basic
---

# Chat Session - ${new Date().toLocaleDateString()}

## Summary
${chatData.summary || 'Chat session summary will be added here.'}

## Key Points
${chatData.keyPoints ? chatData.keyPoints.map((p: string) => `- ${p}`).join('\n') : '- Key points will be extracted during enhancement'}

## Full Conversation
${chatData.conversation || 'Conversation content will be added here.'}

## Notes
*This note was created automatically and is queued for enhancement.*

## Related
*Links will be added during enhancement processing.*
`;
	}

	// Helper methods for calendar event processing

	/**
	 * Calculate event duration in minutes
	 */
	private calculateEventDuration(startTime: string, endTime: string): number {
		try {
			const start = new Date(`1970-01-01T${startTime}`);
			const end = new Date(`1970-01-01T${endTime}`);
			return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
		} catch (error) {
			return 0;
		}
	}

	/**
	 * Determine meeting type based on event characteristics
	 */
	private determineMeetingType(event: CalendarEvent): string {
		const title = event.title.toLowerCase();
		const attendeeCount = event.attendees ? event.attendees.length : 0;
		const hasLocation = event.location && event.location.trim().length > 0;
		
		// Check for common meeting patterns
		if (title.includes('standup') || title.includes('daily')) return 'daily-standup';
		if (title.includes('1:1') || title.includes('one-on-one')) return 'one-on-one';
		if (title.includes('interview')) return 'interview';
		if (title.includes('review') || title.includes('retrospective')) return 'review';
		if (title.includes('planning') || title.includes('sprint')) return 'planning';
		if (title.includes('demo') || title.includes('presentation')) return 'presentation';
		if (title.includes('training') || title.includes('workshop')) return 'training';
		if (title.includes('social') || title.includes('lunch') || title.includes('coffee')) return 'social';
		
		// Infer from characteristics
		if (attendeeCount === 0) return 'personal';
		if (attendeeCount === 1) return 'one-on-one';
		if (attendeeCount <= 5) return 'small-group';
		if (attendeeCount <= 15) return 'team-meeting';
		if (attendeeCount > 15) return 'large-meeting';
		
		// Check location-based patterns
		if (hasLocation) {
			const location = event.location!.toLowerCase();
			if (location.includes('zoom') || location.includes('teams') || location.includes('meet')) return 'virtual-meeting';
			if (location.includes('conference') || location.includes('room')) return 'in-person-meeting';
		}
		
		return 'meeting';
	}

	/**
	 * Check if event appears to be recurring
	 */
	private isRecurringEvent(event: CalendarEvent): boolean {
		const title = event.title.toLowerCase();
		
		// Check for recurring patterns in title
		const recurringKeywords = [
			'weekly', 'daily', 'monthly', 'quarterly',
			'standup', 'sync', 'check-in', 'review',
			'recurring', 'regular', 'scheduled'
		];
		
		return recurringKeywords.some(keyword => title.includes(keyword));
	}
}
