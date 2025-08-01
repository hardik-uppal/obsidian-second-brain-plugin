import { ItemView, WorkspaceLeaf } from 'obsidian';
import { MasterCalendarService } from '../services/master-calendar-service';
import { CalendarEvent } from '../types';
const moment = require('moment');

export const CALENDAR_VIEW_TYPE = 'master-calendar-view';

export class CalendarView extends ItemView {
	private calendarService: MasterCalendarService;
	private currentDate: moment.Moment;
	private currentView: 'month' | 'week' | 'day' | 'agenda' = 'month';
	private eventCounts: Map<string, number> = new Map(); // Date -> event count

	constructor(leaf: WorkspaceLeaf, calendarService: MasterCalendarService) {
		super(leaf);
		this.calendarService = calendarService;
		this.currentDate = moment();
	}

	getViewType(): string {
		return CALENDAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Master Calendar';
	}

	getIcon(): string {
		return 'calendar';
	}

	async onOpen(): Promise<void> {
		this.containerEl.empty();
		this.renderCalendar();
	}

	private renderCalendar(): void {
		const container = this.containerEl;
		container.empty();
		container.addClass('master-calendar-container');

		// Header
		this.renderHeader(container);

		// Calendar content based on current view
		switch (this.currentView) {
			case 'month':
				this.renderMonthView(container);
				break;
			case 'week':
				this.renderWeekView(container);
				break;
			case 'day':
				this.renderDayView(container);
				break;
			case 'agenda':
				this.renderAgendaView(container);
				break;
		}
	}

