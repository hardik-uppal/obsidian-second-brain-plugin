import { App, TFile, Notice } from 'obsidian';
import { PluginSettings, CalendarEvent, Transaction } from '../types';

/**
 * Configuration for different types of linking rules
 */
export interface LinkingRulesConfig {
	enabled: boolean;
	
	timeBasedRules: {
		enabled: boolean;
		windowMinutes: number; // Time window for matching (e.g., 120 for 2 hours)
		autoApplyThreshold: number; // Confidence threshold for auto-application
	};
	
	entityRules: {
		enabled: boolean;
		fuzzyMatchThreshold: number; // 0.8 for 80% similarity
		enabledTypes: ('person' | 'company' | 'location' | 'vendor')[];
	};
	
	locationRules: {
		enabled: boolean;
		radiusMeters: number; // Geographic proximity radius
		includeVenues: boolean; // Match venue names without coordinates
	};
	
	categoryRules: {
		enabled: boolean;
		useExistingTags: boolean;
		projectTagPattern: string; // "project:*"
		categoryTagPattern: string; // "category:*"
	};
	
	uidRules: {
		enabled: boolean;
		uidSources: string[]; // ['ical_uid', 'transaction_id', 'event_id']
		autoApply: boolean;
	};
	
	autoApplication: {
		highConfidenceThreshold: number;  // 0.85 - auto-apply
		mediumConfidenceThreshold: number; // 0.5 - suggest to user
		maxLinksPerNote: number; // 10 - prevent link spam
	};
	
	llmEnhancement: {
		enabled: boolean;
		enhanceExistingRules: boolean;
		generateNewConnections: boolean;
	};
}

/**
 * Represents a potential link between two notes
 */
export interface LinkSuggestion {
	id: string;
	sourceNoteId: string;
	sourceNotePath: string;
	targetNoteId: string;
	targetNotePath: string;
	
	linkType: 'time-based' | 'entity-based' | 'location-based' | 'category-based' | 'uid-based' | 'llm-suggested';
	confidence: number; // 0-1
	
	// Evidence for the link
	evidence: {
		rule: string;
		matchedEntities?: string[];
		timeWindow?: number;
		locationDistance?: number;
		commonTags?: string[];
		uidMatch?: string;
		llmReasoning?: string;
	};
	
	// Link metadata
	metadata: {
		bidirectional: boolean; // Should link be created in both directions
		linkText?: string; // Custom link text
		createdAt: string;
	};
}

/**
 * Result of link analysis for a note
 */
export interface LinkAnalysisResult {
	noteId: string;
	notePath: string;
	suggestions: LinkSuggestion[];
	autoAppliedLinks: LinkSuggestion[];
	queuedForReview: LinkSuggestion[];
	rejected: LinkSuggestion[];
}

/**
 * Item in the enhancement queue for two-phase processing
 */
export interface EnhancementQueueItem {
	noteId: string;
	notePath: string;
	source: 'calendar' | 'transaction' | 'manual' | 'chat';
	sourceData: any;
	priority: 'high' | 'medium' | 'low';
	queuedAt: string;
	attempts: number;
	lastAttempt?: string;
	status: 'queued' | 'processing' | 'completed' | 'failed';
}

/**
 * Service for automatically discovering and creating links between notes
 */
export class NoteLinkingService {
	private app: App;
	private settings: PluginSettings;
	private config: LinkingRulesConfig;
	
	// Cache for performance
	private noteCache: Map<string, { file: TFile; frontmatter: any; content: string }> = new Map();
	private entityIndex: Map<string, Set<string>> = new Map(); // entity -> note paths
	private tagIndex: Map<string, Set<string>> = new Map(); // tag -> note paths
	
	// Track applied links to prevent duplicates and infinite loops
	private appliedLinks: Set<string> = new Set(); // "sourceId->targetId" format
	private linkHistory: Map<string, string[]> = new Map(); // notePath -> array of linked paths
	
	// Enhancement queue for two-phase processing
	private enhancementQueue: EnhancementQueueItem[] = [];
	private queueFilePath: string;
	
	constructor(app: App, settings: PluginSettings) {
		this.app = app;
		this.settings = settings;
		this.config = this.getDefaultConfig();
		this.queueFilePath = `${this.app.vault.configDir}/plugins/obsidian-second-brain-plugin/enhancement-queue.json`;
	}
	
	/**
	 * Initialize the service and build indices
	 */
	async initialize(): Promise<void> {
		console.log('🔗 Initializing Note Linking Service...');
		
		if (!this.config.enabled) {
			console.log('📝 Note linking is disabled');
			return;
		}
		
		// Build indices from existing notes
		await this.buildNoteIndices();
		
		console.log('✅ Note Linking Service initialized');
		console.log(`📊 Indexed ${this.noteCache.size} notes, ${this.entityIndex.size} entities, ${this.tagIndex.size} tags`);
	}
	
	/**
	 * Analyze a new note for potential links
	 */
	async analyzeNote(notePath: string): Promise<LinkAnalysisResult> {
		console.log(`🔍 Analyzing note for links: ${notePath}`);
		
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!file || !(file instanceof TFile)) {
			throw new Error(`Note not found: ${notePath}`);
		}
		
		// Get note metadata
		const noteData = await this.getNoteData(file);
		const suggestions: LinkSuggestion[] = [];
		
		// Apply different rule types
		if (this.config.timeBasedRules.enabled) {
			const timeLinks = await this.findTimeBasedLinks(noteData);
			suggestions.push(...timeLinks);
		}
		
		if (this.config.entityRules.enabled) {
			const entityLinks = await this.findEntityBasedLinks(noteData);
			suggestions.push(...entityLinks);
		}
		
		if (this.config.locationRules.enabled) {
			const locationLinks = await this.findLocationBasedLinks(noteData);
			suggestions.push(...locationLinks);
		}
		
		if (this.config.categoryRules.enabled) {
			const categoryLinks = await this.findCategoryBasedLinks(noteData);
			suggestions.push(...categoryLinks);
		}
		
		if (this.config.uidRules.enabled) {
			const uidLinks = await this.findUidBasedLinks(noteData);
			suggestions.push(...uidLinks);
		}
		
		// Add account-based linking for transactions
		if (this.config.entityRules.enabled && noteData.frontmatter?.type === 'transaction') {
			const accountLinks = await this.findAccountBasedLinks(noteData);
			suggestions.push(...accountLinks);
		}
		
		// Add calendar-specific linking for events
		if (this.config.entityRules.enabled && noteData.frontmatter?.type === 'calendar-event') {
			const attendeeLinks = await this.findAttendeeBasedLinks(noteData);
			suggestions.push(...attendeeLinks);
			
			const meetingSeriesLinks = await this.findMeetingSeriesLinks(noteData);
			suggestions.push(...meetingSeriesLinks);
		}
		
		// Sort by confidence and remove duplicates
		const uniqueSuggestions = this.deduplicateLinks(suggestions);
		const sortedSuggestions = uniqueSuggestions.sort((a, b) => b.confidence - a.confidence);
		
		// Apply confidence-based categorization
		const result = this.categorizeSuggestions(notePath, sortedSuggestions);
		
		console.log(`📋 Found ${suggestions.length} potential links, ${result.autoAppliedLinks.length} auto-applied, ${result.queuedForReview.length} queued for review`);
		
