import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import SecondBrainPlugin from '../../main';
import { ChatThread } from '../types';

export const CHAT_VIEW_TYPE = 'second-brain-chat';

export class ChatView extends ItemView {
	plugin: SecondBrainPlugin;
	private currentThreadId: string | null = null;
	private messagesContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private inputElement: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;
	private newThreadButton: HTMLButtonElement;
	private threadTitle: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Second Brain Chat';
	}

	getIcon(): string {
		return 'message-circle';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('chat-view-container');

		// Create header with thread controls
		const header = container.createEl('div', { cls: 'chat-header' });
		
		const titleContainer = header.createEl('div', { cls: 'chat-title-container' });
		this.threadTitle = titleContainer.createEl('h3', { text: 'New Conversation', cls: 'chat-title' });
		
		const buttonContainer = header.createEl('div', { cls: 'chat-header-buttons' });
		this.newThreadButton = buttonContainer.createEl('button', {
			text: 'New Thread',
			cls: 'chat-new-thread-button'
		});

		// Create messages container
		this.messagesContainer = container.createEl('div', { cls: 'chat-messages' });

		// Create input container
		this.inputContainer = container.createEl('div', { cls: 'chat-input-container' });
		
		this.inputElement = this.inputContainer.createEl('textarea', {
			cls: 'chat-input',
			attr: {
				placeholder: 'Ask me anything about your Second Brain...',
				rows: '3'
			}
		});

		this.sendButton = this.inputContainer.createEl('button', {
			text: 'Send',
			cls: 'chat-send-button'
		});

		// Set up event listeners
		this.setupEventListeners();

		// Start with a new thread
		this.startNewThread();
	}

	private setupEventListeners(): void {
		// Send button click
		this.sendButton.addEventListener('click', () => {
			this.handleSend();
		});

		// New thread button click
		this.newThreadButton.addEventListener('click', () => {
			console.log('🖱️ ChatView: New Thread button clicked');
			this.startNewThread();
		});

		// Enter key to send (Shift+Enter for new line)
		this.inputElement.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.handleSend();
			}
		});

		// Auto-resize textarea
		this.inputElement.addEventListener('input', () => {
			this.inputElement.style.height = 'auto';
			this.inputElement.style.height = this.inputElement.scrollHeight + 'px';
		});
	}

	private startNewThread(): void {
		console.log('🆕 ChatView: Starting new thread...');
		
		// End current thread if exists and process it for suggestions
		if (this.currentThreadId) {
			console.log(`🔄 ChatView: Ending current thread: ${this.currentThreadId}`);
			this.endCurrentThread();
		}

		// Start new thread through the intelligence broker service
		console.log('🚀 ChatView: Calling intelligenceBrokerService.startNewThread()');
		this.currentThreadId = this.plugin.intelligenceBrokerService.startNewThread();
		console.log(`✅ ChatView: New thread started with ID: ${this.currentThreadId}`);
		
		// Update UI
		this.threadTitle.textContent = `Thread ${new Date().toLocaleTimeString()}`;
		this.messagesContainer.empty();
		
		// Add welcome message for new thread
		this.addWelcomeMessage();
		console.log('💬 ChatView: Welcome message added, UI updated');
	}

	private async endCurrentThread(): Promise<void> {
		if (!this.currentThreadId) return;

		try {
			// End thread and get suggestions
			const suggestion = await this.plugin.intelligenceBrokerService.endCurrentThread();
			
			if (suggestion) {
				// Show notification about suggestions being created
				new Notice('Chat conversation processed! Check the suggestion sidebar for potential notes.');
				
				// Add suggestion to the management system if available
				if (this.plugin.suggestionManagementService) {
					await this.plugin.suggestionManagementService.addSuggestion(suggestion);
					
					// Refresh the suggestion view to show the new suggestion
					await this.plugin.refreshSuggestionView();
				}
			}
		} catch (error) {
			console.error('Error ending thread:', error);
		}

		this.currentThreadId = null;
	}

	private async handleSend(): Promise<void> {
		const message = this.inputElement.value.trim();
		if (!message) return;

		// Clear input
		this.inputElement.value = '';
		this.inputElement.style.height = 'auto';

		// Show loading state
		this.sendButton.disabled = true;
		this.sendButton.textContent = 'Thinking...';

		try {
			// Check if LLM is configured
			if (!this.plugin.settings.llmApiKey) {
				this.addErrorMessage('I need an LLM API key to respond. Please configure your LLM settings in the plugin settings.');
				return;
			}

			// Process message through intelligence broker service
			const result = await this.plugin.intelligenceBrokerService.processChatMessage(message);
			
			// Update current thread ID in case it changed
			this.currentThreadId = result.threadId;
			
			// Render the updated thread
			this.renderCurrentThread();

		} catch (error) {
			console.error('Chat error:', error);
			const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
			this.addErrorMessage(`Sorry, I encountered an error: ${errorMsg}`);
		} finally {
			// Reset button state
			this.sendButton.disabled = false;
			this.sendButton.textContent = 'Send';
		}
	}

	private addWelcomeMessage(): void {
		const messageEl = this.messagesContainer.createEl('div', { cls: 'chat-message assistant welcome' });
		const contentEl = messageEl.createEl('div', { cls: 'chat-message-content' });
		contentEl.textContent = 'Hello! I\'m your Second Brain assistant. I can help you with organizing your notes, understanding your data, and managing your knowledge system. What would you like to know?';
		
		const timeEl = messageEl.createEl('div', { cls: 'chat-message-time' });
		timeEl.textContent = new Date().toLocaleTimeString();
		
		this.scrollToBottom();
	}

	private addErrorMessage(content: string): void {
		const messageEl = this.messagesContainer.createEl('div', { cls: 'chat-message assistant error' });
		const contentEl = messageEl.createEl('div', { cls: 'chat-message-content' });
		contentEl.textContent = content;
		
		const timeEl = messageEl.createEl('div', { cls: 'chat-message-time' });
		timeEl.textContent = new Date().toLocaleTimeString();
		
		this.scrollToBottom();
	}

	private renderCurrentThread(): void {
		this.messagesContainer.empty();
		
		if (!this.currentThreadId) {
			this.addWelcomeMessage();
			return;
		}

		const thread = this.plugin.intelligenceBrokerService.getCurrentThread();
		if (!thread) {
			this.addWelcomeMessage();
			return;
		}

		// Update thread title
		this.threadTitle.textContent = thread.title;

		// If no messages yet, show welcome
		if (thread.messages.length === 0) {
			this.addWelcomeMessage();
			return;
		}

		// Render all messages in the thread
		for (const message of thread.messages) {
			this.renderMessage(message);
		}
		
		this.scrollToBottom();
	}

	private renderMessage(message: { role: 'user' | 'assistant'; content: string; timestamp: string }): void {
		const messageEl = this.messagesContainer.createEl('div', { 
			cls: `chat-message ${message.role}` 
		});
		
		const contentEl = messageEl.createEl('div', { cls: 'chat-message-content' });
		contentEl.textContent = message.content;
		
		const timeEl = messageEl.createEl('div', { cls: 'chat-message-time' });
		timeEl.textContent = new Date(message.timestamp).toLocaleTimeString();
	}

	private scrollToBottom(): void {
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	async onClose(): Promise<void> {
		// End current thread when view closes
		await this.endCurrentThread();
	}
}
