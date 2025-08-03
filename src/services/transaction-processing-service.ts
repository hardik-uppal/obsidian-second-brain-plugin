import { App, Notice, TFile } from 'obsidian';
import { 
	PluginSettings, 
	Transaction, 
	TransactionSyncSettings, 
	TransactionSyncResult as TypedTransactionSyncResult,
	TransactionBatchInfo 
} from '../types';
import { PlaidService } from './plaid-service';
import { EventTemplateService } from './event-template-service';
import { SuggestionManagementService } from './suggestion-management-service';
import { TemplateEngine, TemplateDataProcessor } from '../utils/templates';

export interface TransactionSyncResult {
	success: boolean;
	totalFetched: number;
	newTransactions: number;
	duplicatesSkipped: number;
	notesCreated: number;
	errors: string[];
	suggestionsGenerated?: number;
}

export interface TransactionSyncOptions {
	startDate?: string;
	endDate?: string;
	forceResync?: boolean; // Skip duplicate checking
	createNotes?: boolean;
	generateSuggestions?: boolean;
}

/**
 * Manages the complete transaction sync workflow from Plaid to Obsidian notes
 */
export class TransactionProcessingService {
	private app: App;
	private settings: PluginSettings;
	private plaidService: PlaidService;
	private templateService: EventTemplateService;
	private suggestionService?: SuggestionManagementService;
	private processedTransactionIds: Set<string> = new Set();

	constructor(
		app: App,
		settings: PluginSettings,
		plaidService: PlaidService,
		templateService: EventTemplateService,
		suggestionService?: SuggestionManagementService
	) {
		this.app = app;
		this.settings = settings;
		this.plaidService = plaidService;
		this.templateService = templateService;
		this.suggestionService = suggestionService;
	}

	/**
	 * Initialize the service and load existing transaction IDs
	 */
	async initialize(): Promise<void> {
		console.log('Initializing Transaction Processing Service...');
		await this.loadProcessedTransactionIds();
		console.log(`Loaded ${this.processedTransactionIds.size} existing transaction IDs`);
	}

