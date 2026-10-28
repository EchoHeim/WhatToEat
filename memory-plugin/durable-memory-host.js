// durable-memory host half — 安装：把本文件内容原样作为 cordis_define 的 code.host
return {
  name: 'durable-memory-host-v2',
  apply(ctx) {
    const CATEGORIES = ['fact', 'preference', 'identity', 'project', 'task', 'decision', 'other'];
    const err = (...a) => console.error('[memory]', ...a);

    // ---------- optional infrastructure (fs persistence) ----------
    const fsSvc = ctx.get('fs');
    const policy = ctx.get('sandboxPolicy');
    const root = policy && typeof policy.workspaceRoot === 'string' && policy.workspaceRoot
      ? String(policy.workspaceRoot) : '';
    const defaultFile = root ? root.replace(/\\/g, '/').replace(/\/+$/, '') + '/.dsh-memory.json' : '';

    let cache = { version: 1, seq: 0, memories: [], meta: {} };
    let loaded = false;
    let effectiveFile = defaultFile;
    let warnOnce = false;
    let pendingWrite = Promise.resolve();

    // ---------- helpers ----------
    function uid() {
      cache.seq = (cache.seq || 0) + 1;
      return Date.now().toString(36) + '-' + cache.seq + '-' + Math.random().toString(36).slice(2, 7);
    }
    function now() { return new Date().toISOString(); }
    function clean(v, dflt) { return (typeof v === 'string' ? v.trim() : '') || dflt; }
    function toInt(v, dflt, min, max) {
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n)) return dflt;
      return Math.max(min, Math.min(max, n));
    }
    function normCategory(c) { return CATEGORIES.indexOf(c) >= 0 ? c : undefined; }
    function normScope(s) { return clean(s) || 'shared'; }
    function normPath(p) {
      if (typeof p !== 'string') return '';
      let s = p.replace(/\\/g, '/').trim();
      while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
      if (!/^[a-zA-Z]:\//.test(s) && !s.startsWith('/')) return '';
      return s;
    }
    function sanitizeRecord(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const content = clean(raw.content);
      if (!content) return null;
      const ts = now();
      const m = {
        id: clean(raw.id) || uid(),
        content,
        topic: clean(raw.topic) || '',
        category: normCategory(raw.category) || 'fact',
        importance: toInt(raw.importance, 3, 1, 5),
        scope: normScope(raw.scope),
        createdAt: clean(raw.createdAt) || ts,
        updatedAt: clean(raw.updatedAt) || ts,
        accessCount: toInt(raw.accessCount, 0, 0, 1e9),
        lastAccessAt: clean(raw.lastAccessAt) || null,
        history: Array.isArray(raw.history) ? raw.history.slice(-5).map((h) => ({
          at: clean(h && h.at) || ts, content: String((h && h.content) || ''), topic: clean(h && h.topic) || '',
        })) : [],
      };
      return m;
    }
    function normalizeStore(raw) {
      const memories = (Array.isArray(raw && raw.memories) ? raw.memories : [])
        .map(sanitizeRecord).filter((m) => m);
      return {
        version: 1,
        seq: Math.max(toInt(raw && raw.seq, memories.length, 0, 1e9), memories.length),
        memories,
        meta: (raw && raw.meta && typeof raw.meta === 'object') ? raw.meta : {},
      };
    }
    function pub(m) {
      const content = String(m.content || '');
      return {
        id: m.id, content,
        preview: content.length > 240 ? content.slice(0, 240) + '…' : content,
        topic: m.topic || '',
        category: normCategory(m.category) || 'fact',
        importance: toInt(m.importance, 3, 1, 5),
        scope: m.scope || 'shared',
        createdAt: m.createdAt || null,
        updatedAt: m.updatedAt || null,
        accessCount: toInt(m.accessCount, 0, 0, 1e9),
        lastAccessAt: m.lastAccessAt || null,
        historyCount: Array.isArray(m.history) ? m.history.length : 0,
      };
    }
    function summaryData() {
      const byCategory = {};
      const byScope = {};
      for (const m of cache.memories) {
        const c = normCategory(m.category) || 'fact';
        byCategory[c] = (byCategory[c] || 0) + 1;
        const s = m.scope || 'shared';
        byScope[s] = (byScope[s] || 0) + 1;
      }
      return { total: cache.memories.length, byCategory, byScope };
    }

    // ---------- file primitives ----------
    async function tryRead(p) {
      if (!fsSvc || !p) return null;
      try {
        const target = await fsSvc.resolve(p);
        const info = await fsSvc.stat(target);
        if (!info) return null;
        const text = await fsSvc.readText(target);
        const parsed = JSON.parse(text);
        return (parsed && typeof parsed === 'object') ? parsed : null;
      } catch (e) {
        return null;
      }
    }
    async function fileExists(p) {
      if (!fsSvc || !p) return false;
      try {
        const target = await fsSvc.resolve(p);
        const info = await fsSvc.stat(target);
        return Boolean(info);
      } catch (e) { return false; }
    }
    async function writeRaw(p, content) {
      const target = await fsSvc.resolve(p);
      await fsSvc.writeText(target, content);
    }

    // ---------- load / persist ----------
    async function ensureLoaded() {
      if (loaded) return;
      loaded = true;
      effectiveFile = defaultFile;
      if (!fsSvc || !defaultFile) { durable = false; return; }
      const boot = await tryRead(defaultFile);
      if (boot) {
        const pointed = boot.meta && typeof boot.meta.storePath === 'string' ? normPath(boot.meta.storePath) : '';
        if (pointed && pointed !== defaultFile && await fileExists(pointed)) {
          const target = await tryRead(pointed);
          if (target && Array.isArray(target.memories)) {
            cache = normalizeStore(target);
            effectiveFile = pointed;
            return;
          }
        }
        cache = normalizeStore(boot);
      } else {
        cache = normalizeStore(null);
      }
    }
    function persist() {
      pendingWrite = pendingWrite.then(async () => {
        if (!fsSvc || !effectiveFile) { durable = false; return; }
        try {
          const meta = effectiveFile === defaultFile ? {} : { storePath: effectiveFile };
          await writeRaw(effectiveFile, JSON.stringify({
            version: cache.version, seq: cache.seq, memories: cache.memories, meta,
          }, null, 2));
          durable = true;
        } catch (e) {
          durable = false;
          if (!warnOnce) { warnOnce = true; err('cannot persist memory store to', effectiveFile, e); }
        }
      });
      return pendingWrite;
    }

    // ---------- core operations ----------
    function findById(id) { return cache.memories.find((m) => m.id === id); }

    async function addOrMerge(input) {
      await ensureLoaded();
      const content = clean(input.content);
      if (!content) return { ok: false, error: 'content is required' };
      const category = normCategory(input.category) || 'fact';
      const importance = toInt(input.importance, 3, 1, 5);
      const topic = clean(input.topic);
      const scope = normScope(input.scope);
      const ts = now();
      if (input.id) {
        const m = findById(String(input.id));
        if (!m) return { ok: false, error: 'memory id not found: ' + input.id };
        if (!Array.isArray(m.history)) m.history = [];
        if (content !== (m.content || '')) {
          m.history.push({ at: ts, content: m.content || '', topic: m.topic || '' });
          if (m.history.length > 5) m.history = m.history.slice(-5);
        }
        m.content = content;
        if (topic) m.topic = topic;
        m.category = category;
        m.importance = importance;
        m.scope = scope;
        m.updatedAt = ts;
        await persist();
        return { ok: true, action: 'updated', memory: pub(m) };
      }
      if (topic) {
        const existing = cache.memories.find((m) => m.topic === topic && (m.scope || 'shared') === scope);
        if (existing) {
          if (!Array.isArray(existing.history)) existing.history = [];
          if (content !== (existing.content || '')) {
            existing.history.push({ at: ts, content: existing.content || '', topic: existing.topic || '' });
            if (existing.history.length > 5) existing.history = existing.history.slice(-5);
          }
          existing.content = content;
          existing.category = category;
          existing.importance = Math.max(existing.importance || 1, importance);
          existing.updatedAt = ts;
          await persist();
          return { ok: true, action: 'merged', memory: pub(existing) };
        }
      }
      const m = sanitizeRecord({
        id: uid(), content, topic: topic || '', category, importance, scope, createdAt: ts, updatedAt: ts, history: [],
      });
      cache.memories.push(m);
      await persist();
      return { ok: true, action: 'created', memory: pub(m) };
    }

    async function updateOne(input) {
      await ensureLoaded();
      const id = clean(input.id);
      if (!id) return { ok: false, error: 'id is required' };
      const m = findById(id);
      if (!m) return { ok: false, error: 'memory id not found: ' + id };
      const ts = now();
      let changed = false;
      if (!Array.isArray(m.history)) m.history = [];
      if (typeof input.content === 'string') {
        const content = input.content.trim();
        if (content && content !== (m.content || '')) {
          m.history.push({ at: ts, content: m.content || '', topic: m.topic || '' });
          if (m.history.length > 5) m.history = m.history.slice(-5);
          m.content = content;
          changed = true;
        }
      }
      if (typeof input.topic === 'string' && input.topic.trim() && input.topic.trim() !== (m.topic || '')) {
        m.topic = input.topic.trim(); changed = true;
      }
      if (typeof input.topic === 'string' && !input.topic.trim() && m.topic) { m.topic = ''; changed = true; }
      if (normCategory(input.category) && normCategory(input.category) !== (normCategory(m.category) || 'fact')) {
        m.category = normCategory(input.category); changed = true;
      }
      if (typeof input.importance !== 'undefined') {
        const imp = toInt(input.importance, m.importance || 3, 1, 5);
        if (imp !== (m.importance || 3)) { m.importance = imp; changed = true; }
      }
      if (typeof input.scope === 'string' && input.scope.trim() && input.scope.trim() !== (m.scope || 'shared')) {
        m.scope = input.scope.trim(); changed = true;
      }
      if (!changed) return { ok: true, action: 'noop', memory: pub(m) };
      m.updatedAt = ts;
      await persist();
      return { ok: true, action: 'updated', memory: pub(m) };
    }

    async function removeMany(filters) {
      await ensureLoaded();
      const id = clean(filters.id);
      const topic = clean(filters.topic);
      const category = normCategory(filters.category);
      const scope = typeof filters.scope === 'string' && filters.scope.trim() ? filters.scope.trim() : undefined;
      const before = cache.memories.length;
      const removed = [];
      cache.memories = cache.memories.filter((m) => {
        let drop = false;
        if (id) drop = m.id === id;
        else if (topic) drop = m.topic === topic && (!scope || (m.scope || 'shared') === scope);
        else if (category) drop = normCategory(m.category) === category && (!scope || (m.scope || 'shared') === scope);
        else if (filters.all === true) drop = !scope || (m.scope || 'shared') === scope;
        if (drop) removed.push(pub(m));
        return !drop;
      });
      const deleted = before - cache.memories.length;
      if (deleted > 0) await persist();
      return { ok: true, deleted, ids: removed.map((r) => r.id) };
    }

    function tokenize(text) {
      const s = String(text || '').toLowerCase();
      const out = new Set();
      const words = s.match(/[a-z0-9_]{2,}/g) || [];
      for (const w of words) out.add(w);
      const cjk = s.match(/[\u4e00-\u9fa5]+/g) || [];
      for (const seg of cjk) {
        const chars = Array.from(seg);
        if (chars.length === 1) { out.add(chars[0]); continue; }
        for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
      }
      return Array.from(out);
    }
    function haystack(m) {
      return String(m.content || '') + ' ' + String(m.topic || '') + ' ' + String(m.category || '') + ' ' + (m.scope || 'shared');
    }
    function rank(memories, query) {
      const q = String(query || '').trim();
      if (!q) return memories.slice();
      const qt = tokenize(q);
      if (!qt.length) return memories.slice();
      const scored = [];
      for (const m of memories) {
        const h = haystack(m).toLowerCase();
        let hit = 0;
        for (const t of qt) if (h.indexOf(t) >= 0) hit++;
        if (hit > 0) scored.push({ m, score: (hit / qt.length) * 100 + (m.importance || 3) * 2 });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.map((x) => x.m);
    }
    function applyFilters(memories, f) {
      const cat = normCategory(f.category);
      const scope = typeof f.scope === 'string' && f.scope.trim() ? f.scope.trim() : undefined;
      let list = memories;
      if (cat) list = list.filter((m) => normCategory(m.category) === cat);
      if (scope) list = list.filter((m) => (m.scope || 'shared') === scope);
      if (f.importanceAtLeast) {
        const min = toInt(f.importanceAtLeast, 0, 1, 5);
        list = list.filter((m) => (m.importance || 3) >= min);
      }
      if (f.sort === 'importance') {
        list = list.slice().sort((a, b) => (b.importance || 0) - (a.importance || 0) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      } else {
        list = list.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      }
      return list;
    }
    function markAccessed(list) {
      const ts = now();
      let changed = false;
      for (const m of list) {
        m.accessCount = (m.accessCount || 0) + 1;
        m.lastAccessAt = ts;
        changed = true;
      }
      if (changed) return persist();
      return Promise.resolve();
    }

    async function doSearch(args) {
      await ensureLoaded();
      const limit = toInt(args.limit, 8, 1, 50);
      const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope.trim() : undefined;
      const cat = normCategory(args.category);
      let list = cache.memories;
      if (cat) list = list.filter((m) => normCategory(m.category) === cat);
      if (scope) list = list.filter((m) => (m.scope || 'shared') === scope);
      list = rank(list, args.query).slice(0, limit);
      await markAccessed(list);
      return { ok: true, query: clean(args.query) || '', count: list.length, results: list.map(pub) };
    }

    async function doRecallCore(args) {
      await ensureLoaded();
      const limit = toInt(args.limit, 10, 1, 50);
      const min = toInt(args.minImportance, 3, 1, 5);
      const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope.trim() : undefined;
      let list = cache.memories.filter((m) => {
        const cat = normCategory(m.category) || 'fact';
        const core = cat === 'identity' || cat === 'project' || (m.importance || 3) >= min;
        return core && (!scope || (m.scope || 'shared') === scope);
      });
      list = list.sort((a, b) => (b.importance || 0) - (a.importance || 0) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      list = list.slice(0, limit);
      await markAccessed(list);
      return { ok: true, minImportance: min, count: list.length, results: list.map(pub) };
    }

    function doList(args) {
      const limit = toInt(args.limit, 50, 1, 200);
      const rows = applyFilters(cache.memories, args).slice(0, limit);
      return {
        ok: true, total: cache.memories.length, shown: rows.length, results: rows.map(pub),
        summary: summaryData(), file: effectiveFile || null, durable: durable && loaded,
      };
    }
    function doStats() {
      return {
        ok: true,
        summary: summaryData(),
        durable: durable && loaded && Boolean(effectiveFile),
        file: durable && loaded ? effectiveFile : null,
        defaultFile: defaultFile || null,
        scope: 'workspace:' + (root || '(memory-only)'),
      };
    }

    // ---------- sync / transport ----------
    async function setStorePath(input) {
      await ensureLoaded();
      const p = normPath(input && input.path);
      if (!p) return { ok: false, error: 'path must be an absolute path' };
      if (p === effectiveFile) return { ok: true, action: 'unchanged', path: p };
      const existed = await fileExists(p);
      const prevLocal = cache.memories.length;
      if (existed) {
        const target = await tryRead(p);
        if (!target || !Array.isArray(target.memories)) {
          return { ok: false, error: 'target file exists but is not a valid memory store' };
        }
        const next = normalizeStore(target);
        next.seq = Math.max(next.seq, cache.seq);
        cache = next;
        effectiveFile = p;
        await persist();
        if (defaultFile && defaultFile !== effectiveFile) {
          try { await writeRaw(defaultFile, JSON.stringify({ version: 1, seq: cache.seq, memories: [], meta: { storePath: effectiveFile } }, null, 2)); } catch (e) { /* pointer best-effort */ }
        }
        return { ok: true, action: 'adopted', path: p, localReplaced: prevLocal, total: cache.memories.length };
      }
      effectiveFile = p;
      await persist();
      if (defaultFile && defaultFile !== effectiveFile) {
        try { await writeRaw(defaultFile, JSON.stringify({ version: 1, seq: cache.seq, memories: [], meta: { storePath: effectiveFile } }, null, 2)); } catch (e) { /* pointer best-effort */ }
      }
      return { ok: true, action: 'migrated', path: p, moved: prevLocal };
    }

    async function doExport(input) {
      await ensureLoaded();
      const p = normPath(input && input.path);
      if (!p) return { ok: false, error: 'path must be an absolute path' };
      if (!fsSvc) return { ok: false, error: 'no writable filesystem' };
      const copy = JSON.parse(JSON.stringify(cache.memories));
      try {
        await writeRaw(p, JSON.stringify({ version: 1, seq: cache.seq, exportedAt: now(), memories: copy }, null, 2));
      } catch (e) {
        return { ok: false, error: 'cannot write export file: ' + String((e && e.message) || e) };
      }
      return { ok: true, exported: copy.length, path: p };
    }

    async function doImport(input) {
      await ensureLoaded();
      const p = normPath(input && input.path);
      if (!p) return { ok: false, error: 'path must be an absolute path' };
      const data = await tryRead(p);
      if (!data) return { ok: false, error: 'cannot read import file: ' + p };
      const src = (Array.isArray(data.memories) ? data.memories : Array.isArray(data.records) ? data.records : null);
      if (!src) return { ok: false, error: 'import file has no memories/records array' };
      const mode = input.mode === 'replace' ? 'replace' : 'merge';
      if (mode === 'replace') {
        const next = normalizeStore({ memories: src, seq: data.seq });
        next.seq = Math.max(next.seq, cache.seq);
        cache = next;
        await persist();
        return { ok: true, mode, total: cache.memories.length };
      }
      const seenIds = {};
      const seenKeys = {};
      for (const m of cache.memories) {
        seenIds[m.id] = true;
        seenKeys[m.topic + '|' + (m.scope || 'shared') + '|' + m.content] = true;
      }
      let added = 0, skipped = 0;
      for (const raw of src) {
        const rec = sanitizeRecord(raw);
        if (!rec) { skipped++; continue; }
        if (seenIds[rec.id]) { skipped++; continue; }
        if (seenKeys[rec.topic + '|' + rec.scope + '|' + rec.content]) { skipped++; continue; }
        let id = rec.id;
        while (seenIds[id]) id = uid();
        rec.id = id;
        seenIds[rec.id] = true;
        seenKeys[rec.topic + '|' + rec.scope + '|' + rec.content] = true;
        cache.memories.push(rec);
        added++;
      }
      cache.seq = Math.max(cache.seq, cache.memories.length);
      await persist();
      return { ok: true, mode: 'merge', added, skipped };
    }

    // ---------- tool plumbing ----------
    const textOf = (value) => {
      let s;
      try { s = JSON.stringify(value, null, 2); } catch (e) { s = String(value); }
      return [{ type: 'text', text: s }];
    };
    const mkTool = (name, description, parameters, execute, readOnly) => {
      const def = harness.defineTool({
        name, description, parameters,
        output: { schema: { type: 'object', additionalProperties: true }, render: (_a, value) => textOf(value) },
        execute,
        isConcurrencySafe: readOnly ? () => true : undefined,
      });
      ctx.effect(() => harness.registerTool(ctx, def));
    };
    const guard = (fn) => async (args) => {
      try { return await fn(args || {}); } catch (e) {
        err('tool failure', e);
        return { ok: false, error: String((e && e.message) || e) };
      }
    };

    // ---------- model tools ----------
    mkTool('memory_save', '把一条需要长期记住的信息写入记忆库：当用户明确说“记住…/以后记得…”或表达了稳定的偏好、事实、身份、项目约定时调用。同一作用域下相同 topic 会自动合并为覆盖式更新（冲突消解）；也可传已有 id 更新该条。', {
      content: { type: 'string', description: '要记住的内容：一句话自足的陈述（含主语与上下文），不要用代词指代当前会话', required: true },
      topic: { type: 'string', description: '可选主题键，如同一主题再次保存则覆盖旧值（新内容优先）' },
      category: { type: 'string', enum: CATEGORIES, description: '记忆类别' },
      importance: { type: 'integer', description: '重要度 1-5（4/5 会进入核心召回）' },
      scope: { type: 'string', description: '作用域命名空间，默认 shared（当前工作区所有人共享）' },
      id: { type: 'string', description: '已有记忆 id；提供则按 id 原地更新' },
    }, guard((a) => addOrMerge(a)), false);

    mkTool('memory_update', '修正一条已有记忆（内容、主题、类别、重要度、作用域）。原内容会进入该条记忆的 history，最多保留 5 版。', {
      id: { type: 'string', description: '要更新的记忆 id', required: true },
      content: { type: 'string', description: '新内容' },
      topic: { type: 'string', description: '新主题；传空串清除主题' },
      category: { type: 'string', enum: CATEGORIES, description: '新类别' },
      importance: { type: 'integer', description: '新重要度 1-5' },
      scope: { type: 'string', description: '新作用域' },
    }, guard((a) => updateOne(a)), false);

    mkTool('memory_forget', '删除/遗忘记忆。优先传 id 精确删除；按 topic/category 删除需 confirm:true；清空请用 all:true 并配合 scope。用户说“忘掉…”或不再需要某条记忆时调用。', {
      id: { type: 'string', description: '精确删除的记忆 id' },
      topic: { type: 'string', description: '按主题删除（可配 scope 收窄）' },
      category: { type: 'string', enum: CATEGORIES, description: '按类别删除（可配 scope 收窄）' },
      scope: { type: 'string', description: '把删除限定在某个作用域内' },
      all: { type: 'boolean', description: '清空整个（scope 内的）记忆库，需 confirm:true' },
      confirm: { type: 'boolean', description: '批量/清空删除的二次确认开关' },
    }, guard(async (a) => {
      if (!a.id && !a.topic && !a.category && a.all !== true) {
        return { ok: false, error: 'specify id, or topic/category/all with confirm:true' };
      }
      if (!a.id && a.confirm !== true) {
        return { ok: false, error: 'bulk or wipe deletion requires confirm:true' };
      }
      return removeMany(a);
    }), false);

    mkTool('memory_search', '在记忆库中检索与查询最相关的内容（关键词/中英文匹配 + 重要度加权）。回答关于用户的偏好、历史决定、项目约定等话题前，若记忆库可能相关就先调用它；拿不准就问用户或直接搜索。', {
      query: { type: 'string', description: '搜索查询，尽量用能命中原文实体的关键词', required: true },
      category: { type: 'string', enum: CATEGORIES, description: '限定类别' },
      scope: { type: 'string', description: '限定作用域' },
      limit: { type: 'integer', description: '返回条数上限' },
    }, guard((a) => doSearch(a)), true);

    mkTool('memory_recall_core', '取出应“永远记得”的核心记忆（identity/project 或重要度≥minImportance，默认 3）。会话开始、接手新任务、需要记住用户关键背景时先调用一次。', {
      scope: { type: 'string', description: '限定作用域' },
      minImportance: { type: 'integer', description: '重要度下限 1-5' },
      limit: { type: 'integer', description: '返回条数上限' },
    }, guard((a) => doRecallCore(a)), true);

    mkTool('memory_list', '浏览记忆库（按类别/作用域/重要度过滤，按最近或重要度排序），附总数统计与当前存储文件。需要盘点已有记忆或向用户展示时调用。', {
      category: { type: 'string', enum: CATEGORIES, description: '限定类别' },
      scope: { type: 'string', description: '限定作用域' },
      importanceAtLeast: { type: 'integer', description: '只看重要度≥该值的记忆' },
      sort: { type: 'string', enum: ['recent', 'importance'], description: '排序方式' },
      limit: { type: 'integer', description: '返回条数上限' },
    }, guard((a) => doList(a)), true);

    mkTool('memory_stats', '返回记忆库统计与持久化状态（总数、按类别/作用域分布、当前/默认落盘文件）。', {}, guard(async () => doStats()), true);

    mkTool('memory_store_path', '把记忆库切换/迁移到另一个文件（跨设备同步的关键）：传一个绝对路径。若该路径已存在有效记忆库则“采用”（本机改为使用远端那份，本地原有无 id 冲突记录会被替换）；若不存在则把当前记忆“迁移”过去并写本地指针文件自动跟随。目标文件建议放在云同步目录（OneDrive/坚果云/git 仓库），实现多设备共用同一份记忆。', {
      path: { type: 'string', description: '目标绝对路径，例如 D:/Sync/memory.json 或 /Users/me/Cloud/memory.json', required: true },
    }, guard((a) => setStorePath(a)), false);

    mkTool('memory_export', '把当前全部记忆导出为 JSON 文件到指定绝对路径（备份 / 手工搬运到另一台设备后再 memory_import）。', {
      path: { type: 'string', description: '导出文件的绝对路径', required: true },
    }, guard((a) => doExport(a)), false);

    mkTool('memory_import', '从另一个 JSON 文件导入记忆：mode=merge 默认按 id/内容+主题去重合并进当前库；mode=replace 则整体替换当前库。用于恢复备份或在第二台设备并入第一台导出的记忆。', {
      path: { type: 'string', description: '导入文件的绝对路径', required: true },
      mode: { type: 'string', enum: ['merge', 'replace'], description: 'merge(默认)合并去重；replace 整体替换' },
    }, guard((a) => doImport(a)), false);

    // ---------- RPC for the browser manager panel ----------
    ctx.effect(() => harness.handle('mem.list', async (args) => doList(args || {})));
    ctx.effect(() => harness.handle('mem.search', async (args) => doSearch(args || {})));
    ctx.effect(() => harness.handle('mem.save', async (args) => addOrMerge(args || {})));
    ctx.effect(() => harness.handle('mem.update', async (args) => updateOne(args || {})));
    ctx.effect(() => harness.handle('mem.delete', async (args) => removeMany(args || {})));
    ctx.effect(() => harness.handle('mem.stats', async () => doStats()));
    ctx.effect(() => harness.handle('mem.path.set', async (args) => setStorePath(args || {})));
    ctx.effect(() => harness.handle('mem.export', async (args) => doExport(args || {})));
    ctx.effect(() => harness.handle('mem.import', async (args) => doImport(args || {})));

    ensureLoaded().catch((e) => err('warm load failed', e));
  },
};
