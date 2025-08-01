import { ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import { SuggestionManagementService } from '../services/suggestion-management-service';
import { LLMSuggestion, SuggestionBatch } from '../types';

export const SUGGESTION_APPROVAL_VIEW_TYPE = 'suggestion-approval-view';

export class SuggestionApprovalView extends ItemView {
	private suggestionService: SuggestionManagementService;
	private pendingBatches: SuggestionBatch[] = [];
	private refreshInterval?: number;

	constructor(leaf: WorkspaceLeaf, suggestionService: SuggestionManagementService) {
		super(leaf);
		this.suggestionService = suggestionService;
	}

	getViewType(): string {
		return SUGGESTION_APPROVAL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'LLM Suggestions';
	}

	getIcon(): string {
		return 'robot';
	}

	async onOpen(): Promise<void> {
		await this.loadPendingSuggestions();
		this.renderSuggestions();
		
		// Auto-refresh every 30 seconds
		this.refreshInterval = window.setInterval(() => {
			this.refresh();
		}, 30000);
	}

	async onClose(): Promise<void> {
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
		}
	}

	async refresh(): Promise<void> {
		await this.loadPendingSuggestions();
		this.renderSuggestions();
	}

	private async loadPendingSuggestions(): Promise<void> {
		try {
			this.pendingBatches = await this.suggestionService.getPendingSuggestions();
		} catch (error) {
			console.error('Failed to load pending suggestions:', error);
			this.pendingBatches = [];
		}
	}

	private renderSuggestions(): void {
		const container = this.containerEl;
		container.empty();
		container.addClass('suggestion-approval-container');

		// Header
		this.renderHeader(container);

		// Content
		if (this.pendingBatches.length === 0) {
			this.renderEmptyState(container);
		} else {
			this.renderBatches(container);
		}

		// Footer actions
		this.renderFooterActions(container);
	}

	private renderHeader(container: HTMLElement): void {
		const header = container.createDiv('suggestion-header');
		
		const titleContainer = header.createDiv('suggestion-title-container');
		titleContainer.createEl('h3', { text: 'AI Suggestions', cls: 'suggestion-title' });
		
		const refreshBtn = titleContainer.createEl('button', {
			text: '↻',
			cls: 'suggestion-refresh-btn',
			attr: { title: 'Refresh suggestions' }
		});
		refreshBtn.onclick = () => this.refresh();

		// Summary stats
		const summary = header.createDiv('suggestion-summary');
		const totalPending = this.pendingBatches.reduce(
			(sum, batch) => sum + batch.suggestions.filter(s => s.status === 'pending').length, 
			0
		);
		const totalBatches = this.pendingBatches.length;

		summary.createEl('span', { 
			text: `${totalPending} pending in ${totalBatches} batches`,
			cls: 'suggestion-count'
		});
	}

	private renderEmptyState(container: HTMLElement): void {
		const emptyState = container.createDiv('suggestion-empty-state');
		emptyState.createEl('div', { text: '🤖', cls: 'suggestion-empty-icon' });
		emptyState.createEl('h4', { text: 'No pending suggestions' });
		emptyState.createEl('p', { 
			text: 'AI suggestions will appear here after syncing calendar events, importing transactions, or ending chat conversations.',
			cls: 'suggestion-empty-text'
		});
	}

	private renderBatches(container: HTMLElement): void {
		const batchList = container.createDiv('suggestion-batch-list');

		for (const batch of this.pendingBatches) {
			this.renderBatch(batchList, batch);
		}
	}

	private renderBatch(container: HTMLElement, batch: SuggestionBatch): void {
		const batchEl = container.createDiv('suggestion-batch');
		batchEl.setAttribute('data-batch-id', batch.id);

		// Batch header
		const batchHeader = batchEl.createDiv('batch-header');
		
		const batchTitle = batchHeader.createDiv('batch-title');
		batchTitle.createEl('h4', { text: this.getBatchDisplayName(batch) });
		batchTitle.createEl('span', { 
			text: new Date(batch.timestamp).toLocaleDateString(),
			cls: 'batch-date'
		});

		const batchStats = batchHeader.createDiv('batch-stats');
		const pendingCount = batch.suggestions.filter(s => s.status === 'pending').length;
		const approvedCount = batch.suggestions.filter(s => s.status === 'approved').length;
		
		batchStats.createEl('span', { 
			text: `${pendingCount} pending, ${approvedCount} approved`,
			cls: 'batch-stats-text'
		});

		// Batch actions
		const batchActions = batchHeader.createDiv('batch-actions');
		
		if (pendingCount > 0) {
			const approveAllBtn = batchActions.createEl('button', {
				text: 'Approve All',
				cls: 'batch-approve-all mod-cta'
			});
			approveAllBtn.onclick = () => this.approveAllInBatch(batch.id);
		}

		if (approvedCount > 0) {
			const applyAllBtn = batchActions.createEl('button', {
				text: 'Apply All',
				cls: 'batch-apply-all mod-warning'
			});
			applyAllBtn.onclick = () => this.applyAllInBatch(batch.id);
		}

		// Suggestion items
		const suggestionList = batchEl.createDiv('suggestion-list');
		const pendingSuggestions = batch.suggestions.filter(s => s.status === 'pending' || s.status === 'approved');
		
		for (const suggestion of pendingSuggestions.slice(0, 5)) { // Show first 5
			this.renderSuggestionItem(suggestionList, suggestion);
		}

		// Show more button if there are more suggestions
		if (pendingSuggestions.length > 5) {
			const showMoreBtn = suggestionList.createEl('button', {
				text: `Show ${pendingSuggestions.length - 5} more...`,
				cls: 'suggestion-show-more'
			});
			showMoreBtn.onclick = () => this.expandBatch(batch.id);
		}
	}

	private renderSuggestionItem(container: HTMLElement, suggestion: LLMSuggestion): void {
		const itemEl = container.createDiv('suggestion-item');
		itemEl.setAttribute('data-suggestion-id', suggestion.id);
		itemEl.addClass(`suggestion-${suggestion.status}`);

		// Item header
		const itemHeader = itemEl.createDiv('suggestion-item-header');
		
		const itemInfo = itemHeader.createDiv('suggestion-item-info');
		itemInfo.createEl('span', { 
			text: suggestion.originalData.title,
			cls: 'suggestion-item-title'
		});
		
		const itemMeta = itemInfo.createDiv('suggestion-item-meta');
		itemMeta.createEl('span', { 
			text: suggestion.type.replace('-', ' '),
			cls: 'suggestion-type'
		});
		itemMeta.createEl('span', { 
			text: `${Math.round(suggestion.confidence * 100)}% confidence`,
			cls: `suggestion-confidence confidence-${this.getConfidenceLevel(suggestion.confidence)}`
		});

		// Priority indicator
		const priority = itemHeader.createDiv('suggestion-priority');
		priority.createEl('span', {
			text: suggestion.priority,
			cls: `priority-badge priority-${suggestion.priority}`
		});

		// Preview enhancements
		const preview = itemEl.createDiv('suggestion-preview');
		this.renderSuggestionPreview(preview, suggestion);

		// Actions
		const actions = itemEl.createDiv('suggestion-actions');
		
		if (suggestion.status === 'pending') {
			const approveBtn = actions.createEl('button', {
				text: '✓ Approve',
				cls: 'suggestion-approve mod-cta'
			});
			approveBtn.onclick = () => this.approveSuggestion(suggestion.id);

			const rejectBtn = actions.createEl('button', {
				text: '✗ Reject',
				cls: 'suggestion-reject'
			});
			rejectBtn.onclick = () => this.rejectSuggestion(suggestion.id);
		}

		if (suggestion.status === 'approved') {
			const applyBtn = actions.createEl('button', {
				text: '⚡ Apply',
				cls: 'suggestion-apply mod-warning'
			});
			applyBtn.onclick = () => this.applySuggestion(suggestion.id);
		}

		// Always show preview button
		const previewBtn = actions.createEl('button', {
			text: '👁 Preview',
			cls: 'suggestion-preview-btn'
		});
		previewBtn.onclick = () => this.previewSuggestion(suggestion.id);

		// Link to original note if exists
		if (suggestion.targetNotePath) {
			const linkBtn = actions.createEl('button', {
				text: '📄 Open Note',
				cls: 'suggestion-link'
			});
			linkBtn.onclick = () => this.openTargetNote(suggestion.targetNotePath!);
		}
	}

	private renderSuggestionPreview(container: HTMLElement, suggestion: LLMSuggestion): void {
		const suggestions = suggestion.suggestions;
		
		if (suggestions.tags?.length) {
			const tagsPreview = container.createDiv('preview-section');
			tagsPreview.createEl('strong', { text: 'Tags: ' });
			tagsPreview.createEl('span', { text: suggestions.tags.join(', ') });
		}

		if (suggestions.actionItems?.length) {
			const actionsPreview = container.createDiv('preview-section');
			actionsPreview.createEl('strong', { text: 'Action Items: ' });
			actionsPreview.createEl('span', { text: `${suggestions.actionItems.length} items` });
		}

		if (suggestions.preparationItems?.length) {
			const prepPreview = container.createDiv('preview-section');
			prepPreview.createEl('strong', { text: 'Preparation: ' });
			prepPreview.createEl('span', { text: `${suggestions.preparationItems.length} items` });
		}

		if (suggestions.insights) {
			const insightsPreview = container.createDiv('preview-section');
			insightsPreview.createEl('strong', { text: 'Insights: ' });
			insightsPreview.createEl('span', { 
				text: suggestions.insights.substring(0, 100) + (suggestions.insights.length > 100 ? '...' : '')
			});
		}
	}

	private renderFooterActions(container: HTMLElement): void {
		const footer = container.createDiv('suggestion-footer');
		
		const cleanupBtn = footer.createEl('button', {
			text: 'Archive Completed',
			cls: 'suggestion-cleanup'
		});
		cleanupBtn.onclick = () => this.cleanupCompleted();

		const clearAllBtn = footer.createEl('button', {
			text: 'Clear All',
			cls: 'suggestion-clear-all mod-destructive'
		});
		clearAllBtn.onclick = () => this.clearAllSuggestions();
	}

	// ===========================================
	// ACTION HANDLERS
	// ===========================================

	private async approveSuggestion(suggestionId: string): Promise<void> {
		try {
			await this.suggestionService.approveSuggestion(suggestionId);
			await this.refresh();
			new Notice('Suggestion approved');
		} catch (error) {
			new Notice('Failed to approve suggestion');
			console.error(error);
		}
	}

	private async rejectSuggestion(suggestionId: string): Promise<void> {
		try {
			await this.suggestionService.rejectSuggestion(suggestionId, 'User rejected');
			await this.refresh();
			new Notice('Suggestion rejected');
		} catch (error) {
			new Notice('Failed to reject suggestion');
			console.error(error);
		}
	}

	private async applySuggestion(suggestionId: string): Promise<void> {
		try {
			await this.suggestionService.applySuggestion(suggestionId);
			await this.refresh();
		} catch (error) {
			new Notice(`Failed to apply suggestion: ${error instanceof Error ? error.message : 'Unknown error'}`);
			console.error(error);
		}
	}

	private async approveAllInBatch(batchId: string): Promise<void> {
		try {
			await this.suggestionService.approveAllInBatch(batchId);
			await this.refresh();
		} catch (error) {
			new Notice('Failed to approve all suggestions');
			console.error(error);
		}
	}

	private async applyAllInBatch(batchId: string): Promise<void> {
		try {
			const result = await this.suggestionService.applyBatchSuggestions(batchId);
			await this.refresh();
			
			if (result.failed > 0) {
				new Notice(`Applied ${result.applied} suggestions, ${result.failed} failed. Check console for details.`);
				console.error('Failed suggestions:', result.errors);
			}
		} catch (error) {
			new Notice('Failed to apply batch suggestions');
			console.error(error);
		}
	}

	private async previewSuggestion(suggestionId: string): Promise<void> {
		try {
			const preview = await this.suggestionService.previewSuggestion(suggestionId);
			// TODO: Show diff modal
			console.log('Suggestion preview:', preview);
			new Notice('Preview logged to console (TODO: show diff modal)');
		} catch (error) {
			new Notice('Failed to preview suggestion');
			console.error(error);
		}
	}

	private async openTargetNote(notePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (file instanceof TFile) {
			await this.app.workspace.getLeaf().openFile(file);
		} else {
			new Notice(`Note not found: ${notePath}`);
		}
	}

	private async cleanupCompleted(): Promise<void> {
		try {
			await this.suggestionService.cleanupCompletedBatches();
			await this.refresh();
			new Notice('Archived completed batches');
		} catch (error) {
			new Notice('Failed to cleanup completed batches');
			console.error(error);
		}
	}

	private async clearAllSuggestions(): Promise<void> {
		// TODO: Add confirmation dialog
		if (confirm('Are you sure you want to clear all suggestions? This cannot be undone.')) {
			try {
				await this.suggestionService.getStorageService().clearAllSuggestions();
				await this.refresh();
			} catch (error) {
				new Notice('Failed to clear suggestions');
				console.error(error);
			}
		}
	}

	private expandBatch(batchId: string): void {
		// TODO: Implement batch expansion
		new Notice('TODO: Implement batch expansion');
	}

	// ===========================================
	// UTILITY METHODS
	// ===========================================

	private getBatchDisplayName(batch: SuggestionBatch): string {
		const typeNames = {
			'calendar-sync': 'Calendar Events',
			'transaction-import': 'Transactions',
			'note-analysis': 'Chat Analysis'
		};
		return typeNames[batch.type] || batch.type;
	}

	private getConfidenceLevel(confidence: number): string {
		if (confidence >= 0.8) return 'high';
		if (confidence >= 0.6) return 'medium';
		return 'low';
	}
}
