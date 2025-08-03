from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import List, Optional
import os
from dotenv import load_dotenv
import logging
import plaid
from plaid.api import plaid_api
from plaid.model.transactions_get_request import TransactionsGetRequest
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.country_code import CountryCode
from plaid.model.products import Products
from plaid.configuration import Configuration, Environment
from plaid.api_client import ApiClient
from plaid.exceptions import ApiException
import datetime
import json
import sqlite3
from pathlib import Path
from decimal import Decimal

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Custom JSON encoder to handle date, datetime, and Decimal objects
class PlaidJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime.date, datetime.datetime)):
            return obj.isoformat()
        elif isinstance(obj, Decimal):
            return float(obj)
        elif hasattr(obj, 'to_dict'):
            return obj.to_dict()
        elif hasattr(obj, '__dict__'):
            return obj.__dict__
        return super().default(obj)

# Initialize SQLite database for transaction storage
DATABASE_PATH = "transaction_storage.db"

def init_database():
    """Initialize SQLite database for transaction batch storage"""
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    # Create transaction batches table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS transaction_batches (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            total_transactions INTEGER NOT NULL,
            processed_transactions INTEGER DEFAULT 0,
            start_date TEXT,
            end_date TEXT,
            error_message TEXT
        )
    """)
    
    # Create transactions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            transaction_data TEXT NOT NULL,
            processed BOOLEAN DEFAULT FALSE,
            created_at TEXT NOT NULL,
            FOREIGN KEY (batch_id) REFERENCES transaction_batches (id)
        )
    """)
    
    conn.commit()
    conn.close()
    logger.info("Database initialized successfully")

# Initialize database on startup
init_database()

app = FastAPI(
    title="Second Brain Plaid Proxy",
    description="FastAPI proxy server for Plaid integration with Obsidian Second Brain plugin",
    version="1.0.0"
)

# CORS middleware for Obsidian desktop app
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "app://obsidian.md",
        "http://localhost:*",
        "https://localhost:*",
        "*"  # For development - restrict in production
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Plaid configuration
PLAID_CLIENT_ID = os.getenv('PLAID_CLIENT_ID')
PLAID_SECRET = os.getenv('PLAID_SECRET')
PLAID_ENV = os.getenv('PLAID_ENV', 'sandbox')

# Plaid environments mapping
def get_plaid_environment(env_name: str):
    """Get the correct Plaid environment configuration using latest SDK"""
    # Use the Environment class from plaid.configuration for latest SDK
    env_mapping = {
        'sandbox': Environment.Sandbox,
        'production': Environment.Production
    }
    return env_mapping.get(env_name.lower(), Environment.Sandbox)

def create_plaid_client(client_id: str, secret: str, environment: str):
    """Create a Plaid client with the latest SDK configuration"""
    config = Configuration(
        host=get_plaid_environment(environment),
        api_key={
            'clientId': client_id,
            'secret': secret,
            'plaidVersion': '2020-09-14'  # Latest API version
        }
    )
    return plaid_api.PlaidApi(ApiClient(config))

def handle_plaid_error(e: Exception) -> str:
    """Handle Plaid API errors and return formatted error message"""
    if isinstance(e, ApiException):
        try:
            # Parse Plaid error response
            error_data = e.body
            logger.error(f"Plaid API Exception - Status: {e.status}")
            logger.error(f"Plaid API Exception - Headers: {e.headers}")
            logger.error(f"Plaid API Exception - Body: {error_data}")
            
            if isinstance(error_data, dict):
                error_type = error_data.get('error_type', 'UNKNOWN_ERROR')
                error_code = error_data.get('error_code', 'UNKNOWN')
                display_message = error_data.get('display_message', str(e))
                return f"Plaid API Error ({error_type}/{error_code}): {display_message}"
            else:
                return f"Plaid API Error: {str(e)}"
        except Exception as parse_error:
            logger.error(f"Failed to parse Plaid error: {parse_error}")
            return f"Plaid API Error: {str(e)}"
    else:
        return str(e)

# Initialize Plaid client with correct environment
if PLAID_CLIENT_ID and PLAID_SECRET:
    plaid_client = create_plaid_client(PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV)
