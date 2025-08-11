# Linking Engine - Improvement Todos

## Overview
The rule-based linking engine is the foundation of the note enhancement system. It implements 6 rule types for relationship discovery. Current issues include performance bottlenecks, lack of parallel processing, and suboptimal confidence scoring.

## Current Rule Types Analysis

### **Implemented Rules**
1. **Time-based**: Proximity within intelligent time windows
2. **Entity-based**: People, companies, locations, vendors  
3. **Location-based**: Geographic proximity + venue matching
4. **Category-based**: Tag and project associations
5. **UID-based**: Exact matches on transaction IDs, event IDs
6. **Account-based**: Transaction linking by account associations

### **Performance Issues**
- Sequential rule processing (no parallelization)
- Full vault scan for each note analysis
- No result caching between rules
- Suboptimal entity extraction
- Inefficient time window calculations

## Critical Improvements Needed

### ⚡ **Performance Optimization**

#### **High Priority**
- [ ] **Implement parallel rule processing**
  ```typescript
  async analyzeNoteParallel(notePath: string): Promise<LinkAnalysisResult> {
    const noteData = await this.getNoteData(notePath);
    
    // Process all rules in parallel
    const ruleResults = await Promise.all([
      this.findTimeBasedLinks(noteData),
      this.findEntityBasedLinks(noteData),
      this.findLocationBasedLinks(noteData),
      this.findCategoryBasedLinks(noteData),
      this.findUidBasedLinks(noteData),
      this.findAccountBasedLinks(noteData)
    ]);
    
    return this.combineResults(ruleResults);
  }
  ```

- [ ] **Add result caching**
  ```typescript
  class LinkingCache {
    private entityCache = new Map<string, Set<string>>();
    private timeCache = new Map<string, Date>();
    private ruleCache = new Map<string, LinkSuggestion[]>();
    
    getCachedRuleResult(noteId: string, ruleType: string): LinkSuggestion[] | null {
      const key = `${noteId}:${ruleType}`;
      return this.ruleCache.get(key) || null;
    }
  }
  ```

- [ ] **Optimize entity extraction**
  - Pre-build entity index at startup
  - Use fuzzy matching libraries (fuse.js)
  - Cache entity extraction results
  - Parallel entity processing

- [ ] **Improve time window calculations**
  ```typescript
  class TimeWindowOptimizer {
    private timeIndex = new Map<string, Date[]>(); // Pre-sorted by time
    
    findNotesInTimeWindow(targetTime: Date, windowMs: number): string[] {
      const startTime = new Date(targetTime.getTime() - windowMs);
      const endTime = new Date(targetTime.getTime() + windowMs);
      
      // Binary search for efficient time range queries
      return this.binarySearchTimeRange(startTime, endTime);
    }
  }
  ```

#### **Medium Priority**
- [ ] **Add incremental indexing**
  - Update indices on note changes only
  - Track index freshness
  - Partial re-indexing for new notes

- [ ] **Implement rule prioritization**
  - Process high-confidence rules first
  - Skip expensive rules if sufficient links found
  - Dynamic rule ordering based on success rates

- [ ] **Optimize memory usage**
  - Stream large note collections
  - Lazy load note content
  - Release cached data after processing

### 🎯 **Confidence Scoring Improvements**

#### **High Priority**
- [ ] **Calibrate confidence thresholds**
  ```typescript
  interface ConfidenceCalibration {
    timeBasedThresholds: {
      sameEvent: 0.95;        // Same calendar event
      sameDayTransaction: 0.85; // Transaction same day
      weekProximity: 0.60;    // Within same week
    };
    entityThresholds: {
      exactMatch: 0.90;       // Exact entity name
      fuzzyMatch: 0.70;       // Fuzzy similarity
      partialMatch: 0.50;     // Partial entity match
    };
  }
  ```

- [ ] **Add user feedback learning**
  - Track user approval/rejection rates
  - Adjust thresholds based on feedback
  - Personalized confidence scoring

- [ ] **Implement confidence combination**
  - Weight multiple rule matches
  - Boost confidence for rule agreement
  - Penalize conflicting evidence

#### **Medium Priority**
- [ ] **Add confidence explanation**
  - Detailed reasoning for each score
  - User-visible confidence factors
  - Debugging information for low scores

- [ ] **Implement dynamic thresholds**
  - Adjust based on note type
  - Consider user's vault patterns
  - Seasonal/temporal adjustments

### 🔍 **Rule-Specific Enhancements**

#### **Time-Based Rules**
- [ ] **Smart time window calculation**
  ```typescript
  getIntelligentTimeWindow(noteType: string, context: any): number {
    switch (noteType) {
      case 'calendar-event':
        return this.getCalendarTimeWindow(context);
      case 'transaction':
        return this.getTransactionTimeWindow(context);
      default:
        return this.getDefaultTimeWindow();
    }
  }
  ```

- [ ] **Add time zone awareness**
  - Handle cross-timezone events
  - Account for travel scenarios
  - Store timezone metadata

- [ ] **Implement recurring event detection**
  - Identify meeting series
  - Link recurring transactions
  - Pattern-based time matching

#### **Entity-Based Rules**
- [ ] **Improve entity extraction**
  ```typescript
  class AdvancedEntityExtractor {
    extractEntities(content: string): ExtractedEntity[] {
      return [
        ...this.extractPeople(content),
        ...this.extractCompanies(content),
        ...this.extractLocations(content),
        ...this.extractProducts(content)
      ];
    }
    
    private extractPeople(content: string): Person[] {
      // Use NLP libraries or regex patterns
      // Handle name variations and nicknames
    }
  }
  ```

