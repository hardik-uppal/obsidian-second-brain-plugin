import { 
	PluginSettings, 
	LLMRequest, 
	LLMResponse, 
	ParsedData, 
	LLMSuggestion, 
	CalendarEvent, 
	Transaction,
	ChatThread,
	ChatMessage,
	ChatThreadSummary
} from '../types';
import { App, TFile } from 'obsidian';
import axios from 'axios';

/**
 * Enhanced LLM Service - Handles chat threads, parsing, and suggestions
 * Manages conversation threads and converts them to actionable suggestions
 */
export class IntelligenceBrokerService {
	private settings: PluginSettings;
	private activeThreads: Map<string, ChatThread> = new Map();
	private currentThreadId: string | null = null;
	private app: App; // Add app reference for file operations

	constructor(app: App, settings: PluginSettings) {
		this.app = app;
		this.settings = settings;
	}

	// ===========================================
	// CHAT THREAD MANAGEMENT
	// ===========================================

	/**
	 * Start a new chat thread
	 */
	startNewThread(title?: string): string {
		console.log('🆕 IntelligenceBrokerService: Starting new thread...');
		
		// End current thread if exists
		if (this.currentThreadId) {
			console.log(`🔄 IntelligenceBrokerService: Ending current thread: ${this.currentThreadId}`);
			this.endCurrentThread();
		}

		const threadId = this.generateThreadId();
		console.log(`🎲 IntelligenceBrokerService: Generated thread ID: ${threadId}`);
		
		const thread: ChatThread = {
			id: threadId,
			title: title || `Chat ${new Date().toLocaleString()}`,
			messages: [],
			startTime: new Date().toISOString(),
			status: 'active',
			totalMessages: 0,
			lastActivity: new Date().toISOString()
		};

		console.log(`📝 IntelligenceBrokerService: Created thread object:`, thread);
		
		this.activeThreads.set(threadId, thread);
		this.currentThreadId = threadId;
		
		console.log(`💾 IntelligenceBrokerService: Thread stored in memory. Total active threads: ${this.activeThreads.size}`);
		console.log(`🎯 IntelligenceBrokerService: Current thread ID set to: ${this.currentThreadId}`);
		
		return threadId;
	}

	/**
	 * End the current thread and process it for suggestions
	 */
	async endCurrentThread(): Promise<LLMSuggestion | null> {
		if (!this.currentThreadId) {
			console.log('🚫 IntelligenceBrokerService: No current thread to end');
			return null;
		}

		const thread = this.activeThreads.get(this.currentThreadId);
		if (!thread) {
			console.log('🚫 IntelligenceBrokerService: Thread not found in active threads');
			return null;
		}

		console.log(`🏁 IntelligenceBrokerService: Ending thread ${thread.id} with ${thread.messages.length} messages`);

		// Mark thread as ended
		thread.status = 'ended';
		thread.endTime = new Date().toISOString();

		// Save thread as a chat note if it has any messages
		if (thread.messages.length > 0) {
			console.log('💾 IntelligenceBrokerService: Saving thread as chat note...');
			await this.saveChatAsNote(thread);
		}

		// Only process threads with meaningful conversation (more than 2 messages) for suggestions
		if (thread.messages.length < 3) {
			console.log('📝 IntelligenceBrokerService: Thread too short for suggestions, skipping suggestion processing');
			this.currentThreadId = null;
			return null;
		}

		try {
			// Generate suggestions from the thread
			console.log('🔄 IntelligenceBrokerService: Processing thread for suggestions...');
			const suggestion = await this.processThreadForSuggestions(thread);
			this.currentThreadId = null;
			
			console.log('✅ IntelligenceBrokerService: Thread processed successfully');
			return suggestion;
		} catch (error) {
			console.error('❌ Failed to process thread for suggestions:', error);
			this.currentThreadId = null;
			return null;
		}
	}

	/**
	 * Add a message to the current thread and get AI response
	 */
	async processChatMessage(message: string): Promise<{ response: string; threadId: string }> {
		console.log('💬 IntelligenceBrokerService: Processing chat message...');
		
		// Start new thread if none exists
		if (!this.currentThreadId) {
			console.log('🆕 IntelligenceBrokerService: No current thread, starting new one');
			this.startNewThread();
		}

		const thread = this.activeThreads.get(this.currentThreadId!);
		if (!thread) {
			throw new Error('No active thread found');
		}

		console.log(`📝 IntelligenceBrokerService: Adding user message to thread ${thread.id}`);

		// Add user message to thread
		const userMessage: ChatMessage = {
			id: this.generateMessageId(),
			role: 'user',
			content: message,
			timestamp: new Date().toISOString()
		};
		thread.messages.push(userMessage);

		// Get AI response
		console.log('🤖 IntelligenceBrokerService: Generating AI response...');
		const aiResponse = await this.generateAIResponse(message, thread);

		// Add AI response to thread
		const assistantMessage: ChatMessage = {
			id: this.generateMessageId(),
			role: 'assistant',
			content: aiResponse,
			timestamp: new Date().toISOString()
		};
		thread.messages.push(assistantMessage);

		// Update thread metadata
		thread.totalMessages = thread.messages.length;
		thread.lastActivity = new Date().toISOString();

		console.log(`✅ IntelligenceBrokerService: Chat message processed. Thread now has ${thread.totalMessages} messages`);

		return {
			response: aiResponse,
			threadId: this.currentThreadId!
		};
	}

