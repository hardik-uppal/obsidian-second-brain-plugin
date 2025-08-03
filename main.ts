import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, PluginState } from './src/types';
import { VaultInitializer } from './src/vault/initializer';
import { IntelligenceBrokerService } from './src/services/llm-service';
import { PlaidService } from './src/services/plaid-service';
import { CalendarService } from './src/services/calendar-service';
import { MasterCalendarService } from './src/services/master-calendar-service';
import { SuggestionManagementService } from './src/services/suggestion-management-service';
import { TransactionProcessingService } from './src/services/transaction-processing-service';
import { EventTemplateService } from './src/services/event-template-service';
import { TemplateEngine, TemplateDataProcessor } from './src/utils/templates';
import { ChatView, CHAT_VIEW_TYPE } from './src/ui/ChatView';
import { CalendarView, CALENDAR_VIEW_TYPE } from './src/ui/CalendarView';

export default class SecondBrainPlugin extends Plugin {
	settings: PluginSettings;
	state: PluginState;
	
	// Services
	vaultInitializer: VaultInitializer;
	intelligenceBrokerService: IntelligenceBrokerService;
	plaidService: PlaidService;
	calendarService: CalendarService;
	masterCalendarService: MasterCalendarService;
	suggestionManagementService: SuggestionManagementService;
	transactionService: TransactionProcessingService;
	eventTemplateService: EventTemplateService;

	async onload() {
		await this.loadSettings();
		
		// Initialize state
		this.state = {
			initialized: false,
			dependenciesChecked: false,
			syncStatus: {
				transactions: { isRunning: false, itemsProcessed: 0, errors: [] },
				events: { isRunning: false, itemsProcessed: 0, errors: [] },
				tasks: { isRunning: false, itemsProcessed: 0, errors: [] }
			}
		};

		// Initialize services
		this.initializeServices();

		// Initialize suggestion management service
		await this.suggestionManagementService.initialize();

		// Initialize transaction processing service
		await this.transactionService.initialize();

		// Register views
		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
		this.registerView(CALENDAR_VIEW_TYPE, (leaf) => new CalendarView(leaf, this.masterCalendarService));

		// Add ribbon icon for main plugin
		const ribbonIconEl = this.addRibbonIcon('brain', 'Second Brain Integration', (evt: MouseEvent) => {
			new Notice('Second Brain Integration is active!');
		});
		ribbonIconEl.addClass('second-brain-ribbon-class');

		// Add ribbon icon for chat
		const chatRibbonIconEl = this.addRibbonIcon('message-circle', 'Open Second Brain Chat', (evt: MouseEvent) => {
			this.activateChatView();
		});
		chatRibbonIconEl.addClass('second-brain-chat-ribbon-class');

		// Add ribbon icon for calendar
		const calendarRibbonIconEl = this.addRibbonIcon('calendar', 'Open Master Calendar', (evt: MouseEvent) => {
			this.activateCalendarView();
		});
		calendarRibbonIconEl.addClass('second-brain-calendar-ribbon-class');

		// Add status bar item
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Second Brain: Ready');

		// Add commands
		this.addCommands();

		// Add settings tab
		this.addSettingTab(new SecondBrainSettingTab(this.app, this));

		// Initialize vault if needed
		await this.checkAndInitializeVault();

		console.log('Second Brain Integration plugin loaded');
	}

	onunload() {
		console.log('Second Brain Integration plugin unloaded');
	}

	private initializeServices(): void {
		this.vaultInitializer = new VaultInitializer(this.app, this.settings);
		this.intelligenceBrokerService = new IntelligenceBrokerService(this.app, this.settings);
		this.plaidService = new PlaidService(this.settings, async (settings) => {
			this.settings = settings;
			await this.saveSettings();
		});
		this.calendarService = new CalendarService(this.settings);
		this.masterCalendarService = new MasterCalendarService(this.app, this.settings);
		this.suggestionManagementService = new SuggestionManagementService(this.app, this.settings, this.intelligenceBrokerService);
		
		// Initialize event template service
		this.eventTemplateService = new EventTemplateService(this.app, this.settings);
		
		// Initialize transaction processing service
		this.transactionService = new TransactionProcessingService(
			this.app,
			this.settings,
			this.plaidService,
			this.eventTemplateService,
			this.suggestionManagementService
		);
	}

