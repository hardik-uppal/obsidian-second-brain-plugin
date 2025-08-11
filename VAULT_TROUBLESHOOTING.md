# 🔧 Vault Troubleshooting Guide

## 🚨 **Common Issues & Solutions**

### **1. Links Not Appearing with Reasons**

#### **Problem**: New links don't show reasons like `*(shared: John Doe)*`
#### **Solution**:
```bash
1. Run: "Analyze Current Note for Links"
2. Check console for error messages
3. Ensure note has proper frontmatter or content for analysis
```

#### **Problem**: Existing links don't have reason comments
#### **Solution**:
```bash
Run: "Analyze Existing Links for Rules"
# This adds <!-- rule: reason --> comments to existing [[links]]
```

---

### **2. LLM Enhancement Not Working**

#### **Problem**: Enhancement commands do nothing
#### **Checks**:
- [ ] LLM API key configured in plugin settings
- [ ] Internet connection available
- [ ] Console shows LLM service errors

#### **Solution**:
1. Check Developer Console (`Cmd+Option+I`)
2. Look for API errors or network issues
3. Verify API key in settings
4. Try with a simple note first

---

### **3. Queue Visualization Issues**

#### **Problem**: LLM Suggestions view shows empty pipeline
#### **Solution**:
```bash
1. Run: "Process Note Enhancement Queue"
2. Run: "View Enhancement Queue Status"
3. Check if notes are actually queued for processing
```

#### **Problem**: Pipeline numbers don't update
#### **Solution**:
- Refresh the view manually
- Close and reopen LLM Suggestions view
- Check console for UI update errors

---

### **4. Performance Problems**

#### **Problem**: Plugin is slow with large vault
#### **Symptoms**:
- Commands take > 30 seconds
- UI becomes unresponsive
- Browser/Obsidian freezes

#### **Solutions**:
```bash
1. Check vault size: "View Enhancement Queue Status"
2. Process in smaller batches
3. Clear completed items periodically
4. Consider excluding certain folders from analysis
```

---

### **5. Duplicate Links**

#### **Problem**: Same links appear multiple times
#### **Cause**: Multiple analysis runs without proper tracking
#### **Solution**:
```bash
1. Run: "Refresh Note Linking Indices"
2. This rebuilds tracking and prevents duplicates
3. Check notes manually and remove duplicate links if needed
```

---

### **6. No Commands in Command Palette**

#### **Problem**: Can't find plugin commands
#### **Solution**:
1. Check if plugin is enabled in Settings > Community Plugins
2. Restart Obsidian
3. Check console for plugin loading errors

---

### **7. Suggestions Not Appearing**

#### **Problem**: LLM Suggestions view is empty
#### **Check**:
```bash
1. Run any enhancement command first
2. Wait for processing to complete
3. Suggestions appear after LLM analysis
```

#### **If Still Empty**:
- Check LLM API configuration
- Verify suggestions are being generated (console logs)
- Try with content-rich notes

---

## 🔍 **Diagnostic Commands**

### **Check System Health**
```bash
1. "Refresh Note Linking Indices" - Rebuild system
2. "View Enhancement Queue Status" - Check processing state
3. Open Developer Console - Look for errors
```

### **Test Basic Functionality**
```bash
1. Open a simple note
2. "Analyze Current Note for Links"
3. Check console output
4. Verify link creation
```

### **Test Enhancement**
```bash
1. Open a content-rich note
2. "Enhance Current Note with LLM"
3. Check LLM Suggestions view
4. Verify suggestions appear
```

---

## 📊 **Health Check Checklist**

### **✅ Basic System Health**
- [ ] Commands appear in Command Palette
- [ ] No console errors on plugin load
- [ ] LLM Suggestions view opens
- [ ] Settings page loads correctly

### **✅ Linking System Health**
- [ ] `Refresh Note Linking Indices` completes without errors
- [ ] Console shows indexed note counts
- [ ] `Analyze Current Note for Links` runs successfully
- [ ] Links include reason explanations

### **✅ Enhancement System Health**
- [ ] LLM API key configured
- [ ] Enhancement commands execute
- [ ] Suggestions appear in view
- [ ] Queue processing works

### **✅ Performance Health**
- [ ] Commands complete in reasonable time
- [ ] UI remains responsive
- [ ] Memory usage is acceptable
- [ ] No browser freezing

---

## 🚀 **Reset Procedures**

### **Soft Reset** (First try)
```bash
1. "Refresh Note Linking Indices"
2. Close and reopen LLM Suggestions view
3. Test basic functionality
```

### **Medium Reset** (If soft reset fails)
```bash
1. Disable plugin in Settings
2. Restart Obsidian
3. Re-enable plugin
4. Run "Refresh Note Linking Indices"
```

### **Hard Reset** (Last resort)
```bash
1. Backup your vault
2. Disable plugin
3. Delete plugin folder
4. Reinstall plugin
5. Reconfigure settings
```

---

## 📝 **Error Message Guide**

### **"Source file not found"**
- **Cause**: Note was moved or deleted
- **Fix**: Refresh indices or check note path

### **"LLM service error"**
- **Cause**: API key issues or network problems
- **Fix**: Check API configuration and internet connection

### **"Failed to apply link"**
- **Cause**: Note content modification failed
- **Fix**: Check file permissions and note format

### **"Queue processing failed"**
- **Cause**: Large queue or memory issues
- **Fix**: Process smaller batches or restart plugin

---

## 📞 **Getting Help**

### **Console Debugging**
1. Open Developer Console (`Cmd+Option+I`)
2. Look for red error messages
3. Check Network tab for API failures
4. Copy relevant error messages

### **System Information**
- Plugin version
- Obsidian version
- Vault size (number of notes)
- Operating system
- Any custom CSS or themes

### **Useful Console Commands**
```javascript
// Check plugin status
app.plugins.plugins['obsidian-second-brain-plugin']

// Check loaded services
app.plugins.plugins['obsidian-second-brain-plugin'].noteLinkingService

// View current settings
app.plugins.plugins['obsidian-second-brain-plugin'].settings
```

Remember: Most issues can be resolved with "Refresh Note Linking Indices" and checking the Developer Console for specific error messages!
