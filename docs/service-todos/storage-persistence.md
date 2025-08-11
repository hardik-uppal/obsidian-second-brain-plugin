# Storage & Persistence - Improvement Todos

## Overview
Storage and persistence layer handles queue state, suggestion data, and system configuration. Current issues include potential data corruption, lack of backup mechanisms, and inefficient storage formats.

## Current Storage Analysis

### **Storage Components**
- **Enhancement Queue**: `enhancement-queue.json` (118 items, 1559 lines)
- **Suggestion Data**: Various suggestion storage files
- **Configuration**: Plugin settings and linking configuration
- **Cache Data**: Entity indices, note cache, link history

### **Identified Issues**
- No atomic writes (corruption risk)
- No backup mechanisms
- Large JSON files (performance impact)
- No data validation on load
- Memory-based indices (lost on restart)

## Critical Improvements Needed

### 💾 **Data Integrity & Safety**

#### **High Priority**
- [ ] **Implement atomic file operations**
  ```typescript
  class AtomicFileWriter {
    async writeAtomic(filePath: string, data: string): Promise<void> {
      const tempPath = `${filePath}.tmp`;
      const backupPath = `${filePath}.backup`;
      
      try {
        // Create backup of existing file
        if (await this.fileExists(filePath)) {
          await this.copyFile(filePath, backupPath);
        }
        
        // Write to temporary file
        await this.writeFile(tempPath, data);
        
        // Atomic rename (move temp to final)
        await this.moveFile(tempPath, filePath);
        
        // Clean up backup after successful write
        await this.deleteFile(backupPath);
      } catch (error) {
        // Restore from backup on failure
        if (await this.fileExists(backupPath)) {
          await this.moveFile(backupPath, filePath);
        }
        throw error;
      }
    }
  }
  ```

- [ ] **Add data validation**
  ```typescript
  interface DataValidator<T> {
    validate(data: any): data is T;
    getErrors(data: any): ValidationError[];
    sanitize(data: any): T;
  }
  
  class QueueDataValidator implements DataValidator<QueueData> {
    validate(data: any): data is QueueData {
      return (
        data &&
        typeof data === 'object' &&
        Array.isArray(data.queue) &&
        data.queue.every(this.isValidQueueItem)
      );
    }
    
    private isValidQueueItem(item: any): boolean {
      return (
        item &&
        typeof item.noteId === 'string' &&
        typeof item.notePath === 'string' &&
        ['queued', 'processing', 'completed', 'failed'].includes(item.status)
      );
    }
  }
  ```

- [ ] **Implement backup system**
  ```typescript
  class BackupManager {
    private readonly backupDir: string;
    private readonly maxBackups = 10;
    
    async createBackup(filePath: string): Promise<string> {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = path.basename(filePath);
      const backupPath = path.join(this.backupDir, `${fileName}.${timestamp}`);
      
      await this.copyFile(filePath, backupPath);
      await this.cleanupOldBackups(fileName);
      
      return backupPath;
    }
    
    async restoreFromBackup(originalPath: string, backupTimestamp?: string): Promise<void> {
      const backupPath = backupTimestamp 
        ? this.getSpecificBackup(originalPath, backupTimestamp)
        : await this.getLatestBackup(originalPath);
        
      await this.copyFile(backupPath, originalPath);
    }
  }
  ```

- [ ] **Add data corruption detection**
  ```typescript
  class CorruptionDetector {
    async detectCorruption(filePath: string): Promise<CorruptionReport> {
      try {
        const content = await this.readFile(filePath);
        const data = JSON.parse(content);
        
        return {
          isCorrupted: false,
          issues: [],
          recoverable: true
        };
      } catch (error) {
        return {
          isCorrupted: true,
          issues: [error.message],
          recoverable: await this.canRecover(filePath)
        };
      }
    }
    
    async recoverFromCorruption(filePath: string): Promise<boolean> {
      // Try to recover from backup
      // Parse partial JSON
      // Rebuild from scratch if necessary
    }
  }
  ```

#### **Medium Priority**
- [ ] **Add data checksums**
  - Generate checksums for data files
  - Verify integrity on load
  - Detect silent corruption

- [ ] **Implement versioned storage**
  - Track data format versions
  - Handle format migrations
  - Backward compatibility

### 🚀 **Performance Optimization**