	private renderHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: 'calendar-header' });

		// Navigation buttons
		const navLeft = header.createDiv({ cls: 'calendar-nav-left' });
		
		const prevBtn = navLeft.createEl('button', { 
			text: '‹', 
			cls: 'calendar-nav-btn' 
		});
		prevBtn.onclick = () => this.navigatePrevious();

		const todayBtn = navLeft.createEl('button', { 
			text: 'Today', 
			cls: 'calendar-nav-btn today-btn' 
		});
		todayBtn.onclick = () => this.navigateToday();

		const nextBtn = navLeft.createEl('button', { 
			text: '›', 
			cls: 'calendar-nav-btn' 
		});
		nextBtn.onclick = () => this.navigateNext();

		// Title
		const title = header.createDiv({ cls: 'calendar-title' });
		title.textContent = this.getCalendarTitle();

		// View controls
		const navRight = header.createDiv({ cls: 'calendar-nav-right' });
		
		const viewButtons = ['month', 'week', 'day', 'agenda'] as const;
		viewButtons.forEach(view => {
			const btn = navRight.createEl('button', { 
				text: view.charAt(0).toUpperCase() + view.slice(1),
				cls: `calendar-view-btn ${this.currentView === view ? 'active' : ''}`
			});
			btn.onclick = () => this.switchView(view);
		});

		// Sync button
		const syncBtn = navRight.createEl('button', { 
			text: '↻ Sync', 
			cls: 'calendar-sync-btn' 
		});
		syncBtn.onclick = () => this.syncCalendars();
	}

	private getCalendarTitle(): string {
		switch (this.currentView) {
			case 'month':
				return this.currentDate.format('MMMM YYYY');
			case 'week':
				const weekStart = this.currentDate.clone().startOf('week');
				const weekEnd = this.currentDate.clone().endOf('week');
				return `${weekStart.format('MMM D')} - ${weekEnd.format('MMM D, YYYY')}`;
			case 'day':
				return this.currentDate.format('dddd, MMMM D, YYYY');
			case 'agenda':
				return 'Agenda View';
			default:
				return '';
		}
	}

	private renderMonthView(container: HTMLElement): void {
		const monthContainer = container.createDiv({ cls: 'calendar-month-view' });
		
		// Days of week header
		const daysHeader = monthContainer.createDiv({ cls: 'calendar-days-header' });
		const dayNames = moment.weekdaysShort();
		dayNames.forEach(day => {
			daysHeader.createDiv({ text: day, cls: 'calendar-day-header' });
		});

		// Calendar grid
		const calendarGrid = monthContainer.createDiv({ cls: 'calendar-grid' });
		
		const monthStart = this.currentDate.clone().startOf('month').startOf('week');
		const monthEnd = this.currentDate.clone().endOf('month').endOf('week');
		
		let currentDay = monthStart.clone();
		
		while (currentDay.isSameOrBefore(monthEnd)) {
			const dayCell = this.createDayCell(currentDay);
			calendarGrid.appendChild(dayCell);
			currentDay.add(1, 'day');
		}
	}

	private createDayCell(date: moment.Moment): HTMLElement {
		const dayCell = createDiv({ cls: 'calendar-day-cell' });
		
		// Add classes based on date properties
		if (!date.isSame(this.currentDate, 'month')) {
			dayCell.addClass('other-month');
		}
		if (date.isSame(moment(), 'day')) {
			dayCell.addClass('today');
		}
		if (date.isSame(this.currentDate, 'day')) {
			dayCell.addClass('selected');
		}

		// Day number
		const dayNumber = dayCell.createDiv({ 
			text: date.format('D'), 
			cls: 'calendar-day-number' 
		});

		// Events for this day
		const dateString = date.format('YYYY-MM-DD');
		const events = this.calendarService.getEventsForDate(dateString);
		
		if (events.length > 0) {
			const eventsContainer = dayCell.createDiv({ cls: 'calendar-day-events' });
			
			events.slice(0, 3).forEach(event => { // Show max 3 events
				const eventEl = eventsContainer.createDiv({ cls: 'calendar-event' });
				eventEl.textContent = event.title;
				eventEl.title = `${event.startTime} - ${event.title}`;
				
				// Add click handler to view event details
				eventEl.onclick = (e) => {
					e.stopPropagation();
					this.showEventDetails(event);
				};
			});

			if (events.length > 3) {
				const moreEl = eventsContainer.createDiv({ 
					text: `+${events.length - 3} more`,
					cls: 'calendar-event-more' 
				});
				moreEl.onclick = (e) => {
					e.stopPropagation();
					this.showDayEvents(dateString, events);
				};
			}
		}

		// Click handler for day
		dayCell.onclick = () => {
			this.currentDate = date.clone();
			this.switchView('day');
		};

		return dayCell;
	}

	private renderWeekView(container: HTMLElement): void {
		const weekContainer = container.createDiv({ cls: 'calendar-week-view' });
		
		// Time slots column
		const timeColumn = weekContainer.createDiv({ cls: 'calendar-time-column' });
		
		// Days columns
		const daysContainer = weekContainer.createDiv({ cls: 'calendar-week-days' });
		
		const weekStart = this.currentDate.clone().startOf('week');
		
		for (let i = 0; i < 7; i++) {
			const day = weekStart.clone().add(i, 'days');
			const dayColumn = this.createWeekDayColumn(day);
			daysContainer.appendChild(dayColumn);
		}
	}

	private createWeekDayColumn(date: moment.Moment): HTMLElement {
		const dayColumn = createDiv({ cls: 'calendar-week-day' });
		
		// Day header
		const dayHeader = dayColumn.createDiv({ cls: 'calendar-week-day-header' });
		dayHeader.textContent = date.format('ddd D');
		
		if (date.isSame(moment(), 'day')) {
			dayHeader.addClass('today');
		}

		// Events for this day
		const dateString = date.format('YYYY-MM-DD');
		const events = this.calendarService.getEventsForDate(dateString);
		
		events.forEach(event => {
			const eventEl = dayColumn.createDiv({ cls: 'calendar-week-event' });
			eventEl.textContent = `${event.startTime} ${event.title}`;
			eventEl.onclick = () => this.showEventDetails(event);
		});

		return dayColumn;
	}

	private renderDayView(container: HTMLElement): void {
		const dayContainer = container.createDiv({ cls: 'calendar-day-view' });
		
		const dateString = this.currentDate.format('YYYY-MM-DD');
		const events = this.calendarService.getEventsForDate(dateString);
		
		if (events.length === 0) {
			dayContainer.createDiv({ 
				text: 'No events for this day', 
				cls: 'calendar-no-events' 
			});
			return;
		}

		events.forEach(event => {
			const eventCard = this.createEventCard(event);
			dayContainer.appendChild(eventCard);
		});
	}

	private renderAgendaView(container: HTMLElement): void {
		const agendaContainer = container.createDiv({ cls: 'calendar-agenda-view' });
		
		// Get events for the next 30 days
		const startDate = moment().format('YYYY-MM-DD');
		const endDate = moment().add(30, 'days').format('YYYY-MM-DD');
		const events = this.calendarService.getEventsInRange(startDate, endDate);
		
		if (events.length === 0) {
			agendaContainer.createDiv({ 
				text: 'No upcoming events', 
				cls: 'calendar-no-events' 
			});
			return;
		}

		// Group events by date
		const eventsByDate = new Map<string, CalendarEvent[]>();
		events.forEach(event => {
			if (!eventsByDate.has(event.date)) {
				eventsByDate.set(event.date, []);
			}
			eventsByDate.get(event.date)!.push(event);
		});

		// Render each day's events
		for (const [date, dayEvents] of eventsByDate) {
			const daySection = agendaContainer.createDiv({ cls: 'calendar-agenda-day' });
			
			const dayHeader = daySection.createDiv({ cls: 'calendar-agenda-day-header' });
			dayHeader.textContent = moment(date).format('dddd, MMMM D, YYYY');
			
			dayEvents.forEach(event => {
				const eventCard = this.createEventCard(event, true);
				daySection.appendChild(eventCard);
			});
		}
	}

	private createEventCard(event: CalendarEvent, compact: boolean = false): HTMLElement {
		const eventCard = createDiv({ cls: `calendar-event-card ${compact ? 'compact' : ''}` });
		
		const eventTime = eventCard.createDiv({ cls: 'calendar-event-time' });
		eventTime.textContent = event.startTime === 'All Day' ? 'All Day' : `${event.startTime} - ${event.endTime}`;
		
		const eventTitle = eventCard.createDiv({ cls: 'calendar-event-title' });
		eventTitle.textContent = event.title;
		
		if (event.location && !compact) {
			const eventLocation = eventCard.createDiv({ cls: 'calendar-event-location' });
			eventLocation.textContent = `📍 ${event.location}`;
		}

		if (event.attendees.length > 0 && !compact) {
			const eventAttendees = eventCard.createDiv({ cls: 'calendar-event-attendees' });
			eventAttendees.textContent = `👥 ${event.attendees.length} attendee${event.attendees.length > 1 ? 's' : ''}`;
		}

		const eventCalendar = eventCard.createDiv({ cls: 'calendar-event-calendar' });
		eventCalendar.textContent = event.sourceCalendarName;

		eventCard.onclick = () => this.showEventDetails(event);

		return eventCard;
	}

	private showEventDetails(event: CalendarEvent): void {
		// TODO: Implement event details modal or panel
		console.log('Show event details:', event);
	}

	private showDayEvents(date: string, events: CalendarEvent[]): void {
		// TODO: Implement day events modal
		console.log('Show day events:', date, events);
	}

	private navigatePrevious(): void {
		switch (this.currentView) {
			case 'month':
				this.currentDate.subtract(1, 'month');
				break;
			case 'week':
				this.currentDate.subtract(1, 'week');
				break;
			case 'day':
				this.currentDate.subtract(1, 'day');
				break;
			case 'agenda':
				// Agenda view doesn't need navigation
				return;
		}
		this.renderCalendar();
	}

	private navigateNext(): void {
		switch (this.currentView) {
			case 'month':
				this.currentDate.add(1, 'month');
				break;
			case 'week':
				this.currentDate.add(1, 'week');
				break;
			case 'day':
				this.currentDate.add(1, 'day');
				break;
			case 'agenda':
				// Agenda view doesn't need navigation
				return;
		}
		this.renderCalendar();
	}

	private navigateToday(): void {
		this.currentDate = moment();
		this.renderCalendar();
	}

	private switchView(view: 'month' | 'week' | 'day' | 'agenda'): void {
		this.currentView = view;
		this.renderCalendar();
	}

	private async syncCalendars(): Promise<void> {
		try {
			await this.calendarService.syncAllCalendars();
			this.renderCalendar(); // Refresh view after sync
		} catch (error) {
			console.error('Failed to sync calendars:', error);
		}
	}

	/**
	 * Load events from note files in the events directory
	 */
	private async loadEventsFromFiles(): Promise<void> {
		const eventsFolder = this.calendarService.getSettings().eventSettings.eventNotesFolder;
		
		try {
			const eventFiles = this.app.vault.getMarkdownFiles()
				.filter(file => file.path.startsWith(eventsFolder + '/'));

			const eventsByDate = new Map<string, number>();

			for (const file of eventFiles) {
				try {
					const content = await this.app.vault.read(file);
					const frontmatter = this.parseFrontmatter(content);
					
					if (frontmatter?.date && frontmatter?.type === 'calendar-event') {
						const currentCount = eventsByDate.get(frontmatter.date) || 0;
						eventsByDate.set(frontmatter.date, currentCount + 1);
					}
				} catch (error) {
					console.error(`Failed to read event file ${file.path}:`, error);
				}
			}

			this.eventCounts = eventsByDate;
		} catch (error) {
			console.error('Failed to load events from files:', error);
		}
	}

	/**
	 * Parse frontmatter from markdown content
	 */
	private parseFrontmatter(content: string): any {
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (!frontmatterMatch) return null;

		const frontmatterText = frontmatterMatch[1];
		const frontmatter: any = {};

		frontmatterText.split('\n').forEach(line => {
			const colonIndex = line.indexOf(':');
			if (colonIndex > 0) {
				const key = line.substring(0, colonIndex).trim();
				const value = line.substring(colonIndex + 1).trim().replace(/"/g, '');
				frontmatter[key] = value;
			}
		});

		return frontmatter;
	}

	async onClose(): Promise<void> {
		// Cleanup if needed
	}
}