	/**
	 * Main sync method - orchestrates the complete workflow
	 */
	async syncTransactions(options: TransactionSyncOptions = {}): Promise<TransactionSyncResult> {
		const result: TransactionSyncResult = {
			success: false,
			totalFetched: 0,
			newTransactions: 0,
			duplicatesSkipped: 0,
			notesCreated: 0,
			errors: [],
			suggestionsGenerated: 0
		};

		try {
			console.log('=== Starting Transaction Sync ===');
			new Notice('Starting transaction sync from Plaid...');

			// Step 1: Fetch transactions from Plaid
			const transactions = await this.fetchTransactionsFromPlaid(options);
			result.totalFetched = transactions.length;

			if (transactions.length === 0) {
				new Notice('No transactions found for the specified date range');
				result.success = true;
				return result;
			}

			console.log(`Fetched ${transactions.length} transactions from Plaid`);

			// Step 2: Filter out duplicates (unless force resync)
			const { newTransactions, duplicates } = options.forceResync 
				? { newTransactions: transactions, duplicates: [] }
				: this.filterDuplicateTransactions(transactions);

			result.newTransactions = newTransactions.length;
			result.duplicatesSkipped = duplicates.length;

			console.log(`${newTransactions.length} new transactions, ${duplicates.length} duplicates skipped`);

			if (newTransactions.length === 0) {
				new Notice('No new transactions to process');
				result.success = true;
				return result;
			}

			// Step 3: Create notes for transactions (if enabled)
			if (options.createNotes !== false && this.settings.masterCalendar.eventSettings.createEventNotes) {
				const notesCreated = await this.createTransactionNotes(newTransactions);
				result.notesCreated = notesCreated;
				console.log(`Created ${notesCreated} transaction notes`);
			}

			// Step 4: Generate LLM suggestions (if enabled)
			if (options.generateSuggestions !== false && this.settings.suggestionSystem?.enabled && this.suggestionService) {
				try {
					const suggestionBatch = await this.suggestionService.processTransactions(
						newTransactions, 
						'transaction-sync'
					);
					result.suggestionsGenerated = suggestionBatch.suggestions.length;
					console.log(`Generated ${result.suggestionsGenerated} suggestions`);
				} catch (error) {
					console.error('Failed to generate suggestions:', error);
					result.errors.push(`Suggestion generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			}

			// Step 5: Update processed transaction tracking
			await this.updateProcessedTransactionIds(newTransactions);

			// Step 6: Update last sync timestamp
			await this.updateLastSyncTimestamp();

			result.success = true;
			new Notice(`Transaction sync completed: ${result.newTransactions} new transactions processed`);

			console.log('=== Transaction Sync Completed ===');
			console.log('Result:', result);

			return result;

		} catch (error) {
			console.error('Transaction sync failed:', error);
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			result.errors.push(errorMessage);
			new Notice(`Transaction sync failed: ${errorMessage}`);
			return result;
		}
	}

	/**
	 * Fetch transactions from Plaid with date range using batch processing for large volumes
	 */
	private async fetchTransactionsFromPlaid(options: TransactionSyncOptions): Promise<Transaction[]> {
		const startDate = options.startDate || this.getDefaultStartDate();
		const endDate = options.endDate || new Date().toISOString().split('T')[0];

		console.log(`Fetching transactions from ${startDate} to ${endDate}`);

		// For large date ranges, use batch processing
		const daysDiff = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
		
		if (daysDiff > 30) {
			// Use batch processing for date ranges larger than 30 days
			console.log(`Large date range detected (${daysDiff} days), using batch processing...`);
			return await this.fetchTransactionsBatch(startDate, endDate);
		} else {
			// Use direct fetch for smaller ranges
			const rawTransactions = await this.plaidService.getTransactions(startDate, endDate);
			return rawTransactions.map(raw => this.convertToTransaction(raw));
		}
	}

	/**
	 * Fetch transactions using batch processing workflow
	 */
	private async fetchTransactionsBatch(startDate: string, endDate: string): Promise<Transaction[]> {
		try {
			// Create transaction batch in backend
			const batchId = await this.plaidService.createTransactionBatch(startDate, endDate);
			console.log(`Created transaction batch: ${batchId}`);

			// Monitor batch status
			let batchStatus = await this.plaidService.getBatchStatus(batchId);
			console.log(`Batch status: ${batchStatus.status}, ${batchStatus.total_transactions} transactions`);

			// Fetch all transactions from the batch
			const allTransactions: Transaction[] = [];
			let offset = 0;
			const limit = 100;

			while (true) {
				const batchData = await this.plaidService.getBatchTransactions(batchId, limit, offset, false);
				
				if (batchData.transactions.length === 0) {
					break;
				}

				// Convert batch transactions to our format
				for (const item of batchData.transactions) {
					const rawTransaction = item.data;
					const transaction = this.convertToTransaction(rawTransaction);
					allTransactions.push(transaction);
				}

				offset += limit;
				
				// Safety break
				if (offset > batchStatus.total_transactions) {
					break;
				}
			}

			console.log(`Fetched ${allTransactions.length} transactions from batch ${batchId}`);
			return allTransactions;

		} catch (error) {
			console.error('Batch processing failed, falling back to direct fetch:', error);
			// Fallback to direct fetch
			const rawTransactions = await this.plaidService.getTransactions(startDate, endDate);
			return rawTransactions.map(raw => this.convertToTransaction(raw));
		}
	}

	/**
	 * Filter out duplicate transactions based on transaction ID
	 */
	private filterDuplicateTransactions(transactions: Transaction[]): { newTransactions: Transaction[]; duplicates: Transaction[] } {
		const newTransactions: Transaction[] = [];
		const duplicates: Transaction[] = [];

		for (const transaction of transactions) {
			if (this.processedTransactionIds.has(transaction.id)) {
				duplicates.push(transaction);
			} else {
				newTransactions.push(transaction);
			}
		}

		return { newTransactions, duplicates };
	}

	/**
	 * Create Obsidian notes for transactions
	 */
	private async createTransactionNotes(transactions: Transaction[]): Promise<number> {
		let createdCount = 0;
		const transactionsFolder = this.settings.transactionsFolder;

		// Ensure transactions folder exists
		const existingFolder = this.app.vault.getAbstractFileByPath(transactionsFolder);
		if (!existingFolder) {
			console.log(`Creating transactions folder: ${transactionsFolder}`);
			await this.app.vault.createFolder(transactionsFolder);
		}

		for (const transaction of transactions) {
			try {
				console.log(`Creating note for transaction: ${transaction.merchant} - $${transaction.amount}`);
				
				// Generate note content using template (with Templator support)
				const templateData = TemplateDataProcessor.processTransaction(transaction);
				
				let content: string;
				const transactionSettings = this.settings.transactionSettings;
				
				if (transactionSettings?.templateEnabled && transactionSettings?.templatePath) {
					// Use Templator if enabled and template path is set
					content = await this.generateContentWithTemplator(transaction, transactionSettings.templatePath, templateData);
				} else {
					// Use built-in template engine
					content = TemplateEngine.render('transaction', templateData);
				}
				
				// Generate filename
				const fileName = this.generateTransactionFileName(transaction);
				const filePath = `${transactionsFolder}/${fileName}`;

				// Check if file already exists
				const existingFile = this.app.vault.getAbstractFileByPath(filePath);
				if (existingFile) {
					console.log(`Transaction note already exists: ${filePath}`);
					continue;
				}

				// Create the note
				await this.app.vault.create(filePath, content);
				createdCount++;
				console.log(`Created transaction note: ${filePath}`);

			} catch (error) {
				console.error(`Failed to create note for transaction ${transaction.id}:`, error);
			}
		}

		return createdCount;
	}

	/**
	 * Generate a filename for a transaction note
	 */
	private generateTransactionFileName(transaction: Transaction): string {
		const date = transaction.date;
		const merchant = transaction.merchant.replace(/[^a-zA-Z0-9\s]/g, '').trim();
		const amount = Math.abs(transaction.amount).toFixed(2);
		
		return `${date} - ${merchant} - $${amount}.md`;
	}

	/**
	 * Load existing transaction IDs from notes to avoid duplicates
	 */
	private async loadProcessedTransactionIds(): Promise<void> {
		this.processedTransactionIds.clear();
		
		const transactionsFolder = this.app.vault.getAbstractFileByPath(this.settings.transactionsFolder);
		if (!transactionsFolder) {
			console.log('Transactions folder does not exist yet');
			return;
		}

		// Get all files in transactions folder
		const files = this.app.vault.getMarkdownFiles().filter(file => 
			file.path.startsWith(this.settings.transactionsFolder + '/')
		);

		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				const transactionIdMatch = content.match(/transaction_id:\s*"([^"]+)"/);
				if (transactionIdMatch) {
					this.processedTransactionIds.add(transactionIdMatch[1]);
				}
			} catch (error) {
				console.error(`Failed to read transaction file ${file.path}:`, error);
			}
		}
	}

	/**
	 * Update tracked transaction IDs
	 */
	private async updateProcessedTransactionIds(transactions: Transaction[]): Promise<void> {
		for (const transaction of transactions) {
			this.processedTransactionIds.add(transaction.id);
		}
	}

	/**
	 * Update last sync timestamp in settings
	 */
	private async updateLastSyncTimestamp(): Promise<void> {
		// Update last transaction sync timestamp
		this.settings.lastTransactionSync = new Date().toISOString().split('T')[0];
		
		// Save settings if callback is available
		// This would need to be injected from the main plugin
		console.log('Updated last transaction sync timestamp');
	}

	/**
	 * Get default start date for sync (last sync date or 7 days ago)
	 */
	private getDefaultStartDate(): string {
		if (this.settings.lastTransactionSync) {
			return this.settings.lastTransactionSync;
		}
		
		// Default to 7 days ago
		const sevenDaysAgo = new Date();
		sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
		return sevenDaysAgo.toISOString().split('T')[0];
	}

	/**
	 * Manual sync with custom date range
	 */
	async syncTransactionsForDateRange(startDate: string, endDate: string): Promise<TransactionSyncResult> {
		return this.syncTransactions({
			startDate,
			endDate,
			createNotes: true,
			generateSuggestions: true
		});
	}

	/**
	 * Resync all transactions (ignore duplicates)
	 */
	async resyncAllTransactions(startDate?: string, endDate?: string): Promise<TransactionSyncResult> {
		return this.syncTransactions({
			startDate,
			endDate,
			forceResync: true,
			createNotes: true,
			generateSuggestions: true
		});
	}

	/**
	 * Update settings
	 */
	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
		this.plaidService.updateSettings(newSettings);
		this.templateService.updateSettings(newSettings);
	}

	// =====================================================
	// NEW BATCH PROCESSING METHODS
	// =====================================================

	/**
	 * NEW: Sync transactions using batch processing approach
	 * This method follows the planned architecture with backend staging
	 */
	async syncTransactionsBatch(syncSettings?: Partial<TransactionSyncSettings>): Promise<TypedTransactionSyncResult> {
		const mergedSettings = { ...this.settings.transactionSettings, ...syncSettings };
		const startTime = Date.now();
		
		const result: TypedTransactionSyncResult = {
			success: false,
			batchId: '',
			transactionsProcessed: 0,
			transactionsSkipped: 0,
			notesCreated: 0,
			duplicatesFound: 0,
			errors: [],
			duration: 0,
			folderPath: ''
		};

		try {
			new Notice('Starting transaction sync...');
			console.log('=== Transaction Batch Sync Started ===');
			console.log('Sync settings:', mergedSettings);

			// Step 1: Calculate date range
			const dateRange = this.calculateDateRange(mergedSettings);
			console.log('Date range:', dateRange);

			// Step 2: Create transaction batch in backend
			result.batchId = await this.createTransactionBatch(dateRange.startDate, dateRange.endDate);
			console.log('Created batch:', result.batchId);

			// Step 3: Process batch incrementally
			const processResult = await this.processBatchIncrementally(result.batchId, mergedSettings);
			
			// Update result
			result.transactionsProcessed = processResult.processed;
			result.transactionsSkipped = processResult.skipped;
			result.notesCreated = processResult.notesCreated;
			result.duplicatesFound = processResult.duplicates;
			result.errors = processResult.errors;
			result.folderPath = processResult.folderPath;
			result.success = processResult.success;

			// Step 4: Update last sync timestamp
			if (result.success) {
				this.settings.lastTransactionSync = new Date().toISOString();
				// Note: onSettingsChange callback would be handled by main plugin
			}

			result.duration = Date.now() - startTime;
			console.log('=== Transaction Batch Sync Completed ===');
			console.log('Result:', result);

			// Show completion notice
			if (result.success) {
				new Notice(`Transaction sync completed! Created ${result.notesCreated} notes (${result.duplicatesFound} duplicates skipped)`);
			} else {
				new Notice(`Transaction sync failed. Check console for details.`);
			}

			return result;

		} catch (error) {
			console.error('Transaction batch sync failed:', error);
			result.errors.push(error instanceof Error ? error.message : 'Unknown error');
			result.duration = Date.now() - startTime;
			new Notice(`Transaction sync failed: ${result.errors[0]}`);
			return result;
		}
	}

	/**
	 * Calculate date range based on sync settings
	 */
	private calculateDateRange(settings: TransactionSyncSettings): { startDate: string; endDate: string } {
		const today = new Date();
		const endDate = today.toISOString().split('T')[0];
		let startDate: string;

		switch (settings.syncRange) {
			case 'week':
				const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
				startDate = weekAgo.toISOString().split('T')[0];
				break;
			case 'month':
				const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
				startDate = monthAgo.toISOString().split('T')[0];
				break;
			case 'quarter':
				const quarterAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
				startDate = quarterAgo.toISOString().split('T')[0];
				break;
			case 'custom':
				startDate = settings.customStartDate || endDate;
				break;
			default:
				startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
		}

		return { startDate, endDate };
	}

	/**
	 * Create transaction batch in FastAPI backend
	 */
	private async createTransactionBatch(startDate: string, endDate: string): Promise<string> {
		try {
			console.log('Creating transaction batch in backend...');
			
			if (!this.settings.plaidAccessToken) {
				throw new Error('No Plaid access token available. Please connect your bank account first.');
			}

			const backendUrl = 'http://localhost:8000';
			const response = await fetch(`${backendUrl}/plaid/transactions/batch`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					start_date: startDate,
					end_date: endDate,
					access_token: this.settings.plaidAccessToken,
					credentials: {
						client_id: this.settings.plaidClientId || "",
						secret: "", // Backend uses environment variable
						environment: this.settings.plaidEnvironment
					}
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`Backend API error: ${errorData.detail || response.statusText}`);
			}

			const data = await response.json();
			console.log('Batch created successfully:', data);
			return data.batch_id;

		} catch (error) {
			console.error('Failed to create transaction batch:', error);
			throw error;
		}
	}

	/**
	 * Process transaction batch incrementally
	 */
	private async processBatchIncrementally(batchId: string, settings: TransactionSyncSettings): Promise<{
		success: boolean;
		processed: number;
		skipped: number;
		notesCreated: number;
		duplicates: number;
		errors: string[];
		folderPath: string;
	}> {
		const result = {
			success: false,
			processed: 0,
			skipped: 0,
			notesCreated: 0,
			duplicates: 0,
			errors: [] as string[],
			folderPath: ''
		};

		try {
			console.log('Processing batch incrementally:', batchId);
			
			// Ensure transaction folders exist
			await this.ensureTransactionFolders();

			const backendUrl = 'http://localhost:8000';
			let offset = 0;
			const limit = settings.batchSize;
			let hasMore = true;

			// Get batch status first
			const batchStatus = await this.getBatchStatus(batchId);
			const totalTransactions = batchStatus.totalTransactions;

			new Notice(`Processing ${totalTransactions} transactions in batches of ${limit}...`);

			while (hasMore) {
				console.log(`Processing batch ${offset / limit + 1}...`);
				
				// Fetch batch of transactions
				const response = await fetch(`${backendUrl}/plaid/transactions/batch/${batchId}/transactions?limit=${limit}&offset=${offset}&processed=false`);
				
				if (!response.ok) {
					throw new Error(`Failed to fetch batch transactions: ${response.statusText}`);
				}

				const data = await response.json();
				const transactions = data.transactions;

				if (transactions.length === 0) {
					hasMore = false;
					break;
				}

				// Process each transaction
				const processedIds: string[] = [];
				
				for (const transactionData of transactions) {
					try {
						const transaction = transactionData.data;
						
						// Check for duplicates
						if (await this.isTransactionDuplicate(transaction)) {
							result.duplicates++;
							result.skipped++;
							console.log(`Skipping duplicate transaction: ${transaction.transaction_id}`);
							processedIds.push(transaction.transaction_id);
							continue;
						}

						// Create transaction note
						const notePath = await this.createTransactionNoteNew(transaction, settings);
						if (notePath) {
							result.notesCreated++;
							console.log(`Created transaction note: ${notePath}`);
							
							// Track processed transaction
							this.settings.processedTransactionIds.push(transaction.transaction_id);
						}
						
						processedIds.push(transaction.transaction_id);
						result.processed++;

					} catch (error) {
						console.error(`Failed to process transaction ${transactionData.id}:`, error);
						result.errors.push(`Transaction ${transactionData.id}: ${error}`);
						result.skipped++;
					}
				}

				// Mark transactions as processed in backend
				if (processedIds.length > 0) {
					try {
						await fetch(`${backendUrl}/plaid/transactions/batch/${batchId}/mark-processed`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
							},
							body: JSON.stringify(processedIds)
						});
					} catch (error) {
						console.error('Failed to mark transactions as processed:', error);
					}
				}

				// Update progress
				const progressPercentage = Math.round(((offset + transactions.length) / totalTransactions) * 100);
				new Notice(`Transaction sync progress: ${progressPercentage}% (${result.processed}/${totalTransactions})`);

				offset += limit;

				// Small delay to prevent overwhelming the system
				await new Promise(resolve => setTimeout(resolve, 100));
			}

			// Set folder path (use the first transaction's folder as representative)
			result.folderPath = this.settings.transactionsFolder;
			result.success = result.errors.length === 0 || (result.notesCreated > 0 && result.errors.length < result.processed * 0.1);

			console.log('Batch processing completed:', result);
			return result;

		} catch (error) {
			console.error('Failed to process batch:', error);
			result.errors.push(error instanceof Error ? error.message : 'Unknown error');
			return result;
		}
	}

	/**
	 * Get batch status from backend
	 */
	private async getBatchStatus(batchId: string): Promise<TransactionBatchInfo> {
		const backendUrl = 'http://localhost:8000';
		const response = await fetch(`${backendUrl}/plaid/transactions/batch/${batchId}/status`);
		
		if (!response.ok) {
			throw new Error(`Failed to get batch status: ${response.statusText}`);
		}

		const data = await response.json();
		return {
			id: data.batch_id,
			status: data.status,
			totalTransactions: data.total_transactions,
			processedTransactions: data.processed_transactions,
			startDate: '',
			endDate: '',
			createdAt: data.created_at,
			progressPercentage: (data.processed_transactions / data.total_transactions) * 100
		};
	}

	/**
	 * Check if transaction is a duplicate (enhanced version)
	 */
	private async isTransactionDuplicate(transaction: any): Promise<boolean> {
		// Check 1: Already processed transaction IDs
		if (this.settings.processedTransactionIds.includes(transaction.transaction_id)) {
			return true;
		}

		// Check 2: Check if note file already exists
		const expectedFilename = this.generateTransactionFilename(transaction);
		const monthFolder = this.getTransactionMonthFolder(transaction.date);
		const fullPath = `${monthFolder}/${expectedFilename}`;
		
		try {
			const file = this.app.vault.getAbstractFileByPath(fullPath);
			return file instanceof TFile;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Create a transaction note (new batch processing version)
	 */
	private async createTransactionNoteNew(transaction: any, settings: TransactionSyncSettings): Promise<string | null> {
		try {
			// Generate filename and folder path
			const filename = this.generateTransactionFilename(transaction);
			const monthFolder = this.getTransactionMonthFolder(transaction.date);
			const fullPath = `${monthFolder}/${filename}`;

			// Ensure month folder exists
			await this.ensureMonthFolder(monthFolder);

			// Check if file already exists (safety check)
			if (this.app.vault.getAbstractFileByPath(fullPath)) {
				console.log(`File already exists: ${fullPath}`);
				return null;
			}

			// Process transaction data for template
			const templateData = TemplateDataProcessor.processTransaction(transaction);
			
			// Generate note content using template
			let noteContent: string;
			if (settings.templateEnabled && settings.templatePath) {
				// Use Templator integration if available
				noteContent = await this.generateContentWithTemplator(transaction, settings.templatePath, templateData);
			} else {
				// Use default built-in template
				noteContent = TemplateEngine.render('transaction', templateData);
			}

			// Create the file
			const file = await this.app.vault.create(fullPath, noteContent);
			console.log(`Created transaction note: ${fullPath}`);
			return file.path;

		} catch (error) {
			console.error('Failed to create transaction note:', error);
			throw error;
		}
	}

	/**
	 * Generate transaction filename based on settings
	 */
	private generateTransactionFilename(transaction: any): string {
		const date = new Date(transaction.date);
		const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
		
		// Clean merchant name for filesystem
		const merchant = (transaction.merchant_name || transaction.name || 'Unknown')
			.replace(/[^\w\s-]/g, '') // Remove special characters
			.replace(/\s+/g, ' ') // Normalize spaces
			.trim()
			.substring(0, 30); // Limit length

		// Format amount
		const amount = Math.abs(transaction.amount).toFixed(2);

		// Use format from settings or default
		const format = this.settings.transactionSettings?.fileNameFormat || '{{date}} - {{merchant}} - {{amount}}';
		
		return format
			.replace('{{date}}', dateStr)
			.replace('{{merchant}}', merchant)
			.replace('{{amount}}', `$${amount}`)
			+ '.md';
	}

	/**
	 * Get month folder path for transaction
	 */
	private getTransactionMonthFolder(transactionDate: string): string {
		const date = new Date(transactionDate);
		const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
		return `${this.settings.transactionsFolder}/${yearMonth}`;
	}

	/**
	 * Ensure transaction folder structure exists
	 */
	private async ensureTransactionFolders(): Promise<void> {
		try {
			// Ensure main transactions folder exists
			const transactionsFolder = this.app.vault.getAbstractFileByPath(this.settings.transactionsFolder);
			if (!transactionsFolder) {
				await this.app.vault.createFolder(this.settings.transactionsFolder);
				console.log(`Created transactions folder: ${this.settings.transactionsFolder}`);
			}
		} catch (error) {
			console.error('Failed to create transactions folder:', error);
			throw error;
		}
	}

	/**
	 * Ensure specific month folder exists
	 */
	private async ensureMonthFolder(monthFolderPath: string): Promise<void> {
		try {
			const folder = this.app.vault.getAbstractFileByPath(monthFolderPath);
			if (!folder) {
				await this.app.vault.createFolder(monthFolderPath);
				console.log(`Created month folder: ${monthFolderPath}`);
			}
		} catch (error) {
			console.error(`Failed to create month folder ${monthFolderPath}:`, error);
			throw error;
		}
	}

	/**
	 * Get sync statistics (enhanced)
	 */
	getSyncStatistics(): {
		lastSync: string | undefined;
		processedTransactions: number;
		hasCredentials: boolean;
		hasAccessToken: boolean;
	} {
		return {
			lastSync: this.settings.lastTransactionSync,
			processedTransactions: this.settings.processedTransactionIds?.length || 0,
			hasCredentials: this.plaidService.hasCredentials(),
			hasAccessToken: !!this.settings.plaidAccessToken
		};
	}

	/**
	 * Convert raw Plaid transaction to our Transaction format
	 */
	private convertToTransaction(rawTransaction: any): Transaction {
		const formatted = this.plaidService.formatTransactionForTemplate(rawTransaction);
		return {
			id: formatted.id,
			date: formatted.date,
			amount: formatted.amount,
			merchant: formatted.merchant,
			category: formatted.category,
			account: formatted.account,
			description: formatted.description,
			tags: [], // Initialize empty tags array
			rawData: formatted.rawData
		};
	}

	/**
	 * Generate content using Templator plugin if available
	 */
	private async generateContentWithTemplator(transaction: any, templatePath: string, templateData: any): Promise<string> {
		try {
			// Check if Templator plugin is available
			const templatorPlugin = (this.app as any).plugins?.plugins?.['templater-obsidian'];
			
			if (!templatorPlugin) {
				console.warn('Templator plugin not found, falling back to built-in template');
				return TemplateEngine.render('transaction', templateData);
			}

			// Get the template file
			const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
			if (!templateFile || !(templateFile instanceof TFile)) {
				console.warn(`Template file not found: ${templatePath}, falling back to built-in template`);
				return TemplateEngine.render('transaction', templateData);
			}

			// Read template content
			const templateContent = await this.app.vault.read(templateFile);
			
			// Create template context for Templator
			const templateContext = {
				transaction,
				...templateData,
				// Add helper functions that might be useful in templates
				formatAmount: (amount: number) => `$${Math.abs(amount).toFixed(2)}`,
				formatDate: (date: string) => new Date(date).toLocaleDateString(),
				formatDateTime: (date: string) => new Date(date).toLocaleString(),
				isDebit: (amount: number) => amount > 0,
				isCredit: (amount: number) => amount < 0
			};

			// Use Templator's template processing if available
			if (templatorPlugin.templater?.parser) {
				try {
					// Process the template with Templator
					const processedContent = await templatorPlugin.templater.parser.parse_template(
						{ content: templateContent, path: templatePath },
						templateContext
					);
					return processedContent;
				} catch (templatorError) {
					console.error('Templator processing failed:', templatorError);
					// Fall back to built-in template with some basic replacements
					return this.processBasicTemplate(templateContent, templateContext);
				}
			} else {
				// Fall back to basic template processing
				return this.processBasicTemplate(templateContent, templateContext);
			}
		} catch (error) {
			console.error('Error generating content with Templator:', error);
			// Always fall back to built-in template on error
			return TemplateEngine.render('transaction', templateData);
		}
	}

	/**
	 * Process template with basic variable replacement when Templator is not available
	 */
	private processBasicTemplate(templateContent: string, templateData: any): string {
		let processed = templateContent;
		
		// Replace basic template variables
		for (const [key, value] of Object.entries(templateData)) {
			const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
			processed = processed.replace(regex, String(value || ''));
		}
		
		// Replace transaction-specific variables
		if (templateData.transaction) {
			const transaction = templateData.transaction;
			processed = processed.replace(/{{transaction\.(\w+)}}/g, (match, prop) => {
				return String(transaction[prop] || '');
			});
		}
		
		return processed;
	}

	/**
	 * Create default transaction template file for Templator
	 */
	async createDefaultTransactionTemplate(): Promise<string> {
		const templateFolder = 'templates'; // Use default templates folder
		const templateFileName = 'transaction-template.md';
		const templatePath = `${templateFolder}/${templateFileName}`;

		// Ensure template folder exists
		const folder = this.app.vault.getAbstractFileByPath(templateFolder);
		if (!folder) {
			await this.app.vault.createFolder(templateFolder);
		}

		// Check if template already exists
		const existingTemplate = this.app.vault.getAbstractFileByPath(templatePath);
		if (existingTemplate) {
			return templatePath;
		}

		// Create default transaction template content
		const defaultTemplate = `---
type: transaction
merchant: "{{transaction.merchant_name}}"
amount: {{transaction.amount}}
date: "{{transaction.date}}"
account: "{{transaction.account_id}}"
category: "{{transaction.category}}"
subcategory: "{{transaction.subcategory}}"
transaction_id: "{{transaction.transaction_id}}"
created: <% tp.date.now() %>
tags:
  - transaction
  - {{transaction.category}}
---

# ` + `{{transaction.merchant_name}} - $` + `{{formatAmount(transaction.amount)}}

**Date:** ` + `{{formatDate(transaction.date)}}
**Amount:** $` + `{{formatAmount(transaction.amount)}} (` + `{{isDebit(transaction.amount) ? "Debit" : "Credit"}})
**Account:** ` + `{{transaction.account_id}}
**Category:** ` + `{{transaction.category}}` + `{{transaction.subcategory ? " > " + transaction.subcategory : ""}}

<% if (transaction.location) { %>
**Location:** ` + `{{transaction.location.address || transaction.location.city + ", " + transaction.location.region}}
<% } %>

## Transaction Details

**Transaction ID:** ` + `{{transaction.transaction_id}}
**Reference:** ` + `{{transaction.account_reference_number || "N/A"}}

<% if (transaction.merchant_name !== transaction.name) { %>
**Original Name:** ` + `{{transaction.name}}
<% } %>

## Notes

<!-- Add your notes about this transaction here -->

---
*This note was automatically generated from Plaid transaction data.*
`;

		// Create the template file
		await this.app.vault.create(templatePath, defaultTemplate);
		console.log(`Created default transaction template: ${templatePath}`);
		
		return templatePath;
	}
}
