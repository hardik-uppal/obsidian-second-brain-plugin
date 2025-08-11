import { ItemView, WorkspaceLeaf, Notice, TFile, ButtonComponent, Setting, Component } from 'obsidian';
import { SuggestionManagementService } from '../services/suggestion-management-service';
import { LLMSuggestion, SuggestionBatch } from '../types';

export const SUGGESTION_APPROVAL_VIEW_TYPE = 'suggestion-approval-view';

export class SuggestionApprovalView extends ItemView {
	private suggestionService: SuggestionManagementService;
	private pendingBatches: SuggestionBatch[] = [];
	private refreshInterval?: number;
	private expandedBatches: Set<string> = new Set();
	private scrollContainer?: HTMLElement;
	private contentContainer?: HTMLElement;
	private renderHeaderContainer?: HTMLElement;
	private renderFooterContainer?: HTMLElement;
	private currentTab: 'processing' | 'review' = 'review'; // Default to review tab

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
		return 'lightbulb';
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
		console.log('🔄 Refreshing suggestion view...');
		try {
			// Force reload from storage
			await this.loadPendingSuggestions();
			this.renderSuggestions();
			console.log(`✅ Suggestion view refreshed - found ${this.pendingBatches.length} batches`);
			
			// Show user feedback
			const totalSuggestions = this.pendingBatches.reduce(
				(sum, batch) => sum + batch.suggestions.filter(s => s.status === 'pending').length, 
				0
			);
			if (totalSuggestions > 0) {
				new Notice(`Refreshed: ${totalSuggestions} pending suggestions found`);
			} else {
				new Notice('Refreshed: No pending suggestions');
			}
		} catch (error) {
			console.error('Failed to refresh suggestions:', error);
			new Notice('Failed to refresh suggestions');
		}
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
		
		console.log('🎨 Rendering suggestions with', this.pendingBatches.length, 'batches');

		// Create main layout structure
		this.createMainLayout(container);

		// Header with native Obsidian styling
		this.renderModernHeader();

		// Scrollable content area
		this.renderScrollableContent();

		// Footer with actions
		this.renderModernFooter();
		
