import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import SecondBrainPlugin from '../../main';

export const CHAT_VIEW_TYPE = 'second-brain-chat';

interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
	timestamp: string;
}

export class ChatView extends ItemView {
	plugin: SecondBrainPlugin;
	private messages: ChatMessage[] = [];
	private messagesContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private inputElement: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;

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

		// Create header
		const header = container.createEl('div', { cls: 'chat-header' });
		header.createEl('h3', { text: 'Second Brain Assistant', cls: 'chat-title' });

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

		// Load most recent chat session if available
		await this.loadRecentSession();

		// Add initial welcome message if no messages
		if (this.messages.length === 0) {
			this.addMessage('assistant', 'Hello! I\'m your Second Brain assistant. I can help you with organizing your notes, understanding your data, and managing your knowledge system. What would you like to know?');
		}

		this.renderMessages();
	}

	private setupEventListeners(): void {
		// Send button click
		this.sendButton.addEventListener('click', () => {
			this.handleSend();
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

	private async handleSend(): Promise<void> {
		const message = this.inputElement.value.trim();
		if (!message) return;

		// Clear input
		this.inputElement.value = '';
		this.inputElement.style.height = 'auto';

		// Add user message
		this.addMessage('user', message);
		this.renderMessages();

		// Show loading state
		this.sendButton.disabled = true;
		this.sendButton.textContent = 'Thinking...';

		try {
			// Check if LLM is configured
			if (!this.plugin.settings.llmApiKey) {
				this.addMessage('assistant', 'I need an LLM API key to respond. Please configure your LLM settings in the plugin settings.');
				this.renderMessages();
				return;
			}

			// Get response from LLM service
			const response = await this.plugin.llmService.chat(message);
			this.addMessage('assistant', response);
			this.renderMessages();

			// Save session after successful exchange
			await this.saveSession();

		} catch (error) {
			console.error('Chat error:', error);
			const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
			this.addMessage('assistant', `Sorry, I encountered an error: ${errorMsg}`);
			this.renderMessages();
		} finally {
			// Reset button state
			this.sendButton.disabled = false;
			this.sendButton.textContent = 'Send';
		}
	}

	private addMessage(role: 'user' | 'assistant', content: string): void {
		this.messages.push({
			role,
			content,
			timestamp: new Date().toISOString()
		});
	}

	private renderMessages(): void {
		this.messagesContainer.empty();

		for (const message of this.messages) {
			const messageEl = this.messagesContainer.createEl('div', {
				cls: `chat-message chat-message-${message.role}`
			});

			const avatarEl = messageEl.createEl('div', { cls: 'chat-avatar' });
			avatarEl.textContent = message.role === 'user' ? '👤' : '🤖';

			const contentEl = messageEl.createEl('div', { cls: 'chat-content' });
			
			const textEl = contentEl.createEl('div', { cls: 'chat-text' });
			textEl.textContent = message.content;

			const timeEl = contentEl.createEl('div', { cls: 'chat-time' });
			timeEl.textContent = new Date(message.timestamp).toLocaleTimeString();
		}

		// Scroll to bottom
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	private async saveSession(): Promise<void> {
		try {
			// Create chats folder if it doesn't exist
			const chatsFolder = 'Second Brain/Chats';
			const folderExists = await this.app.vault.adapter.exists(chatsFolder);
			if (!folderExists) {
				await this.app.vault.createFolder(chatsFolder);
			}

			// Generate filename with timestamp
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
			const filename = `${chatsFolder}/chat-${timestamp}.md`;

			// Convert messages to markdown
			const markdown = this.messagesToMarkdown();

			// Save to vault
			await this.app.vault.create(filename, markdown);

		} catch (error) {
			console.error('Failed to save chat session:', error);
			// Don't show error to user as this is background operation
		}
	}

	private messagesToMarkdown(): string {
		const lines: string[] = [];
		lines.push('# Second Brain Chat Session');
		lines.push('');
		lines.push(`**Date:** ${new Date().toLocaleDateString()}`);
		lines.push(`**Time:** ${new Date().toLocaleTimeString()}`);
		lines.push('');

		for (const message of this.messages) {
			const role = message.role === 'user' ? '**You**' : '**Assistant**';
			const time = new Date(message.timestamp).toLocaleTimeString();
			
			lines.push(`## ${role} (${time})`);
			lines.push('');
			lines.push(message.content);
			lines.push('');
		}

		return lines.join('\n');
	}

	private async loadRecentSession(): Promise<void> {
		try {
			const chatsFolder = 'Second Brain/Chats';
			const folderExists = await this.app.vault.adapter.exists(chatsFolder);
			if (!folderExists) return;

			// Get all chat files
			const files = this.app.vault.getMarkdownFiles()
				.filter(file => file.path.startsWith(chatsFolder) && file.path.includes('chat-'))
				.sort((a, b) => b.stat.mtime - a.stat.mtime);

			if (files.length === 0) return;

			// Load the most recent file
			const recentFile = files[0];
			const content = await this.app.vault.read(recentFile);
			
			// Parse messages from markdown (simplified parsing)
			this.parseMarkdownToMessages(content);

		} catch (error) {
			console.error('Failed to load recent session:', error);
			// Continue with empty session
		}
	}

	private parseMarkdownToMessages(markdown: string): void {
		// Simple parsing - look for ## **You** and ## **Assistant** headers
		const lines = markdown.split('\n');
		let currentRole: 'user' | 'assistant' | null = null;
		let currentContent: string[] = [];
		let currentTimestamp = new Date().toISOString();

		for (const line of lines) {
			if (line.startsWith('## **You**')) {
				// Save previous message if exists
				if (currentRole && currentContent.length > 0) {
					this.messages.push({
						role: currentRole,
						content: currentContent.join('\n').trim(),
						timestamp: currentTimestamp
					});
				}
				currentRole = 'user';
				currentContent = [];
			} else if (line.startsWith('## **Assistant**')) {
				// Save previous message if exists
				if (currentRole && currentContent.length > 0) {
					this.messages.push({
						role: currentRole,
						content: currentContent.join('\n').trim(),
						timestamp: currentTimestamp
					});
				}
				currentRole = 'assistant';
				currentContent = [];
			} else if (currentRole && line.trim() !== '' && !line.startsWith('#') && !line.startsWith('**Date:**') && !line.startsWith('**Time:**')) {
				currentContent.push(line);
			}
		}

		// Save last message
		if (currentRole && currentContent.length > 0) {
			this.messages.push({
				role: currentRole,
				content: currentContent.join('\n').trim(),
				timestamp: currentTimestamp
			});
		}

		// Limit to last 20 messages to avoid overwhelming the UI
		if (this.messages.length > 20) {
			this.messages = this.messages.slice(-20);
		}
	}

	async onClose(): Promise<void> {
		// Save session when closing
		if (this.messages.length > 0) {
			await this.saveSession();
		}
	}
}