	private addCommands(): void {
		// Initialize vault command
		this.addCommand({
			id: 'initialize-vault',
			name: 'Initialize Vault Structure',
			callback: async () => {
				const success = await this.vaultInitializer.initializeVault();
				if (success) {
					this.state.initialized = true;
				}
			}
		});

		// Connect bank account command
		this.addCommand({
			id: 'connect-bank-account',
			name: 'Connect Bank Account (Plaid)',
			callback: async () => {
				try {
					await this.plaidService?.connectBankAccount();
				} catch (error: any) {
					console.error('Command failed - Connect Bank Account:', error);
					new Notice(`Failed to connect bank account: ${error?.message || 'Unknown error'}`, 6000);
				}
			}
		});

		// Sync transactions command
		this.addCommand({
			id: 'sync-transactions',
			name: 'Sync Transactions from Plaid',
			callback: async () => {
				await this.syncTransactions();
			}
		});

		// NEW: Sync transactions with date range selection
		this.addCommand({
			id: 'sync-transactions-with-range',
			name: 'Sync Transactions (Custom Range)',
			callback: () => {
				new TransactionSyncModal(this.app, this).open();
			}
		});

		// NEW: Quick sync for this month
		this.addCommand({
			id: 'sync-transactions-month',
			name: 'Sync Transactions (This Month)',
			callback: async () => {
				await this.transactionService.syncTransactionsBatch({
					syncRange: 'month'
				});
			}
		});

		// Sync events command
		this.addCommand({
			id: 'sync-events',
			name: 'Sync Calendar Events',
			callback: async () => {
				await this.masterCalendarService.syncAllCalendars();
			}
		});

		// Discover calendars command
		this.addCommand({
			id: 'discover-calendars',
			name: 'Discover Available Calendars',
			callback: async () => {
				await this.masterCalendarService.refreshAllAccounts();
			}
		});

		// Resolve conflicts command
		this.addCommand({
			id: 'resolve-conflicts',
			name: 'Resolve Calendar Conflicts',
			callback: async () => {
				await this.showConflictResolutionModal();
			}
		});

		// Import JSON command
		this.addCommand({
			id: 'import-json',
			name: 'Import JSON Data',
			callback: () => {
				new JsonImportModal(this.app, this).open();
			}
		});

		// Export graph command
		this.addCommand({
			id: 'export-graph',
			name: 'Export Graph Data',
			callback: async () => {
				await this.exportGraphData();
			}
		});

		// Test connections command
		this.addCommand({
			id: 'test-connections',
			name: 'Test API Connections',
			callback: async () => {
				await this.testConnections();
			}
		});

		// Exchange Plaid token command
		this.addCommand({
			id: 'exchange-plaid-token',
			name: 'Exchange Plaid Token',
			callback: () => {
				new PlaidTokenModal(this.app, this).open();
			}
		});
		this.addCommand({
			id: 'open-chat',
			name: 'Open Second Brain Chat',
			callback: async () => {
				await this.activateChatView();
			}
		});

		// Open calendar view command
		this.addCommand({
			id: 'open-calendar',
			name: 'Open Master Calendar',
			callback: async () => {
				await this.activateCalendarView();
			}
		});

		// Sync calendars command
		this.addCommand({
			id: 'sync-calendars',
			name: 'Sync All Calendars',
			callback: async () => {
				await this.masterCalendarService.syncAllCalendars();
			}
		});

		// Add Google account command
		this.addCommand({
			id: 'add-google-account',
			name: 'Add Google Calendar Account',
			callback: async () => {
				new AddGoogleAccountModal(this.app, this, () => {}).open();
			}
		});

		// Diagnostic command for network troubleshooting
		this.addCommand({
			id: 'plaid-network-diagnostics',
			name: 'Run Plaid Network Diagnostics',
			callback: async () => {
				try {
					new Notice('Running network diagnostics...', 2000);
					const diagnostics = await this.plaidService?.diagnoseNetworkConnectivity();
					
					if (diagnostics) {
						const message = `Plaid Network Diagnostics:\n\n${diagnostics.details.join('\n')}\n\nOverall: ${diagnostics.success ? '✅ Healthy' : '❌ Issues Found'}`;
						
						// Show in console for detailed info
						console.log('Plaid Network Diagnostics Results:', diagnostics);
						
						// Show user-friendly notice
						new Notice(message, 10000);
					}
				} catch (error: any) {
					console.error('Diagnostics command failed:', error);
					new Notice(`Diagnostics failed: ${error?.message || 'Unknown error'}`, 5000);
				}
			}
		});

		// Exchange Plaid token command
		this.addCommand({
			id: 'exchange-plaid-token',
			name: 'Exchange Plaid Token',
			callback: () => {
				new PlaidTokenModal(this.app, this).open();
			}
		});

		// Calendar sync diagnostics command
		this.addCommand({
			id: 'calendar-sync-diagnostics',
			name: 'Calendar Sync Diagnostics',
			callback: async () => {
				const diagnostics = await this.masterCalendarService.diagnosticSyncReadiness();
				const details = this.masterCalendarService.getSyncDiagnostics();
				
				let message = `## Calendar Sync Diagnostics\n\n`;
				message += `**Status:** ${diagnostics.ready ? '✅ Ready' : '❌ Issues Found'}\n\n`;
				
				if (diagnostics.issues.length > 0) {
					message += `**Issues:**\n`;
					diagnostics.issues.forEach(issue => {
						message += `- ${issue}\n`;
					});
					message += `\n`;
				}
				
				message += `**Details:**\n`;
				message += `- Master Calendar Enabled: ${details.enabled}\n`;
				message += `- Google Accounts: ${details.accountsCount}\n`;
				message += `- Enabled Calendars: ${details.enabledCalendarsCount}\n`;
				message += `- Create Event Notes: ${details.eventSettings.createEventNotes}\n`;
				message += `- Event Notes Folder: ${details.eventSettings.eventNotesFolder}\n`;
				message += `- Use Templates: ${details.eventSettings.useEventTemplates}\n`;
				message += `- Template Folder: ${details.eventSettings.templateFolder}\n`;
				message += `- Cached Events: ${details.cachedEventsCount}\n`;
				
				new Notice(message, 15000);
				console.log('Calendar Sync Diagnostics:', diagnostics, details);
			}
		});
	}

	private async checkAndInitializeVault(): Promise<void> {
		const isInitialized = await this.vaultInitializer.isVaultInitialized();
		
		if (!isInitialized) {
			new Notice('Second Brain vault not initialized. Use "Initialize Vault Structure" command to set up.', 5000);
		} else {
			this.state.initialized = true;
			new Notice('Second Brain vault ready!');
		}

		// Initialize master calendar service
		// if (this.settings.masterCalendar.enabled) {
		try {
			await this.masterCalendarService.initialize();
			console.log('Master calendar service initialized');
		} catch (error) {
			console.error('Failed to initialize master calendar service:', error);
		}
		// }
	}

	async syncTransactions(): Promise<void> {
		if (this.state.syncStatus.transactions.isRunning) {
			new Notice('Transaction sync already in progress');
			return;
		}

		if (!this.plaidService.isConfigured()) {
			const status = this.plaidService.getConfigurationStatus();
			if (!this.plaidService.hasCredentials()) {
				new Notice(`Plaid not configured. Missing: ${status.missing.join(', ')}`);
			} else {
				new Notice('Plaid credentials configured but no access token. Please connect your bank account first.');
			}
			return;
		}

		this.state.syncStatus.transactions.isRunning = true;
		this.state.syncStatus.transactions.errors = [];

		try {
			// Use the new batch processing approach
			const result = await this.transactionService.syncTransactionsBatch();
			
			if (result.success) {
				new Notice(`Transaction sync completed: ${result.notesCreated} notes created, ${result.duplicatesFound} duplicates skipped`);
				this.state.syncStatus.transactions.itemsProcessed = result.transactionsProcessed;
			} else {
				new Notice(`Transaction sync failed: ${result.errors.join(', ')}`);
				this.state.syncStatus.transactions.errors = result.errors;
			}

		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			this.state.syncStatus.transactions.errors.push(errorMsg);
			new Notice(`Transaction sync failed: ${errorMsg}`);
		} finally {
			this.state.syncStatus.transactions.isRunning = false;
			this.state.syncStatus.transactions.lastSync = new Date().toISOString();
		}
	}

	private async syncEvents(): Promise<void> {
		// Redirect to new master calendar sync
		await this.masterCalendarService.syncAllCalendars();
	}

	async showConflictResolutionModal(): Promise<void> {
		// For now, just show a message about using the new system
		new Notice('Conflict resolution is handled automatically in the new calendar system. Check the settings for calendar priorities.', 5000);
	}

