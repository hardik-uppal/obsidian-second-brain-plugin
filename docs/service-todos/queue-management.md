# Queue Management - Improvement Todos

## Overview
The enhancement queue is the central coordination point for note processing. Current issues include manual processing, small batch sizes, no retry logic, and lack of health monitoring.

## Current Queue Analysis
- **Total items**: 118 notes
- **Completed**: 20 (17% success rate)
- **Queued**: 98 (83% stuck)
- **Processing method**: Manual batch processing only
- **Batch size**: 10 notes (too small)

## Critical Improvements Needed

### 🔄 **Background Processing**

#### **High Priority**
- [ ] **Implement automatic queue processor**
  ```typescript
  class BackgroundQueueProcessor {
    private processingInterval: NodeJS.Timeout;
    private isProcessing: boolean = false;
    private readonly batchSize = 50; // Increased from 10
    
    startBackgroundProcessing(): void {
      this.processingInterval = setInterval(async () => {
        if (!this.isProcessing && this.getQueueSize() > 0) {
          await this.processQueue();
        }
      }, 30000); // Every 30 seconds
    }
  }
  ```

- [ ] **Add configurable processing intervals**
  - High priority: Every 10 seconds
  - Medium priority: Every 30 seconds  
  - Low priority: Every 2 minutes
  - Bulk processing: Every 5 minutes

- [ ] **Implement queue prioritization**
  ```typescript
  interface QueuePriority {
    immediate: EnhancementQueueItem[]; // User-triggered
    high: EnhancementQueueItem[];      // Recent notes
    medium: EnhancementQueueItem[];    // Standard processing
    low: EnhancementQueueItem[];       // Bulk/retroactive
  }
  ```

#### **Medium Priority**
- [ ] **Add processing pause/resume**
  - User control over background processing
  - Pause during heavy system load
  - Resume with backlog catch-up

- [ ] **Implement smart batch sizing**
  - Dynamic batch sizes based on system load
  - Smaller batches for real-time processing
  - Larger batches for background cleanup

### 🔁 **Retry Logic & Error Recovery**

#### **High Priority**
- [ ] **Add exponential backoff retry**
  ```typescript
  interface RetryConfig {
    maxRetries: number;        // Default: 5
    initialDelay: number;      // Default: 1000ms
    maxDelay: number;          // Default: 30000ms
    backoffMultiplier: number; // Default: 2
  }
  
  async processWithRetry(item: EnhancementQueueItem): Promise<void> {
    let delay = this.retryConfig.initialDelay;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        await this.processItem(item);
        return; // Success
      } catch (error) {
        if (attempt === this.retryConfig.maxRetries) {
          item.status = 'failed';
          item.lastError = error.message;
          return;
        }
        
        await this.delay(Math.min(delay, this.retryConfig.maxDelay));
        delay *= this.retryConfig.backoffMultiplier;
      }
    }
  }
  ```

- [ ] **Implement error categorization**
  ```typescript
  enum ErrorType {
    TRANSIENT = 'transient',     // Retry immediately
    RATE_LIMITED = 'rate_limit', // Retry with longer delay
    PERMANENT = 'permanent',     // Don't retry
    UNKNOWN = 'unknown'          // Retry with caution
  }
  ```

- [ ] **Add automatic recovery**
  - Detect and retry stuck "processing" items
  - Reset items stuck for >1 hour
  - Cleanup failed items after 7 days

#### **Medium Priority**
- [ ] **Add circuit breaker for queue processing**
  - Stop processing after consecutive failures
  - Gradually resume after cool-down period
  - Alert user to system issues

- [ ] **Implement queue corruption recovery**
  - Validate queue integrity on load
  - Rebuild queue from note status
  - Backup queue state regularly

### 📊 **Queue Health Monitoring**

#### **High Priority**
- [ ] **Add queue health metrics**
  ```typescript
  interface QueueHealth {
    totalItems: number;
    queuedItems: number;
    processingItems: number;
    completedItems: number;
    failedItems: number;
    stuckItems: number;        // Processing > 1 hour
    avgProcessingTime: number; // In seconds
    errorRate: number;         // Percentage
    throughput: number;        // Items per minute
    oldestQueuedAge: number;   // In hours
  }
  ```

- [ ] **Implement stuck item detection**
  - Identify items in "processing" for >1 hour
  - Detect items with >5 failed attempts
  - Flag items queued for >24 hours

