import { App, TFile, Notice } from 'obsidian';
import { PluginSettings, LLMSuggestion } from '../types';

/**
 * Handles applying approved suggestions to target notes
 */
export class SuggestionApplicationService {
	private app: App;
	private settings: PluginSettings;

	constructor(app: App, settings: PluginSettings) {
		this.app = app;
		this.settings = settings;
	}

	/**
	 * Apply a suggestion to its target note
	 */
	async applySuggestion(suggestion: LLMSuggestion): Promise<boolean> {
		try {
			if (!suggestion.targetNotePath) {
				throw new Error('No target note path specified');
			}

			const targetFile = this.app.vault.getAbstractFileByPath(suggestion.targetNotePath);
			if (!(targetFile instanceof TFile)) {
				throw new Error(`Target note not found: ${suggestion.targetNotePath}`);
			}

			const originalContent = await this.app.vault.read(targetFile);
			const enhancedContent = await this.enhanceContentWithSuggestion(originalContent, suggestion);
			
			// Only modify if content actually changed
			if (enhancedContent !== originalContent) {
				await this.app.vault.modify(targetFile, enhancedContent);
				console.log(`Applied suggestion ${suggestion.id} to ${suggestion.targetNotePath}`);
				return true;
			} else {
				console.log(`No changes needed for suggestion ${suggestion.id}`);
				return false;
			}
		} catch (error) {
			console.error(`Failed to apply suggestion ${suggestion.id}:`, error);
			throw error;
		}
	}