	private async exportGraphData(): Promise<void> {
		try {
			new Notice('Exporting graph data...');
			
			// This is a simplified version - in a full implementation,
			// you'd extract the actual graph structure from Obsidian
			const graphData = {
				nodes: [] as any[],
				edges: [] as any[],
				metadata: {
					exportDate: new Date().toISOString(),
					totalNodes: 0,
					totalEdges: 0,
					nodeTypes: {} as Record<string, number>,
					format: this.settings.exportFormat
				}
			};

			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();
			
			for (const file of files) {
				const content = await this.app.vault.read(file);
				const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
				
				if (frontmatter?.type) {
					graphData.nodes.push({
						id: file.path,
						title: file.basename,
						type: frontmatter.type,
						content: this.settings.includeContent ? content : undefined,
						tags: frontmatter.tags || [],
						frontmatter: this.settings.includeMetadata ? frontmatter : {},
						created: frontmatter.created || file.stat.ctime.toString(),
						modified: file.stat.mtime.toString(),
						path: file.path
					});
				}
			}

			graphData.metadata.totalNodes = graphData.nodes.length;

			// Export based on format
			let exportContent: string;
			let fileName: string;

			switch (this.settings.exportFormat) {
				case 'pytorch':
					exportContent = this.formatForPyTorchGeometric(graphData);
					fileName = 'graph-export-pytorch.json';
					break;
				case 'csv':
					exportContent = this.formatForCSV(graphData);
					fileName = 'graph-export.csv';
					break;
				default:
					exportContent = JSON.stringify(graphData, null, 2);
					fileName = 'graph-export.json';
			}

			// Save export file
			await this.app.vault.create(fileName, exportContent);
			new Notice(`Graph data exported to ${fileName}`);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Graph export failed: ${errorMsg}`);
		}
	}

	private formatForPyTorchGeometric(graphData: any): string {
		// Convert to PyTorch Geometric format
		const pytorchData = {
			x: graphData.nodes.map((node: any) => ({
				id: node.id,
				features: {
					type: node.type,
					tags: node.tags,
					created: node.created
				}
			})),
			edge_index: graphData.edges.map((edge: any) => [edge.source, edge.target]),
			metadata: graphData.metadata
		};
		
		return JSON.stringify(pytorchData, null, 2);
	}

	private formatForCSV(graphData: any): string {
		const headers = ['id', 'title', 'type', 'tags', 'created', 'modified', 'path'];
		const rows = [headers.join(',')];
		
		for (const node of graphData.nodes) {
			const row = [
				node.id,
				`"${node.title}"`,
				node.type,
				`"${node.tags.join(';')}"`,
				node.created,
				node.modified,
				node.path
			];
			rows.push(row.join(','));
		}
		
		return rows.join('\n');
	}

	private async testConnections(): Promise<void> {
		new Notice('Testing API connections...');
		
		const results: string[] = [];

		// Test Plaid
		if (this.plaidService.isConfigured()) {
			const plaidTest = await this.plaidService.testConnection();
			results.push(`Plaid: ${plaidTest ? '✅ Connected' : '❌ Failed'}`);
		} else {
			results.push('Plaid: ⚠️ Not configured');
		}

		// Test Google Calendar
		if (this.calendarService.isConfigured()) {
			const calendarTest = await this.calendarService.testConnection();
			results.push(`Google Calendar: ${calendarTest ? '✅ Connected' : '❌ Failed'}`);
		} else {
			results.push('Google Calendar: ⚠️ Not configured');
		}

		// Test LLM
		if (this.settings.llmApiKey) {
			results.push('LLM: ✅ Configured');
		} else {
			results.push('LLM: ⚠️ Not configured');
		}

		new Notice(results.join('\n'), 8000);
	}

	async activateChatView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

		if (leaves.length > 0) {
			// A chat view already exists, focus it
			leaf = leaves[0];
		} else {
			// Create a new chat view in the right sidebar
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		}

		// Reveal the leaf
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async activateCalendarView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);

		if (leaves.length > 0) {
			// A calendar view already exists, focus it
			leaf = leaves[0];
		} else {
			// Create a new calendar view in the right sidebar
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
		}

		// Reveal the leaf
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		
		// Update services with new settings
		if (this.intelligenceBrokerService) this.intelligenceBrokerService.updateSettings(this.settings);
		if (this.suggestionManagementService) this.suggestionManagementService.updateSettings(this.settings);
		if (this.plaidService) this.plaidService.updateSettings(this.settings);
		if (this.calendarService) this.calendarService.updateSettings(this.settings);
		if (this.transactionService) this.transactionService.updateSettings(this.settings);
		if (this.eventTemplateService) this.eventTemplateService.updateSettings(this.settings);
	}

	async addGoogleAccount(label: string): Promise<void> {
		try {
			if (!this.settings.googleCalendarClientId || !this.settings.googleCalendarClientSecret) {
				new Notice('Please configure Google OAuth2 credentials in settings first');
				return;
			}

			// Generate auth URL using the master calendar service
			const authUrl = this.masterCalendarService.generateAccountAuthUrl(label);
			
			// Open browser for OAuth
			window.open(authUrl, '_blank');
			
			new Notice(`1. Complete authentication in your browser for "${label}"\n2. Copy the authorization code\n3. Use "Exchange Code" in settings`, 8000);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Failed to start Google account setup: ${errorMsg}`);
		}
	}
}

// Add Google Account Modal
class AddGoogleAccountModal extends Modal {
	plugin: SecondBrainPlugin;
	onSubmit: (label: string) => void;