else:
    plaid_client = None  # Will create temporary clients as needed

# Pydantic models
class PlaidCredentials(BaseModel):
    client_id: str = ""  # Can be empty to use environment variable
    secret: str = ""     # Can be empty to use environment variable  
    environment: str = "sandbox"

class LinkTokenRequest(BaseModel):
    user_id: Optional[str] = "default_user"
    credentials: PlaidCredentials
    country_codes: Optional[List[str]] = ["US"]  # Default to US, can include CA, GB, etc.

class PublicTokenExchangeRequest(BaseModel):
    public_token: str
    credentials: PlaidCredentials

class TransactionsRequest(BaseModel):
    access_token: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    credentials: PlaidCredentials

class AccountsRequest(BaseModel):
    access_token: str
    credentials: PlaidCredentials

# Health check endpoint
@app.get("/")
async def root():
    return {
        "service": "Second Brain Plaid Proxy",
        "status": "running",
        "version": "1.0.0",
        "plaid_env": PLAID_ENV
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.datetime.now().isoformat()}

# Create link token endpoint
@app.post("/plaid/link-token")
async def create_link_token(request: LinkTokenRequest):
    try:
        logger.info(f"Creating link token for user: {request.user_id}")
        logger.info(f"Request environment: {request.credentials.environment}")
        logger.info(f"Request country codes: {request.country_codes}")
        
        # Use environment secret if not provided in request
        secret = request.credentials.secret if request.credentials.secret else PLAID_SECRET
        client_id = request.credentials.client_id if request.credentials.client_id else PLAID_CLIENT_ID
        
        logger.info(f"Using client_id: {'***' if client_id else 'None'}")
        logger.info(f"Using secret: {'***' if secret else 'None'}")
        
        if not secret or not client_id:
            logger.error("Plaid credentials not configured")
            raise ValueError("Plaid credentials not configured in environment or request")
        
        # Create temporary Plaid client with provided credentials
        logger.info(f"Creating Plaid client for environment: {request.credentials.environment}")
        temp_client = create_plaid_client(client_id, secret, request.credentials.environment)
        
        # Create link token request
        # Convert country code strings to CountryCode objects
        logger.info("Converting country codes...")
        try:
            country_codes = [CountryCode(code) for code in request.country_codes]
            logger.info(f"Country codes converted successfully: {country_codes}")
        except Exception as cc_error:
            logger.error(f"Failed to convert country codes: {cc_error}")
            raise
        
        logger.info("Creating LinkTokenCreateRequest...")
        try:
            link_request = LinkTokenCreateRequest(
                client_name="Second Brain Obsidian Plugin",
                language='en',
                country_codes=country_codes,
                products=[Products('transactions')],
                user=LinkTokenCreateRequestUser(
                    client_user_id=request.user_id
                )
            )
            logger.info("LinkTokenCreateRequest created successfully")
        except Exception as req_error:
            logger.error(f"Failed to create LinkTokenCreateRequest: {req_error}")
            raise
        
        logger.info("Calling Plaid API to create link token...")
        try:
            logger.info(f"Request object details:")
            logger.info(f"  - Products: {link_request.products}")
            logger.info(f"  - Client name: {link_request.client_name}")
            logger.info(f"  - Country codes: {link_request.country_codes}")
            logger.info(f"  - Language: {link_request.language}")
            logger.info(f"  - User: {link_request.user}")
            logger.info(f"  - User client_user_id: {link_request.user.client_user_id}")
            
            response = temp_client.link_token_create(link_request)
            logger.info("Link token created successfully")
            logger.info(f"Response type: {type(response)}")
            
            # Handle response format - new SDK might return different structure
            if hasattr(response, 'link_token'):
                link_token = response.link_token
                expiration = getattr(response, 'expiration', None)
            elif isinstance(response, dict):
                link_token = response.get('link_token')
                expiration = response.get('expiration')
            else:
                # Try to access as attribute
                link_token = getattr(response, 'link_token', None)
                expiration = getattr(response, 'expiration', None)
            
            if not link_token:
                logger.error(f"No link_token in response. Response: {response}")
                logger.error(f"Response attributes: {dir(response) if hasattr(response, '__dict__') else 'No attributes'}")
                raise ValueError("Invalid response from Plaid API - no link_token found")
                
            logger.info(f"Link token extracted successfully")
            
        except Exception as api_error:
            logger.error(f"Plaid API call failed: {api_error}")
            logger.error(f"API error type: {type(api_error)}")
            
            # Additional debugging for ApiException
            if hasattr(api_error, 'status'):
                logger.error(f"API Status Code: {api_error.status}")
            if hasattr(api_error, 'reason'):
                logger.error(f"API Reason: {api_error.reason}")
            if hasattr(api_error, 'body'):
                logger.error(f"API Response Body: {api_error.body}")
            if hasattr(api_error, 'headers'):
                logger.error(f"API Response Headers: {api_error.headers}")
            
            raise
        
        return {
            "link_token": link_token,
            "expiration": expiration
        }
        
    except Exception as e:
        error_message = handle_plaid_error(e)
        logger.error(f"Failed to create link token: {error_message}")
        raise HTTPException(status_code=400, detail=f"Failed to create link token: {error_message}")

