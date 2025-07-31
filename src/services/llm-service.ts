import { PluginSettings, LLMRequest, LLMResponse, ParsedData } from '../types';
import axios from 'axios';

export class LLMService {
	private settings: PluginSettings;

	constructor(settings: PluginSettings) {
		this.settings = settings;
	}

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

	async chat(message: string): Promise<string> {
		try {
			// For chat, we call the LLM directly without expecting JSON
			switch (this.settings.llmProvider) {
				case 'openai':
					return await this.callOpenAIChat(message);
				case 'anthropic':
					return await this.callAnthropicChat(message);
				case 'custom':
					return await this.callCustomChat(message);
				default:
					throw new Error(`Unsupported LLM provider: ${this.settings.llmProvider}`);
			}
		} catch (error) {
			throw new Error(`Chat failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	private async callOpenAIChat(message: string): Promise<string> {
		const response = await axios.post('https://api.openai.com/v1/chat/completions', {
			model: this.settings.llmModel,
			messages: [
				{
					role: 'system',
					content: 'You are a helpful AI assistant integrated into a personal knowledge management system built with Obsidian. The user is working with their "Second Brain" - a system that captures transactions, calendar events, tasks, and notes. Provide helpful, conversational responses.'
				},
				{
					role: 'user',
					content: message
				}
			],
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

	private async callAnthropicChat(message: string): Promise<string> {
		const response = await axios.post('https://api.anthropic.com/v1/messages', {
			model: this.settings.llmModel,
			max_tokens: 1000,
			messages: [
				{
					role: 'user',
					content: `You are a helpful AI assistant integrated into a personal knowledge management system built with Obsidian. The user is working with their "Second Brain" - a system that captures transactions, calendar events, tasks, and notes. Provide helpful, conversational responses.

User message: ${message}`
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

	private async callCustomChat(message: string): Promise<string> {
		if (!this.settings.llmEndpoint) {
			throw new Error('Custom LLM endpoint not configured');
		}

		const response = await axios.post(this.settings.llmEndpoint, {
			prompt: this.buildChatPrompt(message),
			message: message,
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

	private buildChatPrompt(message: string): string {
		return `
You are a helpful AI assistant integrated into a personal knowledge management system built with Obsidian. 
The user is working with their "Second Brain" - a system that captures transactions, calendar events, tasks, and notes.

User message: ${message}

Please provide a helpful, conversational response. You can:
- Answer questions about their data or system
- Provide suggestions for organizing information
- Help with productivity and knowledge management
- Offer general assistance

Keep your response natural and conversational. If the user asks about specific data, acknowledge that you would need access to their vault contents to provide specific details.

Response:`;
	}

	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
	}
}