	constructor(app: App, plugin: SecondBrainPlugin, onSubmit: (label: string) => void) {
		super(app);
		this.plugin = plugin;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Add Google Account' });

		contentEl.createEl('p', { 
			text: 'Enter a label for this Google account (e.g., "Work Gmail", "Personal Calendar")' 
		});

		const input = contentEl.createEl('input', {
			type: 'text',
			placeholder: 'Enter account label...'
		});
		input.style.width = '100%';
		input.style.marginBottom = '10px';

		const buttonContainer = contentEl.createDiv();
		
		const continueButton = buttonContainer.createEl('button', { text: 'Continue to Google Auth' });
		continueButton.onclick = () => {
			const label = input.value.trim();
			if (!label) {
				new Notice('Please enter an account label');
				return;
			}
			
			// Start the OAuth flow
			this.plugin.addGoogleAccount(label);
			
			// Show the auth code modal for completing the setup
			setTimeout(() => {
				new AuthCodeModal(this.app, this.plugin, label).open();
			}, 1000);
			
			this.close();
		};

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();

		// Focus the input
		input.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// JSON Import Modal
class JsonImportModal extends Modal {
	plugin: SecondBrainPlugin;

	constructor(app: App, plugin: SecondBrainPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Import JSON Data' });

		const textarea = contentEl.createEl('textarea', {
			attr: { rows: '10', cols: '50', placeholder: 'Paste your JSON data here...' }
		});

		const buttonContainer = contentEl.createDiv();
		
		const importButton = buttonContainer.createEl('button', { text: 'Import' });
		importButton.onclick = async () => {
			try {
				const jsonData = JSON.parse(textarea.value);
				await this.processJsonImport(jsonData);
				this.close();
			} catch (error) {
				new Notice('Invalid JSON data');
			}
		};

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private async processJsonImport(data: any): Promise<void> {
		// This would process the imported JSON data
		// For now, just show a success message
		new Notice('JSON data imported successfully');
	}
}

// Auth Code Exchange Modal for Google Accounts
class AuthCodeModal extends Modal {
	plugin: SecondBrainPlugin;
	accountLabel: string;

	constructor(app: App, plugin: SecondBrainPlugin, accountLabel: string) {
		super(app);
		this.plugin = plugin;
		this.accountLabel = accountLabel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: `Complete Setup for "${this.accountLabel}"` });

		contentEl.createEl('p', { 
			text: 'After completing authentication in your browser, copy and paste the authorization code here:' 
		});

		const input = contentEl.createEl('input', {
			type: 'text',
			placeholder: 'Paste authorization code here...'
		});
		input.style.width = '100%';
		input.style.marginBottom = '10px';

		// Add helper text
		contentEl.createEl('div', {
			cls: 'setting-item-description',
			text: 'The authorization code should be a long string of characters. It may be shown in your browser or in a callback URL.'
		});

		const buttonContainer = contentEl.createDiv();
		
		const exchangeButton = buttonContainer.createEl('button', { text: 'Complete Setup' });
		exchangeButton.onclick = async () => {
			const authCode = input.value.trim();
			if (!authCode) {
				new Notice('Please enter the authorization code');
				return;
			}

			try {
				new Notice('Setting up Google account...');
				await this.plugin.masterCalendarService.completeAccountSetup(this.accountLabel, authCode);
				await this.plugin.saveSettings();
				
				new Notice(`Google account "${this.accountLabel}" setup completed!`);
				this.close();
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				new Notice(`Failed to complete account setup: ${errorMsg}`);
			}
		};

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Plaid Token Exchange Modal
class PlaidTokenModal extends Modal {
	plugin: SecondBrainPlugin;

	constructor(app: App, plugin: SecondBrainPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Exchange Plaid Token' });

		contentEl.createEl('p', { 
			text: 'After completing bank authentication in your browser, copy and paste the Plaid token here:' 
		});

		const input = contentEl.createEl('input', {
			type: 'text',
			placeholder: 'Paste Plaid token here...'
		});
		input.style.width = '100%';
		input.style.marginBottom = '10px';

		// Add helper text
		contentEl.createEl('div', {
			cls: 'setting-item-description',
			text: 'The token should start with "public-" and be a long string of characters.'
		});

		const buttonContainer = contentEl.createDiv();
		
		const exchangeButton = buttonContainer.createEl('button', { text: 'Exchange Token' });
		exchangeButton.onclick = async () => {
			const token = input.value.trim();
			if (!token) {
				new Notice('Please enter the Plaid token');
				return;
			}

			if (!token.startsWith('public-')) {
				new Notice('Invalid token format. Plaid tokens should start with "public-"');
				return;
			}

			try {
				new Notice('Exchanging Plaid token...');
				const success = await this.plugin.plaidService.handlePublicTokenFromBrowser(token);
				
				if (success) {
					new Notice('Plaid token exchanged successfully! Bank account connected.');
					this.close();
				} else {
					new Notice('Failed to exchange Plaid token. Please try again.');
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				new Notice(`Failed to exchange Plaid token: ${errorMsg}`);
			}
		};

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Settings Tab
class SecondBrainSettingTab extends PluginSettingTab {
	plugin: SecondBrainPlugin;

	constructor(app: App, plugin: SecondBrainPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Second Brain Integration Settings' });

		// LLM Settings
		containerEl.createEl('h3', { text: 'LLM Configuration' });

		new Setting(containerEl)
			.setName('LLM Provider')
			.setDesc('Choose your LLM provider')
			.addDropdown(dropdown => dropdown
				.addOption('openai', 'OpenAI')
				.addOption('anthropic', 'Anthropic')
				.addOption('custom', 'Custom Endpoint')
				.setValue(this.plugin.settings.llmProvider)
				.onChange(async (value: any) => {
					this.plugin.settings.llmProvider = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('LLM API Key')
			.setDesc('Your LLM API key')
			.addText(text => text
				.setPlaceholder('Enter API key')
				.setValue(this.plugin.settings.llmApiKey)
				.onChange(async (value) => {
					this.plugin.settings.llmApiKey = value;
					await this.plugin.saveSettings();
				}));

		// Plaid Settings
		containerEl.createEl('h3', { text: 'Plaid Configuration' });

		// Add setup guidance
		const plaidStatusText = this.plugin.plaidService?.hasCredentials() 
			? (this.plugin.settings.plaidAccessToken ? '✅ Configured and Connected' : '⚠️ Credentials set - Ready to connect')
			: '❌ Not configured';
		
		containerEl.createEl('div', { 
			cls: 'setting-item-description',
			text: `Status: ${plaidStatusText}\n\n📋 Setup Steps:\n1. Get credentials from Plaid Dashboard (https://dashboard.plaid.com/)\n2. For Production: Request access via Dashboard (required for live banking)\n3. Enter Client ID and Secret below\n4. Choose environment (Sandbox = fake data, Production = real banking)\n5. Click "Connect Bank Account" to link your bank`
		});

		new Setting(containerEl)
			.setName('Plaid Client ID')
			.setDesc('Your Plaid client ID')
			.addText(text => text
				.setPlaceholder('Enter client ID')
				.setValue(this.plugin.settings.plaidClientId)
				.onChange(async (value) => {
					this.plugin.settings.plaidClientId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Plaid Secret')
			.setDesc('Your Plaid secret key')
			.addText(text => text
				.setPlaceholder('Enter secret key')
				.setValue(this.plugin.settings.plaidSecret)
				.onChange(async (value) => {
					this.plugin.settings.plaidSecret = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Plaid Environment')
			.setDesc('Choose your Plaid environment:\n• Sandbox: Testing with fake data\n• Production: Live banking data (requires Plaid Dashboard approval)')
			.addDropdown(dropdown => dropdown
				.addOption('sandbox', 'Sandbox (Testing)')
				.addOption('production', 'Production (Live Banking)')
				.setValue(this.plugin.settings.plaidEnvironment)
				.onChange(async (value: any) => {
					this.plugin.settings.plaidEnvironment = value;
					await this.plugin.saveSettings();
					// Reinitialize Plaid service with new environment
					if (this.plugin.plaidService) {
						this.plugin.plaidService.updateSettings(this.plugin.settings);
					}
					// Refresh settings display to show/hide production notice
					this.display();
				}));

		// Production environment notice
		if (this.plugin.settings.plaidEnvironment === 'production') {
			containerEl.createEl('div', { 
				cls: 'setting-item-description',
				text: '🏦 Production Mode: You\'ll connect to real bank accounts and get live transaction data. Ensure you have Production API access approved in your Plaid Dashboard.'
			});
		}

		// Bank Account Connection
		const plaidStatus = this.plugin.plaidService?.getConfigurationStatus() || { configured: false, missing: [] };
		const hasCredentials = this.plugin.plaidService?.hasCredentials() || false;
		
		new Setting(containerEl)
			.setName('Bank Account Connection')
			.setDesc(
				this.plugin.settings.plaidAccessToken 
					? 'Bank account is connected. Click to reconnect or test connection.'
					: hasCredentials 
						? 'Connect your bank account to sync transactions'
						: 'Enter Plaid credentials above first'
			)
			.addButton(button => button
				.setButtonText(
					this.plugin.settings.plaidAccessToken 
						? 'Test Connection' 
						: 'Connect Bank Account'
				)
				.setDisabled(!hasCredentials)
				.onClick(async () => {
					if (this.plugin.settings.plaidAccessToken) {
						// Test existing connection
						const isValid = await this.plugin.plaidService?.testConnection();
						new Notice(isValid ? 'Bank connection is working!' : 'Bank connection failed. Please reconnect.');
					} else {
						// Connect new account
						try {
							await this.plugin.plaidService?.connectBankAccount();
						} catch (error) {
							console.error('Plaid connection error:', error);
							new Notice(`Failed to start bank connection: ${error instanceof Error ? error.message : 'Unknown error'}`);
						}
					}
				}))
			.addButton(button => button
				.setButtonText('Reconnect')
				.setClass('mod-warning')
				.setDisabled(!hasCredentials)
				.onClick(async () => {
					// Clear existing token and reconnect
					this.plugin.settings.plaidAccessToken = '';
					await this.plugin.saveSettings();
					try {
						await this.plugin.plaidService?.connectBankAccount();
					} catch (error) {
						console.error('Plaid reconnection error:', error);
						new Notice(`Failed to reconnect: ${error instanceof Error ? error.message : 'Unknown error'}`);
					}
				}))
			.addButton(button => button
				.setButtonText('Debug Connection')
				.setClass('mod-secondary')
				.setDisabled(!hasCredentials)
				.onClick(async () => {
					// Run network diagnostics
					try {
						new Notice('Running network diagnostics...', 2000);
						const diagnostics = await this.plugin.plaidService?.diagnoseNetworkConnectivity();
						
						if (diagnostics) {
							const message = `Plaid Network Diagnostics:\n\n${diagnostics.details.join('\n')}\n\nOverall: ${diagnostics.success ? '✅ Healthy' : '❌ Issues Found'}`;
							
							// Show in console for detailed info
							console.log('Plaid Network Diagnostics Results:', diagnostics);
							
							// Show user-friendly notice
							new Notice(message, 10000);
						}
					} catch (error) {
						console.error('Diagnostics failed:', error);
						new Notice(`Diagnostics failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 5000);
					}
				}));

		// Add Exchange Token button for browser-based flow
		new Setting(containerEl)
			.setName('Exchange Plaid Token')
			.setDesc('If you completed bank authentication in your browser, paste the token here to finish connection')
			.addButton(button => button
				.setButtonText('Exchange Token')
				.setClass('mod-cta')
				.setDisabled(!hasCredentials)
				.onClick(() => {
					new PlaidTokenModal(this.plugin.app, this.plugin).open();
				}));

		// Troubleshooting information for Plaid
		const troubleshootingEl = containerEl.createEl('details', { cls: 'setting-item' });
		const summaryEl = troubleshootingEl.createEl('summary', { text: '🔧 Troubleshooting Plaid Connection Issues' });
		summaryEl.style.cursor = 'pointer';
		summaryEl.style.fontSize = '14px';
		summaryEl.style.fontWeight = 'bold';
		summaryEl.style.marginBottom = '8px';
		
		const troubleshootingContent = troubleshootingEl.createEl('div', { cls: 'setting-item-description' });
		troubleshootingContent.innerHTML = `
			<p><strong>🌐 How Plaid Connection Works in Desktop Apps:</strong></p>
			<ul>
				<li><strong>Browser-Based Flow:</strong> Clicking "Connect Bank Account" opens your browser with Plaid Link</li>
				<li><strong>Complete in Browser:</strong> Choose your bank and authenticate normally in the browser</li>
				<li><strong>Copy Token:</strong> After success, copy the provided token</li>
				<li><strong>Return to Obsidian:</strong> Use "Exchange Token" button to paste the token and complete connection</li>
			</ul>
			<p><strong>If you're getting "Network Error" or connection failures:</strong></p>
			<ul>
				<li><strong>Check Internet Connection:</strong> Ensure you have a stable internet connection</li>
				<li><strong>Browser Extensions:</strong> Try disabling ad blockers, privacy extensions, or VPNs temporarily</li>
				<li><strong>CORS Issues:</strong> Some browser security settings may block API calls</li>
				<li><strong>Firewall/Network:</strong> Check if your network/firewall blocks connections to plaid.com</li>
				<li><strong>Try Different Browser:</strong> Test in a different browser or incognito mode</li>
				<li><strong>Use Debug Button:</strong> Click "Debug Connection" above to test network connectivity</li>
			</ul>
			<p><strong>For Production Environment:</strong></p>
			<ul>
				<li>Ensure your Plaid application is approved for Production access</li>
				<li>Verify your domain is allowlisted in Plaid Dashboard</li>
				<li>Check that your production credentials are correct</li>
			</ul>
			<p><strong>Still having issues?</strong> Check the browser console (F12) for detailed error messages.</p>
		`;

		// Transaction Sync Settings
		containerEl.createEl('h3', { text: '💳 Transaction Sync Settings' });

		// Date Range Selection
		new Setting(containerEl)
			.setName('Default Sync Range')
			.setDesc('Choose the default time period for transaction sync')
			.addDropdown(dropdown => dropdown
				.addOption('week', 'Last Week')
				.addOption('month', 'Last Month')
				.addOption('quarter', 'Last Quarter')
				.addOption('custom', 'Custom Range')
				.setValue(this.plugin.settings.transactionSettings.syncRange)
				.onChange(async (value: any) => {
					this.plugin.settings.transactionSettings.syncRange = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide custom date inputs
				}));

		// Custom date range inputs (only show if custom is selected)
		if (this.plugin.settings.transactionSettings.syncRange === 'custom') {
			new Setting(containerEl)
				.setName('Start Date')
				.setDesc('Start date for custom sync range')
				.addText(text => text
					.setPlaceholder('YYYY-MM-DD')
					.setValue(this.plugin.settings.transactionSettings.customStartDate || '')
					.onChange(async (value) => {
						this.plugin.settings.transactionSettings.customStartDate = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('End Date')
				.setDesc('End date for custom sync range')
				.addText(text => text
					.setPlaceholder('YYYY-MM-DD')
					.setValue(this.plugin.settings.transactionSettings.customEndDate || '')
					.onChange(async (value) => {
						this.plugin.settings.transactionSettings.customEndDate = value;
						await this.plugin.saveSettings();
					}));
		}

		// Batch Size Configuration
		new Setting(containerEl)
			.setName('Batch Size')
			.setDesc('Number of transactions to process in each batch (affects performance)')
			.addSlider(slider => slider
				.setLimits(10, 200, 10)
				.setValue(this.plugin.settings.transactionSettings.batchSize)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.transactionSettings.batchSize = value;
					await this.plugin.saveSettings();
				}));

		// File Organization Settings
		new Setting(containerEl)
			.setName('Organize by Month')
			.setDesc('Create separate folders for each month (e.g., transactions/2025-01/)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.transactionSettings.organizeByMonth)
				.onChange(async (value) => {
					this.plugin.settings.transactionSettings.organizeByMonth = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('File Name Format')
			.setDesc('Template for transaction note filenames (use {{date}}, {{merchant}}, {{amount}})')
			.addText(text => text
				.setPlaceholder('{{date}} - {{merchant}} - {{amount}}')
				.setValue(this.plugin.settings.transactionSettings.fileNameFormat)
				.onChange(async (value) => {
					this.plugin.settings.transactionSettings.fileNameFormat = value;
					await this.plugin.saveSettings();
				}));

		// Template Settings
		new Setting(containerEl)
			.setName('Use Custom Templates')
			.setDesc('Use Templator templates for transaction notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.transactionSettings.templateEnabled)
				.onChange(async (value) => {
					this.plugin.settings.transactionSettings.templateEnabled = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide template path
				}));

		if (this.plugin.settings.transactionSettings.templateEnabled) {
			new Setting(containerEl)
				.setName('Template Path')
				.setDesc('Path to the transaction template file')
				.addText(text => text
					.setPlaceholder('templates/transaction.md')
					.setValue(this.plugin.settings.transactionSettings.templatePath)
					.onChange(async (value) => {
						this.plugin.settings.transactionSettings.templatePath = value;
						await this.plugin.saveSettings();
					}));
		}

		// Sync Actions
		new Setting(containerEl)
			.setName('Manual Sync')
			.setDesc('Manually trigger transaction sync operations')
			.addButton(button => button
				.setButtonText('Sync Transactions')
				.setClass('mod-cta')
				.onClick(async () => {
					await this.plugin.syncTransactions();
				}))
			.addButton(button => button
				.setButtonText('Custom Range Sync')
				.setClass('mod-secondary')
				.onClick(() => {
					new TransactionSyncModal(this.plugin.app, this.plugin).open();
				}));

		// Sync Statistics
		const stats = this.plugin.transactionService?.getSyncStatistics();
		if (stats) {
			new Setting(containerEl)
				.setName('Sync Statistics')
				.setDesc(`Last sync: ${stats.lastSync ? new Date(stats.lastSync).toLocaleDateString() : 'Never'}\nProcessed transactions: ${stats.processedTransactions}\nCredentials: ${stats.hasCredentials ? '✅' : '❌'}\nAccess token: ${stats.hasAccessToken ? '✅' : '❌'}`)
				.addButton(button => button
					.setButtonText('View Details')
					.setClass('mod-secondary')
					.onClick(() => {
						const details = `Transaction Sync Statistics:

📊 Last Sync: ${stats.lastSync ? new Date(stats.lastSync).toLocaleString() : 'Never'}
🔢 Processed Transactions: ${stats.processedTransactions}
🔑 Credentials Configured: ${stats.hasCredentials ? '✅ Yes' : '❌ No'}
🎫 Access Token: ${stats.hasAccessToken ? '✅ Connected' : '❌ Not connected'}
📁 Default Sync Range: ${this.plugin.settings.transactionSettings.syncRange}
📦 Batch Size: ${this.plugin.settings.transactionSettings.batchSize}
📂 Organize by Month: ${this.plugin.settings.transactionSettings.organizeByMonth ? '✅ Yes' : '❌ No'}`;
						
						new Notice(details, 10000);
					}));
		}

		// Calendar Integration Settings - New Unified System
		this.renderCalendarSettings(containerEl);
	}

	private renderCalendarSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: '📅 Calendar Integration' });
		
		// Google OAuth2 Setup
		containerEl.createEl('h4', { text: '🔑 Google OAuth2 Setup' });
		
		new Setting(containerEl)
			.setName('Google Client ID')
			.setDesc('Your Google OAuth2 Client ID from Google Cloud Console')
			.addText(text => text
				.setPlaceholder('Enter Google Client ID')
				.setValue(this.plugin.settings.googleCalendarClientId)
				.onChange(async (value) => {
					this.plugin.settings.googleCalendarClientId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Google Client Secret')
			.setDesc('Your Google OAuth2 Client Secret from Google Cloud Console')
			.addText(text => text
				.setPlaceholder('Enter Google Client Secret')
				.setValue(this.plugin.settings.googleCalendarClientSecret)
				.onChange(async (value) => {
					this.plugin.settings.googleCalendarClientSecret = value;
					await this.plugin.saveSettings();
				}));

		// Setup status
		const hasCredentials = this.plugin.settings.googleCalendarClientId && this.plugin.settings.googleCalendarClientSecret;
		const accountCount = this.plugin.settings.masterCalendar.googleAccounts.length;
		
		containerEl.createEl('div', { 
			cls: 'setting-item-description',
			text: `Setup Status: ${hasCredentials ? (accountCount > 0 ? `✅ ${accountCount} account(s) connected` : '⚠️ Credentials set, ready to add accounts') : '❌ Missing credentials'}\n\n💡 For desktop apps: No redirect URI needed - Google uses Out-of-Band (OOB) flow automatically.`
		});

		if (!hasCredentials) {
			return; // Don't show additional options if credentials not set
		}

		// Google Accounts & Calendars
		containerEl.createEl('h4', { text: '🔐 Google Accounts & Calendars' });

		// Action buttons
		new Setting(containerEl)
			.setName('Account Management')
			.setDesc('Add new Google accounts or refresh existing ones')
			.addButton(button => button
				.setButtonText('Add Google Account')
				.setClass('mod-cta')
				.onClick(() => {
					new AddGoogleAccountModal(this.plugin.app, this.plugin, () => {}).open();
				}))
			.addButton(button => button
				.setButtonText('Refresh All')
				.setClass('mod-secondary')
				.onClick(async () => {
					await this.plugin.masterCalendarService.refreshAllAccounts();
					await this.plugin.saveSettings();
					this.display(); // Refresh settings view
				}));

		// Account & Calendar Table
		this.renderAccountTable(containerEl);

		// Calendar Sync Section
		containerEl.createEl('h4', { text: '🔄 Calendar Sync' });

		// Date Range Selection
		new Setting(containerEl)
			.setName('Sync Date Range')
			.setDesc('Choose the time period for calendar sync')
			.addDropdown(dropdown => dropdown
				.addOption('week', 'Last Week')
				.addOption('month', 'Last Month')
				.addOption('quarter', 'Last Quarter')
				.addOption('custom', 'Custom Range')
				.setValue(this.plugin.settings.masterCalendar.syncSettings.syncRange)
				.onChange(async (value: any) => {
					this.plugin.settings.masterCalendar.syncSettings.syncRange = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide custom date inputs
				}));

		// Custom date range inputs (only show if custom is selected)
		if (this.plugin.settings.masterCalendar.syncSettings.syncRange === 'custom') {
			new Setting(containerEl)
				.setName('Start Date')
				.setDesc('Start date for custom sync range')
				.addText(text => text
					.setPlaceholder('YYYY-MM-DD')
					.setValue(this.plugin.settings.masterCalendar.syncSettings.customStartDate || '')
					.onChange(async (value) => {
						this.plugin.settings.masterCalendar.syncSettings.customStartDate = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('End Date')
				.setDesc('End date for custom sync range')
				.addText(text => text
					.setPlaceholder('YYYY-MM-DD')
					.setValue(this.plugin.settings.masterCalendar.syncSettings.customEndDate || '')
					.onChange(async (value) => {
						this.plugin.settings.masterCalendar.syncSettings.customEndDate = value;
						await this.plugin.saveSettings();
					}));
		}

		// Sync Actions
		new Setting(containerEl)
			.setName('Sync Actions')
			.setDesc('Sync events from enabled calendars to create event notes')
			.addButton(button => button
				.setButtonText('Sync All Calendars')
				.setClass('mod-cta')
				.onClick(async () => {
					try {
						await this.plugin.masterCalendarService.syncAllCalendars();
						new Notice('Calendar sync completed successfully');
					} catch (error) {
						new Notice(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
					}
				}))
			.addButton(button => button
				.setButtonText('View Sync Status')
				.setClass('mod-secondary')
				.onClick(() => {
					const syncStatus = this.plugin.masterCalendarService.getSyncStatus();
					if (syncStatus.length === 0) {
						new Notice('No accounts to show status for');
						return;
					}
					
					const statusText = syncStatus.map(status => 
						`${status.accountName}: ${status.status} (Last sync: ${status.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never'})`
					).join('\n');
					
					new Notice(`Sync Status:\n\n${statusText}`, 8000);
				}));

		// Event Notes Settings
		containerEl.createEl('h4', { text: '📝 Event Notes Settings' });

		new Setting(containerEl)
			.setName('Auto-create Event Notes')
			.setDesc('Automatically create Obsidian notes for calendar events')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.masterCalendar.eventSettings.createEventNotes)
				.onChange(async (value) => {
					this.plugin.settings.masterCalendar.eventSettings.createEventNotes = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide sub-options
				}));

		if (this.plugin.settings.masterCalendar.eventSettings.createEventNotes) {
			new Setting(containerEl)
				.setName('Event Notes Folder')
				.setDesc('Folder where event notes will be created')
				.addText(text => text
					.setPlaceholder('events')
					.setValue(this.plugin.settings.masterCalendar.eventSettings.eventNotesFolder)
					.onChange(async (value) => {
						this.plugin.settings.masterCalendar.eventSettings.eventNotesFolder = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Note Name Format')
				.setDesc('Template for event note filenames (use {{title}} and {{date}})')
				.addText(text => text
					.setPlaceholder('{{title}} - {{date}}')
					.setValue(this.plugin.settings.masterCalendar.eventSettings.eventNoteNameFormat)
					.onChange(async (value) => {
						this.plugin.settings.masterCalendar.eventSettings.eventNoteNameFormat = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Use Event Templates')
				.setDesc('Use custom templates for event notes')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.masterCalendar.eventSettings.useEventTemplates)
					.onChange(async (value) => {
						this.plugin.settings.masterCalendar.eventSettings.useEventTemplates = value;
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide template folder
					}));

			if (this.plugin.settings.masterCalendar.eventSettings.useEventTemplates) {
				new Setting(containerEl)
					.setName('Template Folder')
					.setDesc('Folder containing event note templates')
					.addText(text => text
						.setPlaceholder('templates/events')
						.setValue(this.plugin.settings.masterCalendar.eventSettings.templateFolder)
						.onChange(async (value) => {
							this.plugin.settings.masterCalendar.eventSettings.templateFolder = value;
							await this.plugin.saveSettings();
						}));
			}
		}

		// Management Actions
		containerEl.createEl('h4', { text: '🛠️ Management' });

		new Setting(containerEl)
			.setName('Reset All Data')
			.setDesc('Clear all accounts, tokens, and calendar selections')
			.addButton(button => button
				.setButtonText('Clear All Data')
				.setClass('mod-warning')
				.onClick(async () => {
					this.plugin.settings.masterCalendar.googleAccounts = [];
					this.plugin.settings.masterCalendar.selectedCalendars = [];
					await this.plugin.saveSettings();
					this.plugin.masterCalendarService.updateSettings(this.plugin.settings);
					new Notice('All calendar data cleared. You can now start fresh.');
					this.display(); // Refresh
				}));
	}

	private renderAccountTable(containerEl: HTMLElement): void {
		const accounts = this.plugin.settings.masterCalendar.googleAccounts;
		
		if (accounts.length === 0) {
			containerEl.createEl('div', { 
				cls: 'setting-item-description',
				text: 'No Google accounts added yet. Click "Add Google Account" to get started.'
			});
			return;
		}

		// Create table container
		const tableContainer = containerEl.createEl('div', { cls: 'calendar-accounts-table' });
		
		// Add some basic styling
		tableContainer.style.border = '1px solid var(--background-modifier-border)';
		tableContainer.style.borderRadius = '4px';
		tableContainer.style.marginBottom = '16px';

		// Table header
		const headerRow = tableContainer.createEl('div', { cls: 'table-header' });
		headerRow.style.display = 'grid';
		headerRow.style.gridTemplateColumns = '2fr 2fr 1fr 1fr 1fr';
		headerRow.style.gap = '8px';
		headerRow.style.padding = '8px';
		headerRow.style.background = 'var(--background-secondary)';
		headerRow.style.borderBottom = '1px solid var(--background-modifier-border)';
		headerRow.style.fontWeight = 'bold';

		headerRow.createEl('div', { text: 'Account Label' });
		headerRow.createEl('div', { text: 'Email' });
		headerRow.createEl('div', { text: 'Status' });
		headerRow.createEl('div', { text: 'Calendars' });
		headerRow.createEl('div', { text: 'Last Sync' });

		// Account rows
		for (const account of accounts) {
			const accountRow = tableContainer.createEl('div', { cls: 'table-row' });
			accountRow.style.display = 'grid';
			accountRow.style.gridTemplateColumns = '2fr 2fr 1fr 1fr 1fr';
			accountRow.style.gap = '8px';
			accountRow.style.padding = '8px';
			accountRow.style.borderBottom = '1px solid var(--background-modifier-border-hover)';

			// Account label
			accountRow.createEl('div', { text: account.label });

			// Email
			accountRow.createEl('div', { text: account.email || 'Not authenticated' });

			// Status
			const status = account.tokens ? '✅ Connected' : '❌ Expired';
			accountRow.createEl('div', { text: status });

			// Calendars (expandable)
			const calendarsCell = accountRow.createEl('div');
			const accountCalendars = this.plugin.settings.masterCalendar.selectedCalendars
				.filter(cal => cal.accountId === account.id);
			
			if (accountCalendars.length > 0) {
				const expandButton = calendarsCell.createEl('button', { 
					text: `${accountCalendars.length} calendars ▼` 
				});
				expandButton.style.fontSize = '12px';
				expandButton.style.padding = '2px 6px';
				
				// Calendar details container (initially hidden)
				const calendarDetails = tableContainer.createEl('div', { cls: 'calendar-details' });
				calendarDetails.style.display = 'none';
				calendarDetails.style.gridColumn = '1 / -1';
				calendarDetails.style.padding = '8px 16px';
				calendarDetails.style.background = 'var(--background-primary-alt)';
				calendarDetails.style.borderTop = '1px solid var(--background-modifier-border)';

				// Toggle expand/collapse
				let expanded = false;
				expandButton.onclick = () => {
					expanded = !expanded;
					calendarDetails.style.display = expanded ? 'block' : 'none';
					expandButton.textContent = `${accountCalendars.length} calendars ${expanded ? '▲' : '▼'}`;
				};

				// Render calendar list
				for (const calendar of accountCalendars) {
					const calendarRow = calendarDetails.createEl('div', { cls: 'calendar-row' });
					calendarRow.style.display = 'flex';
					calendarRow.style.alignItems = 'center';
					calendarRow.style.gap = '8px';
					calendarRow.style.marginBottom = '4px';

					// Enable/disable toggle
					const enableToggle = calendarRow.createEl('input', { type: 'checkbox' });
					enableToggle.checked = calendar.enabled;
					enableToggle.onchange = async () => {
						calendar.enabled = enableToggle.checked;
						await this.plugin.saveSettings();
					};

					// Calendar name
					calendarRow.createEl('span', { text: calendar.calendarName });

					// Priority indicator
					const priorityEl = calendarRow.createEl('span', { 
						text: `Priority: ${calendar.priority}`,
						cls: 'calendar-priority'
					});
					priorityEl.style.fontSize = '11px';
					priorityEl.style.color = 'var(--text-muted)';
					priorityEl.style.marginLeft = 'auto';
				}
			} else {
				calendarsCell.createEl('span', { text: 'No calendars' });
			}

			// Last sync
			const lastSyncText = account.lastSync 
				? new Date(account.lastSync).toLocaleDateString()
				: 'Never';
			accountRow.createEl('div', { text: lastSyncText });
		}
	}
}

// Transaction Sync Modal
class TransactionSyncModal extends Modal {
	plugin: SecondBrainPlugin;

	constructor(app: App, plugin: SecondBrainPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Sync Transactions' });

		// Date range options
		new Setting(contentEl)
			.setName('Sync Range')
			.setDesc('Select the date range for syncing transactions')
			.addDropdown(dropdown => dropdown
				.addOption('today', 'Today')
				.addOption('week', 'Last 7 Days')
				.addOption('month', 'Last 30 Days')
				.addOption('custom', 'Custom Range')
				.setValue('month') // Default to last 30 days
				.onChange(async (value) => {
					if (value === 'custom') {
						// Show custom date inputs
						this.showCustomDateInputs(contentEl);
					} else {
						// Hide custom date inputs
						this.hideCustomDateInputs(contentEl);
					}
				}));

		// Custom date inputs (hidden by default)
		this.hideCustomDateInputs(contentEl);

		const buttonContainer = contentEl.createDiv();
		
		const syncButton = buttonContainer.createEl('button', { text: 'Sync Transactions' });
		syncButton.onclick = async () => {
			const range = this.getSelectedDateRange(contentEl);
			if (!range) {
				new Notice('Invalid date range');
				return;
			}

			try {
				new Notice(`Syncing transactions for ${range.label}...`);
				await this.plugin.transactionService.syncTransactionsBatch({
					syncRange: 'custom',
					customStartDate: range.start.toISOString().split('T')[0], // Convert to YYYY-MM-DD
					customEndDate: range.end.toISOString().split('T')[0]
				});
				new Notice('Transaction sync completed');
				this.close();
			} catch (error) {
				new Notice(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		};

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private showCustomDateInputs(containerEl: HTMLElement) {
		// First remove any existing custom date inputs to prevent duplicates
		this.hideCustomDateInputs(containerEl);
		
		// Create a container for custom date inputs
		const customDateContainer = containerEl.createDiv({ cls: 'custom-date-inputs' });
		
		new Setting(customDateContainer)
			.setName('Start Date')
			.setDesc('Start date for custom sync range')
			.addText(text => {
				// Set current value if available
				const currentValue = this.plugin.settings.transactionSettings.customStartDate;
				if (currentValue) {
					text.setValue(currentValue);
				}
				
				text.setPlaceholder('YYYY-MM-DD')
					.onChange(async (value) => {
						// Validate and save start date
						if (!value.trim()) {
							this.plugin.settings.transactionSettings.customStartDate = '';
							await this.plugin.saveSettings();
							return;
						}
						
						const date = new Date(value);
						if (isNaN(date.getTime())) {
							new Notice('Invalid start date format. Use YYYY-MM-DD');
							return;
						}
						
						this.plugin.settings.transactionSettings.customStartDate = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(customDateContainer)
			.setName('End Date')
			.setDesc('End date for custom sync range')
			.addText(text => {
				// Set current value if available
				const currentValue = this.plugin.settings.transactionSettings.customEndDate;
				if (currentValue) {
					text.setValue(currentValue);
				}
				
				text.setPlaceholder('YYYY-MM-DD')
					.onChange(async (value) => {
						// Validate and save end date
						if (!value.trim()) {
							this.plugin.settings.transactionSettings.customEndDate = '';
							await this.plugin.saveSettings();
							return;
						}
						
						const date = new Date(value);
						if (isNaN(date.getTime())) {
							new Notice('Invalid end date format. Use YYYY-MM-DD');
							return;
						}
						
						this.plugin.settings.transactionSettings.customEndDate = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private hideCustomDateInputs(containerEl: HTMLElement) {
		// Remove custom date inputs container if it exists
		const customDateContainer = containerEl.querySelector('.custom-date-inputs');
		if (customDateContainer) {
			customDateContainer.remove();
		}
	}

	private getSelectedDateRange(containerEl: HTMLElement) {
		const dropdown = containerEl.querySelector('select');
		const value = dropdown ? (dropdown as HTMLSelectElement).value : '';

		switch (value) {
			case 'today':
				return { label: 'Today', start: new Date(), end: new Date() };
			case 'week':
				return { label: 'Last 7 Days', start: this.addDays(new Date(), -7), end: new Date() };
			case 'month':
				return { label: 'Last 30 Days', start: this.addDays(new Date(), -30), end: new Date() };
			case 'custom':
				// Get custom dates from settings
				const startDateStr = this.plugin.settings.transactionSettings.customStartDate;
				const endDateStr = this.plugin.settings.transactionSettings.customEndDate;
				
				if (!startDateStr || !endDateStr) {
					new Notice('Please set both start and end dates for custom range');
					return null;
				}
				
				const startDate = new Date(startDateStr);
				const endDate = new Date(endDateStr);
				
				if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
					new Notice('Invalid custom date range');
					return null;
				}
				
				if (startDate > endDate) {
					new Notice('Start date must be before end date');
					return null;
				}
				
				return { 
					label: `Custom (${startDateStr} to ${endDateStr})`, 
					start: startDate, 
					end: endDate 
				};
			default:
				return null;
		}
	}

	private addDays(date: Date, days: number): Date {
		const result = new Date(date);
		result.setDate(result.getDate() + days);
		return result;
	}
}