#### **High Priority**
- [ ] **Implement chunked storage**
  ```typescript
  class ChunkedStorage<T> {
    private readonly chunkSize = 1000;
    private readonly indexFile: string;
    private chunks: Map<string, T[]> = new Map();
    
    async addItem(item: T): Promise<void> {
      const chunkId = this.determineChunk(item);
      const chunk = this.chunks.get(chunkId) || [];
      
      chunk.push(item);
      
      if (chunk.length >= this.chunkSize) {
        await this.flushChunk(chunkId, chunk);
        this.chunks.set(chunkId, []);
      } else {
        this.chunks.set(chunkId, chunk);
      }
      
      await this.updateIndex(chunkId, item);
    }
    
    async getItems(filter: (item: T) => boolean): Promise<T[]> {
      const relevantChunks = await this.findRelevantChunks(filter);
      const results: T[] = [];
      
      for (const chunkId of relevantChunks) {
        const chunk = await this.loadChunk(chunkId);
        results.push(...chunk.filter(filter));
      }
      
      return results;
    }
  }
  ```

- [ ] **Add lazy loading**
  ```typescript
  class LazyDataLoader<T> {
    private cache = new Map<string, T>();
    private loadPromises = new Map<string, Promise<T>>();
    
    async get(key: string): Promise<T> {
      // Check cache first
      if (this.cache.has(key)) {
        return this.cache.get(key)!;
      }
      
      // Check if already loading
      if (this.loadPromises.has(key)) {
        return this.loadPromises.get(key)!;
      }
      
      // Start loading
      const loadPromise = this.loadData(key);
      this.loadPromises.set(key, loadPromise);
      
      try {
        const data = await loadPromise;
        this.cache.set(key, data);
        this.loadPromises.delete(key);
        return data;
      } catch (error) {
        this.loadPromises.delete(key);
        throw error;
      }
    }
  }
  ```

- [ ] **Implement streaming I/O**
  ```typescript
  class StreamingProcessor {
    async processLargeFile<T>(
      filePath: string,
      processor: (item: T) => Promise<void>
    ): Promise<void> {
      const stream = this.createReadStream(filePath);
      const parser = this.createJSONStreamParser<T>();
      
      stream.pipe(parser);
      
      for await (const item of parser) {
        await processor(item);
      }
    }
    
    async writeLargeData<T>(
      filePath: string,
      dataSource: AsyncIterable<T>
    ): Promise<void> {
      const stream = this.createWriteStream(filePath);
      const serializer = this.createJSONStreamSerializer<T>();
      
      serializer.pipe(stream);
      
      for await (const item of dataSource) {
        serializer.write(item);
      }
      
      serializer.end();
    }
  }
  ```

#### **Medium Priority**
- [ ] **Add compression**
  - Compress large data files
  - Selective compression based on size
  - Background compression jobs

- [ ] **Implement caching strategies**
  - LRU cache for frequently accessed data
  - Write-through caching
  - Cache invalidation on updates

### 🗃️ **Storage Format Improvements**

#### **High Priority**
- [ ] **Use structured storage format**
  ```typescript
  interface StructuredStorage {
    metadata: {
      version: string;
      created: string;
      lastModified: string;
      checksum: string;
      format: 'json' | 'binary' | 'compressed';
    };
    data: any;
    index?: any; // Optional index for fast queries
  }
  
  class StructuredFileManager {
    async write<T>(filePath: string, data: T, options?: WriteOptions): Promise<void> {
      const structured: StructuredStorage = {
        metadata: {
          version: '1.0.0',
          created: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          checksum: this.calculateChecksum(data),
          format: options?.format || 'json'
        },
        data,
        index: options?.generateIndex ? this.generateIndex(data) : undefined
      };
      
      await this.writeStructured(filePath, structured);
    }
  }
  ```

- [ ] **Add indexing support**
  ```typescript
  class IndexManager<T> {
    private indices = new Map<string, Map<any, Set<string>>>();
    
    createIndex(name: string, keyExtractor: (item: T) => any): void {
      this.indices.set(name, new Map());
    }
    
    updateIndex(name: string, itemId: string, item: T): void {
      const index = this.indices.get(name);
      if (!index) return;
      
      const key = this.getKeyExtractor(name)(item);
      const items = index.get(key) || new Set();
      items.add(itemId);
      index.set(key, items);
    }
    
    query(indexName: string, key: any): Set<string> {
      const index = this.indices.get(indexName);
      return index?.get(key) || new Set();
    }
  }
  ```

- [ ] **Implement schema evolution**
  ```typescript
  interface StorageSchema {
    version: string;
    fields: Record<string, FieldDefinition>;
    migrations?: Migration[];
  }
  
  class SchemaMigrator {
    async migrate(data: any, fromVersion: string, toVersion: string): Promise<any> {
      const migrations = this.getMigrationPath(fromVersion, toVersion);
      
      let result = data;
      for (const migration of migrations) {
        result = await migration.migrate(result);
      }
      
      return result;
    }
  }
  ```