# Exchange public token for access token
@app.post("/plaid/exchange-token")
async def exchange_public_token(request: PublicTokenExchangeRequest):
    try:
        logger.info("Exchanging public token for access token")
        
        # Use environment secret if not provided in request
        secret = request.credentials.secret if request.credentials.secret else PLAID_SECRET
        client_id = request.credentials.client_id if request.credentials.client_id else PLAID_CLIENT_ID
        
        if not secret or not client_id:
            raise ValueError("Plaid credentials not configured in environment or request")
        
        # Create temporary Plaid client with provided credentials
        temp_client = create_plaid_client(client_id, secret, request.credentials.environment)
        
        exchange_request = ItemPublicTokenExchangeRequest(
            public_token=request.public_token
        )
        
        response = temp_client.item_public_token_exchange(exchange_request)
        logger.info("Token exchange successful")
        
        return {
            "access_token": response['access_token'],
            "item_id": response['item_id']
        }
        
    except Exception as e:
        error_message = handle_plaid_error(e)
        logger.error(f"Failed to exchange token: {error_message}")
        raise HTTPException(status_code=400, detail=f"Failed to exchange token: {error_message}")

# Get accounts
@app.post("/plaid/accounts")
async def get_accounts(request: AccountsRequest):
    try:
        logger.info("Fetching accounts")
        
        # Use environment secret if not provided in request
        secret = request.credentials.secret if request.credentials.secret else PLAID_SECRET
        client_id = request.credentials.client_id if request.credentials.client_id else PLAID_CLIENT_ID
        
        if not secret or not client_id:
            raise ValueError("Plaid credentials not configured in environment or request")
        
        # Create temporary Plaid client with provided credentials
        temp_client = create_plaid_client(client_id, secret, request.credentials.environment)
        
        accounts_request = AccountsGetRequest(
            access_token=request.access_token
        )
        
        response = temp_client.accounts_get(accounts_request)
        logger.info(f"Retrieved {len(response['accounts'])} accounts")
        
        return {
            "accounts": response['accounts'],
            "item": response['item']
        }
        
    except Exception as e:
        error_message = handle_plaid_error(e)
        logger.error(f"Failed to fetch accounts: {error_message}")
        raise HTTPException(status_code=400, detail=f"Failed to fetch accounts: {error_message}")

