# Multiple Google Calendar Support

This document outlines the comprehensive strategy for supporting multiple Google Calendars in the Second Brain Integration plugin.

## Architecture Overview

### Core Concept: Unified Calendar Management
- **One master calendar** in Obsidian acts as the source of truth
- **Multiple Google Calendars** can be synced to it
- **Smart conflict resolution** with configurable user preferences
- **Flexible sync ranges** (configurable time windows)

## Key Features

### 1. Multiple Calendar Discovery
- Automatically discovers all calendars you have access to
- Shows calendar names, IDs, and access permissions
- Allows enabling/disabling specific calendars for sync
- Priority-based system for conflict resolution

### 2. Intelligent Conflict Detection
The system detects conflicts in several ways:

#### Conflict Types:
- **Time Overlap**: Events at the same time/location
- **Duplicate**: Identical events across calendars
- **Title Similar**: Events with similar names
- **Location Same**: Different events at same location/time

#### Conflict Detection Algorithm:
1. Groups events by time + location
2. Calculates similarity scores using:
   - Title similarity (50% weight)
   - Location similarity (20% weight)  
   - Time overlap (30% weight)
3. Identifies conflicts above similarity threshold

### 3. Configurable Conflict Resolution

#### Manual Resolution (Default)
- Mark conflicting events for user review
- Display conflicts in special notes
- Let user decide which version to keep

#### Automatic Strategies:
- **Newest**: Always use the most recently modified event
- **Primary**: Use event from primary/highest priority calendar
- **Merge**: Combine information from all conflicting events

### 4. Smart Data Management

#### Sync Time Ranges:
- **Week**: 7 days back/forward
- **Month**: 30 days back/forward
- **Quarter**: 90 days back/forward
- **Year**: 365 days back/forward
- **Custom**: User-defined range

#### Data Limits:
- Configurable max events per sync (50-2000)
- Prevents overwhelming the system
- Incremental sync support

## Implementation Details

### Calendar Event Structure
Each event includes:
```typescript
interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location?: string;
  description?: string;
  attendees: string[];
  tags: string[];
  // Multiple calendar support
  sourceCalendarId: string;
  sourceCalendarName: string;
  lastModified: string;
  obsidianPath?: string;
  syncStatus: 'synced' | 'conflict' | 'error' | 'pending';
  conflictsWith?: string[];
}
```

### Enhanced Note Templates
Events are stored with enhanced metadata:
```markdown
---
type: event
source_calendar: "calendar-id"
calendar_name: "My Work Calendar"
sync_status: "synced"
conflicts_with: []
---

# Meeting Title

**📅 Date:** 2025-01-31
**🕐 Time:** 10:00 AM - 11:00 AM
**📍 Location:** Conference Room A
**📂 Source:** My Work Calendar (work@company.com)

## Description
Meeting description here...

---
*Synced from My Work Calendar on 2025-01-31T10:00:00Z*
```

## Conflict Resolution Workflow

### 1. Detection Phase
```typescript
// Group events by potential conflicts
const conflicts = detectConflicts(allEvents);

// Example conflict:
{
  obsidianEvent: workEvent,
  googleEvents: [
    { event: personalEvent, calendarId: "personal", calendarName: "Personal" }
  ],
  conflictType: "time_overlap",
  similarity: 0.85
}
```

### 2. Resolution Phase
Based on user settings:

#### Manual Resolution:
- Mark all events with `syncStatus: 'conflict'`
- Add `conflictsWith` array with conflicting event IDs
- Display conflicts in settings for user review

#### Automatic Resolution:
- Apply selected strategy (newest/primary/merge)
- Set winning event to `syncStatus: 'synced'`
- Store conflict metadata for audit trail

### 3. Merge Strategy Details
When merging conflicting events:
- Use primary calendar event as base
- Combine descriptions with separators
- Merge attendee lists (deduplicated)
- Combine tags from all sources
- Add source calendar tags (`source:calendar-name`)

## User Experience

### Setup Process
1. **Configure OAuth2** credentials
2. **Discover calendars** using "Discover Available Calendars"
3. **Select calendars** to sync in settings
4. **Set priorities** for each calendar (for conflict resolution)
5. **Configure sync settings** (range, conflict resolution, etc.)
6. **Run initial sync** with "Sync All Calendars"

### Ongoing Usage
- **Automatic sync** (optional, configurable interval)
- **Manual sync** via command or settings
- **Conflict alerts** when conflicts detected
- **Resolution interface** for manual conflict handling

### Commands Available
- `Sync Calendar Events (Multiple Calendars)` - Main sync command
- `Discover Available Calendars` - Find and cache calendars
- `Resolve Calendar Conflicts` - Handle conflicts manually

## Benefits of This Approach

### 1. Flexibility
- Works with any number of Google Calendars
- Supports different organizational patterns
- Accommodates various user workflows

### 2. Data Integrity
- Prevents duplicate events
- Maintains sync status tracking
- Preserves source information

### 3. User Control
- Configurable conflict resolution
- Selective calendar synchronization
- Customizable sync ranges and limits

### 4. Scalability
- Efficient conflict detection algorithms
- Batched processing with limits
- Incremental sync support

## Configuration Options

### Sync Settings
```typescript
interface CalendarSyncSettings {
  syncRange: 'week' | 'month' | 'quarter' | 'year' | 'custom';
  customStartDays: number;
  customEndDays: number;
  conflictResolution: 'manual' | 'newest' | 'primary' | 'merge';
  autoSync: boolean;
  syncInterval: number; // minutes
  maxEventsPerSync: number;
}
```

### Calendar Priority System
- **Primary calendar**: Highest priority (1000+)
- **Other calendars**: Decreasing priority based on discovery order
- **User adjustable**: Via settings interface

## Error Handling

### Network Issues
- Retry logic for failed API calls
- Graceful degradation when calendars unavailable
- Clear error messages for users

### Data Validation
- Validate event data before processing
- Handle malformed calendar responses
- Skip problematic events with logging

### Conflict Resolution Errors
- Fallback to manual resolution on auto-resolve failures
- Log conflict resolution decisions
- Maintain audit trail for troubleshooting

## Future Enhancements

### 1. Advanced Conflict Detection
- Fuzzy string matching for better similarity detection
- ML-based event classification
- Learning from user resolution patterns

### 2. Bi-directional Sync
- Create events in Google Calendar from Obsidian
- Update events in both directions
- Delete propagation with safety checks

### 3. Enhanced Merging
- Smart description merging (remove duplicates)
- Time zone handling improvements
- Recurring event support

### 4. Collaboration Features
- Shared conflict resolution rules
- Team calendar coordination
- Cross-user event linking

This comprehensive approach provides a robust foundation for multiple calendar support while maintaining flexibility and user control.
