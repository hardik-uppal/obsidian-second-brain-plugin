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

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
                "link_token_created": bool(link_token),
                "response_type": str(type(response))
            }
            
        except Exception as sdk_error:
            error_msg = handle_plaid_error(sdk_error)
            logger.error(f"Plaid SDK test failed: {error_msg}")
            return {
                "status": "error",
                "message": "Plaid SDK test failed",
                "error": error_msg,
                "client_id": PLAID_CLIENT_ID[:8] + "...",
                "environment": PLAID_ENV
            }
            
    except Exception as e:
        logger.error(f"Plaid diagnostic test failed: {str(e)}")
        return {
            "status": "error",
            "message": "Failed to test Plaid configuration",
            "error": str(e)
        }



if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "localhost")
    
    logger.info(f"Starting Second Brain Plaid Proxy on {host}:{port}")
    logger.info(f"Plaid Environment: {PLAID_ENV}")
    logger.info(f"Plaid Client ID configured: {bool(PLAID_CLIENT_ID)}")
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,
        log_level="info"
    )