		console.log('✅ Suggestion UI rendered successfully');
	}

	private renderModernFooter(): void {
		if (!this.renderFooterContainer) return;
		
		this.renderFooterContainer.empty();
		this.renderFooterContainer.addClass('modern-footer');

		const footerContent = this.renderFooterContainer.createDiv('footer-content');
		
		// Cleanup actions
		const cleanupSection = footerContent.createDiv('footer-cleanup-section');
		
		new ButtonComponent(cleanupSection.createDiv())
			.setButtonText('🧹 Cleanup Completed')
			.setTooltip('Remove completed suggestions')
			.onClick(() => this.cleanupCompleted());
		
		new ButtonComponent(cleanupSection.createDiv())
			.setButtonText('📊 View Queue Status')
			.setTooltip('Show detailed queue status')
			.onClick(() => this.showQueueStatus());
		
		// Debug button for testing
		new ButtonComponent(cleanupSection.createDiv())
			.setButtonText('🧪 Add Test Suggestion')
			.setTooltip('Add a test suggestion for UI testing')
			.onClick(() => this.addTestSuggestion());

		// Stats section
		const statsSection = footerContent.createDiv('footer-stats-section');
		const totalSuggestions = this.pendingBatches.reduce((sum, batch) => sum + batch.suggestions.length, 0);
		statsSection.createSpan({ 
			text: `Total: ${totalSuggestions} suggestions in ${this.pendingBatches.length} batches`,
			cls: 'footer-stats-text'
		});
	}

	private approveAllSuggestions(): void {
		// Approve all pending suggestions across all batches
		this.pendingBatches.forEach(batch => {
			const pendingSuggestions = batch.suggestions.filter(s => s.status === 'pending');
			pendingSuggestions.forEach(suggestion => {
				this.approveSuggestion(suggestion.id);
			});
		});
	}

	private createMainLayout(container: HTMLElement): void {
		// Main container with proper layout
		const mainLayout = container.createDiv('suggestion-main-layout');

		// Header (sticky)
		const headerContainer = mainLayout.createDiv('suggestion-header-container');
		this.renderHeaderContainer = headerContainer;

		// Scrollable content area
		const scrollWrapper = mainLayout.createDiv('suggestion-scroll-wrapper');
		this.scrollContainer = scrollWrapper.createDiv('suggestion-scroll-container');

		// Content container within scroll area
		this.contentContainer = this.scrollContainer.createDiv('suggestion-content-container');

		// Footer (sticky)
		const footerContainer = mainLayout.createDiv('suggestion-footer-container');
		this.renderFooterContainer = footerContainer;
	}

	private renderModernHeader(): void {
		if (!this.renderHeaderContainer) return;
		
		this.renderHeaderContainer.empty();
		this.renderHeaderContainer.addClass('modern-header');

		// Title section - simplified
		const titleSection = this.renderHeaderContainer.createDiv('header-title-section');
		
		const titleGroup = titleSection.createDiv('header-title-group');
		titleGroup.createEl('h2', { text: 'Suggestions', cls: 'header-title' });
		
		// Tabs section
		const tabsContainer = titleGroup.createDiv('tabs-container');
		this.renderTabs(tabsContainer);
		
		// Stats line for current tab
		const statsLine = titleGroup.createDiv('header-stats');
		this.updateHeaderStats(statsLine);

		// Actions section
		const actionsSection = this.renderHeaderContainer.createDiv('header-actions-section');
		this.renderHeaderActions(actionsSection);
	}

	private renderTabs(container: HTMLElement): void {
		const tabsWrapper = container.createDiv('tabs-wrapper');
		
		const stats = this.calculateQueueStats();
		const processingCount = stats.pendingEnhancement + stats.pendingLinking;
		const reviewCount = stats.pendingReview;
		
		// Processing tab
		const processingTab = tabsWrapper.createDiv(`tab ${this.currentTab === 'processing' ? 'active' : ''}`);
		processingTab.createSpan({ text: '⚡ Processing', cls: 'tab-label' });
		processingTab.createSpan({ text: processingCount.toString(), cls: 'tab-count' });
		processingTab.addEventListener('click', () => this.switchTab('processing'));
		
		// Review tab
		const reviewTab = tabsWrapper.createDiv(`tab ${this.currentTab === 'review' ? 'active' : ''}`);
		reviewTab.createSpan({ text: '👁 Review', cls: 'tab-label' });
		reviewTab.createSpan({ text: reviewCount.toString(), cls: 'tab-count' });
		reviewTab.addEventListener('click', () => this.switchTab('review'));
	}

	private switchTab(tab: 'processing' | 'review'): void {
		this.currentTab = tab;
		this.renderSuggestions(); // Re-render entire view
	}

	private updateHeaderStats(container: HTMLElement): void {
		container.empty();
		
		const stats = this.calculateQueueStats();
		
		if (this.currentTab === 'processing') {
			// Show processing stats
			const processingCount = stats.pendingEnhancement + stats.pendingLinking;
			
			if (processingCount > 0) {
				const statsContainer = container.createDiv('stats-container');
				
				if (stats.pendingEnhancement > 0) {
					const enhancementBadge = statsContainer.createDiv('stat-badge stat-processing');
					enhancementBadge.createSpan({ text: stats.pendingEnhancement.toString(), cls: 'stat-number' });
					enhancementBadge.createSpan({ text: 'enhancing', cls: 'stat-label' });
				}
				
				if (stats.pendingLinking > 0) {
					const linkingBadge = statsContainer.createDiv('stat-badge stat-linking');
					linkingBadge.createSpan({ text: stats.pendingLinking.toString(), cls: 'stat-number' });
					linkingBadge.createSpan({ text: 'linking', cls: 'stat-label' });
				}
			} else {
				container.createSpan({ text: 'No items processing', cls: 'stats-empty' });
			}
		} else {
			// Show review stats
			const totalPending = this.pendingBatches.reduce(
				(sum, batch) => sum + batch.suggestions.filter(s => s.status === 'pending').length, 
				0
			);
			
			if (totalPending > 0) {
				const statsContainer = container.createDiv('stats-container');
				
				const pendingBadge = statsContainer.createDiv('stat-badge stat-pending');
				pendingBadge.createSpan({ text: totalPending.toString(), cls: 'stat-number' });
				pendingBadge.createSpan({ text: 'pending review', cls: 'stat-label' });
			} else {
				container.createSpan({ text: 'No pending suggestions', cls: 'stats-empty' });
			}
		}
	}

	private renderHeaderActions(container: HTMLElement): void {
		const actionsGroup = container.createDiv('header-actions-group');

		// Refresh button using Obsidian ButtonComponent
		const refreshBtnContainer = actionsGroup.createDiv('refresh-btn-container');
		new ButtonComponent(refreshBtnContainer)
			.setButtonText('🔄 Refresh')
			.setTooltip('Refresh suggestions from storage')
			.setClass('mod-cta')
			.onClick(() => this.refresh());

		// Quick action buttons if we have suggestions
		const totalPending = this.pendingBatches.reduce(
			(sum, batch) => sum + batch.suggestions.filter(s => s.status === 'pending').length, 
			0
		);
		
		if (totalPending > 0) {
			const approveAllContainer = actionsGroup.createDiv('approve-all-btn-container');
			new ButtonComponent(approveAllContainer)
				.setButtonText(`✓ Approve All (${totalPending})`)
				.setTooltip('Approve all pending suggestions')
				.setClass('mod-warning')
				.onClick(() => this.approveAllSuggestions());
		}
	}

	private renderScrollableContent(): void {
		if (!this.contentContainer) return;
		
		this.contentContainer.empty();

		// Show content based on current tab
		if (this.currentTab === 'processing') {
			this.renderProcessingQueue();
		} else {
			this.renderReviewQueue();
		}
	}

	private renderProcessingQueue(): void {
		if (!this.contentContainer) return;
		
		const processingContainer = this.contentContainer.createDiv('processing-queue-container');
		
		// Header for processing queue
		const queueHeader = processingContainer.createDiv('queue-section-header');
		queueHeader.createEl('h3', { text: 'Processing Queue', cls: 'section-title' });
		queueHeader.createEl('p', { 
			text: 'Items being enhanced with AI analysis and relationship mapping',
			cls: 'section-description'
		});
		
		// Show mock processing items (since real processing happens in background)
		this.renderMockProcessingItems(processingContainer);
	}

	private renderMockProcessingItems(container: HTMLElement): void {
		const processingList = container.createDiv('processing-list');
		
		// Get actual suggestions that would be "processing"
		const allSuggestions: LLMSuggestion[] = [];
		this.pendingBatches.forEach(batch => {
			allSuggestions.push(...batch.suggestions);
		});
		
		// Create realistic processing items based on actual suggestions
		const processingItems: Array<{
			id: string;
			title: string;
			status: string;
			type: 'enhancement' | 'linking';
			progress: number;
			suggestion: LLMSuggestion;
		}> = [];
		
		// Simulate some suggestions being in different processing stages
		allSuggestions.forEach((suggestion, index) => {
			// Randomly assign some to enhancement phase
			if (index % 3 === 0) {
				processingItems.push({
					id: `enhancement_${suggestion.id}`,
					title: suggestion.originalData.title,
					status: this.getEnhancementStatus(suggestion),
					type: 'enhancement',
					progress: this.calculateEnhancementProgress(suggestion),
					suggestion: suggestion
				});
			}
			
			// Randomly assign some to linking phase
			if (index % 4 === 1) {
				processingItems.push({
					id: `linking_${suggestion.id}`,
					title: suggestion.originalData.title,
					status: this.getLinkingStatus(suggestion),
					type: 'linking',
					progress: this.calculateLinkingProgress(suggestion),
					suggestion: suggestion
				});
			}
		});
		
		if (processingItems.length === 0) {
			const emptyState = processingList.createDiv('processing-empty');
			emptyState.createEl('div', { text: '⚡', cls: 'empty-icon' });
			emptyState.createEl('h4', { text: 'No items processing' });
			emptyState.createEl('p', { text: 'All items have been processed and are ready for review.' });
			return;
		}
		
		processingItems.forEach(item => {
			const itemEl = processingList.createDiv('processing-item');
			
			const itemHeader = itemEl.createDiv('processing-item-header');
			itemHeader.createEl('h4', { text: item.title, cls: 'processing-item-title' });
			
			// Add type indicator
			const typeIndicator = itemHeader.createDiv('processing-type-indicator');
			const typeIcon = item.type === 'enhancement' ? '🤖' : '🔗';
			const typeName = item.type === 'enhancement' ? 'AI Enhancement' : 'Relationship Analysis';
			typeIndicator.createSpan({ text: `${typeIcon} ${typeName}`, cls: 'type-label' });
			
			const statusEl = itemEl.createDiv('processing-item-status');
			statusEl.createEl('span', { text: item.status, cls: 'status-text' });
			
			// Progress bar
			const progressContainer = itemEl.createDiv('progress-container');
			const progressBar = progressContainer.createDiv('progress-bar');
			const progressFill = progressBar.createDiv('progress-fill');
			progressFill.style.width = `${item.progress}%`;
			
			const progressText = progressContainer.createSpan({ 
				text: `${Math.round(item.progress)}%`, 
				cls: 'progress-text' 
			});
			
			// Add estimated time remaining
			const timeRemaining = this.calculateTimeRemaining(item.progress);
			if (timeRemaining) {
				const timeEl = itemEl.createDiv('processing-time');
				timeEl.createSpan({ text: `⏱ ${timeRemaining}`, cls: 'time-remaining' });
			}
		});
	}

	private getEnhancementStatus(suggestion: LLMSuggestion): string {
		const confidence = suggestion.confidence;
		
		if (confidence < 0.3) {
			return 'Analyzing content structure...';
		} else if (confidence < 0.6) {
			return 'Generating tags and insights...';
		} else if (confidence < 0.8) {
			return 'Creating action items...';
		} else {
			return 'Finalizing suggestions...';
		}
	}

	private getLinkingStatus(suggestion: LLMSuggestion): string {
		const hasRelationships = suggestion.suggestions.relationships?.length || 0;
		
		if (hasRelationships === 0) {
			return 'Scanning vault for connections...';
		} else if (hasRelationships < 3) {
			return 'Analyzing relationship strength...';
		} else {
			return 'Mapping knowledge graph...';
		}
	}

	private calculateEnhancementProgress(suggestion: LLMSuggestion): number {
		// Base progress on suggestion completeness
		let progress = 0;
		
		// Title analyzed: +20%
		if (suggestion.originalData.title) progress += 20;
		
		// Tags generated: +25%
		if (suggestion.suggestions.tags?.length) {
			progress += Math.min(25, suggestion.suggestions.tags.length * 5);
		}
		
		// Action items created: +25%
		if (suggestion.suggestions.actionItems?.length) {
			progress += Math.min(25, suggestion.suggestions.actionItems.length * 8);
		}
		
		// Insights generated: +20%
		if (suggestion.suggestions.insights) progress += 20;
		
		// Confidence factor: +10%
		progress += suggestion.confidence * 10;
		
		// Add some randomness to simulate real-time processing
		progress += (Math.random() - 0.5) * 10;
		
		return Math.max(5, Math.min(95, progress));
	}

	private calculateLinkingProgress(suggestion: LLMSuggestion): number {
		// Base progress on relationship discovery
		let progress = 0;
		
		// Base scanning: +30%
		progress += 30;
		
		// Relationships found: +40%
		const relationshipCount = suggestion.suggestions.relationships?.length || 0;
		progress += Math.min(40, relationshipCount * 10);
		
		// Content similarity analysis: +20%
		if (suggestion.suggestions.summary) progress += 20;
		
		// Graph integration: +10%
		progress += 10;
		
		// Add randomness
		progress += (Math.random() - 0.5) * 15;
		
		return Math.max(10, Math.min(90, progress));
	}

	private calculateTimeRemaining(progress: number): string {
		if (progress >= 95) return '';
		
		const remaining = 100 - progress;
		
		if (remaining > 50) {
			return '2-3 minutes remaining';
		} else if (remaining > 20) {
			return '1-2 minutes remaining';
		} else {
			return '< 1 minute remaining';
		}
	}

	private renderReviewQueue(): void {
		if (!this.contentContainer) return;
		
		// Main content - direct suggestion list for review
		if (this.pendingBatches.length === 0) {
			this.renderEmptyState(this.contentContainer);
		} else {
			this.renderDirectSuggestionList();
		}
	}

	private renderDirectSuggestionList(): void {
		if (!this.contentContainer) return;
		
		// Create direct suggestions container
		const suggestionsContainer = this.contentContainer.createDiv('suggestions-banner-container');
		
		// Flatten all pending suggestions from all batches (no approved since they're auto-applied)
		const allSuggestions: LLMSuggestion[] = [];
		this.pendingBatches.forEach(batch => {
			const pendingSuggestions = batch.suggestions.filter(s => s.status === 'pending');
			allSuggestions.push(...pendingSuggestions);
		});
		
		// Render each suggestion directly
		allSuggestions.forEach(suggestion => {
			this.renderSimplifiedSuggestionItem(suggestionsContainer, suggestion);
		});
	}

	private renderSimplifiedSuggestionItem(container: HTMLElement, suggestion: LLMSuggestion): void {
		const itemCard = container.createDiv('suggestion-item-modern simplified-suggestion');
		itemCard.setAttribute('data-suggestion-id', suggestion.id);
		itemCard.addClass(`suggestion-status-${suggestion.status}`);

		// Make the entire item clickable to open note
		if (suggestion.targetNotePath) {
			itemCard.style.cursor = 'pointer';
			itemCard.addEventListener('click', (e) => {
				// Don't trigger if clicking on buttons
				if ((e.target as HTMLElement).closest('button')) return;
				this.openTargetNote(suggestion.targetNotePath!);
			});
		}

		// Item header with title and metadata
		const itemHeader = itemCard.createDiv('suggestion-item-header-modern');
		
		const titleSection = itemHeader.createDiv('suggestion-title-section');
		titleSection.createEl('h4', { 
			text: suggestion.originalData.title, 
			cls: 'suggestion-title-modern' 
		});
		
		const metaSection = itemHeader.createDiv('suggestion-meta-section');
		
		// Type badge
		const typeBadge = metaSection.createDiv('suggestion-type-badge');
		typeBadge.textContent = suggestion.type.replace('-', ' ');
		
		// Confidence indicator
		const confidenceBadge = metaSection.createDiv(`suggestion-confidence-badge confidence-${this.getConfidenceLevel(suggestion.confidence)}`);
		confidenceBadge.textContent = `${Math.round(suggestion.confidence * 100)}%`;
		
		// Priority indicator
		const priorityBadge = metaSection.createDiv(`suggestion-priority-badge priority-${suggestion.priority}`);
		priorityBadge.textContent = suggestion.priority;

		// Interactive preview badges with hover tooltips
		this.renderInteractivePreviewBadges(itemCard, suggestion);

		// Actions section
		this.renderSimplifiedSuggestionActions(itemCard, suggestion);
	}

	private renderInteractivePreviewBadges(container: HTMLElement, suggestion: LLMSuggestion): void {
		const badgesContainer = container.createDiv('interactive-badges-container');
		const suggestions = suggestion.suggestions;
		
		// Tags badge with hover tooltip
		if (suggestions.tags?.length) {
			const tagsBadge = badgesContainer.createDiv('interactive-badge tags-badge');
			tagsBadge.textContent = `🏷️ ${suggestions.tags.length} tags`;
			tagsBadge.setAttribute('title', `Tags: ${suggestions.tags.join(', ')}`);
			tagsBadge.setAttribute('aria-label', `Tags: ${suggestions.tags.join(', ')}`);
			tagsBadge.addEventListener('click', (e) => {
				e.stopPropagation();
				if (suggestion.targetNotePath) {
					this.openTargetNote(suggestion.targetNotePath);
				}
			});
		}
		
		// Action items badge with hover tooltip
		if (suggestions.actionItems?.length) {
			const actionsBadge = badgesContainer.createDiv('interactive-badge actions-badge');
			actionsBadge.textContent = `✅ ${suggestions.actionItems.length} action items`;
			actionsBadge.setAttribute('title', `Action Items:\n${suggestions.actionItems.join('\n')}`);
			actionsBadge.setAttribute('aria-label', `Action Items: ${suggestions.actionItems.join(', ')}`);
			actionsBadge.addEventListener('click', (e) => {
				e.stopPropagation();
				if (suggestion.targetNotePath) {
					this.openTargetNote(suggestion.targetNotePath);
				}
			});
		}
		
		// Relationships badge with hover tooltip
		if (suggestions.relationships?.length) {
			const relationshipsBadge = badgesContainer.createDiv('interactive-badge relationships-badge');
			relationshipsBadge.textContent = `🔗 ${suggestions.relationships.length} relationships`;
			relationshipsBadge.setAttribute('title', `Relationships:\n${suggestions.relationships.join('\n')}`);
			relationshipsBadge.setAttribute('aria-label', `Relationships: ${suggestions.relationships.join(', ')}`);
			relationshipsBadge.addEventListener('click', (e) => {
				e.stopPropagation();
				if (suggestion.targetNotePath) {
					this.openTargetNote(suggestion.targetNotePath);
				}
			});
		}
	}

	private renderSimplifiedSuggestionActions(container: HTMLElement, suggestion: LLMSuggestion): void {
		const actionsContainer = container.createDiv('suggestion-actions-modern simplified-actions');

		const primaryActions = actionsContainer.createDiv('primary-actions');

		// Only show approve/reject for pending items (auto-apply after approval)
		if (suggestion.status === 'pending') {
			const approveContainer = primaryActions.createDiv();
			const approveBtn = new ButtonComponent(approveContainer)
				.setButtonText('✓ Approve & Apply')
				.setTooltip('Approve and automatically apply this suggestion')
				.setClass('mod-cta')
				.onClick(() => this.approveSuggestion(suggestion.id));
			approveContainer.addClass('action-btn-small');

			const rejectContainer = primaryActions.createDiv();
			const rejectBtn = new ButtonComponent(rejectContainer)
				.setButtonText('✗ Reject')
				.setTooltip('Reject this suggestion')
				.onClick(() => this.rejectSuggestion(suggestion.id));
			rejectContainer.addClass('action-btn-small');
		}

		// No separate "Apply" button needed since we auto-apply
		// Approved suggestions should disappear from the queue after being applied
	}

	private renderSimplifiedPipeline(): void {
		if (!this.contentContainer) return;
		
		const pipelineSection = this.contentContainer.createDiv('simplified-pipeline');
		
		// Simple horizontal pipeline
		const pipeline = pipelineSection.createDiv('pipeline-simple');
		const stats = this.calculateQueueStats();
		
		// Show all stages with interactive details
		const stages = [
			{ 
				name: 'Processing', 
				count: stats.pendingEnhancement + stats.pendingLinking, 
				icon: '⚡',
				details: this.getProcessingDetails(stats)
			},
			{ 
				name: 'Review', 
				count: stats.pendingReview, 
				icon: '👁',
				details: this.getReviewDetails()
			},
			{ 
				name: 'Ready', 
				count: this.getTotalApprovedCount(), 
				icon: '✅',
				details: this.getReadyDetails()
			}
		];

		stages.forEach((stage, index) => {
			const stageEl = pipeline.createDiv('pipeline-stage-simple interactive-stage');
			stageEl.createSpan({ text: stage.icon, cls: 'stage-icon' });
			stageEl.createSpan({ text: stage.count.toString(), cls: 'stage-count' });
			stageEl.createSpan({ text: stage.name, cls: 'stage-name' });
			
			// Add interactive tooltip and click behavior
			if (stage.count > 0) {
				stageEl.setAttribute('title', stage.details);
				stageEl.style.cursor = 'pointer';
				stageEl.addEventListener('click', () => {
					this.showStageDetails(stage.name, stage.details, stage.count);
				});
			}
			
			// Add arrow connector (except for last stage)
			if (index < stages.length - 1) {
				pipeline.createSpan({ text: '→', cls: 'pipeline-arrow' });
			}
		});
	}

	private getProcessingDetails(stats: any): string {
		const details: string[] = [];
		if (stats.pendingEnhancement > 0) {
			details.push(`${stats.pendingEnhancement} waiting for AI enhancement`);
		}
		if (stats.pendingLinking > 0) {
			details.push(`${stats.pendingLinking} waiting for relationship analysis`);
		}
		return details.join('\n') || 'No items processing';
	}

	private getReviewDetails(): string {
		const pendingSuggestions = this.getAllPendingSuggestions();
		if (pendingSuggestions.length === 0) return 'No items pending review';
		
		const types = pendingSuggestions.reduce((acc, suggestion) => {
			const type = suggestion.type.replace('-', ' ');
			acc[type] = (acc[type] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);
		
		return Object.entries(types)
			.map(([type, count]) => `${count} ${type}`)
			.join('\n');
	}

	private getReadyDetails(): string {
		const approvedSuggestions = this.getAllApprovedSuggestions();
		if (approvedSuggestions.length === 0) return 'No approved items ready';
		
		const types = approvedSuggestions.reduce((acc, suggestion) => {
			const type = suggestion.type.replace('-', ' ');
			acc[type] = (acc[type] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);
		
		return Object.entries(types)
			.map(([type, count]) => `${count} ${type} ready to apply`)
			.join('\n');
	}

	private getAllPendingSuggestions(): LLMSuggestion[] {
		const allSuggestions: LLMSuggestion[] = [];
		this.pendingBatches.forEach(batch => {
			const pending = batch.suggestions.filter(s => s.status === 'pending');
			allSuggestions.push(...pending);
		});
		return allSuggestions;
	}

	private getAllApprovedSuggestions(): LLMSuggestion[] {
		const allSuggestions: LLMSuggestion[] = [];
		this.pendingBatches.forEach(batch => {
			const approved = batch.suggestions.filter(s => s.status === 'approved');
			allSuggestions.push(...approved);
		});
		return allSuggestions;
	}

	private showStageDetails(stageName: string, details: string, count: number): void {
		// Create a detailed modal or notice with stage information
		const message = `${stageName} Stage (${count} items):\n\n${details}`;
		new Notice(message, 8000);
		
		// Also log to console for debugging
		console.log(`📊 ${stageName} Stage Details:`, {
			count,
			details: details.split('\n'),
			timestamp: new Date().toISOString()
		});
	}

	private getTotalApprovedCount(): number {
		return this.pendingBatches.reduce(
			(sum, batch) => sum + batch.suggestions.filter(s => s.status === 'approved').length,
			0
		);
	}

	private toggleBatchExpansion(batchId: string): void {
		if (this.expandedBatches.has(batchId)) {
			this.expandedBatches.delete(batchId);
		} else {
			this.expandedBatches.add(batchId);
		}
		this.renderScrollableContent(); // Re-render to show/hide content
	}

	private renderCompactQueueVisualization(): void {
		if (!this.contentContainer) return;
		
		const queueSection = this.contentContainer.createDiv('queue-visualization-compact');
		
		// Compact pipeline view
		const pipeline = queueSection.createDiv('pipeline-compact');
		const stats = this.calculateQueueStats();
		
		// Create pipeline stages in a more compact format
		const stages = [
			{ name: 'Created', count: stats.created, icon: '📝', status: 'completed' },
			{ name: 'Enhanced', count: stats.pendingEnhancement, icon: '⚡', status: stats.pendingEnhancement > 0 ? 'active' : 'idle' },
			{ name: 'Linked', count: stats.pendingLinking, icon: '🔗', status: stats.pendingLinking > 0 ? 'active' : 'idle' },
			{ name: 'Review', count: stats.pendingReview, icon: '👁', status: stats.pendingReview > 0 ? 'waiting' : 'idle' }
		];

		stages.forEach((stage, index) => {
			const stageEl = pipeline.createDiv(`pipeline-stage pipeline-stage-${stage.status}`);
			stageEl.createSpan({ text: stage.icon, cls: 'stage-icon' });
			stageEl.createSpan({ text: stage.count.toString(), cls: 'stage-count' });
			stageEl.createSpan({ text: stage.name, cls: 'stage-name' });
			
			// Add arrow connector (except for last stage)
			if (index < stages.length - 1) {
				pipeline.createSpan({ text: '→', cls: 'pipeline-arrow' });
			}
		});
	}

	private renderHeader(container: HTMLElement): void {
		const header = container.createDiv('suggestion-header');
		
		const titleContainer = header.createDiv('suggestion-title-container');
		titleContainer.createEl('h3', { text: 'AI Suggestions', cls: 'suggestion-title' });
		
		const refreshBtn = titleContainer.createEl('button', {
			text: '🔄 Refresh',
			cls: 'suggestion-refresh-btn',
			attr: { title: 'Refresh suggestions' }
		});
		refreshBtn.onclick = () => this.refresh();

		// Summary stats (more compact)
		const summary = header.createDiv('suggestion-summary');
		const totalPending = this.pendingBatches.reduce(
			(sum, batch) => sum + batch.suggestions.filter(s => s.status === 'pending').length, 
			0
		);
		const totalBatches = this.pendingBatches.length;

		if (totalPending > 0) {
			summary.createEl('span', { 
				text: `${totalPending} pending suggestions`,
				cls: 'suggestion-count'
			});
		} else {
			summary.createEl('span', { 
				text: 'No pending suggestions',
				cls: 'suggestion-count'
			});
		}
	}

	private renderQueueVisualization(container: HTMLElement): void {
		const queueSection = container.createDiv('queue-visualization');
		
		// Queue header
		const queueHeader = queueSection.createDiv('queue-header');
		queueHeader.createEl('h4', { text: 'Processing Pipeline', cls: 'queue-title' });
		
		// Queue stages
		const queuePipeline = queueSection.createDiv('queue-pipeline');
		
		// Calculate stats for each stage
		const stats = this.calculateQueueStats();
		
		// Stage 1: Note Creation
		this.renderQueueStage(queuePipeline, {
			name: 'Note Creation',
			description: 'Basic notes from events, transactions, chat',
			count: stats.created,
			icon: '📝',
			status: 'active'
		});
		
		// Stage 2: Enhancement Queue
		this.renderQueueStage(queuePipeline, {
			name: 'Enhancement Queue',
			description: 'Waiting for LLM content enhancement',
			count: stats.pendingEnhancement,
			icon: '⏳',
			status: stats.pendingEnhancement > 0 ? 'active' : 'idle'
		});
		
		// Stage 3: Linking Analysis
		this.renderQueueStage(queuePipeline, {
			name: 'Link Analysis',
			description: 'Finding connections between notes',
			count: stats.pendingLinking,
			icon: '🔗',
			status: stats.pendingLinking > 0 ? 'active' : 'idle'
		});
		
		// Stage 4: User Review
		this.renderQueueStage(queuePipeline, {
			name: 'User Review',
			description: 'Awaiting your approval',
			count: stats.pendingReview,
			icon: '👤',
			status: stats.pendingReview > 0 ? 'waiting' : 'idle'
		});
	}

	private renderQueueStage(container: HTMLElement, stage: {
		name: string;
		description: string;
		count: number;
		icon: string;
		status: 'active' | 'waiting' | 'idle';
	}): void {
		const stageEl = container.createDiv(`queue-stage queue-stage-${stage.status}`);
		
		// Stage icon and count
		const stageHeader = stageEl.createDiv('stage-header');
		stageHeader.createEl('span', { text: stage.icon, cls: 'stage-icon' });
		stageHeader.createEl('span', { text: stage.count.toString(), cls: 'stage-count' });
		
		// Stage info
		stageEl.createEl('div', { text: stage.name, cls: 'stage-name' });
		stageEl.createEl('div', { text: stage.description, cls: 'stage-description' });
	}

	private calculateQueueStats(): {
		created: number;
		pendingEnhancement: number;
		pendingLinking: number;
		pendingReview: number;
	} {
		const pendingReview = this.pendingBatches.reduce(
			(sum, batch) => sum + batch.suggestions.filter(s => s.status === 'pending').length,
			0
		);

		// For now, we'll estimate other stages based on batch metadata
		// In a full implementation, these would come from actual queue services
		const totalInProgress = this.pendingBatches.reduce((sum, batch) => sum + batch.suggestions.length, 0);
		
		return {
			created: Math.floor(totalInProgress * 0.1), // Estimate: 10% recently created
			pendingEnhancement: Math.floor(totalInProgress * 0.2), // 20% pending enhancement
			pendingLinking: Math.floor(totalInProgress * 0.1), // 10% pending linking
			pendingReview: pendingReview
		};
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
			
			// Auto-apply immediately after approval
			await this.applySuggestion(suggestionId);
			
			await this.refresh();
			new Notice('Suggestion approved and applied automatically');
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

	private showQueueStatus(): void {
		// Show detailed queue status
		const stats = this.calculateQueueStats();
		const message = `Queue Status:\n• Created: ${stats.created}\n• Enhancement: ${stats.pendingEnhancement}\n• Linking: ${stats.pendingLinking}\n• Review: ${stats.pendingReview}`;
		new Notice(message, 5000);
	}

	private addTestSuggestion(): void {
		// Create multiple test suggestions with different data for better testing
		const testSuggestions: LLMSuggestion[] = [
			{
				id: `test_${Date.now()}_1`,
				type: 'note-enhancement',
				sourceId: 'test-source-1',
				timestamp: new Date().toISOString(),
				status: 'pending',
				priority: 'high',
				originalData: {
					title: 'Meeting Notes - Product Review',
					type: 'note',
					summary: 'Strategic product review meeting notes'
				},
				suggestions: {
					tags: ['#product', '#strategy', '#meeting', '#q4-planning'],
					actionItems: [
						'Schedule follow-up with engineering team',
						'Review competitor analysis by Friday', 
						'Prepare budget proposal for Q1'
					],
					preparationItems: ['Gather market research data'],
					relationships: [
						'Product Roadmap 2024',
						'Engineering Sprint Planning',
						'Marketing Strategy'
					],
					insights: 'This meeting revealed critical insights about market positioning',
					summary: 'Strategic planning session with actionable next steps'
				},
				confidence: 0.92,
				targetNotePath: 'Meeting Notes - Product Review.md'
			},
			{
				id: `test_${Date.now()}_2`,
				type: 'calendar-event',
				sourceId: 'test-source-2',
				timestamp: new Date().toISOString(),
				status: 'approved',
				priority: 'medium',
				originalData: {
					title: 'Weekly Team Standup',
					type: 'event',
					summary: 'Regular team synchronization meeting'
				},
				suggestions: {
					tags: ['#standup', '#team', '#weekly'],
					actionItems: ['Update project status', 'Review blockers'],
					preparationItems: [],
					relationships: ['Sprint Planning', 'Team Goals'],
					insights: 'Regular team sync to maintain momentum',
					summary: 'Routine standup with team updates'
				},
				confidence: 0.85,
				targetNotePath: 'Weekly Team Standup.md'
			}
		];

		// Create or update test batch
		if (this.pendingBatches.length === 0) {
			const testBatch: SuggestionBatch = {
				id: `batch_${Date.now()}`,
				type: 'note-analysis',
				sourceOperation: 'test-ui-development',
				timestamp: new Date().toISOString(),
				suggestions: testSuggestions,
				batchStatus: 'pending',
				totalSuggestions: testSuggestions.length,
				approvedCount: testSuggestions.filter(s => s.status === 'approved').length,
				rejectedCount: 0,
				appliedCount: 0
			};
			this.pendingBatches.push(testBatch);
		} else {
			// Add to existing batch
			this.pendingBatches[0].suggestions.push(...testSuggestions);
			this.pendingBatches[0].totalSuggestions = this.pendingBatches[0].suggestions.length;
			this.pendingBatches[0].approvedCount = this.pendingBatches[0].suggestions.filter(s => s.status === 'approved').length;
		}

		// Re-render the view
		this.renderScrollableContent();
		new Notice(`Added ${testSuggestions.length} test suggestions! Try hovering and clicking on badges and pipeline stages.`);
	}
}
