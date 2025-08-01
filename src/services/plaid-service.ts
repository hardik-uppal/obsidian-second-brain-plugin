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

	// OAuth flow helpers - proper implementation
	async generateLinkToken(userId?: string): Promise<string> {
		try {
			console.log('=== Generating Link Token ===');
			console.log('Plaid Environment:', this.settings.plaidEnvironment);
			console.log('Base Path:', PlaidEnvironments[this.settings.plaidEnvironment]);
			
			const request: LinkTokenCreateRequest = {
				client_name: "Obsidian Second Brain Plugin",
				country_codes: [CountryCode.Us],
				language: 'en',
				user: {
					client_user_id: userId || 'obsidian-user-' + Date.now()
				},
				products: [Products.Transactions, Products.Auth],
				account_filters: {
					depository: {
						account_subtypes: [DepositoryAccountSubtype.Checking, DepositoryAccountSubtype.Savings]
					}
				},
				redirect_uri: undefined // Not needed for most integrations
			};

			console.log('Making request to /link/token/create...');
			const response = await this.client.linkTokenCreate(request);
			console.log('Link token created successfully');
			return response.data.link_token;
		} catch (error: any) {
			console.error('=== Link Token Creation Failed ===');
			console.error('Error object:', error);
			console.error('Error name:', error?.name);
			console.error('Error code:', error?.code);
			console.error('Response status:', error?.response?.status);
			console.error('Response data:', error?.response?.data);
			console.error('Error message:', error?.message);
			console.error('Error stack:', error?.stack);
			
			// Check for specific network error types first
			if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
				throw new Error('Network error: Cannot reach Plaid servers. Check your internet connection and try again.');
			} else if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT') {
				throw new Error('Network error: Connection to Plaid timed out. Please try again.');
			} else if (error?.name === 'TypeError' && error?.message?.includes('fetch')) {
				throw new Error('Network error: Failed to fetch from Plaid API. This may be caused by:\n• CORS restrictions\n• Ad blockers or browser extensions\n• Network firewall\n• Try disabling browser extensions temporarily');
			} else if (error?.message?.toLowerCase()?.includes('failed to fetch')) {
				throw new Error('Network error: Failed to fetch from Plaid API. Please check your internet connection and try again.');
			} else if (error?.response?.status === 401) {
				throw new Error('Invalid Plaid credentials. Please check your Client ID and Secret.');
			} else if (error?.response?.status === 400) {
				const errorCode = error?.response?.data?.error_code;
				const errorMsg = error?.response?.data?.error_message || 'Invalid configuration';
				throw new Error(`Plaid configuration error (${errorCode}): ${errorMsg}`);
			} else if (error?.message?.includes('network') || error?.code === 'ECONNREFUSED') {
				throw new Error('Network error connecting to Plaid. Please check your internet connection.');
			} else if (error?.response?.data?.error_code) {
				const errorCode = error.response.data.error_code;
				const errorMsg = error.response.data.error_message || 'Unknown Plaid error';
				throw new Error(`Plaid Error (${errorCode}): ${errorMsg}`);
			} else {
				throw new Error(`Plaid API error: ${error?.message || 'Unknown error'}. Check browser console for more details.`);
			}
		}
	}

	async exchangePublicToken(publicToken: string): Promise<string> {
		try {
			console.log('Exchanging public token for access token...');
			console.log('Environment:', this.settings.plaidEnvironment);
			console.log('Client ID configured:', !!this.settings.plaidClientId);
			console.log('Secret configured:', !!this.settings.plaidSecret);
			
			if (!this.settings.plaidClientId || !this.settings.plaidSecret) {
				throw new Error('Plaid credentials missing during token exchange');
			}
			
			// Ensure client is properly initialized with current settings
			this.initializeClient();
			
			const request: ItemPublicTokenExchangeRequest = {
				public_token: publicToken
			};

			const response = await this.client.itemPublicTokenExchange(request);
			console.log('Token exchange successful');
			return response.data.access_token;
		} catch (error: any) {
			console.error('Failed to exchange public token:', error);
			console.error('Error details:', error?.response?.data);
			
			// Provide more specific error messages
			if (error?.response?.status === 400) {
				const errorCode = error?.response?.data?.error_code;
				const errorMsg = error?.response?.data?.error_message || 'Invalid request';
				throw new Error(`Plaid API Error (${errorCode}): ${errorMsg}`);
			} else if (error?.response?.status === 401) {
				throw new Error('Invalid Plaid credentials during token exchange. Please check your Client ID and Secret.');
			} else if (error?.response?.data?.error_code) {
				// Handle specific Plaid error codes
				const errorCode = error.response.data.error_code;
				const errorMsg = error.response.data.error_message || 'Unknown Plaid error';
				throw new Error(`Plaid Error (${errorCode}): ${errorMsg}`);
			} else if (error?.message?.includes('network') || error?.code === 'ECONNREFUSED') {
				throw new Error('Network error during token exchange. Please check your internet connection.');
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

	// Initiate Plaid Link flow using local HTML file approach
	async initiateLinkFlow(): Promise<void> {
		try {
			// Check if we have the required credentials
			if (!this.hasCredentials()) {
				throw new Error('Plaid credentials not configured. Please set your Client ID and Secret in settings first.');
			}

			console.log('=== Starting Plaid Link Flow ===');
			console.log('Environment:', this.settings.plaidEnvironment);
			console.log('Client ID:', this.settings.plaidClientId?.substring(0, 10) + '...');

			new Notice('Generating Plaid link token...');
			
			console.log('Step 1: Generating link token...');
			const linkToken = await this.generateLinkToken();
			console.log('Step 1 completed: Link token generated');

			console.log('Step 2: Creating Plaid Link HTML...');
			const linkHtml = this.createPlaidLinkHtml(linkToken);
			
			console.log('Step 3: Opening Plaid Link in browser...');
			// Create a blob URL for the HTML content
			const blob = new Blob([linkHtml], { type: 'text/html' });
			const blobUrl = URL.createObjectURL(blob);
			
			// Open in new window/tab
			window.open(blobUrl, '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes');
			
			new Notice(`✅ Plaid Link opened in your browser!\n\n📋 Instructions:\n1. Complete bank authentication in the browser window\n2. After success, you'll get a token starting with "public-"\n3. Copy that token\n4. Return to Obsidian and use "Exchange Plaid Token" command\n5. Paste the token to complete connection`, 15000);
			
			console.log('Step 3 completed: Browser opened with Plaid Link');

		} catch (error) {
			console.error('=== Plaid Link Flow Failed ===');
			console.error('Error:', error);
			
			// Provide detailed error messages
			let errorMessage = 'Failed to start bank account connection: ';
			
			if (error instanceof Error) {
				if (error.message.includes('network') || error.message.includes('Network')) {
					errorMessage += 'Network error. Please check your internet connection and try again.';
				} else if (error.message.includes('credentials') || error.message.includes('401')) {
					errorMessage += 'Invalid Plaid credentials. Please check your Client ID and Secret in settings.';
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
			await this.initiateLinkFlow();
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

	// Create HTML page for Plaid Link in browser
	private createPlaidLinkHtml(linkToken: string): string {
		return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connect Your Bank Account - Plaid</title>
    <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
            width: 100%;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        .logo {
            width: 60px;
            height: 60px;
            background: #667eea;
            border-radius: 50%;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 24px;
        }
        button {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            margin: 10px;
            transition: background 0.3s;
        }
        button:hover {
            background: #5a6fd8;
        }
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .status {
            margin: 20px 0;
            padding: 10px;
            border-radius: 6px;
            font-weight: 500;
        }
        .success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .info {
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #b6d4db;
        }
        .token-display {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            padding: 15px;
            margin: 15px 0;
            font-family: monospace;
            word-break: break-all;
            font-size: 14px;
        }
        .instructions {
            text-align: left;
            margin: 20px 0;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid #667eea;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🏦</div>
        <h1>Connect Your Bank Account</h1>
        <p>Click the button below to securely connect your bank account through Plaid.</p>
        
        <button id="connectButton" onclick="startPlaidLink()">
            Connect Bank Account
        </button>
        
        <div id="status" class="status info" style="display: none;">
            Initializing secure connection...
        </div>
        
        <div id="tokenSection" style="display: none;">
            <div class="instructions">
                <h3>✅ Success! Bank Account Connected</h3>
                <p><strong>Next steps:</strong></p>
                <ol>
                    <li>Copy the token below</li>
                    <li>Return to Obsidian</li>
                    <li>Use the "Exchange Plaid Token" command or button in settings</li>
                    <li>Paste the token when prompted</li>
                </ol>
            </div>
            
            <h3>Your Plaid Token:</h3>
            <div id="tokenDisplay" class="token-display">
                Token will appear here...
            </div>
            <button onclick="copyToken()">Copy Token</button>
            <button onclick="window.close()">Close Window</button>
        </div>
    </div>

    <script>
        let publicToken = null;
        let linkHandler = null;

        function showStatus(message, type = 'info') {
            const statusEl = document.getElementById('status');
            statusEl.textContent = message;
            statusEl.className = 'status ' + type;
            statusEl.style.display = 'block';
        }

        function showToken(token) {
            publicToken = token;
            document.getElementById('tokenDisplay').textContent = token;
            document.getElementById('tokenSection').style.display = 'block';
            document.getElementById('connectButton').style.display = 'none';
        }

        function copyToken() {
            if (publicToken) {
                navigator.clipboard.writeText(publicToken).then(() => {
                    showStatus('Token copied to clipboard!', 'success');
                }).catch(() => {
                    // Fallback for older browsers
                    const textArea = document.createElement('textarea');
                    textArea.value = publicToken;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    showStatus('Token copied to clipboard!', 'success');
                });
            }
        }

        function startPlaidLink() {
            showStatus('Initializing Plaid Link...', 'info');
            
            try {
                linkHandler = Plaid.create({
                    token: '${linkToken}',
                    onSuccess: function(public_token, metadata) {
                        console.log('Plaid Link Success:', public_token, metadata);
                        showStatus('Bank account connected successfully!', 'success');
                        showToken(public_token);
                    },
                    onLoad: function() {
                        console.log('Plaid Link loaded');
                        showStatus('Plaid Link loaded, opening connection dialog...', 'info');
                    },
                    onExit: function(err, metadata) {
                        if (err != null) {
                            console.error('Plaid Link Error:', err, metadata);
                            showStatus('Connection failed: ' + err.error_message, 'error');
                        } else {
                            console.log('Plaid Link Exit:', metadata);
                            showStatus('Connection cancelled', 'info');
                        }
                    },
                    onEvent: function(eventName, metadata) {
                        console.log('Plaid Link Event:', eventName, metadata);
                    }
                });
                
                // Open Plaid Link
                linkHandler.open();
            } catch (error) {
                console.error('Failed to initialize Plaid Link:', error);
                showStatus('Failed to initialize Plaid Link: ' + error.message, 'error');
            }
        }

        // Auto-start if this is a direct link (optional)
        // startPlaidLink();
    </script>
</body>
</html>`;
	}

	// Create temporary HTML file for Plaid Link
	private async createTempLinkFile(htmlContent: string): Promise<string> {
		const os = require('os');
		const path = require('path');
		const fs = require('fs').promises;
		
		const tempDir = os.tmpdir();
		const fileName = `plaid-link-${Date.now()}.html`;
		const filePath = path.join(tempDir, fileName);
		
		await fs.writeFile(filePath, htmlContent, 'utf8');
		console.log('Temporary Plaid Link file created:', filePath);
		
		return filePath;
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
}
