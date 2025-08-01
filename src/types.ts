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
	plaidEnvironment: 'sandbox' | 'production';
	plaidAccessToken?: string;

	// Google Calendar Configuration (OAuth2 only)
	googleCalendarClientId: string;
	googleCalendarClientSecret: string;

	// Master Calendar Settings
	masterCalendar: MasterCalendarSettings;

	// Tasks Configuration
	tasksPluginEnabled: boolean;
	todoistApiKey?: string; // Optional external task source

	// Vault Configuration
	notesFolder: string;
	transactionsFolder: string;
	eventsFolder: string;
	tasksFolder: string;
	templatesFolder: string;
	chatsFolder: string;

	// Sync Settings
	lastTransactionSync?: string;
	lastEventSync?: string;
	lastTaskSync?: string;

	// Graph Export Settings
	exportFormat: 'json' | 'pytorch' | 'csv';
	includeContent: boolean;
	includeMetadata: boolean;

	// Suggestion System Settings
	suggestionSystem: SuggestionSystemSettings;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	llmProvider: 'openai',
	llmApiKey: '',
	llmModel: 'gpt-4o',
	
	plaidClientId: '',
	plaidSecret: '',
	plaidAccessToken: '',
	plaidEnvironment: 'sandbox',
	
	googleCalendarClientId: '',
	googleCalendarClientSecret: '',
	masterCalendar: {
		// enabled: true,
		googleAccounts: [],
		selectedCalendars: [],
		syncSettings: {
			syncRange: 'month',
			customStartDate: undefined,
			customEndDate: undefined,
			conflictResolution: 'manual',
			autoSync: false,
			syncInterval: 60,
			maxEventsPerSync: 500
		},
		eventSettings: {
			createEventNotes: true,
			eventNotesFolder: 'events',
			useEventTemplates: true,
			templateFolder: 'templates/events',
			eventNoteNameFormat: '{{title}} - {{date}}'
		},
		viewSettings: {
			defaultView: 'month',
			showWeekNumbers: true,
			firstDayOfWeek: 0,
			timeFormat: '24h',
			showDeclinedEvents: false,
			compactView: false
		}
	},
	
	tasksPluginEnabled: true,
	
	notesFolder: 'notes',
	transactionsFolder: 'transactions',
	eventsFolder: 'events',
	tasksFolder: 'tasks',
	templatesFolder: 'templates',
	chatsFolder: 'chats',
	
	exportFormat: 'json',
	includeContent: true,
	includeMetadata: true,
	suggestionSystem: {
		enabled: true,
		autoApproveHighConfidence: false,
		highConfidenceThreshold: 0.85,
		createSummaryLogs: true,
		storageLocation: '.suggestions',
		maxPendingSuggestions: 100,
		batchProcessing: true,
		notifyOnNewSuggestions: true
	}
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
	// Multiple calendar support fields
	sourceCalendarId: string;
	sourceCalendarName: string;
	lastModified: string;
	obsidianPath?: string; // Path to the note in Obsidian
	syncStatus: 'synced' | 'conflict' | 'error' | 'pending';
	conflictsWith?: string[]; // IDs of conflicting events
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
	type: 'transaction' | 'event' | 'task' | 'suggestion' | 'chat';
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

// Chat Thread Management Types
export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: string;
}

export interface ChatThread {
	id: string;
	title: string;
	messages: ChatMessage[];
	startTime: string;
	endTime?: string;
	status: 'active' | 'ended' | 'archived';
	relatedNotes?: string[];
	totalMessages: number;
	lastActivity: string;
}

