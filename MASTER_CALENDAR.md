# Master Calendar System

## Overview

We have implemented a **Master Calendar System** that supports multiple Google accounts and provides a dedicated calendar view in the sidebar. This is a standalone system that does not depend on any external Obsidian plugins.

## Key Features

### 🎯 Master Calendar Service
- **Multi-Account Support**: Connect multiple Google accounts
- **Calendar Selection**: Choose which calendars to sync from each account
- **Event Synchronization**: Sync events within configurable date ranges
- **Automatic Event Notes**: Create Obsidian notes from calendar events using templates

### 📅 Calendar View (Sidebar Only)
- **Multiple Views**: Month, Week, Day, and Agenda views
- **Interactive Calendar**: Click on dates to navigate, click events to view details
- **Real-time Sync**: Sync button to update events from Google Calendar
- **Responsive Design**: Clean, modern UI that fits Obsidian's design language

### ⚙️ Configuration System
- **Google Account Manager**: Handle OAuth2 authentication for multiple accounts
- **Event Template Service**: Customizable templates for event notes
- **Sync Settings**: Flexible sync ranges and conflict resolution
- **View Settings**: Customizable calendar display options

## Architecture

### Services
1. **MasterCalendarService** - Main orchestrator for calendar operations
2. **GoogleAccountManager** - Handles OAuth2 and Google Calendar API operations
3. **EventTemplateService** - Manages event note creation with templates
4. **CalendarView** - UI component for displaying the calendar

### Data Flow
1. User adds Google account credentials in settings
2. OAuth2 authentication exchanges code for tokens
3. Available calendars are discovered and user selects which to sync
4. Events are synced based on date range and calendar selection
5. Event notes are created using templates
6. Calendar view displays events interactively

## Usage

### Setup
1. Enable Master Calendar in plugin settings
2. Add Google account(s) with Client ID and Secret
3. Complete OAuth2 authentication
4. Select calendars to sync from each account
5. Configure event note settings and templates

### Daily Use
1. Open Master Calendar from ribbon icon or command palette
2. View events in month/week/day/agenda views
3. Sync calendars manually or enable auto-sync
4. Event notes are automatically created in configured folder

## Settings Structure

```typescript
masterCalendar: {
  enabled: boolean;
  googleAccounts: GoogleAccount[];
  selectedCalendars: SelectedCalendar[];
  syncSettings: CalendarSyncSettings;
  eventSettings: EventSettings;
  viewSettings: CalendarViewSettings;
}
```

## Commands Added
- `open-calendar` - Open Master Calendar view
- `sync-calendars` - Sync all calendars
- `add-google-account` - Add Google Calendar account

## Templates

The system includes three default templates:
- **default-event.md** - Standard event template
- **meeting-event.md** - Template for events with attendees
- **all-day-event.md** - Template for all-day events

Templates support variables like:
- `{{title}}` - Event title
- `{{date}}` - Event date (YYYY-MM-DD)
- `{{startTime}}` / `{{endTime}}` - Event times
- `{{location}}` - Event location
- `{{attendees}}` - Attendee list
- `{{description}}` - Event description

## Benefits of This System

1. **Complete Independence**: Standalone system with no external plugin dependencies
2. **Multi-Account Support**: Connect and sync multiple Google accounts simultaneously
3. **Granular Control**: Select specific calendars from each account to sync
4. **Dedicated UI**: Custom sidebar calendar view with multiple display modes
5. **Rich Templates**: Powerful templating system for event notes
6. **Smart Sync**: Intelligent conflict resolution and event management
7. **High Performance**: Optimized sync with configurable limits and caching

## Next Steps

To fully utilize the Master Calendar:
1. Configure Google OAuth2 credentials in plugin settings
2. Add your Google accounts
3. Select calendars to sync
4. Customize event templates
5. Open the calendar view and start syncing!

The Master Calendar provides a powerful, flexible foundation for calendar integration that can be extended with additional features like:
- Two-way sync (create events in Obsidian)
- Calendar overlays
- Advanced conflict resolution
- Integration with other productivity plugins