# Get transactions
@app.post("/plaid/transactions")
async def get_transactions(request: TransactionsRequest):
    try:
        logger.info("Fetching transactions")
        
        # Default to last 30 days if no dates provided
        end_date = request.end_date or datetime.date.today()
        start_date = request.start_date or (datetime.date.today() - datetime.timedelta(days=30))
        
        # Convert strings to date objects if needed
        if isinstance(end_date, str):
            end_date = datetime.datetime.strptime(end_date, '%Y-%m-%d').date()
        if isinstance(start_date, str):
            start_date = datetime.datetime.strptime(start_date, '%Y-%m-%d').date()
        
        # Use environment secret if not provided in request
        secret = request.credentials.secret if request.credentials.secret else PLAID_SECRET
        client_id = request.credentials.client_id if request.credentials.client_id else PLAID_CLIENT_ID
        
        if not secret or not client_id:
            raise ValueError("Plaid credentials not configured in environment or request")
        
        # Create temporary Plaid client with provided credentials
        temp_client = create_plaid_client(client_id, secret, request.credentials.environment)
        
        transactions_request = TransactionsGetRequest(
            access_token=request.access_token,
            start_date=start_date,
            end_date=end_date
        )
        
        response = temp_client.transactions_get(transactions_request)
        logger.info(f"Retrieved {len(response['transactions'])} transactions")
        
        return {
            "transactions": response['transactions'],
            "accounts": response['accounts'],
            "total_transactions": response['total_transactions'],
            "item": response['item']
        }
        
    except Exception as e:
        error_message = handle_plaid_error(e)
        logger.error(f"Failed to fetch transactions: {error_message}")
        raise HTTPException(status_code=400, detail=f"Failed to fetch transactions: {error_message}")

