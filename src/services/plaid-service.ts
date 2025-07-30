import { PlaidApi, Configuration, PlaidEnvironments, TransactionsGetRequest, AccountsGetRequest } from 'plaid';
import { PluginSettings, Transaction } from '../types';
import { Notice } from 'obsidian';

export class PlaidService {
	private client: PlaidApi;
	private settings: PluginSettings;

	constructor(settings: PluginSettings) {
		this.settings = settings;
		this.initializeClient();
	}

	private initializeClient(): void {
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
	}

	async testConnection(): Promise<boolean> {
		try {
			if (!this.settings.plaidAccessToken) {
				throw new Error('No access token available. Please link your bank account first.');
			}

			const request: AccountsGetRequest = {
				access_token: this.settings.plaidAccessToken,
			};

			await this.client.accountsGet(request);
			return true;
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

			const request: AccountsGetRequest = {
				access_token: this.settings.plaidAccessToken,
			};

			const response = await this.client.accountsGet(request);
			return response.data.accounts;
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

			const request: TransactionsGetRequest = {
				access_token: this.settings.plaidAccessToken,
				start_date: start,
				end_date: end,
			};

			const response = await this.client.transactionsGet(request);
			return response.data.transactions;
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

	// OAuth flow helpers (simplified - in production you'd need proper OAuth handling)
	generateLinkToken(): string {
		// This would typically involve calling Plaid's link/token/create endpoint
		// For now, return a placeholder
		return 'link-token-placeholder';
	}

	async exchangePublicToken(publicToken: string): Promise<string> {
		try {
			// This would call Plaid's link/token/exchange endpoint
			// For now, return a placeholder
			return 'access-token-placeholder';
		} catch (error) {
			console.error('Failed to exchange public token:', error);
			throw error;
		}
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
		if (!this.settings.plaidAccessToken) missing.push('Access Token');

		return {
			configured: missing.length === 0,
			missing
		};
	}
}