	/**
	 * Apply multiple suggestions in batch
	 */
	async applyMultipleSuggestions(suggestions: LLMSuggestion[]): Promise<{
		applied: number;
		failed: number;
		errors: string[];
	}> {
		const result = {
			applied: 0,
			failed: 0,
			errors: [] as string[]
		};

		for (const suggestion of suggestions) {
			try {
				const success = await this.applySuggestion(suggestion);
				if (success) {
					result.applied++;
				}
			} catch (error) {
				result.failed++;
				result.errors.push(`${suggestion.originalData.title}: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		}

		return result;
	}

	/**
	 * Enhance content with suggestion data
	 */
	private async enhanceContentWithSuggestion(
		originalContent: string,
		suggestion: LLMSuggestion
	): Promise<string> {
		let enhanced = originalContent;
		const suggestions = suggestion.suggestions;

		// Apply enhancements based on suggestion type
		switch (suggestion.type) {
			case 'calendar-event':
				enhanced = await this.enhanceCalendarEvent(enhanced, suggestions);
				break;
			case 'transaction':
				enhanced = await this.enhanceTransaction(enhanced, suggestions);
				break;
			case 'note-enhancement':
				enhanced = await this.enhanceNote(enhanced, suggestions);
				break;
			default:
				enhanced = await this.enhanceGeneric(enhanced, suggestions);
		}

		return enhanced;
	}

	/**
	 * Enhance calendar event note
	 */
	private async enhanceCalendarEvent(content: string, suggestions: LLMSuggestion['suggestions']): Promise<string> {
		let enhanced = content;

		// Add tags to frontmatter
		if (suggestions.tags?.length) {
			enhanced = this.addTagsToFrontmatter(enhanced, suggestions.tags);
		}

		// Add preparation section
		if (suggestions.preparationItems?.length) {
			enhanced = this.addOrUpdateSection(enhanced, 'Preparation', 
				suggestions.preparationItems.map(item => `- [ ] ${item}`).join('\n'));
		}

		// Add action items section
		if (suggestions.actionItems?.length) {
			enhanced = this.addOrUpdateSection(enhanced, 'Action Items',
				suggestions.actionItems.map(item => `- [ ] ${item}`).join('\n'));
		}

		// Add insights
		if (suggestions.insights) {
			enhanced = this.addOrUpdateSection(enhanced, 'AI Insights', suggestions.insights);
		}

		// Add related section with links
		if (suggestions.relationships?.length) {
			const relationships = suggestions.relationships.map(rel => `- [[${rel}]]`).join('\n');
			enhanced = this.addOrUpdateSection(enhanced, 'Related', relationships);
		}

		return enhanced;
	}

	/**
	 * Enhance transaction note
	 */
	private async enhanceTransaction(content: string, suggestions: LLMSuggestion['suggestions']): Promise<string> {
		let enhanced = content;

		// Add tags to frontmatter
		if (suggestions.tags?.length) {
			enhanced = this.addTagsToFrontmatter(enhanced, suggestions.tags);
		}

		// Add categories to frontmatter
		if (suggestions.categories?.length) {
			enhanced = this.addToFrontmatter(enhanced, 'categories', suggestions.categories);
		}

		// Add insights
		if (suggestions.insights) {
			enhanced = this.addOrUpdateSection(enhanced, 'Analysis', suggestions.insights);
		}

		// Add action items if any
		if (suggestions.actionItems?.length) {
			enhanced = this.addOrUpdateSection(enhanced, 'Action Items',
				suggestions.actionItems.map(item => `- [ ] ${item}`).join('\n'));
		}

		return enhanced;
	}

	/**
	 * Enhance general note
	 */
	private async enhanceNote(content: string, suggestions: LLMSuggestion['suggestions']): Promise<string> {
		let enhanced = content;

		// Add tags
		if (suggestions.tags?.length) {
			enhanced = this.addTagsToFrontmatter(enhanced, suggestions.tags);
		}

		// Add action items
		if (suggestions.actionItems?.length) {
			enhanced = this.addOrUpdateSection(enhanced, 'Action Items',
				suggestions.actionItems.map(item => `- [ ] ${item}`).join('\n'));
		}

		// Add insights
		if (suggestions.insights) {
			enhanced = this.addOrUpdateSection(enhanced, 'Key Insights', suggestions.insights);
		}

		// Add relationships
		if (suggestions.relationships?.length) {
			const relationships = suggestions.relationships.map(rel => `- [[${rel}]]`).join('\n');
			enhanced = this.addOrUpdateSection(enhanced, 'Related Notes', relationships);
		}

		return enhanced;
	}

	/**
	 * Generic enhancement for unknown types
	 */
	private async enhanceGeneric(content: string, suggestions: LLMSuggestion['suggestions']): Promise<string> {
		let enhanced = content;

		if (suggestions.tags?.length) {
			enhanced = this.addTagsToFrontmatter(enhanced, suggestions.tags);
		}

		if (suggestions.insights) {
			enhanced = this.addOrUpdateSection(enhanced, 'AI Suggestions', suggestions.insights);
		}

		return enhanced;
	}

	/**
	 * Add tags to frontmatter
	 */
	private addTagsToFrontmatter(content: string, newTags: string[]): string {
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
		const match = content.match(frontmatterRegex);

		if (match) {
			const frontmatter = match[1];
			let updatedFrontmatter = frontmatter;

			// Check if tags already exist
			const tagsRegex = /^tags:\s*(.*)$/m;
			const tagsMatch = frontmatter.match(tagsRegex);

			if (tagsMatch) {
				// Parse existing tags
				const existingTagsStr = tagsMatch[1].trim();
				let existingTags: string[] = [];

				if (existingTagsStr.startsWith('[') && existingTagsStr.endsWith(']')) {
					// Array format: [tag1, tag2]
					existingTags = existingTagsStr.slice(1, -1)
						.split(',')
						.map(tag => tag.trim().replace(/^["']|["']$/g, ''))
						.filter(tag => tag.length > 0);
				} else {
					// Simple format: tag1, tag2
					existingTags = existingTagsStr.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
				}

				// Merge with new tags (avoid duplicates)
				const allTags = [...new Set([...existingTags, ...newTags])];
				const tagsStr = `[${allTags.map(tag => `"${tag}"`).join(', ')}]`;
				updatedFrontmatter = frontmatter.replace(tagsRegex, `tags: ${tagsStr}`);
			} else {
				// Add new tags line
				const tagsStr = `[${newTags.map(tag => `"${tag}"`).join(', ')}]`;
				updatedFrontmatter = frontmatter + `\ntags: ${tagsStr}`;
			}

			return content.replace(frontmatterRegex, `---\n${updatedFrontmatter}\n---\n`);
		} else {
			// No frontmatter exists, create it
			const tagsStr = `[${newTags.map(tag => `"${tag}"`).join(', ')}]`;
			const newFrontmatter = `---\ntags: ${tagsStr}\n---\n\n`;
			return newFrontmatter + content;
		}
	}

	/**
	 * Add field to frontmatter
	 */
	private addToFrontmatter(content: string, field: string, values: string[]): string {
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
		const match = content.match(frontmatterRegex);

		if (match) {
			const frontmatter = match[1];
			const valuesStr = `[${values.map(val => `"${val}"`).join(', ')}]`;
			const updatedFrontmatter = frontmatter + `\n${field}: ${valuesStr}`;
			return content.replace(frontmatterRegex, `---\n${updatedFrontmatter}\n---\n`);
		} else {
			// No frontmatter exists, create it
			const valuesStr = `[${values.map(val => `"${val}"`).join(', ')}]`;
			const newFrontmatter = `---\n${field}: ${valuesStr}\n---\n\n`;
			return newFrontmatter + content;
		}
	}

	/**
	 * Add or update a section in the note
	 */
	private addOrUpdateSection(content: string, sectionTitle: string, sectionContent: string): string {
		const sectionRegex = new RegExp(`^## ${sectionTitle}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n---|$)`, 'm');
		const match = content.match(sectionRegex);

		if (match) {
			// Section exists, update it
			const newSection = `## ${sectionTitle}\n${sectionContent}\n`;
			return content.replace(sectionRegex, newSection);
		} else {
			// Section doesn't exist, add it before any existing ## sections or at the end
			const otherSectionRegex = /\n## /;
			const otherSectionMatch = content.match(otherSectionRegex);

			const newSection = `\n## ${sectionTitle}\n${sectionContent}\n`;

			if (otherSectionMatch) {
				// Insert before first ## section
				return content.replace(otherSectionRegex, newSection + '\n## ');
			} else {
				// Add at the end
				return content + newSection;
			}
		}
	}

	/**
	 * Validate that a suggestion can be applied
	 */
	async validateSuggestion(suggestion: LLMSuggestion): Promise<{ valid: boolean; reason?: string }> {
		if (!suggestion.targetNotePath) {
			return { valid: false, reason: 'No target note path specified' };
		}

		const targetFile = this.app.vault.getAbstractFileByPath(suggestion.targetNotePath);
		if (!(targetFile instanceof TFile)) {
			return { valid: false, reason: `Target note not found: ${suggestion.targetNotePath}` };
		}

		if (suggestion.status !== 'approved') {
			return { valid: false, reason: 'Suggestion not approved' };
		}

		return { valid: true };
	}

	/**
	 * Preview changes that would be made by a suggestion
	 */
	async previewSuggestion(suggestion: LLMSuggestion): Promise<{ original: string; enhanced: string }> {
		if (!suggestion.targetNotePath) {
			throw new Error('No target note path specified');
		}

		const targetFile = this.app.vault.getAbstractFileByPath(suggestion.targetNotePath);
		if (!(targetFile instanceof TFile)) {
			throw new Error(`Target note not found: ${suggestion.targetNotePath}`);
		}

		const original = await this.app.vault.read(targetFile);
		const enhanced = await this.enhanceContentWithSuggestion(original, suggestion);

		return { original, enhanced };
	}

	/**
	 * Update settings
	 */
	updateSettings(newSettings: PluginSettings): void {
		this.settings = newSettings;
	}
}
