# Development Guide - Second Brain Integration Plugin

## Project Overview

This Obsidian plugin implements a comprehensive "Second Brain" system that automatically ingests and organizes personal data from multiple sources using AI-powered parsing and graph intelligence.

## Architecture

### Core Components

1. **Main Plugin (`main.ts`)**
   - Plugin lifecycle management
   - Command registration
   - Settings management
   - Service coordination

2. **Services (`src/services/`)**
   - `llm-service.ts`: Configurable LLM integration (OpenAI, Anthropic, custom)
   - `plaid-service.ts`: Financial transaction integration
   - `calendar-service.ts`: Google Calendar integration

3. **Vault Management (`src/vault/`)**
   - `initializer.ts`: Vault structure setup and sample data creation

4. **Utilities (`src/utils/`)**
   - `templates.ts`: Note template engine and data processors

5. **Types (`src/types.ts`)**
   - TypeScript interfaces and type definitions

## Key Features Implemented

### ✅ Core Features
- [x] Vault initialization with folder structure
- [x] Template system for different note types
- [x] LLM service integration (OpenAI, Anthropic, custom)
- [x] Plaid API integration for transactions
- [x] Google Calendar API integration
- [x] Settings UI with configuration options
- [x] Command palette integration
- [x] Graph data export (JSON, CSV, PyTorch Geometric)
- [x] Connection testing utilities

### ✅ Data Processing
- [x] Transaction parsing and note generation
- [x] Calendar event parsing and note generation
- [x] Template-based content generation
- [x] Frontmatter standardization for Dataview compatibility
- [x] JSON import functionality

### ✅ Build System
- [x] TypeScript compilation
- [x] ESBuild bundling
- [x] Development and production builds
- [x] Version management
- [x] Dependency management

## File Structure

```
obsidian-second-brain-integration/
├── main.ts                     # Main plugin entry point
├── manifest.json              # Plugin manifest
├── package.json               # NPM configuration
├── tsconfig.json              # TypeScript configuration
├── esbuild.config.mjs         # Build configuration
├── version-bump.mjs           # Version management utility
├── versions.json              # Version compatibility
├── README.md                  # User documentation
├── DEVELOPMENT.md             # This file
├── src/
│   ├── types.ts              # TypeScript interfaces
│   ├── services/             # External API integrations
│   │   ├── llm-service.ts    # LLM provider abstraction
│   │   ├── plaid-service.ts  # Financial data integration
│   │   └── calendar-service.ts # Calendar integration
│   ├── vault/                # Vault management
│   │   └── initializer.ts    # Setup and initialization
│   ├── utils/                # Utility functions
│   │   └── templates.ts      # Template engine
│   └── ui/                   # UI components (placeholder)
└── templates/                # Note templates (created at runtime)
```

## Development Workflow

### Setup
```bash
npm install
```

### Development Build (with watch)
```bash
npm run dev
```

### Production Build
```bash
npm run build
```

### Version Bump
```bash
npm version patch|minor|major
```

## API Integrations

### LLM Service
- **Providers**: OpenAI, Anthropic, Custom endpoints
- **Functions**: Transaction parsing, event parsing, suggestion generation
- **Configuration**: API keys, model selection, custom endpoints

### Plaid Integration
- **Features**: Account linking, transaction fetching, OAuth flow
- **Configuration**: Client ID, Secret, Environment, Access tokens
- **Data Flow**: Raw transactions → LLM parsing → Markdown notes

### Google Calendar
- **Features**: Event fetching, OAuth support, calendar selection
- **Configuration**: API keys or OAuth credentials, Calendar ID
- **Data Flow**: Calendar events → LLM parsing → Markdown notes

## Template System

### Template Types
1. **Transaction**: Financial transaction with merchant, amount, category
2. **Event**: Calendar event with attendees, location, time
3. **Task**: Task with priority, due date, project
4. **Note**: General note with tags and relationships

### Template Engine
- Variable substitution with `{{variable}}` syntax
- Type-specific data processors
- Frontmatter generation for Dataview compatibility
- Content formatting and cleanup

## Settings Management

### Configuration Categories
1. **LLM Settings**: Provider, API key, model, endpoint
2. **Plaid Settings**: Client ID, secret, environment, access token
3. **Calendar Settings**: API key, credentials, calendar ID
4. **Vault Settings**: Folder paths, sync timestamps
5. **Export Settings**: Format preferences, content inclusion

## Command Integration

### Available Commands
- `initialize-vault`: Set up folder structure and templates
- `sync-transactions`: Fetch and process new transactions
- `sync-events`: Fetch and process calendar events
- `import-json`: Manual JSON data import
- `export-graph`: Export vault graph structure
- `test-connections`: Verify API connectivity

## Graph Export Formats

### JSON Format
Standard graph structure with nodes, edges, and metadata.

### PyTorch Geometric Format
Optimized for machine learning workflows with feature matrices and edge indices.

### CSV Format
Tabular format for spreadsheet analysis and external tools.

## Error Handling

### Service Level
- Connection testing and validation
- Graceful degradation when APIs are unavailable
- Error logging and user notifications

### Data Processing
- Validation of imported data
- Fallback templates when LLM processing fails
- Duplicate detection and handling

## Security Considerations

### API Key Storage
- Local storage in Obsidian settings
- No transmission to third parties
- Secure credential handling

### Data Privacy
- All processing happens locally
- Optional LLM processing
- User control over data export

## Testing Strategy

### Manual Testing
1. Plugin loading and initialization
2. API connection testing
3. Data sync functionality
4. Template generation
5. Export functionality

### Integration Testing
- Test with real API endpoints (sandbox mode)
- Verify data flow from API to notes
- Check Dataview compatibility

## Future Enhancements

### Planned Features
- [ ] Sidebar panel for recent items
- [ ] Inline action buttons in notes
- [ ] Frontmatter watchers for two-way sync
- [ ] Task integration (Todoist, Tasks plugin)
- [ ] Graph suggestions with ML
- [ ] Usage analytics
- [ ] Bulk import functionality

### Technical Improvements
- [ ] Unit test coverage
- [ ] Error recovery mechanisms
- [ ] Performance optimization
- [ ] Mobile compatibility
- [ ] Plugin dependency management

## Troubleshooting

### Common Issues
1. **Build Failures**: Check TypeScript errors, dependency versions
2. **API Errors**: Verify credentials, network connectivity, rate limits
3. **Template Issues**: Check variable substitution, frontmatter format
4. **Sync Problems**: Verify timestamps, duplicate handling

### Debug Tools
- Console logging throughout services
- Connection test utilities
- Settings validation
- Error notification system

## Contributing

### Code Style
- TypeScript with strict null checks
- ESLint configuration included
- Consistent naming conventions
- Comprehensive error handling

### Pull Request Process
1. Fork repository
2. Create feature branch
3. Implement changes with tests
4. Update documentation
5. Submit pull request

## Performance Considerations

### Optimization Areas
- Batch processing for large data sets
- Incremental sync to avoid duplicates
- Efficient template rendering
- Memory management for large vaults

### Monitoring
- Sync duration tracking
- Error rate monitoring
- User feedback collection
- Performance metrics

---

This plugin provides a solid foundation for a comprehensive second brain system in Obsidian, with extensible architecture and robust API integrations.