	/**
	 * Get current active thread
	 */
	getCurrentThread(): ChatThread | null {
		if (!this.currentThreadId) {
			return null;
		}
		return this.activeThreads.get(this.currentThreadId) || null;
	}

	/**
	 * Get thread by ID
	 */
	getThread(threadId: string): ChatThread | null {
		return this.activeThreads.get(threadId) || null;
	}

	/**
	 * List all threads
	 */
	getAllThreads(): ChatThread[] {
		return Array.from(this.activeThreads.values());
	}

	/**
	 * Process a completed thread for suggestions
	 */
	private async processThreadForSuggestions(thread: ChatThread): Promise<LLMSuggestion> {
		const summary = await this.generateThreadSummary(thread);
		
		return {
			id: this.generateSuggestionId(),
			type: 'chat-thread',
			sourceId: thread.id,
			timestamp: new Date().toISOString(),
			status: 'pending',
			priority: summary.confidence > 0.8 ? 'high' : summary.confidence > 0.5 ? 'medium' : 'low',
			originalData: {
				title: thread.title,
				type: 'chat-thread',
				summary: `Conversation with ${thread.totalMessages} messages about: ${summary.keyTopics.join(', ')}`,
				threadData: thread
			},
			suggestions: {
				tags: summary.keyTopics,
				actionItems: summary.actionItems,
				insights: summary.insights.join('\n'),
				summary: `## ${summary.suggestedTitle}\n\n${this.formatThreadAsNote(thread, summary)}`,
				noteContent: this.formatThreadAsNote(thread, summary),
				noteType: summary.noteType,
				metadata: {
					threadId: thread.id,
					messageCount: thread.totalMessages,
					duration: this.calculateThreadDuration(thread),
					shouldCreateNote: summary.shouldCreateNote,
					suggestedNoteType: summary.noteType
				}
			},
			confidence: summary.confidence,
			targetNotePath: `notes/${this.sanitizeFileName(summary.suggestedTitle)}_${new Date().toISOString().split('T')[0]}.md`
		};
	}

	/**
	 * Generate summary and analysis of a chat thread
	 */
	private async generateThreadSummary(thread: ChatThread): Promise<ChatThreadSummary> {
		const prompt = this.buildThreadSummaryPrompt(thread);
		const request: LLMRequest = {
			prompt,
			data: { thread },
			type: 'suggestion'
		};

		const response = await this.callLLM(request);
		if (!response.success) {
			// Return default summary if LLM fails
			return {
				threadId: thread.id,
				keyTopics: ['conversation'],
				actionItems: [],
				decisions: [],
				insights: [],
				suggestedTitle: thread.title,
				shouldCreateNote: thread.messages.length > 5,
				noteType: 'general',
				confidence: 0.5
			};
		}

		return response.data as ChatThreadSummary;
	}

	/**
	 * Format thread as a note
	 */
	private formatThreadAsNote(thread: ChatThread, summary: ChatThreadSummary): string {
		let content = `**Date:** ${new Date(thread.startTime).toLocaleDateString()}\n`;
		content += `**Duration:** ${this.calculateThreadDuration(thread)}\n`;
		content += `**Messages:** ${thread.totalMessages}\n\n`;

		if (summary.keyTopics.length > 0) {
			content += `## Key Topics\n${summary.keyTopics.map(topic => `- ${topic}`).join('\n')}\n\n`;
		}

		if (summary.insights.length > 0) {
			content += `## Key Insights\n${summary.insights.map(insight => `- ${insight}`).join('\n')}\n\n`;
		}

		if (summary.actionItems.length > 0) {
			content += `## Action Items\n${summary.actionItems.map(item => `- [ ] ${item}`).join('\n')}\n\n`;
		}

		if (summary.decisions.length > 0) {
			content += `## Decisions Made\n${summary.decisions.map(decision => `- ${decision}`).join('\n')}\n\n`;
		}

		content += `## Conversation\n\n`;
		for (const message of thread.messages) {
			const time = new Date(message.timestamp).toLocaleTimeString();
			content += `**${message.role === 'user' ? 'You' : 'Assistant'}** (${time}):\n${message.content}\n\n`;
		}

		return content;
	}

