# Backend Setup Guide

## Latest Update - Plaid SDK v35.0.0

This backend has been updated to use the **latest Plaid Python SDK v35.0.0** with:
- Modern Configuration and Environment classes
- Enhanced error handling with structured Plaid API errors
- Proper API version headers (2020-09-14)
- Removed deprecated development environment
- Better type safety and validation

## Quick Start

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```

2. **Run the setup script:**
   ```bash
   ./start.sh
   ```

3. **Configure your Plaid credentials:**
   - Copy `.env.example` to `.env`
   - Edit `.env` with your Plaid credentials:
     ```
     PLAID_CLIENT_ID=your_plaid_client_id_here
     PLAID_SECRET=your_plaid_secret_here
     PLAID_ENV=sandbox  # or production (development removed)
     ```

4. **The server will start on http://localhost:8000**

## Manual Setup (Alternative)

If the automatic script doesn't work:

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env
# Edit .env with your credentials

# Start server
python main.py
```

## Testing the Backend

Once running, you can test the backend:

1. **Health check:** http://localhost:8000/health
2. **API documentation:** http://localhost:8000/docs
3. **Test endpoint:** http://localhost:8000/test

## Plaid Credentials

To get your Plaid credentials:

1. Sign up at https://plaid.com/
2. Create a new application
3. Get your Client ID and Secret from the dashboard
4. Start with "sandbox" environment for testing

## Testing the Updated Backend

Test the new SDK integration with:

```bash
# Test basic functionality
python test_updated_backend.py

# Or test manually
curl http://localhost:8000/health
curl http://localhost:8000/test
```

Expected improvements:
- Better error messages with Plaid error codes
- Enhanced type safety and validation
- Modern API configuration
- Support for latest Plaid features

## Integration with Obsidian

The Obsidian plugin will automatically connect to this backend when you:
1. Start the backend server
2. Use the "Connect Bank Account" feature in the plugin
3. The plugin will open a browser page served by this backend
4. Complete the Plaid Link flow in the browser
5. Copy the token back to Obsidian

## Security Notes

- **Recommended**: Store Plaid credentials in the backend `.env` file for better security
- The server will use environment variables when available, falling back to credentials passed in requests
- CORS is configured for Obsidian desktop app origin (`app://obsidian.md`)
- For production use, implement proper authentication and restrict CORS origins
- Never commit your `.env` file with real credentials to version control

## Troubleshooting

- **Port 8000 already in use:** Change the PORT in `.env` file
- **CORS errors:** The backend is configured for Obsidian's origin (`app://obsidian.md`)
- **Plaid errors:** Check your credentials and environment settings
- **Python issues:** Ensure Python 3.7+ is installed
