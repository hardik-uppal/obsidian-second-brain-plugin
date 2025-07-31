# Second Brain Integration Plugin for Obsidian

A comprehensive Obsidian plugin that transforms your vault into a unified "second brain" by automatically ingesting and organizing transactions, calendar events, and tasks with AI-powered parsing and graph intelligence.

## Features

### 🏗️ Core Features

- **Vault Initialization**: Automatically creates organized folder structure (`/notes`, `/transactions`, `/events`, `/tasks`, `/templates`)
- **API Authentication**: Secure OAuth flows for Plaid and Google Calendar integration
- **Data Synchronization**: Background or on-demand sync of transactions, events, and tasks
- **ML-Powered Parsing**: Configurable LLM integration (OpenAI, Anthropic, or custom endpoints) to transform raw data into structured markdown
- **Dataview Compatibility**: All notes use frontmatter fields readable by Dataview for powerful queries

### 🔄 Data Sources

- **Plaid Integration**: Automatic transaction import from connected bank accounts
- **Google Calendar**: Sync calendar events with full OAuth support
- **Task Management**: Integration with Todoist or Obsidian Tasks plugin
- **JSON Import**: Manual import of structured data via Command Palette

### 🧠 Intelligence Features

- **Graph Suggestions**: AI-powered backlink and tag suggestions with user feedback
- **Graph Export**: Export vault structure in JSON, CSV, or PyTorch Geometric formats
- **Usage Analytics**: Track plugin usage and suggestion effectiveness
- **Bulk Import**: Support for historical data import with performance tracking

### 🎨 UI/UX Integration

- **Command Palette**: All major functions accessible via commands
- **Chat Interface**: Interactive AI assistant for vault queries and knowledge management
- **Sidebar Panel**: Recent items browser with search and filtering
- **Inline Actions**: `Summarize`, `Redact`, `Suggest Links` buttons within notes
- **Frontmatter Watchers**: Automatic sync of changes back to source systems
- **Ribbon Icons**: Quick access to main features and chat interface

## Installation

### Prerequisites

1. **Obsidian** (minimum version 0.15.0)
2. **Required Plugins** (will be checked during initialization):
   - Dataview (essential)
   - Tasks (essential)
   - Calendar (recommended)
   - Templater (recommended)

### Install from Source

