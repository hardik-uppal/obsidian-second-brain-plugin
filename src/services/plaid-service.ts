import { 
	PlaidApi, 
	Configuration, 
	PlaidEnvironments, 
	TransactionsGetRequest, 
	AccountsGetRequest, 
	LinkTokenCreateRequest, 
	ItemPublicTokenExchangeRequest,
	CountryCode,
	Products,
	DepositoryAccountSubtype
} from 'plaid';
import { PluginSettings, Transaction, PlaidLinkOptions, PlaidLinkHandler, PlaidLinkMetadata, PlaidLinkError } from '../types';
import { Notice } from 'obsidian';

export class PlaidService {
	private client: PlaidApi;
	private settings: PluginSettings;
	private onSettingsChange?: (settings: PluginSettings) => Promise<void>;

	constructor(settings: PluginSettings, onSettingsChange?: (settings: PluginSettings) => Promise<void>) {
		this.settings = settings;
		this.onSettingsChange = onSettingsChange;
		this.initializeClient();
	}

	private initializeClient(): void {
		console.log('=== Initializing Plaid Client ===');
		console.log('Environment setting:', this.settings.plaidEnvironment);
		console.log('Available environments:', Object.keys(PlaidEnvironments));
		console.log('Resolved base path:', PlaidEnvironments[this.settings.plaidEnvironment]);
		
		const configuration = new Configuration({
			basePath: PlaidEnvironments[this.settings.plaidEnvironment],
			baseOptions: {
				headers: {
					'PLAID-CLIENT-ID': this.settings.plaidClientId,
					'PLAID-SECRET': this.settings.plaidSecret,
				},
			},
		});

		this.client = new PlaidApi(configuration);
		console.log('Plaid client initialized');
	}