		return result;
	}
	
	/**
	 * Apply high-confidence links automatically
	 */
	async applyHighConfidenceLinks(suggestions: LinkSuggestion[]): Promise<number> {
		let applied = 0;
		
		for (const suggestion of suggestions) {
			if (suggestion.confidence >= this.config.autoApplication.highConfidenceThreshold) {
				// Check if link already exists to prevent duplicates
				if (this.isLinkAlreadyApplied(suggestion)) {
					console.log(`⏭️ Skipping duplicate link: ${suggestion.sourceNotePath} → ${suggestion.targetNotePath}`);
					continue;
				}
				
				try {
					await this.applyLink(suggestion);
					applied++;
				} catch (error) {
					console.error(`Failed to apply link: ${error}`);
				}
			}
		}
		
		if (applied > 0) {
			new Notice(`🔗 Applied ${applied} automatic links`);
		}
		
		return applied;
	}
	
	/**
	 * Find links based on time proximity
	 */
	private async findTimeBasedLinks(noteData: any): Promise<LinkSuggestion[]> {
		const suggestions: LinkSuggestion[] = [];
		
		// Extract time information from the note
		const noteTime = this.extractTimeFromNote(noteData);
		if (!noteTime) {
			return suggestions;
		}
		
		// Get intelligent time window based on note type
		const windowMs = this.getTimeWindowForNoteType(noteData) * 60 * 1000;
		
		// Search through other notes for time matches
		for (const [path, cachedNote] of this.noteCache) {
			if (path === noteData.file.path) continue;
			
			const otherTime = this.extractTimeFromNote(cachedNote);
			if (!otherTime) continue;
			
			const timeDiff = Math.abs(noteTime.getTime() - otherTime.getTime());
			if (timeDiff <= windowMs) {
				const confidence = this.calculateTimeBasedConfidence(timeDiff, windowMs, noteData, cachedNote);
				
				suggestions.push({
					id: this.generateLinkId(),
					sourceNoteId: noteData.file.path,
					sourceNotePath: noteData.file.path,
					targetNoteId: path,
					targetNotePath: path,
					linkType: 'time-based',
					confidence,
					evidence: {
						rule: 'time-proximity',
						timeWindow: Math.round(timeDiff / (60 * 1000)) // minutes
					},
					metadata: {
						bidirectional: true,
						createdAt: new Date().toISOString()
					}
				});
			}
		}
		
		return suggestions;
	}

	/**
	 * Get intelligent time window based on note type and context
	 */
	private getTimeWindowForNoteType(noteData: any): number {
		const noteType = noteData.frontmatter?.type;
		const baseWindow = this.config.timeBasedRules.windowMinutes;
		
		switch (noteType) {
			case 'calendar-event':
				// Calendar events: tight window for same-day events, wider for meetings
				const meetingType = noteData.frontmatter?.meeting_type;
				if (meetingType === 'meeting' || meetingType === 'conference') {
					return 480; // 8 hours for meetings/conferences
				}
				return 240; // 4 hours for other events
			
			case 'transaction':
				// Transactions: same day for shopping, wider for travel/large purchases
				const amount = parseFloat(noteData.frontmatter?.amount || '0');
				const category = noteData.frontmatter?.category?.toLowerCase() || '';
				
				if (category.includes('travel') || category.includes('hotel') || category.includes('transport')) {
					return 2880; // 48 hours for travel-related
				}
				if (amount > 500) {
					return 1440; // 24 hours for large purchases
				}
				return 720; // 12 hours for regular transactions
			
			case 'chat-thread':
				// Chat threads: shorter window for conversation context
				return 120; // 2 hours
			
			case 'note-enhancement':
				// Enhanced notes: wider window for research/project work
				return 1440; // 24 hours
			
			default:
				// Default notes: use base configuration
				return baseWindow;
		}
	}
	
	/**
	 * Find links based on entity matching (people, companies, locations)
	 */
	private async findEntityBasedLinks(noteData: any): Promise<LinkSuggestion[]> {
		const suggestions: LinkSuggestion[] = [];
		
		// Extract entities from the note
		const entities = this.extractEntitiesFromNote(noteData);
		
		for (const entity of entities) {
			// Find other notes containing this entity
			const relatedNotes = this.entityIndex.get(entity.toLowerCase()) || new Set();
			
			for (const targetPath of relatedNotes) {
				if (targetPath === noteData.file.path) continue;
				
				const confidence = this.calculateEntityBasedConfidence(entity, noteData, targetPath);
				
				if (confidence >= this.config.entityRules.fuzzyMatchThreshold) {
					suggestions.push({
						id: this.generateLinkId(),
						sourceNoteId: noteData.file.path,
						sourceNotePath: noteData.file.path,
						targetNoteId: targetPath,
						targetNotePath: targetPath,
						linkType: 'entity-based',
						confidence,
						evidence: {
							rule: 'entity-match',
							matchedEntities: [entity]
						},
						metadata: {
							bidirectional: true,
							createdAt: new Date().toISOString()
						}
					});
				}
			}
		}
		
		return suggestions;
	}
	
	/**
	 * Find links based on location proximity
	 */
	private async findLocationBasedLinks(noteData: any): Promise<LinkSuggestion[]> {
		const suggestions: LinkSuggestion[] = [];
		
		// Extract location from note
		const noteLocation = this.extractLocationFromNote(noteData);
		if (!noteLocation) return suggestions;
		
		// Find notes with similar locations
		for (const [path, cachedNote] of this.noteCache) {
			if (path === noteData.file.path) continue;
			
			const otherLocation = this.extractLocationFromNote(cachedNote);
			if (!otherLocation) continue;
			
			const distance = this.calculateLocationDistance(noteLocation, otherLocation);
			
			if (distance <= this.config.locationRules.radiusMeters) {
				const confidence = this.calculateLocationBasedConfidence(distance);
				
				suggestions.push({
					id: this.generateLinkId(),
					sourceNoteId: noteData.file.path,
					sourceNotePath: noteData.file.path,
					targetNoteId: path,
					targetNotePath: path,
					linkType: 'location-based',
					confidence,
					evidence: {
						rule: 'location-proximity',
						locationDistance: distance
					},
					metadata: {
						bidirectional: true,
						createdAt: new Date().toISOString()
					}
				});
			}
		}
		
		return suggestions;
	}
	
	/**
	 * Find links based on category/tag similarity
	 */
	private async findCategoryBasedLinks(noteData: any): Promise<LinkSuggestion[]> {
		const suggestions: LinkSuggestion[] = [];
		
		const noteTags = this.extractTagsFromNote(noteData);
		
		// Find notes with overlapping tags
		const relatedNotes = new Map<string, Set<string>>(); // path -> common tags
		
		for (const tag of noteTags) {
			const notesWithTag = this.tagIndex.get(tag) || new Set();
			
			for (const targetPath of notesWithTag) {
				if (targetPath === noteData.file.path) continue;
				
				if (!relatedNotes.has(targetPath)) {
					relatedNotes.set(targetPath, new Set());
				}
				relatedNotes.get(targetPath)!.add(tag);
			}
		}
		
		// Create suggestions for notes with sufficient tag overlap
		for (const [targetPath, commonTags] of relatedNotes) {
			if (commonTags.size >= 2) { // Require at least 2 common tags
				const confidence = this.calculateCategoryBasedConfidence(noteTags, Array.from(commonTags));
				
				suggestions.push({
					id: this.generateLinkId(),
					sourceNoteId: noteData.file.path,
					sourceNotePath: noteData.file.path,
					targetNoteId: targetPath,
					targetNotePath: targetPath,
					linkType: 'category-based',
					confidence,
					evidence: {
						rule: 'tag-overlap',
						commonTags: Array.from(commonTags)
					},
					metadata: {
						bidirectional: true,
						createdAt: new Date().toISOString()
					}
				});
			}
		}
		
		return suggestions;
	}
	
	/**
	 * Find links based on UID matching
	 */
	private async findUidBasedLinks(noteData: any): Promise<LinkSuggestion[]> {
		const suggestions: LinkSuggestion[] = [];
		
		const noteUids = this.extractUidsFromNote(noteData);
		
		for (const uid of noteUids) {
			// Find other notes with the same UID
			for (const [path, cachedNote] of this.noteCache) {
				if (path === noteData.file.path) continue;
				
				const otherUids = this.extractUidsFromNote(cachedNote);
				
				if (otherUids.includes(uid)) {
					suggestions.push({
						id: this.generateLinkId(),
						sourceNoteId: noteData.file.path,
						sourceNotePath: noteData.file.path,
						targetNoteId: path,
						targetNotePath: path,
						linkType: 'uid-based',
						confidence: 0.95, // UID matches are very high confidence
						evidence: {
							rule: 'uid-match',
							uidMatch: uid
						},
						metadata: {
							bidirectional: true,
							createdAt: new Date().toISOString()
						}
					});
				}
			}
		}
		
		return suggestions;
	}
	
	/**
	 * Find links based on account matching (for financial transactions)
	 */
	private async findAccountBasedLinks(noteData: any): Promise<LinkSuggestion[]> {
		const suggestions: LinkSuggestion[] = [];
		
		// Extract account information from the note
		const noteAccount = noteData.frontmatter?.account || noteData.frontmatter?.account_id;
		if (!noteAccount) return suggestions;
		
		// Find other transaction notes with the same account
		for (const [path, cachedNote] of this.noteCache) {
			if (path === noteData.file.path) continue;
			
			// Only link transaction notes
			if (cachedNote.frontmatter?.type !== 'transaction') continue;
			
			const otherAccount = cachedNote.frontmatter?.account || cachedNote.frontmatter?.account_id;
			if (!otherAccount || otherAccount !== noteAccount) continue;
			
			// Calculate confidence based on additional factors
			let confidence = 0.8; // High confidence for same account
			
			// Boost confidence for similar amounts
			const noteAmount = parseFloat(noteData.frontmatter?.amount || '0');
			const otherAmount = parseFloat(cachedNote.frontmatter?.amount || '0');
			if (noteAmount > 0 && otherAmount > 0) {
				const amountDiff = Math.abs(noteAmount - otherAmount);
				if (amountDiff <= 10) { // Within $10
					confidence += 0.1;
				}
			}
			
			// Boost confidence for same category
			const noteCategory = noteData.frontmatter?.category;
			const otherCategory = cachedNote.frontmatter?.category;
			if (noteCategory && otherCategory && noteCategory === otherCategory) {
				confidence += 0.05;
			}
			
			suggestions.push({
				id: this.generateLinkId(),
				sourceNoteId: noteData.file.path,
				sourceNotePath: noteData.file.path,
				targetNoteId: path,
				targetNotePath: path,
				linkType: 'entity-based',
				confidence: Math.min(0.95, confidence),
				evidence: {
					rule: 'account-match',
					matchedEntities: [noteAccount]
				},
				metadata: {
					bidirectional: true,
					createdAt: new Date().toISOString()
				}
			});
		}
		
		return suggestions;
	}
	
	/**
	 * Find links based on shared attendees (for calendar events)
	 */
	private async findAttendeeBasedLinks(noteData: any): Promise<LinkSuggestion[]> {
		const suggestions: LinkSuggestion[] = [];
		
		// Extract attendees from the current event
		const noteAttendees = this.extractAttendeesFromNote(noteData);
		if (noteAttendees.length === 0) return suggestions;
		
		// Find other calendar events with overlapping attendees
		for (const [path, cachedNote] of this.noteCache) {
			if (path === noteData.file.path) continue;
			
			// Only link calendar events
			if (cachedNote.frontmatter?.type !== 'calendar-event') continue;
			
			const otherAttendees = this.extractAttendeesFromNote(cachedNote);
			if (otherAttendees.length === 0) continue;
			
			// Find common attendees
			const commonAttendees = noteAttendees.filter(attendee => 
				otherAttendees.includes(attendee)
			);
			
			if (commonAttendees.length > 0) {
				// Calculate confidence based on attendee overlap
				const overlapRatio = commonAttendees.length / Math.max(noteAttendees.length, otherAttendees.length);
				let confidence = 0.6 + (overlapRatio * 0.3); // 0.6-0.9 range
				
				// Boost confidence for exact attendee matches
				if (commonAttendees.length === noteAttendees.length && 
					commonAttendees.length === otherAttendees.length) {
					confidence = 0.95;
				}
				
				suggestions.push({
					id: this.generateLinkId(),
					sourceNoteId: noteData.file.path,
					sourceNotePath: noteData.file.path,
					targetNoteId: path,
					targetNotePath: path,
					linkType: 'entity-based',
					confidence: Math.min(0.95, confidence),
					evidence: {
						rule: 'attendee-overlap',
						matchedEntities: commonAttendees
					},
					metadata: {
						bidirectional: true,
						createdAt: new Date().toISOString()
					}
				});
			}
		}
		
		return suggestions;
	}
	
	/**
	 * Find links based on meeting series patterns (recurring meetings)
	 */
	private async findMeetingSeriesLinks(noteData: any): Promise<LinkSuggestion[]> {
		const suggestions: LinkSuggestion[] = [];
		
		const noteTitle = noteData.file.basename;
		const noteMeetingType = noteData.frontmatter?.meeting_type;
		
		// Find other events with similar patterns
		for (const [path, cachedNote] of this.noteCache) {
			if (path === noteData.file.path) continue;
			
			// Only link calendar events
			if (cachedNote.frontmatter?.type !== 'calendar-event') continue;
			
			const otherTitle = cachedNote.file.basename;
			const otherMeetingType = cachedNote.frontmatter?.meeting_type;
			
			let confidence = 0;
			const evidence: any = { rule: 'meeting-series' };
			
			// Check for exact meeting type match
			if (noteMeetingType && otherMeetingType && noteMeetingType === otherMeetingType) {
				confidence += 0.4;
				evidence.meetingTypeMatch = noteMeetingType;
			}
			
			// Check for title similarity (recurring meeting patterns)
			const titleSimilarity = this.calculateTitleSimilarity(noteTitle, otherTitle);
			if (titleSimilarity > 0.7) {
				confidence += titleSimilarity * 0.5;
				evidence.titleSimilarity = titleSimilarity;
			}
			
			// Check for same time slot patterns
			const timeSlotMatch = this.checkTimeSlotSimilarity(noteData, cachedNote);
			if (timeSlotMatch) {
				confidence += 0.3;
				evidence.timeSlotMatch = true;
			}
			
			// Only suggest if confidence is reasonable
			if (confidence >= 0.6) {
				suggestions.push({
					id: this.generateLinkId(),
					sourceNoteId: noteData.file.path,
					sourceNotePath: noteData.file.path,
					targetNoteId: path,
					targetNotePath: path,
					linkType: 'category-based',
					confidence: Math.min(0.95, confidence),
					evidence,
					metadata: {
						bidirectional: true,
						createdAt: new Date().toISOString()
					}
				});
			}
		}
		
		return suggestions;
	}
	
	/**
	 * Apply a link suggestion by modifying the source note
	 */
	private async applyLink(suggestion: LinkSuggestion): Promise<void> {
		const sourceFile = this.app.vault.getAbstractFileByPath(suggestion.sourceNotePath);
		if (!sourceFile || !(sourceFile instanceof TFile)) {
			throw new Error(`Source file not found: ${suggestion.sourceNotePath}`);
		}

		// Double-check for existing link before applying
		if (this.isLinkAlreadyApplied(suggestion)) {
			console.log(`⏭️ Link already exists, skipping: ${suggestion.sourceNotePath} → ${suggestion.targetNotePath}`);
			return;
		}
		
		const content = await this.app.vault.read(sourceFile);
		
		// Create link text with reason
		const targetTitle = this.getNoteTitleFromPath(suggestion.targetNotePath);
		const linkText = suggestion.metadata.linkText || targetTitle;
		const linkMarkdown = `[[${suggestion.targetNotePath.replace('.md', '')}|${linkText}]]`;
		const linkReason = this.generateLinkReason(suggestion);
		const linkWithReason = `- ${linkMarkdown} *(${linkReason})*`;
		
		// Check if link already exists in content
		if (this.linkExistsInContent(content, linkMarkdown, suggestion.targetNotePath)) {
			console.log(`⏭️ Link already exists in content: ${suggestion.sourceNotePath} → ${suggestion.targetNotePath}`);
			this.markLinkAsApplied(suggestion);
			return;
		}
		
		// Add link to Related section or create one
		const updatedContent = this.addLinkToNote(content, linkWithReason, suggestion.linkType);
		
		await this.app.vault.modify(sourceFile, updatedContent);
		
		// Mark link as applied to prevent duplicates
		this.markLinkAsApplied(suggestion);
		
		// Update cache with new content
		await this.updateNoteCache(sourceFile);
		
		// Apply bidirectional link if specified (with recursion protection)
		if (suggestion.metadata.bidirectional && !this.isReverseLinkAlreadyApplied(suggestion)) {
			await this.applyBacklink(suggestion);
		}
		
		console.log(`🔗 Applied ${suggestion.linkType} link: ${suggestion.sourceNotePath} → ${suggestion.targetNotePath}`);
	}
	
	// Helper methods for data extraction and calculations
	
	private extractTimeFromNote(noteData: any): Date | null {
		// Try frontmatter first - for calendar events with specific time
		if (noteData.frontmatter?.date) {
			// For events with start time, combine date and time
			if (noteData.frontmatter?.['start-time'] || noteData.frontmatter?.start_time) {
				const dateStr = noteData.frontmatter.date;
				const timeStr = noteData.frontmatter['start-time'] || noteData.frontmatter.start_time;
				const datetime = new Date(`${dateStr}T${timeStr}`);
				if (!isNaN(datetime.getTime())) {
					return datetime;
				}
			}
			
			// For transactions, use date only (but set a consistent time to avoid 0 minute differences)
			if (noteData.frontmatter?.type === 'transaction') {
				const date = new Date(noteData.frontmatter.date);
				if (!isNaN(date.getTime())) {
					// Set time to noon to avoid timezone issues and provide meaningful time differences
					date.setHours(12, 0, 0, 0);
					return date;
				}
			}
			
			// For other notes, try to parse date directly
			const date = new Date(noteData.frontmatter.date);
			if (!isNaN(date.getTime())) {
				return date;
			}
		}
		
		return null;
	}
	
	private extractEntitiesFromNote(noteData: any): string[] {
		const entities: Set<string> = new Set();
		
		// Extract from frontmatter - Transaction fields with descriptive prefixes
		if (noteData.frontmatter?.merchant) {
			entities.add(`merchant:${noteData.frontmatter.merchant}`);
		}
		
		// Extract account information for transaction linking with descriptive prefix
		if (noteData.frontmatter?.account || noteData.frontmatter?.account_id) {
			const accountId = noteData.frontmatter.account || noteData.frontmatter.account_id;
			entities.add(`account:${accountId}`);
		}
		
		// Extract category for categorical linking with descriptive prefix
		if (noteData.frontmatter?.category) {
			entities.add(`category:${noteData.frontmatter.category}`);
		}
		
		// Extract currency for currency-based linking
		if (noteData.frontmatter?.currency || noteData.frontmatter?.iso_currency_code) {
			const currency = noteData.frontmatter.currency || noteData.frontmatter.iso_currency_code;
			entities.add(`currency:${currency}`);
		}
		
		// Extract calendar event specific entities
		if (noteData.frontmatter?.attendees) {
			const attendees = Array.isArray(noteData.frontmatter.attendees) 
				? noteData.frontmatter.attendees 
				: noteData.frontmatter.attendees.split(',').map((a: string) => a.trim());
			attendees.forEach((attendee: string) => {
				if (attendee && attendee.length > 0) {
					// Clean up email addresses to just names where possible
					const cleanAttendee = this.cleanAttendeeForEntity(attendee);
					entities.add(`attendee:${cleanAttendee}`);
				}
			});
		}
		
		// Extract meeting location for location-based linking
		if (noteData.frontmatter?.location) {
			entities.add(`location:${noteData.frontmatter.location}`);
		}
		
		// Extract calendar source for calendar-based grouping
		if (noteData.frontmatter?.calendar_source || noteData.frontmatter?.sourceCalendarName) {
			const calendarSource = noteData.frontmatter.calendar_source || noteData.frontmatter.sourceCalendarName;
			entities.add(`calendar:${calendarSource}`);
		}
		
		// Extract meeting type for pattern-based linking
		if (noteData.frontmatter?.meeting_type) {
			entities.add(`meeting-type:${noteData.frontmatter.meeting_type}`);
		}
		
		// Extract organizer information
		if (noteData.frontmatter?.organizer) {
			const cleanOrganizer = this.cleanAttendeeForEntity(noteData.frontmatter.organizer);
			entities.add(`organizer:${cleanOrganizer}`);
		}
		
		// Extract event status for filtering
		if (noteData.frontmatter?.status) {
			entities.add(`status:${noteData.frontmatter.status}`);
		}
		
		// Extract recurring meeting patterns from title
		if (noteData.frontmatter?.type === 'calendar-event') {
			const title = noteData.file.basename;
			const recurringPatterns = this.extractRecurringPatterns(title);
			recurringPatterns.forEach(pattern => entities.add(pattern));
		}
		
		// Extract from title and content (basic regex for now)
		const text = `${noteData.file.basename} ${noteData.content}`;
		
		// Simple patterns for entities - can be enhanced with NLP
		const patterns = [
			/([A-Z][a-z]+ [A-Z][a-z]+)/g, // Person names
			/([A-Z][a-z]+(?: [A-Z][a-z]+)* (?:Corp|Inc|LLC|Ltd))/g, // Company names
		];
		
		for (const pattern of patterns) {
			const matches = text.match(pattern) || [];
			matches.forEach(match => entities.add(match.trim()));
		}
		
		return Array.from(entities);
	}
	
	private extractLocationFromNote(noteData: any): { name: string; lat?: number; lng?: number } | null {
		if (noteData.frontmatter?.location) {
			return { name: noteData.frontmatter.location };
		}
		
		// Look for location in content
		const locationRegex = /(?:at|@)\s+([^,\n]+)/gi;
		const match = noteData.content.match(locationRegex);
		if (match) {
			return { name: match[0].replace(/(?:at|@)\s+/i, '').trim() };
		}
		
		return null;
	}
	
	private extractTagsFromNote(noteData: any): string[] {
		const tags: Set<string> = new Set();
		
		// From frontmatter
		if (noteData.frontmatter?.tags) {
			const noteTags = Array.isArray(noteData.frontmatter.tags) 
				? noteData.frontmatter.tags 
				: [noteData.frontmatter.tags];
			noteTags.forEach((tag: string) => tags.add(tag));
		}
		
		// From content (#tags)
		const tagRegex = /#([a-zA-Z0-9_-]+)/g;
		const matches = noteData.content.match(tagRegex) || [];
		matches.forEach(match => tags.add(match.substring(1)));
		
		return Array.from(tags);
	}
	
	/**
	 * Extract recurring meeting patterns from event titles
	 */
	private extractRecurringPatterns(title: string): string[] {
		const patterns: string[] = [];
		const lowerTitle = title.toLowerCase();
		
		// Extract meeting series patterns
		const recurringKeywords = [
			'weekly', 'daily', 'monthly', 'quarterly',
			'standup', 'sync', 'check-in', 'review',
			'scrum', 'sprint', 'planning', 'retrospective',
			'1:1', 'one-on-one', 'team meeting'
		];
		
		for (const keyword of recurringKeywords) {
			if (lowerTitle.includes(keyword)) {
				patterns.push(`meeting-type:${keyword}`);
			}
		}
		
		// Extract project/team patterns
		const projectRegex = /(?:project\s+|team\s+)([a-zA-Z0-9\s]+?)(?:\s+|$)/gi;
		const projectMatches = title.match(projectRegex);
		if (projectMatches) {
			projectMatches.forEach(match => {
				const cleanMatch = match.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
				patterns.push(`project:${cleanMatch}`);
			});
		}
		
		// Extract time-based patterns
		if (lowerTitle.includes('monday') || lowerTitle.includes('weekly')) {
			patterns.push('recurring:weekly');
		}
		if (lowerTitle.includes('daily') || lowerTitle.includes('standup')) {
			patterns.push('recurring:daily');
		}
		
		return patterns;
	}

	/**
	 * Clean attendee/organizer strings for better entity matching
	 */
	private cleanAttendeeForEntity(attendee: string): string {
		// Remove email domains but keep names
		if (attendee.includes('@')) {
			const parts = attendee.split('@');
			const namePart = parts[0];
			
			// If the name part looks like a real name (contains dots or multiple words), use it
			if (namePart.includes('.') || namePart.includes(' ')) {
				return namePart.replace(/\./g, ' ').trim();
			}
			
			// Otherwise, return the full email for entity matching
			return attendee.toLowerCase();
		}
		
		// Clean up display names
		return attendee.replace(/[<>]/g, '').trim();
	}
	
	private extractUidsFromNote(noteData: any): string[] {
		const uids: string[] = [];
		
		for (const source of this.config.uidRules.uidSources) {
			if (noteData.frontmatter?.[source]) {
				uids.push(noteData.frontmatter[source]);
			}
		}
		
		return uids;
	}
	
	// Calendar-specific helper methods
	
	/**
	 * Extract attendees from calendar event note
	 */
	private extractAttendeesFromNote(noteData: any): string[] {
		const attendees: string[] = [];
		
		if (noteData.frontmatter?.attendees) {
			if (Array.isArray(noteData.frontmatter.attendees)) {
				attendees.push(...noteData.frontmatter.attendees);
			} else if (typeof noteData.frontmatter.attendees === 'string') {
				// Handle comma-separated string
				const attendeeList = noteData.frontmatter.attendees
					.split(',')
					.map((a: string) => a.trim())
					.filter((a: string) => a.length > 0);
				attendees.push(...attendeeList);
			}
		}
		
		return attendees;
	}
	
	/**
	 * Calculate title similarity for recurring meeting detection
	 */
	private calculateTitleSimilarity(title1: string, title2: string): number {
		// Simple similarity calculation based on common words
		const words1 = title1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
		const words2 = title2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
		
		if (words1.length === 0 || words2.length === 0) return 0;
		
		const commonWords = words1.filter(word => words2.includes(word));
		const totalWords = new Set([...words1, ...words2]).size;
		
		return commonWords.length / totalWords;
	}
	
	/**
	 * Check if two calendar events have similar time slots
	 */
	private checkTimeSlotSimilarity(noteData: any, otherNoteData: any): boolean {
		const startTime1 = noteData.frontmatter?.start_time || noteData.frontmatter?.['start-time'];
		const startTime2 = otherNoteData.frontmatter?.start_time || otherNoteData.frontmatter?.['start-time'];
		
		if (!startTime1 || !startTime2) return false;
		
		// Extract hour from time (e.g., "09:00" -> 9)
		const hour1 = parseInt(startTime1.split(':')[0]);
		const hour2 = parseInt(startTime2.split(':')[0]);
		
		// Consider times within 1 hour as similar slots
		return Math.abs(hour1 - hour2) <= 1;
	}
	
	// Confidence calculation methods
	
	private calculateTimeBasedConfidence(timeDiffMs: number, windowMs: number, noteData?: any, otherNoteData?: any): number {
		// Convert to minutes for easier calculation
		const timeDiffMinutes = timeDiffMs / (1000 * 60);
		
		// Base confidence calculation
		let baseConfidence: number;
		if (timeDiffMinutes < 1) {
			baseConfidence = 0.95; // Very high confidence for same time
		} else if (timeDiffMinutes <= 15) {
			baseConfidence = 0.9;  // High confidence for very close times
		} else if (timeDiffMinutes <= 60) {
			baseConfidence = 0.8;  // Good confidence for same hour
		} else if (timeDiffMinutes <= 240) { // 4 hours
			baseConfidence = 0.7;  // Medium confidence for related activities
		} else {
			// Gradually decrease confidence for larger gaps
			const ratio = 1 - (timeDiffMs / windowMs);
			baseConfidence = Math.max(0.5, ratio); // Minimum 0.5 confidence
		}
		
		// Apply intelligent adjustments based on note types
		if (noteData && otherNoteData) {
			const noteType = noteData.frontmatter?.type;
			const otherType = otherNoteData.frontmatter?.type;
			
			// Boost confidence for related note types
			if (noteType === 'transaction' && otherType === 'transaction') {
				// Same account transactions should have higher confidence
				const sameAccount = (noteData.frontmatter?.account_id === otherNoteData.frontmatter?.account_id);
				if (sameAccount) {
					baseConfidence = Math.min(0.95, baseConfidence + 0.1);
				}
			}
			
			if (noteType === 'calendar-event' && otherType === 'calendar-event') {
				// Same calendar events should have higher confidence
				const sameCalendar = (noteData.frontmatter?.calendar_source === otherNoteData.frontmatter?.calendar_source);
				if (sameCalendar) {
					baseConfidence = Math.min(0.95, baseConfidence + 0.1);
				}
			}
			
			// Cross-type relationships: transaction + calendar event
			if ((noteType === 'transaction' && otherType === 'calendar-event') ||
				(noteType === 'calendar-event' && otherType === 'transaction')) {
				// Slightly lower confidence for cross-type relationships
				baseConfidence = Math.max(0.5, baseConfidence - 0.1);
			}
		}
		
		return baseConfidence;
	}
	
	private calculateEntityBasedConfidence(entity: string, noteData: any, targetPath: string): number {
		// Extract entity type and value for more intelligent confidence scoring
		let entityType = 'unknown';
		let entityValue = entity;
		
		if (entity.includes(':')) {
			[entityType, entityValue] = entity.split(':', 2);
		}
		
		// Base confidence varies by entity type
		let baseConfidence = 0.7;
		switch (entityType) {
			case 'account':
				baseConfidence = 0.9; // Very high confidence for same account
				break;
			case 'merchant':
				baseConfidence = 0.85; // High confidence for same merchant
				break;
			case 'attendee':
				baseConfidence = 0.8; // High confidence for shared attendees
				break;
			case 'organizer':
				baseConfidence = 0.85; // High confidence for same organizer
				break;
			case 'location':
				baseConfidence = 0.75; // Good confidence for same location
				break;
			case 'calendar':
				baseConfidence = 0.8; // High confidence for same calendar source
				break;
			case 'category':
				baseConfidence = 0.6; // Medium confidence for same category
				break;
			case 'meeting-type':
				baseConfidence = 0.7; // Good confidence for meeting types
				break;
			case 'status':
				baseConfidence = 0.5; // Lower confidence for status matches
				break;
			default:
				baseConfidence = 0.7;
		}
		
		// Boost confidence if entity appears in title or is very specific
		if (noteData.file.basename.toLowerCase().includes(entityValue.toLowerCase())) {
			baseConfidence = Math.min(0.95, baseConfidence + 0.1);
		}
		
		// Additional boosts for specific entity types
		if (entityType === 'attendee' && entityValue.includes('@')) {
			// Email addresses are very specific - boost confidence
			baseConfidence = Math.min(0.95, baseConfidence + 0.05);
		}
		
		if (entityType === 'calendar' && (entityValue.includes('work') || entityValue.includes('personal'))) {
			// Specific calendar names are more reliable
			baseConfidence = Math.min(0.95, baseConfidence + 0.05);
		}
		
		return baseConfidence;
	}
	
	private calculateLocationBasedConfidence(distance: number): number {
		const maxDistance = this.config.locationRules.radiusMeters;
		const ratio = 1 - (distance / maxDistance);
		return Math.max(0.6, ratio); // Minimum 0.6 confidence
	}
	
	private calculateCategoryBasedConfidence(allTags: string[], commonTags: string[]): number {
		const ratio = commonTags.length / allTags.length;
		return Math.min(0.8, 0.5 + (ratio * 0.3)); // 0.5-0.8 range
	}
	
	// Utility methods
	
	private async buildNoteIndices(): Promise<void> {
		console.log('🏗️ Building note indices...');
		
		const files = this.app.vault.getMarkdownFiles();
		let indexedCount = 0;
		
		for (const file of files) {
			try {
				const noteData = await this.getNoteData(file);
				this.noteCache.set(file.path, noteData);
				
				// Build entity index
				const entities = this.extractEntitiesFromNote(noteData);
				for (const entity of entities) {
					const key = entity.toLowerCase();
					if (!this.entityIndex.has(key)) {
						this.entityIndex.set(key, new Set());
					}
					this.entityIndex.get(key)!.add(file.path);
				}
				
				// Build tag index
				const tags = this.extractTagsFromNote(noteData);
				for (const tag of tags) {
					if (!this.tagIndex.has(tag)) {
						this.tagIndex.set(tag, new Set());
					}
					this.tagIndex.get(tag)!.add(file.path);
				}
				
				indexedCount++;
			} catch (error) {
				console.error(`❌ Failed to index note ${file.path}:`, error);
			}
		}
		
		console.log(`📚 Indexed ${indexedCount} notes, ${this.entityIndex.size} entities, ${this.tagIndex.size} tags`);
	}
	
	private async getNoteData(file: TFile): Promise<any> {
		const content = await this.app.vault.read(file);
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
		
		return {
			file,
			content,
			frontmatter
		};
	}
	
	private deduplicateLinks(suggestions: LinkSuggestion[]): LinkSuggestion[] {
		const seen = new Set<string>();
		return suggestions.filter(suggestion => {
			// Create unique key for this link
			const key = `${suggestion.sourceNotePath}->${suggestion.targetNotePath}`;
			
			// Skip if we've already seen this exact link
			if (seen.has(key)) {
				return false;
			}
			
			// Skip if link has already been applied
			if (this.appliedLinks.has(key)) {
				console.log(`⏭️ Filtering out already applied link: ${key}`);
				return false;
			}
			
			// Skip if reverse link exists (avoid bidirectional duplicates)
			const reverseKey = `${suggestion.targetNotePath}->${suggestion.sourceNotePath}`;
			if (this.appliedLinks.has(reverseKey)) {
				console.log(`⏭️ Filtering out reverse duplicate: ${key}`);
				return false;
			}
			
			seen.add(key);
			return true;
		});
	}
	
	private categorizeSuggestions(notePath: string, suggestions: LinkSuggestion[]): LinkAnalysisResult {
		const autoAppliedLinks: LinkSuggestion[] = [];
		const queuedForReview: LinkSuggestion[] = [];
		const rejected: LinkSuggestion[] = [];
		
		let appliedCount = 0;
		
		for (const suggestion of suggestions) {
			if (appliedCount >= this.config.autoApplication.maxLinksPerNote) {
				rejected.push(suggestion);
			} else if (suggestion.confidence >= this.config.autoApplication.highConfidenceThreshold) {
				autoAppliedLinks.push(suggestion);
				appliedCount++;
			} else if (suggestion.confidence >= this.config.autoApplication.mediumConfidenceThreshold) {
				queuedForReview.push(suggestion);
			} else {
				rejected.push(suggestion);
			}
		}
		
		return {
			noteId: notePath,
			notePath,
			suggestions,
			autoAppliedLinks,
			queuedForReview,
			rejected
		};
	}
	
	private generateLinkId(): string {
		return `link_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}
	
	private getNoteTitleFromPath(path: string): string {
		return path.replace(/\.md$/, '').split('/').pop() || path;
	}
	
	/**
	 * Generate a human-readable reason for why a link was created
	 */
	private generateLinkReason(suggestion: LinkSuggestion): string {
		const evidence = suggestion.evidence;
		
		switch (suggestion.linkType) {
			case 'time-based':
				const timeWindow = evidence.timeWindow || 0;
				return `occurred ${timeWindow}min apart`;
			
			case 'entity-based':
				if (evidence.matchedEntities && evidence.matchedEntities.length > 0) {
					const entities = evidence.matchedEntities.slice(0, 2).join(', '); // Show max 2 entities
					return `shared: ${entities}`;
				}
				return 'common entity';
			
			case 'location-based':
				const distance = evidence.locationDistance || 0;
				return distance === 0 ? 'same location' : `${distance}m apart`;
			
			case 'category-based':
				if (evidence.commonTags && evidence.commonTags.length > 0) {
					const tags = evidence.commonTags.slice(0, 2).join(', ');
					return `tags: ${tags}`;
				}
				return 'related category';
			
			case 'uid-based':
				return `ID: ${evidence.uidMatch || 'exact match'}`;
			
			case 'llm-suggested':
				return evidence.llmReasoning || 'AI suggested';
			
			default:
				return `${suggestion.linkType} rule`;
		}
	}

	/**
	 * Analyze existing links in notes and assign retroactive rules/reasons
	 */
	async analyzeExistingLinks(forceReanalyze: boolean = false): Promise<{
		analyzed: number;
		updated: number;
		rules: Record<string, number>;
	}> {
		const allFiles = this.app.vault.getMarkdownFiles();
		let analyzed = 0;
		let updated = 0;
		const ruleCount: Record<string, number> = {};

		for (const file of allFiles) {
			const content = await this.app.vault.read(file);
			const existingLinks = this.extractExistingLinks(content);
			
			if (existingLinks.length === 0) continue;

			let fileUpdated = false;
			let newContent = content;

			for (const link of existingLinks) {
				analyzed++;
				
				// Skip if link already has a reason (unless force re-analyzing)
				if (link.reason && !forceReanalyze) continue;

				// Determine the rule that likely created this link
				const rule = await this.determineRetrospectiveRule(file, link);
				
				if (rule) {
					// Add reason to the link
					const reasonComment = ` <!-- ${rule.type}: ${rule.reason} -->`;
					
					if (link.reason && forceReanalyze) {
						// Replace existing reason
						const existingCommentRegex = new RegExp(`\\s*<!--\\s*[^>]+\\s*-->`, 'g');
						const linkWithoutComment = link.originalText.replace(existingCommentRegex, '');
						newContent = newContent.replace(
							link.originalText,
							linkWithoutComment + reasonComment
						);
					} else {
						// Add new reason
						newContent = newContent.replace(
							link.originalText,
							link.originalText + reasonComment
						);
					}
					
					ruleCount[rule.type] = (ruleCount[rule.type] || 0) + 1;
					fileUpdated = true;
				}
			}

			if (fileUpdated) {
				await this.app.vault.modify(file, newContent);
				updated++;
			}
		}

		return { analyzed, updated, rules: ruleCount };
	}

	/**
	 * Extract existing links from note content
	 */
	private extractExistingLinks(content: string): Array<{
		originalText: string;
		targetNote: string;
		reason?: string;
	}> {
		const links: Array<{ originalText: string; targetNote: string; reason?: string }> = [];
		
		// Match [[Note Name]] and [[Note Name|Display Text]] with optional comments
		const linkRegex = /\[\[([^\]]+)\]\](\s*<!--\s*([^>]+)\s*-->)?/g;
		let match;

		while ((match = linkRegex.exec(content)) !== null) {
			const [originalText, linkTarget, , reason] = match;
			
			// Extract actual note name (before any | alias)
			const noteName = linkTarget.split('|')[0].trim();
			
			links.push({
				originalText,
				targetNote: noteName,
				reason: reason?.trim()
			});
		}

		return links;
	}

	/**
	 * Determine which rule likely created a link by analyzing the notes
	 */
	private async determineRetrospectiveRule(sourceFile: TFile, link: {
		targetNote: string;
	}): Promise<{ type: string; reason: string } | null> {
		try {
			const targetFile = this.app.metadataCache.getFirstLinkpathDest(link.targetNote, sourceFile.path);
			if (!targetFile) return null;

			const [sourceContent, targetContent] = await Promise.all([
				this.app.vault.read(sourceFile),
				this.app.vault.read(targetFile)
			]);

			const sourceMetadata = this.app.metadataCache.getFileCache(sourceFile);
			const targetMetadata = this.app.metadataCache.getFileCache(targetFile);

			// Create note data objects for existing methods
			const sourceNoteData = { content: sourceContent, metadata: sourceMetadata, file: sourceFile };
			const targetNoteData = { content: targetContent, metadata: targetMetadata, file: targetFile };

			// Check for UID-based links first (most reliable)
			const sourceUIDs = this.extractUidsFromNote(sourceNoteData);
			const targetUIDs = this.extractUidsFromNote(targetNoteData);
			
			for (const uid of sourceUIDs) {
				if (targetUIDs.includes(uid)) {
					return { type: 'uid-based', reason: `ID: ${uid}` };
				}
			}

			// Check for time-based links
			const sourceTime = this.extractTimestampFromContent(sourceContent, sourceMetadata);
			const targetTime = this.extractTimestampFromContent(targetContent, targetMetadata);
			
			if (sourceTime && targetTime) {
				const timeDiff = Math.abs(sourceTime.getTime() - targetTime.getTime()) / (1000 * 60);
				if (timeDiff <= this.config.timeBasedRules.windowMinutes) {
					// Format time difference more intelligently
					let timeDescription: string;
					if (timeDiff < 1) {
						timeDescription = 'at the same time';
					} else if (timeDiff < 60) {
						timeDescription = `${Math.round(timeDiff)}min apart`;
					} else if (timeDiff < 1440) { // Less than 24 hours
						const hours = Math.round(timeDiff / 60);
						timeDescription = `${hours}h apart`;
					} else {
						const days = Math.round(timeDiff / 1440);
						timeDescription = `${days}d apart`;
					}
					
					return { type: 'time-based', reason: `occurred ${timeDescription}` };
				}
			}

			// Check for entity-based links
			const sourceEntities = this.extractEntitiesFromNote(sourceNoteData);
			const targetEntities = this.extractEntitiesFromNote(targetNoteData);
			const commonEntities = sourceEntities.filter(e => targetEntities.includes(e));
			
			if (commonEntities.length > 0) {
				// Format entities for better readability
				const formattedEntities = commonEntities.slice(0, 2).map(entity => {
					// Remove prefixes for better display
					if (entity.includes(':')) {
						const [type, value] = entity.split(':', 2);
						switch (type) {
							case 'account': return `account ${value}`;
							case 'merchant': return `merchant ${value}`;
							case 'category': return `category ${value}`;
							case 'attendee': return `attendee ${value}`;
							case 'location': return `location ${value}`;
							case 'calendar': return `calendar ${value}`;
							case 'meeting-type': return `meeting type ${value}`;
							default: return entity;
						}
					}
					return entity;
				}).join(', ');
				
				return { type: 'entity-based', reason: `shared: ${formattedEntities}` };
			}

			// Check for category-based links (tags)
			const sourceTags = sourceMetadata?.tags?.map(t => t.tag) || [];
			const targetTags = targetMetadata?.tags?.map(t => t.tag) || [];
			const commonTags = sourceTags.filter(t => targetTags.includes(t));
			
			if (commonTags.length > 0) {
				const tags = commonTags.slice(0, 2).join(', ');
				return { type: 'category-based', reason: `tags: ${tags}` };
			}

			// Default to manual/unknown
			return { type: 'manual', reason: 'user created' };

		} catch (error) {
			console.error('Error determining retrospective rule:', error);
			return null;
		}
	}

	/**
	 * Extract timestamp from content and metadata
	 */
	private extractTimestampFromContent(content: string, metadata: any): Date | null {
		// Try metadata first
		if (metadata?.frontmatter?.date) {
			const date = new Date(metadata.frontmatter.date);
			if (!isNaN(date.getTime())) return date;
		}

		// Try to find timestamps in content
		const isoDateRegex = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;
		const match = content.match(isoDateRegex);
		if (match) {
			const date = new Date(match[1]);
			if (!isNaN(date.getTime())) return date;
		}

		// Fall back to file creation/modification time would require file stats
		return null;
	}

	private addLinkToNote(content: string, linkMarkdown: string, linkType: string): string {
		// Look for Related section
		const relatedRegex = /## Related\s*\n([\s\S]*?)(?=\n## |$)/i;
		const match = content.match(relatedRegex);
		
		if (match) {
			// Add to existing Related section
			const existingRelated = match[1];
			const newRelated = existingRelated.trim() + `\n- ${linkMarkdown}`;
			return content.replace(relatedRegex, `## Related\n${newRelated}\n`);
		} else {
			// Add new Related section at the end
			return content.trim() + `\n\n## Related\n- ${linkMarkdown}\n`;
		}
	}
	
	// Link Management & Duplicate Prevention Methods
	
	/**
	 * Check if a link has already been applied between two notes
	 */
	private isLinkAlreadyApplied(suggestion: LinkSuggestion): boolean {
		const linkKey = `${suggestion.sourceNotePath}->${suggestion.targetNotePath}`;
		return this.appliedLinks.has(linkKey);
	}
	
	/**
	 * Check if the reverse link has already been applied
	 */
	private isReverseLinkAlreadyApplied(suggestion: LinkSuggestion): boolean {
		const reverseLinkKey = `${suggestion.targetNotePath}->${suggestion.sourceNotePath}`;
		return this.appliedLinks.has(reverseLinkKey);
	}
	
	/**
	 * Mark a link as applied to prevent future duplicates
	 */
	private markLinkAsApplied(suggestion: LinkSuggestion): void {
		const linkKey = `${suggestion.sourceNotePath}->${suggestion.targetNotePath}`;
		this.appliedLinks.add(linkKey);
		
		// Update link history
		if (!this.linkHistory.has(suggestion.sourceNotePath)) {
			this.linkHistory.set(suggestion.sourceNotePath, []);
		}
		const existingLinks = this.linkHistory.get(suggestion.sourceNotePath)!;
		if (!existingLinks.includes(suggestion.targetNotePath)) {
			existingLinks.push(suggestion.targetNotePath);
		}
	}
	
	/**
	 * Check if a link already exists in the note content
	 */
	private linkExistsInContent(content: string, linkMarkdown: string, targetPath: string): boolean {
		// Check for exact link markdown
		if (content.includes(linkMarkdown)) {
			return true;
		}
		
		// Check for various link formats
		const targetTitle = this.getNoteTitleFromPath(targetPath);
		const possibleLinkFormats = [
			`[[${targetPath.replace('.md', '')}]]`,
			`[[${targetPath.replace('.md', '')}|${targetTitle}]]`,
			`[[${targetTitle}]]`,
			linkMarkdown
		];
		
		return possibleLinkFormats.some(format => content.includes(format));
	}
	
	/**
	 * Update the note cache with fresh content after modification
	 */
	private async updateNoteCache(file: TFile): Promise<void> {
		try {
			const noteData = await this.getNoteData(file);
			this.noteCache.set(file.path, noteData);
		} catch (error) {
			console.error(`Failed to update cache for ${file.path}:`, error);
		}
	}
	
	/**
	 * Clear link tracking data (useful for testing)
	 */
	private clearLinkTracking(): void {
		this.appliedLinks.clear();
		this.linkHistory.clear();
		console.log('🧹 Cleared link tracking data');
	}
	
	private async applyBacklink(suggestion: LinkSuggestion): Promise<void> {
		// Create reverse link
		const reverseLink: LinkSuggestion = {
			...suggestion,
			sourceNoteId: suggestion.targetNoteId,
			sourceNotePath: suggestion.targetNotePath,
			targetNoteId: suggestion.sourceNoteId,
			targetNotePath: suggestion.sourceNotePath
		};
		
		await this.applyLink(reverseLink);
	}
	
	private calculateLocationDistance(loc1: any, loc2: any): number {
		// Simple string comparison for now
		// In a real implementation, you'd use geocoding and haversine formula
		if (loc1.name === loc2.name) {
			return 0;
		}
		
		// Check if one location name contains the other
		if (loc1.name.toLowerCase().includes(loc2.name.toLowerCase()) ||
			loc2.name.toLowerCase().includes(loc1.name.toLowerCase())) {
			return 50; // Assume they're close
		}
		
		return 1000; // Assume they're far
	}
	
	private getDefaultConfig(): LinkingRulesConfig {
		return {
			enabled: true,
			
			timeBasedRules: {
				enabled: true,
				windowMinutes: 240, // 4 hours default - will be adjusted per note type
				autoApplyThreshold: 0.8
			},
			
			entityRules: {
				enabled: true,
				fuzzyMatchThreshold: 0.7,
				enabledTypes: ['person', 'company', 'location', 'vendor']
			},
			
			locationRules: {
				enabled: true,
				radiusMeters: 500,
				includeVenues: true
			},
			
			categoryRules: {
				enabled: true,
				useExistingTags: true,
				projectTagPattern: 'project:*',
				categoryTagPattern: 'category:*'
			},
			
			uidRules: {
				enabled: true,
				uidSources: ['ical_uid', 'transaction_id', 'event_id'],
				autoApply: true
			},
			
			autoApplication: {
				highConfidenceThreshold: 0.85,
				mediumConfidenceThreshold: 0.5,
				maxLinksPerNote: 10
			},
			
			llmEnhancement: {
				enabled: false, // Will be enabled in Phase 2
				enhanceExistingRules: false,
				generateNewConnections: false
			}
		};
	}
	
	/**
	 * Update configuration
	 */
	updateConfig(newConfig: Partial<LinkingRulesConfig>): void {
		this.config = { ...this.config, ...newConfig };
		console.log('🔧 Updated linking rules configuration');
	}
	
	/**
	 * Update settings
	 */
	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
	}
	
	/**
	 * Refresh indices (call when notes are added/modified)
	 */
	async refreshIndices(): Promise<void> {
		this.noteCache.clear();
		this.entityIndex.clear();
		this.tagIndex.clear();
		
		// Clear link tracking to allow re-analysis
		this.clearLinkTracking();
		
		await this.buildNoteIndices();
		
		// Rebuild link tracking from existing note content
		await this.rebuildLinkTracking();
		
		console.log('🔄 Refreshed note linking indices and link tracking');
	}
	
	/**
	 * Rebuild link tracking by scanning existing note content
	 */
	private async rebuildLinkTracking(): Promise<void> {
		console.log('🔍 Rebuilding link tracking from existing notes...');
		
		for (const [path, noteData] of this.noteCache) {
			// Extract existing links from the note content
			const existingLinks = this.extractExistingLinksFromContent(noteData.content);
			
			// Mark these links as already applied
			for (const targetPath of existingLinks) {
				const linkKey = `${path}->${targetPath}`;
				this.appliedLinks.add(linkKey);
				
				// Update link history
				if (!this.linkHistory.has(path)) {
					this.linkHistory.set(path, []);
				}
				if (!this.linkHistory.get(path)!.includes(targetPath)) {
					this.linkHistory.get(path)!.push(targetPath);
				}
			}
		}
		
		console.log(`📊 Rebuilt tracking for ${this.appliedLinks.size} existing links`);
	}
	
	/**
	 * Extract existing links from note content
	 */
	private extractExistingLinksFromContent(content: string): string[] {
		const links: string[] = [];
		
		// Match all wiki-style links [[...]]
		const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
		let match;
		
		while ((match = linkRegex.exec(content)) !== null) {
			const linkTarget = match[1];
			
			// Convert to full path if needed
			let fullPath = linkTarget;
			if (!linkTarget.endsWith('.md')) {
				fullPath = `${linkTarget}.md`;
			}
			
			links.push(fullPath);
		}
		
		return links;
	}

	// Enhancement Queue Methods for Two-Phase Processing

	/**
	 * Add a note to the enhancement queue for later processing
	 */
	async queueForEnhancement(notePath: string, metadata: {
		source: 'calendar' | 'transaction' | 'manual' | 'chat';
		sourceData: any;
		priority?: 'high' | 'medium' | 'low';
	}): Promise<void> {
		const queueItem: EnhancementQueueItem = {
			noteId: notePath,
			notePath,
			source: metadata.source,
			sourceData: metadata.sourceData,
			priority: metadata.priority || 'medium',
			queuedAt: new Date().toISOString(),
			attempts: 0,
			status: 'queued'
		};

		// Check if already queued
		const existingIndex = this.enhancementQueue.findIndex(item => item.notePath === notePath);
		if (existingIndex >= 0) {
			this.enhancementQueue[existingIndex] = queueItem; // Update existing
		} else {
			this.enhancementQueue.push(queueItem);
		}

		await this.saveQueue();
		console.log(`📋 Queued note for enhancement: ${notePath} (${metadata.source})`);
	}

	/**
	 * Process the enhancement queue in batches
	 */
	async processEnhancementQueue(batchSize: number = 10): Promise<void> {
		await this.loadQueue();

		const itemsToProcess = this.enhancementQueue
			.filter(item => item.status === 'queued')
			.sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority))
			.slice(0, batchSize);

		if (itemsToProcess.length === 0) {
			console.log('📋 Enhancement queue is empty');
			return;
		}

		console.log(`🔄 Processing ${itemsToProcess.length} notes from enhancement queue...`);

		for (const item of itemsToProcess) {
			try {
				item.status = 'processing';
				item.attempts++;
				item.lastAttempt = new Date().toISOString();
				await this.saveQueue();

				// Process the note for linking suggestions
				const result = await this.analyzeNote(item.notePath);

				// Apply high-confidence links automatically
				await this.applyHighConfidenceLinks(result.autoAppliedLinks);

				// Send medium-confidence suggestions to the suggestion system
				if (result.queuedForReview.length > 0) {
					// This will be handled by the suggestion integration service
					console.log(`📝 Generated ${result.queuedForReview.length} suggestions for ${item.notePath}`);
				}

				item.status = 'completed';
				console.log(`✅ Enhanced note: ${item.notePath}`);

			} catch (error) {
				console.error(`❌ Failed to enhance note ${item.notePath}:`, error);
				item.status = 'failed';
			}

			await this.saveQueue();
		}

		console.log(`✅ Completed processing enhancement queue batch`);
	}

	/**
	 * Get the current size of the enhancement queue
	 */
	getQueueSize(): number {
		return this.enhancementQueue.filter(item => item.status === 'queued').length;
	}

	/**
	 * Get queue status information
	 */
	getQueueStatus(): {
		queued: number;
		processing: number;
		completed: number;
		failed: number;
		total: number;
	} {
		const status = {
			queued: 0,
			processing: 0,
			completed: 0,
			failed: 0,
			total: this.enhancementQueue.length
		};

		for (const item of this.enhancementQueue) {
			status[item.status]++;
		}

		return status;
	}

	/**
	 * Clear completed items from the queue
	 */
	async clearCompletedFromQueue(): Promise<void> {
		const originalLength = this.enhancementQueue.length;
		this.enhancementQueue = this.enhancementQueue.filter(item => 
			item.status !== 'completed' && item.status !== 'failed'
		);
		
		await this.saveQueue();
		
		const removed = originalLength - this.enhancementQueue.length;
		if (removed > 0) {
			console.log(`🧹 Cleared ${removed} completed items from enhancement queue`);
		}
	}

	/**
	 * Save the enhancement queue to disk
	 */
	private async saveQueue(): Promise<void> {
		try {
			const queueData = {
				queue: this.enhancementQueue,
				lastUpdated: new Date().toISOString()
			};

			await this.app.vault.adapter.write(this.queueFilePath, JSON.stringify(queueData, null, 2));
		} catch (error) {
			console.error('Failed to save enhancement queue:', error);
		}
	}

	/**
	 * Load the enhancement queue from disk
	 */
	private async loadQueue(): Promise<void> {
		try {
			const exists = await this.app.vault.adapter.exists(this.queueFilePath);
			if (!exists) {
				this.enhancementQueue = [];
				return;
			}

			const queueData = await this.app.vault.adapter.read(this.queueFilePath);
			const parsed = JSON.parse(queueData);
			this.enhancementQueue = parsed.queue || [];
		} catch (error) {
			console.error('Failed to load enhancement queue:', error);
			this.enhancementQueue = [];
		}
	}

	/**
	 * Get priority weight for sorting
	 */
	private priorityWeight(priority: 'high' | 'medium' | 'low'): number {
		switch (priority) {
			case 'high': return 3;
			case 'medium': return 2;
			case 'low': return 1;
			default: return 2;
		}
	}
}