export interface ChatThreadSummary {
	threadId: string;
	keyTopics: string[];
	actionItems: string[];
	decisions: string[];
	insights: string[];
	suggestedTitle: string;
	shouldCreateNote: boolean;
	noteType: 'meeting-notes' | 'brainstorm' | 'decision-log' | 'action-plan' | 'general';
	confidence: number;
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

// Plaid Link SDK Types
declare global {
	interface Window {
		Plaid?: {
			create: (options: PlaidLinkOptions) => PlaidLinkHandler;
		};
	}
}

export interface PlaidLinkOptions {
	token: string;
	onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
	onLoad?: () => void;
	onExit?: (error: PlaidLinkError | null, metadata: PlaidLinkMetadata) => void;
	onEvent?: (eventName: string, metadata: PlaidLinkMetadata) => void;
	receivedRedirectUri?: string;
}

export interface PlaidLinkHandler {
	open: () => void;
	exit: (options?: { force: boolean }) => void;
	destroy: () => void;
}

export interface PlaidLinkMetadata {
	institution?: {
		institution_id: string;
		name: string;
	};
	accounts: Array<{
		account_id: string;
		name: string;
		mask: string;
		type: string;
		subtype: string;
	}>;
	link_session_id: string;
	transfer_status?: string;
}

export interface PlaidLinkError {
	error_type: string;
	error_code: string;
	error_message: string;
	display_message?: string;
}

// Calendar Management Types
export interface CalendarSyncSettings {
	syncRange: 'week' | 'month' | 'quarter' | 'custom';
	customStartDate?: string; // YYYY-MM-DD (for custom range)
	customEndDate?: string;   // YYYY-MM-DD (for custom range)
	conflictResolution: 'manual' | 'newest' | 'primary' | 'merge';
	autoSync: boolean;
	syncInterval: number; // Minutes between auto syncs
	maxEventsPerSync: number;
}

// Master Calendar System Types
export interface MasterCalendarSettings {
	// enabled: boolean;
	googleAccounts: GoogleAccount[];
	selectedCalendars: SelectedCalendar[];
	syncSettings: CalendarSyncSettings;
	eventSettings: EventSettings;
	viewSettings: CalendarViewSettings;
}

export interface GoogleAccount {
	id: string;
	label: string;        // User-defined label like "Work Gmail"
	email: string;
	name: string;
	clientId: string;     // Shared across accounts
	clientSecret: string; // Shared across accounts
	tokens?: string; // JSON string of access/refresh tokens
	enabled: boolean;
	lastSync?: string;
}

export interface SelectedCalendar {
	accountId: string;
	calendarId: string;
	calendarName: string;
	color?: string;
	enabled: boolean;
	priority: number; // For conflict resolution
	syncDirection: 'read-only' | 'write-only' | 'bidirectional';
}

export interface EventSettings {
	createEventNotes: boolean;
	eventNotesFolder: string;
	useEventTemplates: boolean;
	templateFolder: string;
	eventNoteNameFormat: string; // e.g., "{{title}} - {{date}}"
}

export interface CalendarViewSettings {
	defaultView: 'month' | 'week' | 'day' | 'agenda';
	showWeekNumbers: boolean;
	firstDayOfWeek: 0 | 1; // 0 = Sunday, 1 = Monday
	timeFormat: '12h' | '24h';
	showDeclinedEvents: boolean;
	compactView: boolean;
}



export interface CalendarInfo {
	id: string;
	name: string;
	description?: string;
	primary: boolean;
	accessRole: string;
	backgroundColor?: string;
	enabled: boolean;
	priority: number; // For conflict resolution (higher = more important)
}

export interface ConflictingEvent {
	obsidianEvent: CalendarEvent;
	googleEvents: Array<{
		event: CalendarEvent;
		calendarId: string;
		calendarName: string;
	}>;
	conflictType: 'time_overlap' | 'duplicate' | 'title_similar' | 'location_same';
	similarity: number; // 0-1 score
}

export interface SyncResult {
	success: boolean;
	calendarsProcessed: number;
	eventsImported: number;
	eventsUpdated: number;
	eventsSkipped: number;
	conflicts: ConflictingEvent[];
	errors: string[];
	duration: number;
}

// LLM Suggestion System Types
export interface LLMSuggestion {
	id: string;
	type: 'calendar-event' | 'transaction' | 'note-enhancement' | 'tag-suggestion' | 'chat-thread';
	sourceId: string; // Original event/transaction/note/thread ID
	timestamp: string;
	status: 'pending' | 'approved' | 'rejected' | 'applied';
	priority: 'low' | 'medium' | 'high';
	
	// Original data reference
	originalData: {
		title: string;
		type: string;
		path?: string; // For existing notes
		summary: string;
		threadData?: ChatThread; // For chat-thread suggestions
	};
	
	// LLM generated suggestions
	suggestions: {
		tags?: string[];
		categories?: string[];
		actionItems?: string[];
		relationships?: string[];
		preparationItems?: string[];
		insights?: string;
		summary?: string;
		metadata?: Record<string, any>;
		noteContent?: string; // For chat-thread to note conversion
		noteType?: string; // Suggested note type
	};
	
	// User decisions
	userDecisions?: {
		approvedSuggestions: string[];
		rejectedSuggestions: string[];
		customModifications?: Record<string, any>;
		notes?: string;
	};
	
	// Linking and tracking
	targetNotePath?: string;
	relatedNotes?: string[];
	confidence: number; // 0-1 score from LLM
}

export interface SuggestionBatch {
	id: string;
	type: 'calendar-sync' | 'transaction-import' | 'note-analysis' | 'chat-thread-end';
	sourceOperation: string;
	timestamp: string;
	suggestions: LLMSuggestion[];
	batchStatus: 'pending' | 'partially-approved' | 'completed' | 'archived';
	totalSuggestions: number;
	approvedCount: number;
	rejectedCount: number;
	appliedCount: number;
}

export interface SuggestionSystemSettings {
	enabled: boolean;
	autoApproveHighConfidence: boolean;
	highConfidenceThreshold: number; // 0.8 default
	createSummaryLogs: boolean;
	storageLocation: '.suggestions' | 'suggestions';
	maxPendingSuggestions: number;
	batchProcessing: boolean;
	notifyOnNewSuggestions: boolean;
}

// Default suggestion settings
export const DEFAULT_SUGGESTION_SETTINGS: SuggestionSystemSettings = {
	enabled: true,
	autoApproveHighConfidence: false,
	highConfidenceThreshold: 0.85,
	createSummaryLogs: true,
	storageLocation: '.suggestions',
	maxPendingSuggestions: 100,
	batchProcessing: true,
	notifyOnNewSuggestions: true
};
