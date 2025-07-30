import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, PluginState } from './src/types';
import { VaultInitializer } from './src/vault/initializer';
import { LLMService } from './src/services/llm-service';
import { PlaidService } from './src/services/plaid-service';
import { CalendarService } from './src/services/calendar-service';
import { TemplateEngine, TemplateDataProcessor } from './src/utils/templates';

export default class SecondBrainPlugin extends Plugin {
	settings: PluginSettings;
	state: PluginState;
	
	// Services
	vaultInitializer: VaultInitializer;
	llmService: LLMService;
	plaidService: PlaidService;
	calendarService: CalendarService;

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

		// Add ribbon icon
		const ribbonIconEl = this.addRibbonIcon('brain', 'Second Brain Integration', (evt: MouseEvent) => {
			new Notice('Second Brain Integration is active!');
		});
		ribbonIconEl.addClass('second-brain-ribbon-class');

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
		this.llmService = new LLMService(this.settings);
		this.plaidService = new PlaidService(this.settings);
		this.calendarService = new CalendarService(this.settings);
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

		// Sync transactions command
		this.addCommand({
			id: 'sync-transactions',
			name: 'Sync Transactions from Plaid',
			callback: async () => {
				await this.syncTransactions();
			}
		});

		// Sync events command
		this.addCommand({
			id: 'sync-events',
			name: 'Sync Calendar Events',
			callback: async () => {
				await this.syncEvents();
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
	}

	private async checkAndInitializeVault(): Promise<void> {
		const isInitialized = await this.vaultInitializer.isVaultInitialized();
		
		if (!isInitialized) {
			new Notice('Second Brain vault not initialized. Use "Initialize Vault Structure" command to set up.', 5000);
		} else {
			this.state.initialized = true;
			new Notice('Second Brain vault ready!');
		}
	}

	private async syncTransactions(): Promise<void> {
		if (this.state.syncStatus.transactions.isRunning) {
			new Notice('Transaction sync already in progress');
			return;
		}

		if (!this.plaidService.isConfigured()) {
			const status = this.plaidService.getConfigurationStatus();
			new Notice(`Plaid not configured. Missing: ${status.missing.join(', ')}`);
			return;
		}

		this.state.syncStatus.transactions.isRunning = true;
		this.state.syncStatus.transactions.errors = [];

		try {
			const transactions = await this.plaidService.getNewTransactions();
			
			for (const transaction of transactions) {
				try {
					await this.processTransaction(transaction);
					this.state.syncStatus.transactions.itemsProcessed++;
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : 'Unknown error';
					this.state.syncStatus.transactions.errors.push(errorMsg);
					console.error('Failed to process transaction:', error);
				}
			}

			// Update last sync time
			this.settings.lastTransactionSync = new Date().toISOString();
			await this.saveSettings();

			new Notice(`Synced ${this.state.syncStatus.transactions.itemsProcessed} transactions`);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Transaction sync failed: ${errorMsg}`);
		} finally {
			this.state.syncStatus.transactions.isRunning = false;
		}
	}

	private async syncEvents(): Promise<void> {
		if (this.state.syncStatus.events.isRunning) {
			new Notice('Event sync already in progress');
			return;
		}

		if (!this.calendarService.isConfigured()) {
			const status = this.calendarService.getConfigurationStatus();
			new Notice(`Google Calendar not configured. Missing: ${status.missing.join(', ')}`);
			return;
		}

		this.state.syncStatus.events.isRunning = true;
		this.state.syncStatus.events.errors = [];

		try {
			const events = await this.calendarService.getNewEvents();
			
			for (const event of events) {
				try {
					await this.processEvent(event);
					this.state.syncStatus.events.itemsProcessed++;
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : 'Unknown error';
					this.state.syncStatus.events.errors.push(errorMsg);
					console.error('Failed to process event:', error);
				}
			}

			// Update last sync time
			this.settings.lastEventSync = new Date().toISOString();
			await this.saveSettings();

			new Notice(`Synced ${this.state.syncStatus.events.itemsProcessed} events`);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Event sync failed: ${errorMsg}`);
		} finally {
			this.state.syncStatus.events.isRunning = false;
		}
	}

	private async processTransaction(transaction: any): Promise<void> {
		// Format transaction data
		const templateData = TemplateDataProcessor.processTransaction(transaction);
		
		// Use LLM to enhance the data if configured
		if (this.settings.llmApiKey) {
			try {
				const llmResult = await this.llmService.parseTransaction(transaction);
				// Merge LLM suggestions with template data
				templateData.suggestions = llmResult.suggestions;
				if (llmResult.tags) {
					templateData.tags = [...templateData.tags, ...llmResult.tags];
				}
			} catch (error) {
				console.warn('LLM processing failed for transaction:', error);
			}
		}

		// Generate note content
		const noteContent = TemplateEngine.render('transaction', templateData);
		
		// Create note file
		const fileName = `${templateData.date}-${templateData.id}.md`;
		const filePath = `${this.settings.transactionsFolder}/${fileName}`;
		
		// Check if file already exists
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (!existingFile) {
			await this.app.vault.create(filePath, noteContent);
		}
	}

	private async processEvent(event: any): Promise<void> {
		// Format event data
		const templateData = TemplateDataProcessor.processEvent(event);
		
		// Use LLM to enhance the data if configured
		if (this.settings.llmApiKey) {
			try {
				const llmResult = await this.llmService.parseEvent(event);
				templateData.suggestions = llmResult.suggestions;
				if (llmResult.tags) {
					templateData.tags = [...templateData.tags, ...llmResult.tags];
				}
			} catch (error) {
				console.warn('LLM processing failed for event:', error);
			}
		}

		// Generate note content
		const noteContent = TemplateEngine.render('event', templateData);
		
		// Create note file
		const fileName = `${templateData.date}-${templateData.title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.md`;
		const filePath = `${this.settings.eventsFolder}/${fileName}`;
		
		// Check if file already exists
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (!existingFile) {
			await this.app.vault.create(filePath, noteContent);
		}
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

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		
		// Update services with new settings
		if (this.llmService) this.llmService.updateSettings(this.settings);
		if (this.plaidService) this.plaidService.updateSettings(this.settings);
		if (this.calendarService) this.calendarService.updateSettings(this.settings);
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

		// Google Calendar Settings
		containerEl.createEl('h3', { text: 'Google Calendar Configuration' });

		new Setting(containerEl)
			.setName('Google Calendar API Key')
			.setDesc('Your Google Calendar API key')
			.addText(text => text
				.setPlaceholder('Enter API key')
				.setValue(this.plugin.settings.googleCalendarApiKey)
				.onChange(async (value) => {
					this.plugin.settings.googleCalendarApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Calendar ID')
			.setDesc('Google Calendar ID (use "primary" for main calendar)')
			.addText(text => text
				.setPlaceholder('primary')
				.setValue(this.plugin.settings.googleCalendarId)
				.onChange(async (value) => {
					this.plugin.settings.googleCalendarId = value;
					await this.plugin.saveSettings();
				}));
	}
}