1. Clone this repository to your Obsidian plugins folder:
   ```bash
   cd /path/to/your/vault/.obsidian/plugins/
   git clone https://github.com/hardik-uppal/obsidian-second-brain-plugin.git
   cd obsidian-second-brain-plugin
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Enable the plugin in Obsidian Settings → Community Plugins

## Configuration

### 1. LLM Configuration

Configure your preferred LLM provider in plugin settings:

- **OpenAI**: Requires API key
- **Anthropic**: Requires API key  
- **Custom Endpoint**: Requires endpoint URL and API key

### 2. Plaid Setup (Financial Transactions)

1. Create a Plaid developer account at [plaid.com/developers](https://plaid.com/developers)
2. Get your Client ID and Secret Key
3. Configure in plugin settings:
   - Client ID
   - Secret Key
   - Environment (sandbox/development/production)
4. Use the OAuth flow to connect your bank accounts

### 3. Google Calendar Setup

**Option A: API Key (Read-only)**
1. Create a Google Cloud project
2. Enable the Calendar API
3. Create an API key
4. Configure in plugin settings

**Option B: OAuth (Full access)**
1. Create OAuth 2.0 credentials in Google Cloud Console
2. Configure redirect URI
3. Paste credentials JSON in plugin settings
4. Complete OAuth flow

### 4. Tasks Integration

- **Obsidian Tasks Plugin**: Automatically detected if installed
- **Todoist**: Requires API token configuration

## Usage

### Initial Setup

1. **Initialize Vault**: Run `Second Brain: Initialize Vault Structure` from Command Palette
2. **Configure APIs**: Set up your API keys in plugin settings
3. **Test Connections**: Run `Second Brain: Test API Connections` to verify setup

### Daily Workflow

1. **Sync Data**: 
   - `Second Brain: Sync Transactions from Plaid`
   - `Second Brain: Sync Calendar Events`
   - Or enable automatic background sync

2. **Review Generated Notes**: Check the organized folders for new notes with AI-generated tags and suggestions

3. **Manual Import**: Use `Second Brain: Import JSON Data` for one-off data imports

4. **Chat with Your Data**: Use `Second Brain: Open Second Brain Chat` or click the chat ribbon icon to interact with your knowledge base

5. **Export Analysis**: Use `Second Brain: Export Graph Data` for external analysis

### Templates

The plugin creates and uses these templates:

- **Transaction Template**: Financial transaction with merchant, amount, category
- **Event Template**: Calendar event with attendees, location, time
- **Task Template**: Task with priority, due date, project
- **Note Template**: General note with tags and relationships

### Dataview Queries

Example queries you can use with the generated data:

```dataview
TABLE amount, merchant, category
FROM "transactions"
WHERE date >= date(today) - dur(30 days)
SORT date DESC
```

```dataview
CALENDAR date
FROM "events"
WHERE date >= date(today)
```

```dataview
TASK
FROM "tasks"
WHERE !completed
SORT priority DESC, due_date ASC
```

## Graph Export Formats

### JSON Format
Standard graph structure with nodes and edges:
```json
{
  "nodes": [...],
  "edges": [...],
  "metadata": {...}
}
```

### PyTorch Geometric Format
Optimized for machine learning workflows:
```json
{
  "x": [...],
  "edge_index": [...],
  "metadata": {...}
}
```

### CSV Format
Simple tabular format for spreadsheet analysis.

## Development

### Project Structure

```
├── main.ts                 # Main plugin file
├── manifest.json          # Plugin manifest
├── src/
│   ├── types.ts           # TypeScript interfaces
│   ├── services/          # External API services
│   │   ├── llm-service.ts
│   │   ├── plaid-service.ts
│   │   └── calendar-service.ts
│   ├── vault/             # Vault management
│   │   └── initializer.ts
│   ├── utils/             # Utilities
│   │   └── templates.ts
│   └── ui/                # UI components
├── templates/             # Note templates
└── README.md
```

### Build Commands

- `npm run dev` - Development build with watch mode
- `npm run build` - Production build
- `npm run version` - Bump version and update manifest

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Privacy & Security

- **API Keys**: Stored locally in Obsidian settings, never transmitted to third parties
- **Data Processing**: LLM processing can be disabled or configured to use local endpoints
- **Sync Data**: All synced data remains in your local Obsidian vault
- **Analytics**: Usage analytics are anonymized and optional

## Troubleshooting

### Common Issues

1. **Plugin won't load**: Check Obsidian version compatibility (minimum 0.15.0)
2. **API connection failed**: Verify API keys and network connectivity
3. **Sync not working**: Check API rate limits and authentication status
4. **Missing dependencies**: Install required plugins (Dataview, Tasks)

### Debug Mode

Enable debug logging in plugin settings to troubleshoot issues.

### Support

- **Issues**: Report bugs on GitHub Issues
- **Discussions**: Join community discussions
- **Documentation**: Check the wiki for detailed guides

## Roadmap

- [ ] **Enhanced AI Features**: More sophisticated graph analysis and suggestions
- [ ] **Additional Integrations**: Support for more financial institutions and calendar providers
- [ ] **Mobile Support**: Optimized mobile experience
- [ ] **Collaboration Features**: Shared vault synchronization
- [ ] **Advanced Analytics**: Built-in dashboard for personal insights

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Obsidian team for the excellent plugin API
- Plaid for financial data integration
- Google for Calendar API
- OpenAI and Anthropic for LLM capabilities

---

**Note**: This plugin is in active development. Please report any issues or feature requests on GitHub.