	async testConnection(): Promise<boolean> {
		try {
			if (!this.settings.plaidAccessToken) {
				throw new Error('No access token available. Please configure your Plaid Access Token.');
			}

			// Use FastAPI backend for API calls to avoid CORS issues
			const backendUrl = 'http://localhost:8000';
			
			const response = await fetch(`${backendUrl}/plaid/accounts`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					access_token: this.settings.plaidAccessToken,
					credentials: {
						client_id: this.settings.plaidClientId || "",
						secret: "", // Will use backend environment variable
						environment: this.settings.plaidEnvironment
					}
				})
			});

			return response.ok;
		} catch (error) {
			console.error('Plaid connection test failed:', error);
			return false;
		}
	}

	async getAccounts(): Promise<any[]> {
		try {
			if (!this.settings.plaidAccessToken) {
				throw new Error('No access token available');
			}

			// Use FastAPI backend for API calls to avoid CORS issues
			const backendUrl = 'http://localhost:8000';
			
			const response = await fetch(`${backendUrl}/plaid/accounts`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					access_token: this.settings.plaidAccessToken,
					credentials: {
						client_id: this.settings.plaidClientId || "",
						secret: "", // Will use backend environment variable
						environment: this.settings.plaidEnvironment
					}
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`Backend API error: ${errorData.detail || response.statusText}`);
			}

			const data = await response.json();
			return data.accounts;
		} catch (error) {
			console.error('Failed to fetch accounts:', error);
			throw error;
		}
	}

	async getTransactions(startDate?: string, endDate?: string, count: number = 100): Promise<any[]> {
		try {
			if (!this.settings.plaidAccessToken) {
				throw new Error('No access token available');
			}

			// Default to last 30 days if no dates provided
			const end = endDate || new Date().toISOString().split('T')[0];
			const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

			// Use FastAPI backend for API calls to avoid CORS issues
			const backendUrl = 'http://localhost:8000';
			
			const response = await fetch(`${backendUrl}/plaid/transactions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					access_token: this.settings.plaidAccessToken,
					start_date: start,
					end_date: end,
					credentials: {
						client_id: this.settings.plaidClientId || "",
						secret: "", // Will use backend environment variable
						environment: this.settings.plaidEnvironment
					}
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`Backend API error: ${errorData.detail || response.statusText}`);
			}

			const data = await response.json();
			return data.transactions;
		} catch (error) {
			console.error('Failed to fetch transactions:', error);
			throw error;
		}
	}

	async getNewTransactions(): Promise<any[]> {
		try {
			const lastSync = this.settings.lastTransactionSync;
			const startDate = lastSync || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
			const endDate = new Date().toISOString().split('T')[0];

			return await this.getTransactions(startDate, endDate);
		} catch (error) {
			console.error('Failed to fetch new transactions:', error);
			throw error;
		}
	}

	async syncTransactions(): Promise<{ success: boolean; count: number; errors: string[] }> {
		const result = {
			success: false,
			count: 0,
			errors: [] as string[]
		};

		try {
			new Notice('Syncing transactions from Plaid...');

			const transactions = await this.getNewTransactions();
			result.count = transactions.length;

			if (transactions.length === 0) {
				new Notice('No new transactions found');
				result.success = true;
				return result;
			}

			// Process transactions (this would be handled by the main plugin)
			new Notice(`Found ${transactions.length} new transactions`);
			result.success = true;

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			result.errors.push(errorMessage);
			new Notice(`Transaction sync failed: ${errorMessage}`);
			return result;
		}
	}

	// =====================================================
	// BATCH PROCESSING METHODS
	// =====================================================

	/**
	 * Create a transaction batch for background processing
	 */
	async createTransactionBatch(startDate: string, endDate: string): Promise<string> {
		try {
			console.log(`Creating transaction batch for ${startDate} to ${endDate}`);
			
			if (!this.settings.plaidAccessToken) {
				throw new Error('No access token available');
			}

			// Use FastAPI backend for batch creation
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
						secret: "", // Will use backend environment variable
						environment: this.settings.plaidEnvironment
					}
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`Backend API error: ${errorData.detail || response.statusText}`);
			}

			const data = await response.json();
			console.log(`Created transaction batch: ${data.batch_id} with ${data.total_transactions} transactions`);
			
			return data.batch_id;
		} catch (error) {
			console.error('Failed to create transaction batch:', error);
			throw error;
		}
	}

	/**
	 * Get batch status
	 */
	async getBatchStatus(batchId: string): Promise<any> {
		try {
			const backendUrl = 'http://localhost:8000';
			
			const response = await fetch(`${backendUrl}/plaid/transactions/batch/${batchId}/status`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				}
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`Backend API error: ${errorData.detail || response.statusText}`);
			}

			return await response.json();
		} catch (error) {
			console.error('Failed to get batch status:', error);
			throw error;
		}
	}

	/**
	 * Get transactions from a batch with pagination
	 */
	async getBatchTransactions(batchId: string, limit: number = 50, offset: number = 0, processed?: boolean): Promise<any> {
		try {
			const backendUrl = 'http://localhost:8000';
			
			let url = `${backendUrl}/plaid/transactions/batch/${batchId}/transactions?limit=${limit}&offset=${offset}`;
			if (processed !== undefined) {
				url += `&processed=${processed}`;
			}
			
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				}
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`Backend API error: ${errorData.detail || response.statusText}`);
			}

			return await response.json();
		} catch (error) {
			console.error('Failed to get batch transactions:', error);
			throw error;
		}
	}

	/**
	 * Mark transactions as processed
	 */
	async markTransactionsProcessed(batchId: string, transactionIds: string[]): Promise<any> {
		try {
			const backendUrl = 'http://localhost:8000';
			
			const response = await fetch(`${backendUrl}/plaid/transactions/batch/${batchId}/mark-processed`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(transactionIds)
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`Backend API error: ${errorData.detail || response.statusText}`);
			}

			return await response.json();
		} catch (error) {
			console.error('Failed to mark transactions as processed:', error);
			throw error;
		}
	}

	/**
	 * List all transaction batches
	 */
	async listTransactionBatches(status?: string, limit: number = 20): Promise<any> {
		try {
			const backendUrl = 'http://localhost:8000';
			
			let url = `${backendUrl}/plaid/transactions/batches?limit=${limit}`;
			if (status) {
				url += `&status=${status}`;
			}
			
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				}
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`Backend API error: ${errorData.detail || response.statusText}`);
			}

			return await response.json();
		} catch (error) {
			console.error('Failed to list transaction batches:', error);
			throw error;
		}
	}

	// OAuth flow helpers - Using FastAPI backend proxy
	async generateLinkToken(userId?: string, countryCodes: string[] = ['US']): Promise<string> {
		try {
			console.log('=== Generating Link Token via FastAPI Backend ===');
			console.log('Plaid Environment:', this.settings.plaidEnvironment);
			console.log('Country Codes:', countryCodes);
			
			// Check if FastAPI backend is available
			const backendUrl = 'http://localhost:8000';
			
			try {
				// Test backend connectivity
				const healthResponse = await fetch(`${backendUrl}/health`);
				if (!healthResponse.ok) {
					throw new Error('Backend not responding');
				}
				console.log('FastAPI backend is available');
			} catch (error) {
				throw new Error('FastAPI backend is not running. Please start the backend server first.\n\nTo start the backend:\n1. Open terminal in the backend folder\n2. Run: python main.py\n3. Or run: ./start.sh');
			}
			
			// Create link token via backend
			const response = await fetch(`${backendUrl}/plaid/link-token`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					user_id: userId || `obsidian_user_${Date.now()}`,
					country_codes: countryCodes,
					credentials: {
						client_id: this.settings.plaidClientId || "",
						secret: "", // Will use backend environment variable
						environment: this.settings.plaidEnvironment
					}
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`Backend API error: ${errorData.detail || response.statusText}`);
			}

			const data = await response.json();
			console.log('Link token created successfully via backend');
			return data.link_token;
			
		} catch (error: any) {
			console.error('=== Link Token Creation Failed ===');
			console.error('Error:', error);
			
			if (error?.message?.includes('Backend') || error?.message?.includes('FastAPI')) {
				throw error; // Re-throw backend-specific errors as-is
			} else if (error?.message?.includes('fetch') || error?.name === 'TypeError') {
				throw new Error('Network error: Unable to connect to FastAPI backend. Please ensure the backend server is running on http://localhost:8000');
			} else {
				throw error;
			}
		}
	}

	async exchangePublicToken(publicToken: string): Promise<string> {
		try {
			console.log('Exchanging public token for access token via FastAPI backend...');
			console.log('Environment:', this.settings.plaidEnvironment);
			console.log('Client ID configured:', !!this.settings.plaidClientId);
			console.log('Secret configured:', !!this.settings.plaidSecret);
			
			if (!this.settings.plaidClientId || !this.settings.plaidSecret) {
				throw new Error('Plaid credentials missing during token exchange');
			}
			
			// Use FastAPI backend for token exchange to avoid CORS issues
			const backendUrl = 'http://localhost:8000';
			
			// Check if backend is available
			try {
				const healthResponse = await fetch(`${backendUrl}/health`);
				if (!healthResponse.ok) {
					throw new Error('Backend not responding');
				}
			} catch (error) {
				throw new Error('FastAPI backend is not running. Please start the backend server first.');
			}
			
			// Exchange token via backend
			const response = await fetch(`${backendUrl}/plaid/exchange-token`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					public_token: publicToken,
					credentials: {
						client_id: this.settings.plaidClientId || "",
						secret: "", // Will use backend environment variable
						environment: this.settings.plaidEnvironment
					}
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(`Backend API error: ${errorData.detail || response.statusText}`);
			}

			const data = await response.json();
			console.log('Token exchange successful via backend');
			return data.access_token;
			
		} catch (error: any) {
			console.error('Failed to exchange public token:', error);
			
			// Provide more specific error messages
			if (error?.message?.includes('Backend') || error?.message?.includes('FastAPI')) {
				throw error; // Re-throw backend-specific errors as-is
			} else if (error?.message?.includes('credentials')) {
				throw new Error('Invalid Plaid credentials during token exchange. Please check your Client ID and Secret.');
			} else if (error?.message?.includes('network') || error?.code === 'ECONNREFUSED') {
				throw new Error('Network error during token exchange. Please check your internet connection and ensure the FastAPI backend is running.');
			} else {
				throw new Error(`Token exchange failed: ${error?.message || 'Unknown error'}`);
			}
		}
	}

	// Load Plaid Link SDK dynamically
	private loadPlaidSDK(): Promise<typeof window.Plaid> {
		return new Promise((resolve, reject) => {
			console.log('=== Loading Plaid SDK ===');
			
			// Check if Plaid is already loaded
			if (window.Plaid) {
				console.log('Plaid SDK already loaded');
				resolve(window.Plaid);
				return;
			}

			console.log('Loading Plaid SDK from CDN...');
			// Create script element
			const script = document.createElement('script');
			script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
			script.onload = () => {
				console.log('Plaid SDK script loaded successfully');
				if (window.Plaid) {
					console.log('Plaid SDK initialized and available');
					resolve(window.Plaid);
				} else {
					console.error('Plaid SDK script loaded but Plaid object not available');
					reject(new Error('Plaid SDK failed to initialize'));
				}
			};
			script.onerror = (error) => {
				console.error('Failed to load Plaid SDK script:', error);
				reject(new Error('Failed to load Plaid Link SDK'));
			};

			// Add to document head
			document.head.appendChild(script);
			console.log('Plaid SDK script tag added to document head');
		});
	}

	// Initiate Plaid Link flow using FastAPI backend
	async initiateLinkFlow(countryCodes: string[] = ['US']): Promise<void> {
		try {
			// Check if we have the required credentials
			if (!this.hasCredentials()) {
				throw new Error('Plaid credentials not configured. Please set your Client ID and Secret in settings first.');
			}

			console.log('=== Starting Plaid Link Flow via FastAPI Backend ===');
			console.log('Environment:', this.settings.plaidEnvironment);
			console.log('Countries:', countryCodes);
			console.log('Client ID:', this.settings.plaidClientId?.substring(0, 10) + '...');

			new Notice('Starting bank account connection...');
			
			// Check if FastAPI backend is running
			const backendUrl = 'http://localhost:8000';
			try {
				const healthResponse = await fetch(`${backendUrl}/health`);
				if (!healthResponse.ok) {
					throw new Error('Backend not responding');
				}
			} catch (error) {
				throw new Error('FastAPI backend is not running. Please start the backend server first.\n\nTo start:\n1. Open terminal in the backend folder\n2. Run: ./start.sh\n3. Or run: python main.py');
			}

			// Open the Plaid Link interface served by our backend
			const countriesParam = countryCodes.join(',');
			const linkUrl = `${backendUrl}/plaid/link?client_id=${encodeURIComponent(this.settings.plaidClientId)}&environment=${encodeURIComponent(this.settings.plaidEnvironment)}&countries=${encodeURIComponent(countriesParam)}`;
			
			console.log('Opening Plaid Link interface...');
			window.open(linkUrl, '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes');
			
			new Notice(`✅ Plaid Link opened in your browser!\n\n📋 Instructions:\n1. Select your country from the dropdown\n2. Complete bank authentication in the browser\n3. After success, copy the provided token\n4. Return to Obsidian and use "Exchange Plaid Token" command\n5. Paste the token to complete connection`, 15000);
			
			console.log('Plaid Link interface opened successfully');

		} catch (error) {
			console.error('=== Plaid Link Flow Failed ===');
			console.error('Error:', error);
			
			// Provide detailed error messages
			let errorMessage = 'Failed to start bank account connection: ';
			
			if (error instanceof Error) {
				if (error.message.includes('credentials') || error.message.includes('401')) {
					errorMessage += 'Invalid Plaid credentials. Please check your Client ID and Secret in settings.';
				} else if (error.message.includes('Backend') || error.message.includes('FastAPI')) {
					errorMessage += error.message;
				} else if (error.message.includes('environment')) {
					errorMessage += 'Environment configuration error. Please check if you have access to the selected Plaid environment.';
				} else {
					errorMessage += error.message;
				}
			} else {
				errorMessage += 'Unknown error';
			}
			
			new Notice(errorMessage, 8000);
			throw error;
		}
	}

	// Convenience method for connecting bank account from plugin UI
	async connectBankAccount(): Promise<boolean> {
		try {
			console.log('=== Starting bank account connection ===');
			
			if (this.settings.plaidAccessToken) {
				// Already have an access token, test if it's still valid
				console.log('Existing access token found, testing connection...');
				const isValid = await this.testConnection();
				if (isValid) {
					new Notice('Bank account is already connected and working!');
					return true;
				} else {
					new Notice('Existing connection is invalid. Please reconnect your bank account.');
				}
			}

			// Validate configuration before starting
			if (!this.hasCredentials()) {
				const status = this.getConfigurationStatus();
				throw new Error(`Plaid configuration incomplete. Missing: ${status.missing.join(', ')}`);
			}

			// Start the link flow
			console.log('Starting Plaid Link flow...');
			const selectedCountries = this.getSelectedCountries();
			await this.initiateLinkFlow(selectedCountries);
			return true;
		} catch (error: any) {
			console.error('Failed to connect bank account:', error);
			
			// Provide specific error messages based on error type
			let userMessage = 'Failed to connect bank account. ';
			
			if (error?.message?.includes('Network error') || error?.message?.includes('network')) {
				userMessage += 'Network connection failed. Please check:\n• Your internet connection\n• Firewall/VPN settings\n• Try again in a few minutes';
			} else if (error?.message?.includes('Invalid credentials') || error?.message?.includes('401')) {
				userMessage += 'Invalid Plaid credentials. Please check your Client ID and Secret in settings.';
			} else if (error?.message?.includes('configuration') || error?.message?.includes('Missing:')) {
				userMessage += error.message;
			} else if (error?.message?.includes('CORS') || error?.message?.includes('fetch')) {
				userMessage += 'Browser security error. This may be caused by:\n• CORS restrictions\n• Ad blockers\n• Browser extensions\n• Try disabling extensions temporarily';
			} else {
				userMessage += `Error: ${error?.message || 'Unknown error'}`;
			}
			
			new Notice(userMessage, 8000); // Show for 8 seconds
			return false;
		}
	}

	// Check if we need to show a "Connect Bank Account" button
	needsBankConnection(): boolean {
		return !this.settings.plaidAccessToken || this.settings.plaidAccessToken === '';
	}

	// Utility methods
	formatTransactionForTemplate(transaction: any): Record<string, any> {
		return {
			id: transaction.transaction_id,
			date: transaction.date,
			amount: Math.abs(transaction.amount),
			merchant: transaction.merchant_name || transaction.name || 'Unknown',
			category: transaction.category?.[0] || 'Other',
			account: transaction.account_id,
			description: transaction.original_description || transaction.name || '',
			rawData: transaction
		};
	}

	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
		this.initializeClient();
	}

	// Check if we have credentials to start Link flow
	hasCredentials(): boolean {
		return !!(
			this.settings.plaidClientId &&
			this.settings.plaidSecret
		);
	}

	// Check if we have a full configuration including access token
	isConfigured(): boolean {
		return !!(
			this.settings.plaidClientId &&
			this.settings.plaidSecret &&
			this.settings.plaidAccessToken
		);
	}

	getConfigurationStatus(): { configured: boolean; missing: string[] } {
		const missing: string[] = [];
		
		if (!this.settings.plaidClientId) missing.push('Client ID');
		if (!this.settings.plaidSecret) missing.push('Secret');
		
		// Don't require access token for initial setup
		const hasCredentials = missing.length === 0;
		
		return {
			configured: hasCredentials,
			missing
		};
	}

	// Network diagnostic method to help debug connectivity issues
	async diagnoseNetworkConnectivity(): Promise<{ success: boolean; details: string[] }> {
		const details: string[] = [];
		let success = true;

		try {
			console.log('=== Running Network Diagnostics ===');
			
			// Test 1: Check if we can reach Plaid's CDN
			try {
				const response = await fetch('https://cdn.plaid.com/link/v2/stable/link-initialize.js', { 
					method: 'HEAD',
					mode: 'no-cors' // Avoid CORS issues for this test
				});
				details.push('✅ Plaid CDN reachable');
			} catch (error) {
				details.push('❌ Plaid CDN unreachable');
				success = false;
			}

			// Test 2: Check basic internet connectivity
			try {
				const response = await fetch('https://httpbin.org/get', { 
					method: 'HEAD',
					mode: 'no-cors'
				});
				details.push('✅ Internet connectivity working');
			} catch (error) {
				details.push('❌ Internet connectivity issues');
				success = false;
			}

			// Test 3: Environment-specific endpoint test
			const baseUrl = this.settings.plaidEnvironment === 'production' 
				? 'https://production.plaid.com' 
				: 'https://sandbox.plaid.com';
			
			try {
				// Just test if we can make a request to the base URL
				const response = await fetch(baseUrl, { 
					method: 'HEAD',
					mode: 'no-cors'
				});
				details.push(`✅ Plaid ${this.settings.plaidEnvironment} endpoint reachable`);
			} catch (error) {
				details.push(`❌ Plaid ${this.settings.plaidEnvironment} endpoint unreachable`);
				success = false;
			}

			// Test 4: Check configuration
			if (!this.hasCredentials()) {
				const status = this.getConfigurationStatus();
				details.push(`❌ Configuration incomplete: Missing ${status.missing.join(', ')}`);
				success = false;
			} else {
				details.push('✅ Plaid credentials configured');
			}

			return { success, details };
		} catch (error) {
			console.error('Network diagnostics failed:', error);
			return { 
				success: false, 
				details: [`❌ Diagnostics failed: ${error instanceof Error ? error.message : 'Unknown error'}`] 
			};
		}
	}

	// Method to handle public token from browser
	async handlePublicTokenFromBrowser(publicToken: string): Promise<boolean> {
		try {
			console.log('Processing public token from browser...');
			new Notice('Processing bank connection...');
			
			// Exchange the public token for an access token
			const accessToken = await this.exchangePublicToken(publicToken);
			
			// Update settings with the new access token
			this.settings.plaidAccessToken = accessToken;
			
			// Save settings using the callback if available
			if (this.onSettingsChange) {
				await this.onSettingsChange(this.settings);
				console.log('Settings saved successfully');
			}
			
			new Notice('Bank account connected successfully!');
			return true;
		} catch (error) {
			console.error('Failed to process public token:', error);
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Failed to complete bank account connection: ${errorMsg}`);
			return false;
		}
	}

	// Get supported countries for Plaid integration
	getSupportedCountries(): { code: string; name: string; flag: string }[] {
		return [
			{ code: 'US', name: 'United States', flag: '🇺🇸' },
			{ code: 'CA', name: 'Canada', flag: '🇨🇦' },
			{ code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
			{ code: 'IE', name: 'Ireland', flag: '🇮🇪' },
			{ code: 'FR', name: 'France', flag: '🇫🇷' },
			{ code: 'ES', name: 'Spain', flag: '🇪🇸' },
			{ code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
			{ code: 'DE', name: 'Germany', flag: '🇩🇪' }
		];
	}

	// Get user's selected countries from settings
	getSelectedCountries(): string[] {
		return this.settings.plaidCountryCodes?.length > 0 
			? this.settings.plaidCountryCodes 
			: ['US']; // Default to US if none selected
	}
}