	// ===========================================
	// EVENT ENHANCEMENT FUNCTIONALITY
	// ===========================================

	/**
	 * Generate enhanced suggestions for calendar events
	 */
	async generateEventEnhancements(event: CalendarEvent): Promise<LLMSuggestion> {
		const prompt = this.buildEventEnhancementPrompt(event);
		const request: LLMRequest = {
			prompt,
			data: event,
			type: 'event'
		};

		const response = await this.callLLM(request);
		if (!response.success) {
			throw new Error(`Event enhancement failed: ${response.error}`);
		}

		return this.convertEventResponseToSuggestion(event, response.data);
	}

	/**
	 * Batch process events for enhancements
	 */
	async generateBatchEventEnhancements(events: CalendarEvent[]): Promise<LLMSuggestion[]> {
		const suggestions: LLMSuggestion[] = [];
		
		for (const event of events) {
			try {
				const suggestion = await this.generateEventEnhancements(event);
				suggestions.push(suggestion);
			} catch (error) {
				console.error(`Failed to enhance event ${event.title}:`, error);
				// Create a minimal suggestion to track the failure
				suggestions.push({
					id: this.generateSuggestionId(),
					type: 'calendar-event',
					sourceId: event.id,
					timestamp: new Date().toISOString(),
					status: 'rejected',
					priority: 'low',
					originalData: {
						title: event.title,
						type: 'calendar-event',
						summary: `${event.title} on ${event.date}`
					},
					suggestions: {},
					confidence: 0,
					targetNotePath: `events/${this.sanitizeFileName(event.title)}_${event.date}.md`
				});
			}
		}

		return suggestions;
	}

	/**
	 * Generate transaction enhancements
	 */
	async generateTransactionEnhancements(transaction: Transaction): Promise<LLMSuggestion> {
		const prompt = this.buildTransactionEnhancementPrompt(transaction);
		const request: LLMRequest = {
			prompt,
			data: transaction,
			type: 'transaction'
		};

		const response = await this.callLLM(request);
		if (!response.success) {
			throw new Error(`Transaction enhancement failed: ${response.error}`);
		}

		return this.convertTransactionResponseToSuggestion(transaction, response.data);
	}

	// ===========================================
	// EXISTING PARSING FUNCTIONALITY (Updated)
	// ===========================================

	async parseTransaction(transactionData: any): Promise<ParsedData> {
		const prompt = this.buildTransactionPrompt(transactionData);
		const request: LLMRequest = {
			prompt,
			data: transactionData,
			type: 'transaction'
		};

		const response = await this.callLLM(request);
		if (!response.success) {
			throw new Error(`LLM parsing failed: ${response.error}`);
		}

		return response.data;
	}

	async parseEvent(eventData: any): Promise<ParsedData> {
		const prompt = this.buildEventPrompt(eventData);
		const request: LLMRequest = {
			prompt,
			data: eventData,
			type: 'event'
		};

		const response = await this.callLLM(request);
		if (!response.success) {
			throw new Error(`LLM parsing failed: ${response.error}`);
		}

		return response.data;
	}

	async parseTask(taskData: any): Promise<ParsedData> {
		const prompt = this.buildTaskPrompt(taskData);
		const request: LLMRequest = {
			prompt,
			data: taskData,
			type: 'task'
		};

		const response = await this.callLLM(request);
		if (!response.success) {
			throw new Error(`LLM parsing failed: ${response.error}`);
		}

		return response.data;
	}

	async generateSuggestions(noteContent: string, noteType: string): Promise<string[]> {
		const prompt = this.buildSuggestionPrompt(noteContent, noteType);
		const request: LLMRequest = {
			prompt,
			data: { content: noteContent, type: noteType },
			type: 'suggestion'
		};

		const response = await this.callLLM(request);
		if (!response.success) {
			console.warn(`Suggestion generation failed: ${response.error}`);
			return [];
		}

		return response.data.suggestions || [];
	}