#### **Medium Priority**
- [ ] **Add binary storage format**
  - More efficient than JSON
  - Faster parsing and serialization
  - Smaller file sizes

- [ ] **Implement data partitioning**
  - Split data by date/type
  - Parallel loading of partitions
  - Efficient range queries

### 🔒 **Data Security & Privacy**

#### **High Priority**
- [ ] **Add data encryption**
  ```typescript
  class EncryptionManager {
    private readonly algorithm = 'aes-256-gcm';
    
    async encrypt(data: string, key: Buffer): Promise<EncryptedData> {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher(this.algorithm, key, iv);
      
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return {
        encrypted,
        iv: iv.toString('hex'),
        authTag: cipher.getAuthTag().toString('hex')
      };
    }
    
    async decrypt(encryptedData: EncryptedData, key: Buffer): Promise<string> {
      const decipher = crypto.createDecipher(
        this.algorithm, 
        key, 
        Buffer.from(encryptedData.iv, 'hex')
      );
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    }
  }
  ```

- [ ] **Implement secure key management**
  - User-provided encryption keys
  - Key derivation from passwords
  - Secure key storage

#### **Medium Priority**
- [ ] **Add data anonymization**
  - Remove or hash sensitive data
  - Configurable anonymization rules
  - Privacy-preserving analytics

- [ ] **Implement audit logging**
  - Track data access and modifications
  - Tamper-evident logs
  - Compliance support

### 📊 **Storage Monitoring & Analytics**

#### **High Priority**
- [ ] **Add storage metrics**
  ```typescript
  interface StorageMetrics {
    fileCount: number;
    totalSize: number;
    largestFile: { path: string; size: number };
    averageFileSize: number;
    compressionRatio: number;
    operationsPerSecond: {
      reads: number;
      writes: number;
      deletes: number;
    };
    errorRate: number;
  }
  
  class StorageMonitor {
    async collectMetrics(): Promise<StorageMetrics> {
      return {
        fileCount: await this.countFiles(),
        totalSize: await this.calculateTotalSize(),
        largestFile: await this.findLargestFile(),
        averageFileSize: await this.calculateAverageSize(),
        compressionRatio: await this.calculateCompressionRatio(),
        operationsPerSecond: this.getOperationRates(),
        errorRate: this.calculateErrorRate()
      };
    }
  }
  ```

- [ ] **Implement storage health checks**
  - Check file integrity
  - Verify available disk space
  - Monitor I/O performance

#### **Medium Priority**
- [ ] **Add storage optimization recommendations**
  - Identify large unused files
  - Suggest compression opportunities
  - Recommend data archival

- [ ] **Create storage dashboard**
  - Visual storage usage
  - Performance trends
  - Health status

## Implementation Timeline

### **Week 1: Data Safety**
1. Implement atomic file operations
2. Add data validation
3. Create backup system
4. Add corruption detection

### **Week 2: Performance**
1. Implement chunked storage
2. Add lazy loading
3. Create streaming I/O
4. Add indexing support

### **Week 3: Advanced Features**
1. Implement structured storage format
2. Add schema evolution
3. Create encryption support
4. Add compression

### **Week 4: Monitoring**
1. Add storage metrics
2. Implement health checks
3. Create storage dashboard
4. Add optimization tools

## Testing Strategy

### **Data Integrity Testing**
- [ ] Test atomic operations under failures
- [ ] Validate backup and restore
- [ ] Test corruption detection and recovery
- [ ] Verify data validation

### **Performance Testing**
- [ ] Benchmark large file operations
- [ ] Test chunked storage scalability
- [ ] Measure lazy loading effectiveness
- [ ] Profile memory usage

### **Reliability Testing**
- [ ] Test system crashes during writes
- [ ] Simulate disk space exhaustion
- [ ] Test concurrent access scenarios
- [ ] Validate recovery mechanisms

## Success Metrics

### **Reliability Targets**
- **Data corruption rate**: 0%
- **Data loss rate**: 0%
- **Recovery success rate**: 100%
- **Backup completion rate**: >99%

### **Performance Targets**
- **Large file load time**: <5 seconds for 10MB files
- **Write performance**: <1 second for queue updates
- **Memory usage**: <100MB for large datasets
- **Startup time**: <3 seconds for index loading

---

*Created: August 8, 2025*
*Priority: High*
*Dependencies: Queue Management*
