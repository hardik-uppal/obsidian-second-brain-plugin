import { NoteTemplate } from '../types';

export const NOTE_TEMPLATES: Record<string, NoteTemplate> = {
	transaction: {
		name: 'Transaction',
		type: 'transaction',
		frontmatter: `---
type: transaction
date: "{{date}}"
amount: "{{amount}}"
merchant: "{{merchant}}"
category: "{{category}}"
account: "{{account}}"
tags: [finance, {{tags}}]
transaction_id: "{{id}}"
created: "{{created}}"
---`,
		content: `# {{merchant}} - $\{{amount}}

**Date:** {{date}}
**Category:** {{category}}
**Account:** {{account}}
**Amount:** $\{{amount}}

## Description
{{description}}

## Auto-Generated Tags
{{auto_tags}}

## Notes
<!-- Add your personal notes here -->

## Related
<!-- Links to related notes will appear here -->
`
	},

	event: {
		name: 'Calendar Event',
		type: 'event',
		frontmatter: `---
type: event
date: "{{date}}"
start_time: "{{start_time}}"
end_time: "{{end_time}}"
location: "{{location}}"
attendees: [{{attendees}}]
tags: [calendar, {{tags}}]
event_id: "{{id}}"
created: "{{created}}"
---`,
		content: `# {{title}}

**Date:** {{date}}
**Time:** {{start_time}} - {{end_time}}
**Location:** {{location}}

## Description
{{description}}

## Attendees
{{attendee_list}}

## Preparation Notes
<!-- Add preparation notes here -->

## Follow-up Actions
<!-- Add follow-up tasks here -->

## Related
<!-- Links to related notes will appear here -->
`
	},

	task: {
		name: 'Task',
		type: 'task',
		frontmatter: `---
type: task
title: "{{title}}"
due_date: "{{due_date}}"
priority: "{{priority}}"
completed: {{completed}}
project: "{{project}}"
tags: [tasks, {{tags}}]
task_id: "{{id}}"
created: "{{created}}"
---`,
		content: `# {{title}}

**Due Date:** {{due_date}}
**Priority:** {{priority}}
**Project:** {{project}}
**Status:** {{status}}

## Description
{{description}}

## Subtasks
{{subtasks}}

## Notes
<!-- Add your notes here -->

## Related
<!-- Links to related notes will appear here -->
`
	},

	note: {
		name: 'General Note',
		type: 'note',
		frontmatter: `---
type: note
title: "{{title}}"
tags: [{{tags}}]
created: "{{created}}"
---`,
		content: `# {{title}}

## Content
{{content}}

## Related
<!-- Links to related notes will appear here -->
`
	}
};

export class TemplateEngine {
	static render(templateType: string, data: Record<string, any>): string {
		const template = NOTE_TEMPLATES[templateType];
		if (!template) {
			throw new Error(`Template not found: ${templateType}`);
		}

		let content = template.frontmatter + '\n\n' + template.content;
		
		// Replace all template variables
		Object.keys(data).forEach(key => {
			const value = data[key];
			const placeholder = `{{${key}}}`;
			
			// Handle different data types
			let replacement: string;
			if (Array.isArray(value)) {
				replacement = value.map(item => `"${item}"`).join(', ');
			} else if (typeof value === 'boolean') {
				replacement = value.toString();
			} else if (typeof value === 'number') {
				replacement = value.toString();
			} else {
				replacement = value?.toString() || '';
			}
			
			content = content.replace(new RegExp(placeholder, 'g'), replacement);
		});

		// Clean up any remaining placeholders
		content = content.replace(/\{\{[^}]+\}\}/g, '');
		
		return content;
	}

	static getAvailableTemplates(): string[] {
		return Object.keys(NOTE_TEMPLATES);
	}

	static getTemplate(type: string): NoteTemplate | undefined {
		return NOTE_TEMPLATES[type];
	}
}

// Template data processors for different data types
export class TemplateDataProcessor {
	static processTransaction(transaction: any): Record<string, any> {
		const date = new Date(transaction.date);
		return {
			id: transaction.transaction_id || transaction.id,
			date: date.toISOString().split('T')[0],
			amount: Math.abs(transaction.amount).toFixed(2),
			merchant: transaction.merchant_name || transaction.name || 'Unknown',
			category: transaction.category?.[0] || 'Other',
			account: transaction.account_id || 'Unknown',
			description: transaction.original_description || transaction.name || '',
			tags: this.generateTransactionTags(transaction),
			auto_tags: this.generateAutoTags(transaction),
			created: new Date().toISOString()
		};
	}

	static processEvent(event: any): Record<string, any> {
		const startDate = new Date(event.start?.dateTime || event.start?.date);
		const endDate = new Date(event.end?.dateTime || event.end?.date);
		
		return {
			id: event.id,
			title: event.summary || 'Untitled Event',
			date: startDate.toISOString().split('T')[0],
			start_time: event.start?.dateTime ? startDate.toLocaleTimeString() : 'All Day',
			end_time: event.end?.dateTime ? endDate.toLocaleTimeString() : 'All Day',
			location: event.location || '',
			description: event.description || '',
			attendees: event.attendees?.map((a: any) => a.email) || [],
			attendee_list: event.attendees?.map((a: any) => `- ${a.email}`).join('\n') || 'No attendees',
			tags: this.generateEventTags(event),
			created: new Date().toISOString()
		};
	}

	static processTask(task: any): Record<string, any> {
		return {
			id: task.id,
			title: task.content || task.title || 'Untitled Task',
			description: task.description || '',
			due_date: task.due?.date || '',
			priority: this.mapPriority(task.priority),
			completed: task.completed || false,
			project: task.project_id || '',
			status: task.completed ? '✅ Completed' : '⏳ Pending',
			tags: this.generateTaskTags(task),
			subtasks: task.subtasks?.map((st: any) => `- [ ] ${st.content}`).join('\n') || '',
			created: new Date().toISOString()
		};
	}

	private static generateTransactionTags(transaction: any): string[] {
		const tags = ['finance'];
		
		if (transaction.amount < 0) tags.push('expense');
		else tags.push('income');
		
		if (transaction.category) {
			tags.push(transaction.category[0].toLowerCase().replace(/\s+/g, '-'));
		}
		
		return tags;
	}

	private static generateEventTags(event: any): string[] {
		const tags = ['calendar'];
		
		if (event.attendees?.length > 1) tags.push('meeting');
		if (event.location) tags.push('in-person');
		if (event.summary?.toLowerCase().includes('call')) tags.push('call');
		
		return tags;
	}

	private static generateTaskTags(task: any): string[] {
		const tags = ['tasks'];
		
		if (task.priority > 1) tags.push('high-priority');
		if (task.due?.date) tags.push('deadline');
		if (task.project_id) tags.push('project');
		
		return tags;
	}

	private static generateAutoTags(data: any): string {
		// This would be enhanced with LLM-generated tags
		return 'auto-generated, needs-review';
	}

	private static mapPriority(priority: number): string {
		if (priority >= 4) return 'high';
		if (priority >= 2) return 'medium';
		return 'low';
	}
}