	private async callLLM(request: LLMRequest): Promise<LLMResponse> {
		try {
			switch (this.settings.llmProvider) {
				case 'openai':
					return await this.callOpenAI(request);
				case 'anthropic':
					return await this.callAnthropic(request);
				case 'custom':
					return await this.callCustomEndpoint(request);
				default:
					throw new Error(`Unsupported LLM provider: ${this.settings.llmProvider}`);
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}

	private async callOpenAI(request: LLMRequest): Promise<LLMResponse> {
		const response = await axios.post('https://api.openai.com/v1/chat/completions', {
			model: this.settings.llmModel,
			messages: [
				{
					role: 'system',
					content: 'You are a helpful assistant that parses and structures data for a personal knowledge management system. Always respond with valid JSON.'
				},
				{
					role: 'user',
					content: request.prompt
				}
			],
			temperature: 0.3,
			max_tokens: 1000
		}, {
			headers: {
				'Authorization': `Bearer ${this.settings.llmApiKey}`,
				'Content-Type': 'application/json'
			}
		});

		const content = response.data.choices[0].message.content;
		try {
			const parsedData = JSON.parse(content);
			return {
				success: true,
				data: parsedData
			};
		} catch (parseError) {
			return {
				success: false,
				error: 'Failed to parse LLM response as JSON'
			};
		}
	}

	private async callAnthropic(request: LLMRequest): Promise<LLMResponse> {
		const response = await axios.post('https://api.anthropic.com/v1/messages', {
			model: this.settings.llmModel,
			max_tokens: 1000,
			messages: [
				{
					role: 'user',
					content: request.prompt
				}
			]
		}, {
			headers: {
				'x-api-key': this.settings.llmApiKey,
				'Content-Type': 'application/json',
				'anthropic-version': '2023-06-01'
			}
		});

		const content = response.data.content[0].text;
		try {
			const parsedData = JSON.parse(content);
			return {
				success: true,
				data: parsedData
			};
		} catch (parseError) {
			return {
				success: false,
				error: 'Failed to parse LLM response as JSON'
			};
		}
	}

	private async callCustomEndpoint(request: LLMRequest): Promise<LLMResponse> {
		if (!this.settings.llmEndpoint) {
			throw new Error('Custom LLM endpoint not configured');
		}

		const response = await axios.post(this.settings.llmEndpoint, {
			prompt: request.prompt,
			data: request.data,
			type: request.type,
			model: this.settings.llmModel
		}, {
			headers: {
				'Authorization': `Bearer ${this.settings.llmApiKey}`,
				'Content-Type': 'application/json'
			}
		});

		return {
			success: true,
			data: response.data
		};
	}

	private buildTransactionPrompt(transactionData: any): string {
		return `
Parse this financial transaction data and return a structured JSON response for a personal knowledge management system.

Transaction Data:
${JSON.stringify(transactionData, null, 2)}

Please analyze the transaction and return JSON in this exact format:
{
  "title": "Descriptive title for the transaction note",
  "content": "Detailed markdown content describing the transaction",
  "frontmatter": {
    "type": "transaction",
    "date": "YYYY-MM-DD",
    "amount": "dollar amount as string",
    "merchant": "merchant name",
    "category": "transaction category",
    "account": "account identifier"
  },
  "tags": ["relevant", "tags", "for", "categorization"],
  "suggestions": ["potential", "related", "note", "connections"]
}

Focus on:
1. Creating a clear, descriptive title
2. Categorizing the transaction appropriately
3. Suggesting relevant tags for organization
4. Identifying potential connections to other notes
5. Extracting key details for the frontmatter

Return only valid JSON, no additional text.
`;
	}

	private buildEventPrompt(eventData: any): string {
		return `
Parse this calendar event data and return a structured JSON response for a personal knowledge management system.

Event Data:
${JSON.stringify(eventData, null, 2)}

Please analyze the event and return JSON in this exact format:
{
  "title": "Clear title for the event note",
  "content": "Detailed markdown content about the event",
  "frontmatter": {
    "type": "event",
    "date": "YYYY-MM-DD",
    "start_time": "start time",
    "end_time": "end time",
    "location": "event location",
    "attendees": ["list", "of", "attendees"]
  },
  "tags": ["relevant", "event", "tags"],
  "suggestions": ["potential", "related", "connections"]
}

Focus on:
1. Creating a meaningful event title
2. Extracting key event details
3. Identifying the event type and context
4. Suggesting relevant organizational tags
5. Finding potential connections to other notes or projects

Return only valid JSON, no additional text.
`;
	}

	private buildTaskPrompt(taskData: any): string {
		return `
Parse this task data and return a structured JSON response for a personal knowledge management system.

Task Data:
${JSON.stringify(taskData, null, 2)}

Please analyze the task and return JSON in this exact format:
{
  "title": "Clear task title",
  "content": "Detailed markdown content about the task",
  "frontmatter": {
    "type": "task",
    "title": "task title",
    "due_date": "YYYY-MM-DD or empty string",
    "priority": "low|medium|high",
    "completed": false,
    "project": "project name or empty string"
  },
  "tags": ["relevant", "task", "tags"],
  "suggestions": ["potential", "related", "connections"]
}

Focus on:
1. Creating a clear, actionable task title
2. Determining appropriate priority level
3. Identifying project or context associations
4. Suggesting relevant organizational tags
5. Finding connections to related notes or other tasks

Return only valid JSON, no additional text.
`;
	}

	private buildSuggestionPrompt(noteContent: string, noteType: string): string {
		return `
Analyze this ${noteType} note content and suggest potential connections to other notes in a personal knowledge management system.

Note Content:
${noteContent}

Based on the content, suggest 3-5 potential note titles or topics that might be related to this ${noteType}. Consider:
1. Related concepts or themes
2. People or organizations mentioned
3. Projects or goals referenced
4. Similar transactions/events/tasks
5. Follow-up actions or dependencies

Return JSON in this format:
{
  "suggestions": ["Suggested Note Title 1", "Suggested Note Title 2", "etc"]
}

Return only valid JSON, no additional text.
`;
	}

	/**
	 * Build thread summary prompt
	 */
	private buildThreadSummaryPrompt(thread: ChatThread): string {
		const conversation = thread.messages.map(msg => 
			`${msg.role}: ${msg.content}`
		).join('\n');

		return `Analyze this chat conversation and provide a comprehensive summary for potential note creation.

Conversation Details:
- Thread ID: ${thread.id}
- Duration: ${this.calculateThreadDuration(thread)}
- Total Messages: ${thread.totalMessages}
- Started: ${new Date(thread.startTime).toLocaleString()}

Conversation:
${conversation}

Please analyze this conversation and return JSON with the following structure:
{
  "threadId": "${thread.id}",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "actionItems": ["action item 1", "action item 2"],
  "decisions": ["decision 1", "decision 2"],
  "insights": ["insight 1", "insight 2"],
  "suggestedTitle": "Suggested Note Title",
  "shouldCreateNote": true,
  "noteType": "meeting-notes|brainstorm|decision-log|action-plan|general",
  "confidence": 0.85
}

Focus on:
1. Identifying 3-5 key topics discussed
2. Extracting concrete action items mentioned
3. Noting any decisions made
4. Capturing important insights or conclusions
5. Suggesting an appropriate title for a note
6. Determining if this conversation warrants creating a note (true for substantial conversations)
7. Classifying the type of note this would be
8. Providing a confidence score (0-1) for the analysis quality

Return only valid JSON, no additional text.`;
	}

	// ===========================================
	// HELPER METHODS
	// ===========================================

	/**
	 * Generate unique thread ID
	 */
	private generateThreadId(): string {
		return `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Generate unique message ID
	 */
	private generateMessageId(): string {
		return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Generate unique suggestion ID
	 */
	private generateSuggestionId(): string {
		return `sug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Calculate thread duration in human readable format
	 */
	private calculateThreadDuration(thread: ChatThread): string {
		const start = new Date(thread.startTime);
		const end = thread.endTime ? new Date(thread.endTime) : new Date();
		const durationMs = end.getTime() - start.getTime();
		
		const minutes = Math.floor(durationMs / 60000);
		const seconds = Math.floor((durationMs % 60000) / 1000);
		
		if (minutes > 0) {
			return `${minutes}m ${seconds}s`;
		}
		return `${seconds}s`;
	}

	/**
	 * Generate AI response for chat message
	 */
	private async generateAIResponse(message: string, thread: ChatThread): Promise<string> {
		try {
			// Build context from recent messages
			const recentMessages = thread.messages.slice(-10); // Last 10 messages for context
			const conversationHistory = recentMessages.map(msg => ({
				role: msg.role,
				content: msg.content
			}));

			const prompt = this.buildChatPrompt(message, { conversationHistory });
			
			switch (this.settings.llmProvider) {
				case 'openai':
					return await this.callOpenAIChat(message, conversationHistory);
				case 'anthropic':
					return await this.callAnthropicChat(message, conversationHistory);
				case 'custom':
					return await this.callCustomChat(message, conversationHistory);
				default:
					throw new Error(`Unsupported LLM provider: ${this.settings.llmProvider}`);
			}
		} catch (error) {
			console.error('Failed to generate AI response:', error);
			return "I apologize, but I'm having trouble processing your message right now. Please try again.";
		}
	}

	/**
	 * Sanitize filename for file paths
	 */
	private sanitizeFileName(input: string): string {
		return input
			.replace(/[<>:"/\\|?*]/g, '-')
			.replace(/\s+/g, '_')
			.trim()
			.substring(0, 50);
	}

	/**
	 * Convert LLM response to suggestions format
	 */
	private convertToSuggestions(responseData: any, sourceType: string): LLMSuggestion[] {
		const suggestions: LLMSuggestion[] = [];
		
		if (responseData.suggestions && Array.isArray(responseData.suggestions)) {
			for (const item of responseData.suggestions) {
				suggestions.push({
					id: this.generateSuggestionId(),
					type: this.mapSourceTypeToSuggestionType(sourceType),
					sourceId: item.sourceId || 'chat',
					timestamp: new Date().toISOString(),
					status: 'pending',
					priority: item.priority || 'medium',
					originalData: {
						title: item.title || 'Chat Suggestion',
						type: sourceType,
						summary: item.summary || ''
					},
					suggestions: {
						tags: item.tags,
						actionItems: item.actionItems,
						relationships: item.relationships,
						insights: item.insights
					},
					confidence: item.confidence || 0.7,
					targetNotePath: item.targetPath
				});
			}
		}
		
		return suggestions;
	}

	/**
	 * Convert event response to suggestion
	 */
	private convertEventResponseToSuggestion(event: CalendarEvent, responseData: any): LLMSuggestion {
		return {
			id: this.generateSuggestionId(),
			type: 'calendar-event',
			sourceId: event.id,
			timestamp: new Date().toISOString(),
			status: 'pending',
			priority: responseData.priority || 'medium',
			originalData: {
				title: event.title,
				type: 'calendar-event',
				summary: `${event.title} on ${event.date} at ${event.startTime}`
			},
			suggestions: {
				tags: responseData.tags || [],
				categories: responseData.categories || [],
				actionItems: responseData.actionItems || [],
				preparationItems: responseData.preparationItems || [],
				relationships: responseData.relationships || [],
				insights: responseData.insights,
				summary: responseData.summary,
				metadata: responseData.metadata || {}
			},
			confidence: responseData.confidence || 0.8,
			targetNotePath: `events/${this.sanitizeFileName(event.title)}_${event.date}.md`
		};
	}

	/**
	 * Convert transaction response to suggestion
	 */
	private convertTransactionResponseToSuggestion(transaction: Transaction, responseData: any): LLMSuggestion {
		return {
			id: this.generateSuggestionId(),
			type: 'transaction',
			sourceId: transaction.id,
			timestamp: new Date().toISOString(),
			status: 'pending',
			priority: responseData.priority || 'medium',
			originalData: {
				title: `${transaction.merchant} - $${transaction.amount}`,
				type: 'transaction',
				summary: `${transaction.description} on ${transaction.date}`
			},
			suggestions: {
				tags: responseData.tags || [],
				categories: responseData.categories || [],
				actionItems: responseData.actionItems || [],
				relationships: responseData.relationships || [],
				insights: responseData.insights,
				metadata: responseData.metadata || {}
			},
			confidence: responseData.confidence || 0.7,
			targetNotePath: `transactions/${this.sanitizeFileName(transaction.merchant)}_${transaction.date}.md`
		};
	}

	/**
	 * Map source type to suggestion type
	 */
	private mapSourceTypeToSuggestionType(sourceType: string): LLMSuggestion['type'] {
		switch (sourceType) {
			case 'chat-conversation':
				return 'note-enhancement';
			case 'calendar-event':
				return 'calendar-event';
			case 'transaction':
				return 'transaction';
			default:
				return 'note-enhancement';
		}
	}

	// ===========================================
	// PROMPT BUILDERS
	// ===========================================

	/**
	 * Build chat prompt with context
	 */
	private buildChatPrompt(
		message: string, 
		context?: { 
			relatedNotes?: string[];
			conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
		}
	): string {
		let prompt = `You are an AI assistant helping with personal knowledge management in Obsidian.

User message: "${message}"

`;

		if (context?.conversationHistory?.length) {
			prompt += `\nConversation history:\n`;
			context.conversationHistory.slice(-5).forEach(msg => {
				prompt += `${msg.role}: ${msg.content}\n`;
			});
		}

		if (context?.relatedNotes?.length) {
			prompt += `\nRelated notes in vault:\n`;
			context.relatedNotes.forEach(note => {
				prompt += `- ${note}\n`;
			});
		}

		prompt += `\nProvide a helpful response. If this conversation could lead to actionable items or new insights, include them in a "suggestions" field in your JSON response.

Response format:
{
  "content": "your response here",
  "suggestions": [
    {
      "title": "suggestion title",
      "summary": "brief description",
      "actionItems": ["item 1", "item 2"],
      "tags": ["tag1", "tag2"],
      "priority": "high|medium|low",
      "confidence": 0.8
    }
  ]
}`;

		return prompt;
	}

	/**
	 * Build chat end suggestions prompt
	 */
	private buildChatEndSuggestionsPrompt(
		conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
		relatedNotes: string[]
	): string {
		let prompt = `Analyze this conversation and suggest actionable items, notes to create, or connections to make.

Conversation:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

`;

		if (relatedNotes.length) {
			prompt += `Existing related notes: ${relatedNotes.join(', ')}\n\n`;
		}

		prompt += `Based on this conversation, suggest:
1. Action items that should be tracked
2. New notes that should be created
3. Tags that would be useful
4. Connections to existing notes
5. Key insights to remember

Return suggestions as JSON array:
{
  "suggestions": [
    {
      "title": "suggestion title",
      "summary": "what this suggestion does",
      "actionItems": ["specific action 1", "specific action 2"],
      "tags": ["relevant", "tags"],
      "relationships": ["related note 1", "related note 2"],
      "insights": "key insight to remember",
      "priority": "high|medium|low",
      "confidence": 0.8,
      "targetPath": "suggested/note/path.md"
    }
  ]
}`;

		return prompt;
	}

	/**
	 * Build event enhancement prompt
	 */
	private buildEventEnhancementPrompt(event: CalendarEvent): string {
		return `Analyze this calendar event and suggest enhancements for better organization and preparation:

Event Details:
- Title: ${event.title}
- Date: ${event.date}
- Time: ${event.startTime} - ${event.endTime}
- Location: ${event.location || 'No location'}
- Description: ${event.description || 'No description'}
- Attendees: ${event.attendees.join(', ') || 'No attendees'}
- Current tags: ${event.tags.join(', ') || 'No tags'}

Please suggest:
1. Relevant tags (3-5 tags maximum)
2. Event category/type
3. Preparation items (3-5 items)
4. Potential action items
5. Related topics/projects that might connect
6. Priority level assessment
7. Key insights about this event

Return as JSON:
{
  "tags": ["tag1", "tag2", "tag3"],
  "categories": ["category"],
  "preparationItems": ["prep item 1", "prep item 2"],
  "actionItems": ["action 1", "action 2"],
  "relationships": ["related topic 1", "related topic 2"],
  "insights": "key insights about this event",
  "summary": "brief summary of the event purpose",
  "priority": "high|medium|low",
  "confidence": 0.85,
  "metadata": {
    "eventType": "meeting|appointment|personal|work",
    "estimatedPrepTime": "15 minutes",
    "followUpRequired": true
  }
}`;
	}

	/**
	 * Build transaction enhancement prompt
	 */
	private buildTransactionEnhancementPrompt(transaction: Transaction): string {
		return `Analyze this financial transaction and suggest enhancements:

Transaction Details:
- Amount: $${transaction.amount}
- Merchant: ${transaction.merchant}
- Date: ${transaction.date}
- Category: ${transaction.category}
- Description: ${transaction.description}
- Current tags: ${transaction.tags.join(', ') || 'No tags'}

Please suggest:
1. More specific tags
2. Budget categories
3. Expense type classification
4. Related financial goals or tracking
5. Action items (if any)
6. Insights about spending patterns

Return as JSON:
{
  "tags": ["specific", "tags"],
  "categories": ["budget-category"],
  "actionItems": ["action if needed"],
  "relationships": ["related goal or category"],
  "insights": "spending insight",
  "priority": "high|medium|low",
  "confidence": 0.75,
  "metadata": {
    "expenseType": "essential|discretionary|investment",
    "budgetImpact": "high|medium|low",
    "recurringLikelihood": "high|medium|low"
  }
}`;
	}

	private async callOpenAIChat(message: string, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
		const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
			{
				role: 'system',
				content: 'You are a helpful AI assistant integrated into a personal knowledge management system built with Obsidian. The user is working with their "Second Brain" - a system that captures transactions, calendar events, tasks, and notes. Provide helpful, conversational responses.'
			}
		];

		// Add conversation history if provided
		if (conversationHistory) {
			messages.push(...conversationHistory.map(msg => ({
				role: msg.role,
				content: msg.content
			})));
		}

		// Add current message
		messages.push({
			role: 'user',
			content: message
		});

		const response = await axios.post('https://api.openai.com/v1/chat/completions', {
			model: this.settings.llmModel,
			messages,
			temperature: 0.7,
			max_tokens: 1000
		}, {
			headers: {
				'Authorization': `Bearer ${this.settings.llmApiKey}`,
				'Content-Type': 'application/json'
			}
		});

		return response.data.choices[0].message.content;
	}

	private async callAnthropicChat(message: string, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
		let fullPrompt = 'You are a helpful AI assistant integrated into a personal knowledge management system built with Obsidian. The user is working with their "Second Brain" - a system that captures transactions, calendar events, tasks, and notes. Provide helpful, conversational responses.\n\n';
		
		// Add conversation history if provided
		if (conversationHistory) {
			fullPrompt += 'Conversation history:\n';
			conversationHistory.forEach(msg => {
				fullPrompt += `${msg.role}: ${msg.content}\n`;
			});
			fullPrompt += '\n';
		}

		fullPrompt += `User message: ${message}`;

		const response = await axios.post('https://api.anthropic.com/v1/messages', {
			model: this.settings.llmModel,
			max_tokens: 1000,
			messages: [
				{
					role: 'user',
					content: fullPrompt
				}
			]
		}, {
			headers: {
				'x-api-key': this.settings.llmApiKey,
				'Content-Type': 'application/json',
				'anthropic-version': '2023-06-01'
			}
		});

		return response.data.content[0].text;
	}

	private async callCustomChat(message: string, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
		if (!this.settings.llmEndpoint) {
			throw new Error('Custom LLM endpoint not configured');
		}

		const response = await axios.post(this.settings.llmEndpoint, {
			prompt: this.buildChatPrompt(message, { conversationHistory }),
			message: message,
			conversationHistory,
			type: 'chat',
			model: this.settings.llmModel
		}, {
			headers: {
				'Authorization': `Bearer ${this.settings.llmApiKey}`,
				'Content-Type': 'application/json'
			}
		});

		return response.data.response || response.data.content || response.data;
	}

	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
	}

	/**
	 * Save a completed chat thread as a note in the chats folder
	 */
	private async saveChatAsNote(thread: ChatThread): Promise<void> {
		try {
			console.log(`💾 IntelligenceBrokerService: Saving chat thread as note: ${thread.id}`);
			
			// Ensure chats folder exists
			const chatsFolder = this.settings.chatsFolder;
			const existingFolder = this.app.vault.getAbstractFileByPath(chatsFolder);
			if (!existingFolder) {
				console.log(`📁 Creating chats folder: ${chatsFolder}`);
				await this.app.vault.createFolder(chatsFolder);
			}

			// Create a simple, clean chat note
			const content = this.formatChatAsNote(thread);
			
			// Create filename with "Chat" suffix
			const date = new Date(thread.startTime).toISOString().split('T')[0]; // YYYY-MM-DD
			const time = new Date(thread.startTime).toTimeString().slice(0, 5).replace(':', ''); // HHMM
			const fileName = `Chat Session ${date} ${time}.md`;
			const filePath = `${chatsFolder}/${fileName}`;

			console.log(`📝 Creating chat note: ${filePath}`);
			
			// Create the file
			await this.app.vault.create(filePath, content);
			console.log(`✅ Chat saved as note: ${filePath}`);
			
		} catch (error) {
			console.error(`❌ Error saving chat as note:`, error);
			// Don't throw - we don't want chat saving to break the flow
		}
	}

	/**
	 * Format a chat thread as a clean markdown note
	 */
	private formatChatAsNote(thread: ChatThread): string {
		const startTime = new Date(thread.startTime);
		const endTime = thread.endTime ? new Date(thread.endTime) : new Date();
		
		let content = `---
type: chat-session
date: ${startTime.toISOString().split('T')[0]}
start-time: "${startTime.toISOString()}"
end-time: "${endTime.toISOString()}"
messages: ${thread.totalMessages}
tags: [chat, second-brain]
---

# Chat Session - ${startTime.toLocaleDateString()} ${startTime.toLocaleTimeString()}

**Duration:** ${this.calculateChatDuration(startTime, endTime)}  
**Messages:** ${thread.totalMessages}  

## Conversation

`;

		if (thread.messages.length === 0) {
			content += "*No messages in this chat session*\n";
		} else {
			for (const message of thread.messages) {
				const timestamp = new Date(message.timestamp).toLocaleTimeString();
				const role = message.role === 'user' ? '**You**' : '**Assistant**';
				content += `### ${role} *(${timestamp})*\n\n${message.content}\n\n`;
			}
		}

		content += `\n---\n*Chat session ended at ${endTime.toLocaleString()}*\n`;
		
		return content;
	}

	/**
	 * Calculate chat duration in a human-readable format
	 */
	private calculateChatDuration(start: Date, end: Date): string {
		const durationMs = end.getTime() - start.getTime();
		const minutes = Math.floor(durationMs / 60000);
		const seconds = Math.floor((durationMs % 60000) / 1000);
		
		if (minutes > 0) {
			return `${minutes}m ${seconds}s`;
		} else {
			return `${seconds}s`;
		}
	}
}
