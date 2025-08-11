# 🚀 Quick Test Reference - Current Vault

## 📋 **Essential Commands to Test**

### **🔧 System Setup**
```
1. "Refresh Note Linking Indices" - Initialize/rebuild system
2. "View Enhancement Queue Status" - Check processing pipeline
```

### **🔗 Link Testing**
```
3. "Analyze Current Note for Links" - Find connections for active note
4. "Analyze Existing Links for Rules" - Add reasons to existing links
```

### **🤖 Enhancement Testing**
```
5. "Enhance Current Note with LLM" - AI improve current note
6. "Enhance Notes in Current Folder" - Batch enhance folder
7. "Enhance Recent Notes (7 days)" - Enhance recent notes
8. "Process Note Enhancement Queue" - Process queued items
```

---

## 🎯 **3-Minute Quick Test**

### **Step 1: Setup (30 seconds)**
1. Open Command Palette (`Cmd+P`)
2. Run: `Refresh Note Linking Indices`
3. Wait for completion notice

### **Step 2: Test Link Transparency (60 seconds)**
1. Open any existing note
2. Run: `Analyze Current Note for Links`
3. Check if new links appear with reasons: `*(reason here)*`
4. Run: `Analyze Existing Links for Rules`
5. Check if existing links now have comments: `<!-- rule: reason -->`

### **Step 3: Test Enhancement (90 seconds)**
1. Open a note you want to improve
2. Run: `Enhance Current Note with LLM`
3. Review the suggestions in LLM Suggestions view
4. Approve/reject suggestions

---

## 🔍 **What to Look For**

### **✅ Working Link System**
- New links include parenthetical reasons
- Existing links get HTML comment reasons
- Console shows analysis results
- No duplicate links created

### **✅ Working Enhancement**
- Suggestions appear in LLM Suggestions view
- Queue visualization shows pipeline stages
- Notes get meaningfully enhanced
- No errors in console

### **✅ Working UI**
- LLM Suggestions view opens
- Pipeline visualization shows current status
- Suggestions can be approved/rejected
- Real-time updates work

---

## 🚨 **Common Issues & Quick Fixes**

### **No Links Created**
```
Fix: Run "Refresh Note Linking Indices"
```

### **No Enhancement Suggestions**
```
Fix: Check LLM API key in settings
Fix: Ensure internet connection
```

### **UI Not Updating**
```
Fix: Refresh the view
Fix: Check Developer Console for errors
```

### **Performance Issues**
```
Fix: Run "View Enhancement Queue Status" 
Fix: Clear completed items if queue is large
```

---

## 📊 **Expected Results**

### **Link Analysis Output:**
```
🔍 Analyzing note for links: Your Note.md
📋 Found X potential links, Y auto-applied, Z queued for review
🔗 Applied entity-based link: shared: John Smith (confidence: 0.89)
```

### **Enhancement Output:**
```
🤖 Enhancing note content with LLM...
📝 Generated enhancement suggestions
✅ Note enhancement completed
```

### **Retroactive Analysis:**
```
Link Analysis Complete:
📊 X links analyzed
✅ Y files updated with reasons
Rules found: • entity-based: A • time-based: B • manual: C
```

---

## 🎯 **Success Criteria**

- [ ] All commands execute without errors
- [ ] Links include transparent reasons
- [ ] Enhancement suggestions are relevant
- [ ] UI updates show real-time status
- [ ] Performance is acceptable for vault size

**Test Duration: 3-5 minutes for basic validation**
**Full Test Duration: 15-20 minutes for comprehensive testing**