- [ ] **Add queue size monitoring**
  - Alert when queue exceeds threshold
  - Warn on low processing throughput
  - Track queue growth rate

#### **Medium Priority**
- [ ] **Create queue dashboard UI**
  - Real-time queue status
  - Processing progress bars
  - Error rate trends
  - Performance metrics

- [ ] **Add queue analytics**
  - Processing time trends
  - Success rate by note type
  - Peak processing hours
  - Bottleneck identification

### 🗂️ **Queue State Management**

#### **High Priority**
- [ ] **Improve queue persistence**
  ```typescript
  class QueuePersistence {
    private readonly queuePath: string;
    private readonly backupPath: string;
    private saveTimeout: NodeJS.Timeout;
    
    async saveQueueWithBackup(): Promise<void> {
      // Create backup before saving
      await this.createBackup();
      await this.saveQueue();
      this.scheduleNextSave();
    }
  }
  ```

- [ ] **Add queue validation**
  - Validate JSON structure on load
  - Check for duplicate entries
  - Verify note path existence

- [ ] **Implement atomic updates**
  - Prevent queue corruption during updates
  - Use file locking for concurrent access
  - Rollback on write failures

#### **Medium Priority**
- [ ] **Add queue compression**
  - Compress completed items
  - Archive old queue data
  - Optimize storage size

- [ ] **Implement queue migration**
  - Handle queue format upgrades
  - Migrate legacy queue data
  - Validate migration success

### ⚡ **Performance Optimization**

#### **High Priority**
- [ ] **Optimize batch processing**
  ```typescript
  async processBatchOptimized(items: EnhancementQueueItem[]): Promise<void> {
    // Group by note type for optimized processing
    const grouped = this.groupByNoteType(items);
    
    // Process each group with type-specific optimizations
    await Promise.all([
      this.processTransactionBatch(grouped.transactions),
      this.processCalendarBatch(grouped.calendar),
      this.processManualBatch(grouped.manual)
    ]);
  }
  ```

- [ ] **Add parallel processing**
  - Process multiple items concurrently
  - Limit concurrency to prevent overload
  - Handle dependencies between items

- [ ] **Implement queue indexing**
  - Index by note path for fast lookup
  - Index by status for filtered queries
  - Index by priority for sorted processing

#### **Medium Priority**
- [ ] **Add memory optimization**
  - Stream large queues instead of loading all
  - Lazy load queue item details
  - Cleanup processed items from memory

- [ ] **Implement queue sharding**
  - Split large queues into smaller files
  - Process shards independently
  - Merge results efficiently

## Implementation Timeline

### **Week 1: Critical Fixes**
1. Implement background queue processor
2. Add basic retry logic
3. Increase default batch size to 50
4. Add stuck item detection

### **Week 2: Reliability**
1. Add exponential backoff retry
2. Implement error categorization
3. Add queue validation and backup
4. Create health monitoring

### **Week 3: Performance**
1. Optimize batch processing
2. Add parallel processing
3. Implement queue indexing
4. Add memory optimization

### **Week 4: Advanced Features**
1. Create queue dashboard UI
2. Add queue analytics
3. Implement queue sharding
4. Add migration tools

## Testing Strategy

### **Load Testing**
- [ ] Test with 1000+ item queues
- [ ] Simulate concurrent processing
- [ ] Test error recovery scenarios
- [ ] Validate performance under load

### **Reliability Testing**
- [ ] Test queue corruption scenarios
- [ ] Simulate system crashes during processing
- [ ] Test backup and recovery
- [ ] Validate retry logic

### **Performance Testing**
- [ ] Measure processing throughput
- [ ] Test memory usage with large queues
- [ ] Benchmark batch processing
- [ ] Profile bottlenecks

## Success Metrics

### **Performance Targets**
- **Processing throughput**: >100 notes/minute
- **Queue processing latency**: <30 seconds
- **Memory usage**: <100MB for 1000 items
- **Batch processing time**: <5 minutes for 100 items

### **Reliability Targets**
- **Queue corruption rate**: 0%
- **Data loss rate**: 0%
- **Recovery time**: <1 minute
- **Error detection**: <30 seconds

---

*Created: August 8, 2025*
*Priority: Critical*
*Dependencies: None (Foundation service)*
