# Second Brain FastAPI Backend

This FastAPI server acts as a proxy for Plaid API calls to avoid CORS issues when calling Plaid from the Obsidian desktop app.

## Features

- **Latest Plaid SDK (v35.0.0)** with modern configuration
- Plaid Link token creation with multi-country support
- Public token exchange for access tokens  
- Account and transaction fetching
- CORS-enabled for Obsidian desktop app
- Self-contained Plaid Link HTML interface with country selection
- Secure credential handling with environment variables
- Enhanced error handling for Plaid API errors
- Support for US, CA, GB, IE, FR, ES, NL, DE markets
- Compatible with Plaid API version 2020-09-14

## Setup

1. **Install Python dependencies:**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Plaid credentials
   ```

3. **Run the server:**
   ```bash
   python main.py
   ```
   
   Or with uvicorn directly:
   ```bash
   uvicorn main:app --reload --host localhost --port 8000
   ```

## Environment Variables

- `PLAID_CLIENT_ID`: Your Plaid client ID
- `PLAID_SECRET`: Your Plaid secret key
- `PLAID_ENV`: Environment (sandbox, development, production)
- `PORT`: Server port (default: 8000)
- `HOST`: Server host (default: localhost)

## API Endpoints

### Health Check
- `GET /` - Service info
- `GET /health` - Health check
- `GET /test` - Test endpoint

### Plaid Integration
- `POST /plaid/link-token` - Create Plaid Link token
- `POST /plaid/exchange-token` - Exchange public token for access token
- `POST /plaid/accounts` - Get bank accounts
- `POST /plaid/transactions` - Get transactions
- `GET /plaid/link` - Serve Plaid Link HTML interface

## Technical Details

### Plaid SDK Version
- **Plaid Python SDK v35.0.0** (latest as of 2025)
- Uses modern Configuration and Environment classes
- Proper API version handling with plaidVersion header
- Enhanced error handling with structured Plaid error responses
- Removed deprecated development environment

### Improvements in Latest Version
- Better type safety and validation
- Improved error messages with error codes and types
- Modern authentication flow with proper host configuration
- Support for latest Plaid API features

## Usage with Obsidian Plugin

1. Start the FastAPI server
2. Update your Obsidian plugin settings to use the proxy server
3. The plugin will make requests to `http://localhost:8000` instead of directly to Plaid

## Security Notes

- The server accepts credentials in API requests rather than storing them
- CORS is configured for Obsidian desktop app origin
- For production use, implement proper authentication and credential storage
- Never commit your `.env` file with real credentials

## Future Extensions

This server is designed to be extended for additional features:
- Graph data processing
- AI/ML model integration
- Advanced transaction analysis
- Custom data pipelines
