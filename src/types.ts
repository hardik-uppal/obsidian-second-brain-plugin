// Core interfaces for the Second Brain Integration Plugin

export interface PluginSettings {
	// LLM Configuration
	llmProvider: 'openai' | 'anthropic' | 'custom';
	llmApiKey: string;
	llmEndpoint?: string; // For custom providers
	llmModel: string;

	// Plaid Configuration
	plaidClientId: string;
	plaidSecret: string;
	plaidAccessId: string; // Required for API calls
	plaidEnvironment: 'sandbox' | 'development' | 'production';
	plaidAccessToken?: string;

	// Google Calendar Configuration (OAuth2 only)
	googleCalendarClientId: string;
	googleCalendarClientSecret: string;
	googleCalendarRedirectUri: string;
	googleCalendarId: string;
	googleCalendarTokens?: string; // JSON string of access/refresh tokens

	// Tasks Configuration
	tasksPluginEnabled: boolean;
	todoistApiKey?: string; // Optional external task source

	// Vault Configuration
	notesFolder: string;
	transactionsFolder: string;
	eventsFolder: string;
	tasksFolder: string;
	templatesFolder: string;

	// Sync Settings
	lastTransactionSync?: string;
	lastEventSync?: string;
	lastTaskSync?: string;

	// Graph Export Settings
	exportFormat: 'json' | 'pytorch' | 'csv';
	includeContent: boolean;
	includeMetadata: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	llmProvider: 'openai',
	llmApiKey: '',
	llmModel: 'gpt-4o',
	
	plaidClientId: '',
	plaidSecret: '',
	plaidAccessId: '',
	plaidEnvironment: 'sandbox',
	
	googleCalendarClientId: '',
	googleCalendarClientSecret: '',
	googleCalendarRedirectUri: 'http://localhost:8080/callback',
	googleCalendarId: 'primary',
	
	tasksPluginEnabled: true,
	
	notesFolder: 'notes',
	transactionsFolder: 'transactions',
	eventsFolder: 'events',
	tasksFolder: 'tasks',
	templatesFolder: 'templates',
	
	exportFormat: 'json',
	includeContent: true,
	includeMetadata: true
};

// Data Types
export interface Transaction {
	id: string;
	date: string;
	amount: number;
	merchant: string;
	category: string;
	account: string;
	description: string;
	tags: string[];
	rawData?: any;
}

export interface CalendarEvent {
	id: string;
	title: string;
	date: string;
	startTime: string;
	endTime: string;
	location?: string;
	description?: string;
	attendees: string[];
	tags: string[];
	rawData?: any;
}

export interface Task {
	id: string;
	title: string;
	description?: string;
	dueDate?: string;
	priority: 'low' | 'medium' | 'high';
	completed: boolean;
	project?: string;
	tags: string[];
	rawData?: any;
}

// LLM Service Types
export interface LLMRequest {
	prompt: string;
	data: any;
	type: 'transaction' | 'event' | 'task' | 'suggestion';
}

export interface LLMResponse {
	success: boolean;
	data?: any;
	error?: string;
}

export interface ParsedData {
	title: string;
	content: string;
	frontmatter: Record<string, any>;
	tags: string[];
	suggestions?: string[];
}

// Graph Export Types
export interface GraphNode {
	id: string;
	title: string;
	type: 'note' | 'transaction' | 'event' | 'task';
	content?: string;
	tags: string[];
	frontmatter: Record<string, any>;
	created: string;
	modified: string;
	path: string;
}

export interface GraphEdge {
	source: string;
	target: string;
	type: 'backlink' | 'tag' | 'folder' | 'temporal';
	weight?: number;
}

export interface GraphExport {
	nodes: GraphNode[];
	edges: GraphEdge[];
	metadata: {
		exportDate: string;
		totalNodes: number;
		totalEdges: number;
		nodeTypes: Record<string, number>;
		format: string;
	};
}

// Template Types
export interface NoteTemplate {
	name: string;
	type: 'transaction' | 'event' | 'task' | 'note';
	frontmatter: string;
	content: string;
}

// Sync Status
export interface SyncStatus {
	isRunning: boolean;
	lastSync?: string;
	itemsProcessed: number;
	errors: string[];
}

// Plugin State
export interface PluginState {
	initialized: boolean;
	dependenciesChecked: boolean;
	syncStatus: {
		transactions: SyncStatus;
		events: SyncStatus;
		tasks: SyncStatus;
	};
}