- [ ] **Add entity disambiguation**
  - Handle multiple people with same name
  - Distinguish companies from products
  - Context-aware entity resolution

- [ ] **Implement entity relationship tracking**
  - Track entity co-occurrence
  - Build entity relationship graph
  - Use relationships for linking

#### **Location-Based Rules**
- [ ] **Add geocoding support**
  - Convert addresses to coordinates
  - Handle address variations
  - Cache geocoding results

- [ ] **Implement venue matching**
  - Match venue names without coordinates
  - Handle venue name variations
  - Chain/franchise recognition

- [ ] **Add proximity calculations**
  - Efficient distance calculations
  - Configurable proximity thresholds
  - Multi-level proximity (neighborhood, city, region)

#### **Category-Based Rules**
- [ ] **Improve tag analysis**
  ```typescript
  class CategoryAnalyzer {
    analyzeTags(tags: string[]): CategoryAnalysis {
      return {
        projects: this.extractProjects(tags),
        topics: this.extractTopics(tags),
        types: this.extractTypes(tags),
        hierarchies: this.buildTagHierarchies(tags)
      };
    }
  }
  ```

- [ ] **Add semantic category matching**
  - Similar tag recognition
  - Hierarchical tag relationships
  - Category synonym handling

#### **UID-Based Rules**
- [ ] **Expand UID sources**
  - Calendar IDs, transaction IDs
  - Import source IDs
  - Cross-platform ID mapping

- [ ] **Add ID pattern recognition**
  - Detect ID formats automatically
  - Handle ID variations
  - Validate ID integrity

#### **Account-Based Rules**
- [ ] **Improve account matching**
  - Handle account name variations
  - Account type categorization
  - Account relationship mapping

### 🛠️ **Error Handling & Resilience**

#### **High Priority**
- [ ] **Add rule isolation**
  ```typescript
  async processRuleWithIsolation(rule: LinkingRule, noteData: any): Promise<LinkSuggestion[]> {
    try {
      return await rule.process(noteData);
    } catch (error) {
      console.error(`Rule ${rule.name} failed:`, error);
      return []; // Continue with other rules
    }
  }
  ```

- [ ] **Implement partial failure handling**
  - Continue processing if one rule fails
  - Aggregate successful rule results
  - Report rule-specific errors

- [ ] **Add rule validation**
  - Validate rule configuration
  - Check rule dependencies
  - Verify rule output format

#### **Medium Priority**
- [ ] **Add rule health monitoring**
  - Track rule success rates
  - Monitor rule performance
  - Alert on rule failures

- [ ] **Implement rule fallbacks**
  - Fallback to simpler rules
  - Default confidence scores
  - Graceful degradation

### 📊 **Analytics & Monitoring**

#### **High Priority**
- [ ] **Add performance metrics**
  ```typescript
  interface RulePerformanceMetrics {
    executionTime: number;
    linksFound: number;
    confidenceDistribution: number[];
    errorRate: number;
    cacheHitRate: number;
  }
  ```

- [ ] **Track rule effectiveness**
  - User approval rates by rule
  - Most successful rule combinations
  - Rule contribution to final links

#### **Medium Priority**
- [ ] **Add debugging tools**
  - Step-by-step rule execution
  - Confidence score breakdown
  - Link suggestion explanations

- [ ] **Implement rule benchmarking**
  - Performance baselines
  - Regression detection
  - Optimization recommendations

## Implementation Timeline

### **Week 1: Core Performance**
1. Implement parallel rule processing
2. Add basic result caching
3. Optimize entity extraction
4. Improve time window calculations

### **Week 2: Confidence & Reliability**
1. Calibrate confidence thresholds
2. Add rule isolation
3. Implement user feedback learning
4. Add partial failure handling

### **Week 3: Rule Enhancements**
1. Improve time-based rules
2. Enhanced entity extraction
3. Better location-based matching
4. Semantic category analysis

### **Week 4: Monitoring & Analytics**
1. Add performance metrics
2. Implement rule health monitoring
3. Create debugging tools
4. Add benchmarking system

## Testing Strategy

### **Performance Testing**
- [ ] Benchmark rule execution times
- [ ] Test with large note collections
- [ ] Measure cache effectiveness
- [ ] Profile memory usage

### **Accuracy Testing**
- [ ] Test confidence score calibration
- [ ] Validate rule combinations
- [ ] Test edge cases for each rule
- [ ] Measure precision and recall

### **Reliability Testing**
- [ ] Test rule failure scenarios
- [ ] Validate partial failure handling
- [ ] Test index corruption recovery
- [ ] Verify error isolation

## Success Metrics

### **Performance Targets**
- **Rule execution time**: <1 second per note
- **Cache hit rate**: >80% for repeated analyses
- **Memory usage**: <50MB for 1000 notes
- **Parallel speedup**: >3x improvement

### **Accuracy Targets**
- **Precision**: >85% user approval rate
- **Recall**: >90% of valid links found
- **Confidence calibration**: ±5% accuracy
- **Rule agreement**: >70% for overlapping domains

---

*Created: August 8, 2025*
*Priority: High*
*Dependencies: Queue Management*