# Serve Plaid Link HTML page
@app.get("/plaid/link", response_class=HTMLResponse)
async def serve_plaid_link(client_id: str, environment: str = "sandbox", countries: str = "US"):
    """Serve a self-contained Plaid Link HTML page"""
    
    html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connect Your Bank Account - Second Brain</title>
    <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        .container {{
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
            width: 100%;
        }}
        h1 {{
            color: #333;
            margin-bottom: 20px;
        }}
        .logo {{
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
        }}
        button {{
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            margin: 10px;
            transition: background 0.3s;
        }}
        button:hover {{
            background: #5a6fd8;
        }}
        button:disabled {{
            background: #ccc;
            cursor: not-allowed;
        }}
        .status {{
            margin: 20px 0;
            padding: 10px;
            border-radius: 6px;
            font-weight: 500;
        }}
        .success {{
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }}
        .error {{
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }}
        .info {{
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #b6d4db;
        }}
        .token-display {{
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            padding: 15px;
            margin: 15px 0;
            font-family: monospace;
            word-break: break-all;
            font-size: 14px;
        }}
        .instructions {{
            text-align: left;
            margin: 20px 0;
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid #667eea;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🏦</div>
        <h1>Connect Your Bank Account</h1>
        <p>Secure connection powered by Plaid</p>
        
        <div style="margin: 20px 0;">
            <label for="countrySelect" style="display: block; margin-bottom: 5px; font-weight: 500;">Select your country:</label>
            <select id="countrySelect" style="padding: 8px; border-radius: 4px; border: 1px solid #ddd; width: 200px;">
                <option value="US">🇺🇸 United States</option>
                <option value="CA">🇨🇦 Canada</option>
                <option value="GB">🇬🇧 United Kingdom</option>
                <option value="IE">🇮🇪 Ireland</option>
                <option value="FR">🇫🇷 France</option>
                <option value="ES">🇪🇸 Spain</option>
                <option value="NL">🇳🇱 Netherlands</option>
                <option value="DE">🇩🇪 Germany</option>
            </select>
        </div>
        
        <button id="connectButton" onclick="createLinkTokenAndStart()">
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
        const CLIENT_ID = '{client_id}';
        const ENVIRONMENT = '{environment}';
        const SERVER_URL = window.location.origin;
        
        // Set initial country selection based on URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const defaultCountries = urlParams.get('countries') || '{countries}';
        document.getElementById('countrySelect').value = defaultCountries.split(',')[0];

        function showStatus(message, type = 'info') {{
            const statusEl = document.getElementById('status');
            statusEl.textContent = message;
            statusEl.className = 'status ' + type;
            statusEl.style.display = 'block';
        }}

        function showToken(token) {{
            publicToken = token;
            document.getElementById('tokenDisplay').textContent = token;
            document.getElementById('tokenSection').style.display = 'block';
            document.getElementById('connectButton').style.display = 'none';
        }}

        function copyToken() {{
            if (publicToken) {{
                navigator.clipboard.writeText(publicToken).then(() => {{
                    showStatus('Token copied to clipboard!', 'success');
                }}).catch(() => {{
                    // Fallback for older browsers
                    const textArea = document.createElement('textarea');
                    textArea.value = publicToken;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    showStatus('Token copied to clipboard!', 'success');
                }});
            }}
        }}

        async function createLinkTokenAndStart() {{
            showStatus('Creating secure link token...', 'info');
            document.getElementById('connectButton').disabled = true;
            
            try {{
                // Get selected country
                const selectedCountry = document.getElementById('countrySelect').value;
                const countryList = [selectedCountry];
                
                // Create link token via our backend
                const response = await fetch(`${{SERVER_URL}}/plaid/link-token`, {{
                    method: 'POST',
                    headers: {{
                        'Content-Type': 'application/json',
                    }},
                    body: JSON.stringify({{
                        user_id: 'obsidian_user_' + Date.now(),
                        country_codes: countryList,
                        credentials: {{
                            client_id: CLIENT_ID,
                            secret: '', // Will be populated from backend environment
                            environment: ENVIRONMENT
                        }}
                    }})
                }});

                if (!response.ok) {{
                    throw new Error(`Failed to create link token: ${{response.statusText}}`);
                }}

                const data = await response.json();
                const linkToken = data.link_token;

                showStatus('Link token created, opening Plaid Link...', 'info');
                
                // Initialize Plaid Link
                linkHandler = Plaid.create({{
                    token: linkToken,
                    onSuccess: function(public_token, metadata) {{
                        console.log('Plaid Link Success:', public_token, metadata);
                        showStatus('Bank account connected successfully!', 'success');
                        showToken(public_token);
                    }},
                    onLoad: function() {{
                        console.log('Plaid Link loaded');
                        showStatus('Opening secure connection dialog...', 'info');
                    }},
                    onExit: function(err, metadata) {{
                        document.getElementById('connectButton').disabled = false;
                        if (err != null) {{
                            console.error('Plaid Link Error:', err, metadata);
                            showStatus('Connection failed: ' + err.error_message, 'error');
                        }} else {{
                            console.log('Plaid Link Exit:', metadata);
                            showStatus('Connection cancelled', 'info');
                        }}
                    }},
                    onEvent: function(eventName, metadata) {{
                        console.log('Plaid Link Event:', eventName, metadata);
                    }}
                }});
                
                // Open Plaid Link
                linkHandler.open();
                
            }} catch (error) {{
                console.error('Failed to start Plaid Link:', error);
                showStatus('Failed to start connection: ' + error.message, 'error');
                document.getElementById('connectButton').disabled = false;
            }}
        }}
    </script>
</body>
</html>
    """
    
    return HTMLResponse(content=html_content)

# Development endpoint to test server connection
@app.get("/test")
async def test_endpoint():
    return {
        "message": "FastAPI server is running!",
        "plaid_configured": bool(PLAID_CLIENT_ID and PLAID_SECRET),
        "environment": PLAID_ENV
    }

# Diagnostic endpoint to test Plaid SDK and credentials
@app.get("/test/plaid")
async def test_plaid():
    """Test Plaid SDK setup and credentials"""
    try:
        logger.info("Testing Plaid SDK configuration...")
        
        if not PLAID_CLIENT_ID or not PLAID_SECRET:
            return {
                "status": "error",
                "message": "Plaid credentials not configured",
                "client_id_set": bool(PLAID_CLIENT_ID),
                "secret_set": bool(PLAID_SECRET),
                "environment": PLAID_ENV
            }
        
        # Test client creation
        test_client = create_plaid_client(PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV)
        
        # Test a simple request (item/get requires access token, so we'll try link token creation)
        try:
            from plaid.model.link_token_create_request import LinkTokenCreateRequest
            from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
            from plaid.model.country_code import CountryCode
            from plaid.model.products import Products
            
            link_request = LinkTokenCreateRequest(
                client_name="Second Brain Test",
                language='en',
                country_codes=[CountryCode('US')],
                products=[Products('transactions')],
                user=LinkTokenCreateRequestUser(
                    client_user_id='test_user'
                )
            )
            
            logger.info(f"Testing link token creation with request: {link_request}")
            response = test_client.link_token_create(link_request)
            logger.info(f"Link token response type: {type(response)}")
            logger.info(f"Link token response: {response}")
            
            # Handle both dict and object responses
            if hasattr(response, 'link_token'):
                link_token = response.link_token
            elif isinstance(response, dict) and 'link_token' in response:
                link_token = response['link_token']
            else:
                logger.error(f"Unexpected response format: {response}")
                return {
                    "status": "error",
                    "message": "Unexpected response format from Plaid",
                    "response_type": str(type(response)),
                    "response_content": str(response)
                }
            
            return {
                "status": "success",
                "message": "Plaid SDK configured correctly",
                "client_id": PLAID_CLIENT_ID[:8] + "...",  # Only show first 8 chars
                "environment": PLAID_ENV,
                "test_link_token_created": bool(link_token)
            }
            
        except Exception as inner_e:
            logger.error(f"Failed to test Plaid API call: {inner_e}")
            return {
                "status": "warning",
                "message": "Plaid client created but API test failed",
                "client_id": PLAID_CLIENT_ID[:8] + "...",
                "environment": PLAID_ENV,
                "api_error": str(inner_e)
            }
            
    except Exception as e:
        logger.error(f"Plaid SDK test failed: {e}")
        return {
            "status": "error",
            "message": f"Plaid SDK test failed: {str(e)}",
            "environment": PLAID_ENV
        }

# =====================================================
# TRANSACTION BATCH STORAGE ENDPOINTS
# =====================================================

class TransactionBatchRequest(BaseModel):
    start_date: str
    end_date: str
    access_token: str
    credentials: PlaidCredentials

class TransactionBatchResponse(BaseModel):
    batch_id: str
    status: str
    total_transactions: int
    message: str

class BatchStatusResponse(BaseModel):
    batch_id: str
    status: str
    total_transactions: int
    processed_transactions: int
    created_at: str
    error_message: Optional[str] = None

@app.post("/plaid/transactions/batch", response_model=TransactionBatchResponse)
async def create_transaction_batch(request: TransactionBatchRequest):
    """
    Create a transaction batch for background processing
    This endpoint fetches transactions and stores them for gradual processing
    """
    try:
        logger.info(f"Creating transaction batch for date range: {request.start_date} to {request.end_date}")
        
        # Use credentials from request or environment
        client_id = request.credentials.client_id or PLAID_CLIENT_ID
        secret = request.credentials.secret or PLAID_SECRET
        environment = request.credentials.environment or PLAID_ENV
        
        if not client_id or not secret:
            raise HTTPException(status_code=400, detail="Plaid credentials not provided")
        
        # Create Plaid client
        client = create_plaid_client(client_id, secret, environment)
        
        # Fetch transactions from Plaid
        transactions_request = TransactionsGetRequest(
            access_token=request.access_token,
            start_date=datetime.datetime.strptime(request.start_date, '%Y-%m-%d').date(),
            end_date=datetime.datetime.strptime(request.end_date, '%Y-%m-%d').date()
        )
        
        response = client.transactions_get(transactions_request)
        
        # Debug: Log response type and structure
        logger.info(f"Plaid response type: {type(response)}")
        logger.info(f"Plaid response attributes: {dir(response) if hasattr(response, '__dict__') else 'No attributes'}")
        
        # Handle response based on SDK version - could be dict or object
        transactions = None
        if hasattr(response, 'transactions'):
            logger.info("Accessing transactions via response.transactions")
            transactions = response.transactions
        elif isinstance(response, dict) and 'transactions' in response:
            logger.info("Accessing transactions via response['transactions']")
            transactions = response['transactions']
        else:
            # Try to access as attribute first, then as dict
            try:
                logger.info("Trying response.transactions as fallback")
                transactions = response.transactions
            except AttributeError:
                try:
                    logger.info("Trying response['transactions'] as fallback")
                    transactions = response['transactions']
                except (KeyError, TypeError) as e:
                    logger.error(f"Could not access transactions from response: {e}")
                    logger.error(f"Response content: {response}")
                    raise ValueError(f"Could not access transactions from Plaid response: {e}")
        
        if transactions is None:
            raise ValueError("No transactions found in Plaid response")
            
        logger.info(f"Found {len(transactions)} transactions")
        if len(transactions) > 0:
            logger.info(f"First transaction type: {type(transactions[0])}")
            logger.info(f"First transaction attributes: {dir(transactions[0]) if hasattr(transactions[0], '__dict__') else 'No attributes'}")
        
        # Generate batch ID
        batch_id = f"batch_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{len(transactions)}"
        
        # Store batch in database
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        # Insert batch record
        cursor.execute("""
            INSERT INTO transaction_batches 
            (id, status, created_at, total_transactions, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            batch_id,
            'pending',
            datetime.datetime.now().isoformat(),
            len(transactions),
            request.start_date,
            request.end_date
        ))
        
        # Insert individual transactions (with deduplication)
        new_transactions = 0
        duplicate_transactions = 0
        
        for transaction in transactions:
            # Convert Plaid transaction object to dictionary for JSON serialization
            try:
                if hasattr(transaction, 'to_dict'):
                    logger.info(f"Converting transaction using to_dict() method")
                    transaction_dict = transaction.to_dict()
                elif hasattr(transaction, '__dict__'):
                    logger.info(f"Converting transaction using __dict__")
                    transaction_dict = dict(transaction.__dict__)
                elif isinstance(transaction, dict):
                    logger.info(f"Transaction is already a dict")
                    transaction_dict = transaction
                else:
                    logger.info(f"Converting transaction using dict() constructor")
                    transaction_dict = dict(transaction)
                
                transaction_id = transaction_dict.get('transaction_id')
                logger.info(f"Processing transaction ID: {transaction_id}")
                
                if not transaction_id:
                    logger.error(f"No transaction_id found in transaction_dict keys: {list(transaction_dict.keys())}")
                    continue
                
                # Debug: Log transaction_dict structure for the first transaction
                if new_transactions == 0:
                    logger.info(f"Sample transaction_dict keys: {list(transaction_dict.keys())}")
                    logger.info(f"Sample transaction_dict types: {[(k, type(v)) for k, v in transaction_dict.items()]}")
                
            except Exception as conversion_error:
                logger.error(f"Failed to convert transaction to dict: {conversion_error}")
                logger.error(f"Transaction type: {type(transaction)}")
                logger.error(f"Transaction content: {transaction}")
                continue
            
            # Check if transaction already exists
            cursor.execute("""
                SELECT id FROM transactions WHERE id = ?
            """, (transaction_id,))
            
            if cursor.fetchone():
                duplicate_transactions += 1
                logger.info(f"Skipping duplicate transaction: {transaction_id}")
                continue
            
            cursor.execute("""
                INSERT INTO transactions 
                (id, batch_id, transaction_data, created_at)
                VALUES (?, ?, ?, ?)
            """, (
                transaction_id,
                batch_id,
                json.dumps(transaction_dict, cls=PlaidJSONEncoder),
                datetime.datetime.now().isoformat()
            ))
            new_transactions += 1
        
        # Update batch with actual new transaction count
        cursor.execute("""
            UPDATE transaction_batches 
            SET total_transactions = ?
            WHERE id = ?
        """, (new_transactions, batch_id))
        
        conn.commit()
        conn.close()
        
        logger.info(f"Created batch {batch_id} with {new_transactions} new transactions ({duplicate_transactions} duplicates skipped)")
        
        return TransactionBatchResponse(
            batch_id=batch_id,
            status='pending',
            total_transactions=new_transactions,
            message=f"Batch created successfully with {new_transactions} new transactions ({duplicate_transactions} duplicates skipped)"
        )
        
    except Exception as e:
        logger.error(f"Failed to create transaction batch: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create transaction batch: {str(e)}")

@app.get("/plaid/transactions/batch/{batch_id}/status", response_model=BatchStatusResponse)
async def get_batch_status(batch_id: str):
    """Get the status of a transaction batch"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, status, total_transactions, processed_transactions, created_at, error_message
            FROM transaction_batches
            WHERE id = ?
        """, (batch_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            raise HTTPException(status_code=404, detail=f"Batch {batch_id} not found")
        
        return BatchStatusResponse(
            batch_id=row[0],
            status=row[1],
            total_transactions=row[2],
            processed_transactions=row[3],
            created_at=row[4],
            error_message=row[5]
        )
        
    except Exception as e:
        logger.error(f"Failed to get batch status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get batch status: {str(e)}")

@app.get("/plaid/transactions/batch/{batch_id}/transactions")
async def get_batch_transactions(batch_id: str, limit: int = 50, offset: int = 0, processed: Optional[bool] = None):
    """Get transactions from a batch with pagination"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        # Build query based on processed filter
        if processed is not None:
            cursor.execute("""
                SELECT id, transaction_data, processed, created_at
                FROM transactions
                WHERE batch_id = ? AND processed = ?
                ORDER BY created_at
                LIMIT ? OFFSET ?
            """, (batch_id, processed, limit, offset))
        else:
            cursor.execute("""
                SELECT id, transaction_data, processed, created_at
                FROM transactions
                WHERE batch_id = ?
                ORDER BY created_at
                LIMIT ? OFFSET ?
            """, (batch_id, limit, offset))
        
        rows = cursor.fetchall()
        conn.close()
        
        transactions = []
        for row in rows:
            transaction_data = json.loads(row[1])
            transactions.append({
                'id': row[0],
                'data': transaction_data,
                'processed': bool(row[2]),
                'created_at': row[3]
            })
        
        return {
            'batch_id': batch_id,
            'transactions': transactions,
            'limit': limit,
            'offset': offset,
            'count': len(transactions)
        }
        
    except Exception as e:
        logger.error(f"Failed to get batch transactions: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get batch transactions: {str(e)}")

@app.post("/plaid/transactions/batch/{batch_id}/mark-processed")
async def mark_transactions_processed(batch_id: str, transaction_ids: List[str]):
    """Mark specific transactions as processed"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        # Mark transactions as processed
        for transaction_id in transaction_ids:
            cursor.execute("""
                UPDATE transactions 
                SET processed = TRUE 
                WHERE batch_id = ? AND id = ?
            """, (batch_id, transaction_id))
        
        # Update batch processed count
        cursor.execute("""
            UPDATE transaction_batches 
            SET processed_transactions = (
                SELECT COUNT(*) FROM transactions 
                WHERE batch_id = ? AND processed = TRUE
            )
            WHERE id = ?
        """, (batch_id, batch_id))
        
        # Check if batch is complete
        cursor.execute("""
            SELECT total_transactions, processed_transactions 
            FROM transaction_batches 
            WHERE id = ?
        """, (batch_id,))
        
        row = cursor.fetchone()
        if row and row[0] == row[1]:  # total == processed
            cursor.execute("""
                UPDATE transaction_batches 
                SET status = 'completed' 
                WHERE id = ?
            """, (batch_id,))
        
        conn.commit()
        conn.close()
        
        return {
            'batch_id': batch_id,
            'marked_processed': len(transaction_ids),
            'message': f'Marked {len(transaction_ids)} transactions as processed'
        }
        
    except Exception as e:
        logger.error(f"Failed to mark transactions as processed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to mark transactions as processed: {str(e)}")

@app.get("/plaid/transactions/batches")
async def list_transaction_batches(status: Optional[str] = None, limit: int = 20):
    """List transaction batches with optional status filter"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        if status:
            cursor.execute("""
                SELECT id, status, total_transactions, processed_transactions, created_at, start_date, end_date
                FROM transaction_batches
                WHERE status = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, (status, limit))
        else:
            cursor.execute("""
                SELECT id, status, total_transactions, processed_transactions, created_at, start_date, end_date
                FROM transaction_batches
                ORDER BY created_at DESC
                LIMIT ?
            """, (limit,))
        
        rows = cursor.fetchall()
        conn.close()
        
        batches = []
        for row in rows:
            batches.append({
                'batch_id': row[0],
                'status': row[1],
                'total_transactions': row[2],
                'processed_transactions': row[3],
                'created_at': row[4],
                'start_date': row[5],
                'end_date': row[6],
                'progress_percentage': (row[3] / row[2] * 100) if row[2] > 0 else 0
            })
        
        return {
            'batches': batches,
            'count': len(batches)
        }
        
    except Exception as e:
        logger.error(f"Failed to list transaction batches: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list transaction batches: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
