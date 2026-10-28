// durable-memory client half — 安装：把本文件内容原样作为 cordis_define 的 code.client
return {
  name: 'durable-memory-client-v2',
  apply(ctx) {
    const CATEGORIES = ['fact', 'preference', 'identity', 'project', 'task', 'decision', 'other'];

    function MemoryPanel() {
      const [rows, setRows] = React.useState([]);
      const [summary, setSummary] = React.useState(null);
      const [file, setFile] = React.useState('');
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState('');
      const [msg, setMsg] = React.useState('');
      const [q, setQ] = React.useState('');
      const [cat, setCat] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [newContent, setNewContent] = React.useState('');
      const [newCat, setNewCat] = React.useState('fact');
      const [newImp, setNewImp] = React.useState('3');
      const [pathTarget, setPathTarget] = React.useState('');

      function doLoad(qv, cv) {
        setLoading(true);
        host.call('mem.list', { q: qv || '', category: cv || undefined, limit: 80 })
          .then((res) => {
            setRows((res && res.results) || []);
            setSummary((res && res.summary) || null);
            if (res && res.file) setFile(res.file);
            setError('');
            setLoading(false);
          })
          .catch((e) => {
            setError(String((e && e.message) || e));
            setLoading(false);
          });
      }
      function act(promise) {
        setBusy(true); setMsg(''); setError('');
        return promise
          .then((res) => {
            if (res && res.ok === false) setError(res.error || 'operation failed');
            else if (res && res.action) setMsg(res.action + (res.path ? ' → ' + res.path : '') + (typeof res.added === 'number' ? '（新增 ' + res.added + '，跳过 ' + (res.skipped || 0) + '）' : '') + (typeof res.exported === 'number' ? '（导出 ' + res.exported + ' 条）' : ''));
            doLoad(q, cat);
          })
          .catch((e) => setError(String((e && e.message) || e)))
          .finally(() => setBusy(false));
      }

      React.useEffect(() => { doLoad('', ''); }, []);

      function addMem() {
        const content = newContent.trim();
        if (!content || busy) return;
        setBusy(true);
        host.call('mem.save', { content, category: newCat, importance: Number(newImp) || 3, scope: 'shared' })
          .then((res) => {
            if (res && res.ok === false) { setError(res.error || 'save failed'); }
            else { setNewContent(''); doLoad(q, cat); }
          })
          .catch((e) => setError(String((e && e.message) || e)))
          .finally(() => setBusy(false));
      }

      function delMem(id) {
        if (busy) return;
        setBusy(true);
        host.call('mem.delete', { id })
          .then((res) => {
            if (res && res.ok === false) { setError(res.error || 'delete failed'); }
            else doLoad(q, cat);
          })
          .catch((e) => setError(String((e && e.message) || e)))
          .finally(() => setBusy(false));
      }

      const total = summary ? summary.total : 0;
      const opts = [];
      opts.push(React.createElement('option', { key: 'all', value: '' }, '全部分类'));
      for (const c of CATEGORIES) opts.push(React.createElement('option', { key: c, value: c }, c));
      const impOpts = [];
      for (let i = 1; i <= 5; i++) impOpts.push(React.createElement('option', { key: i, value: String(i) }, String(i)));

      const children = [];
      children.push(React.createElement('div', { key: 'head', className: 'dshm-head' },
        React.createElement('span', { className: 'dshm-title' }, '记忆 Memory'),
        React.createElement('span', { className: 'dshm-chip' }, '共 ' + total + ' 条'),
        summary && summary.durable === false
          ? React.createElement('span', { className: 'dshm-chip dshm-warn' }, '仅内存（无持久化）')
          : file
            ? React.createElement('span', { className: 'dshm-chip dshm-ok dshm-file', title: file }, '存储: ' + file)
            : null,
      ));

      children.push(React.createElement('div', { key: 'sync', className: 'dshm-bar' },
        React.createElement('input', {
          className: 'dshm-input dshm-grow', placeholder: '同步/迁移目标绝对路径（建议云同步目录）…', value: pathTarget,
          onChange: (e) => setPathTarget(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') act(host.call('mem.path.set', { path: pathTarget })); },
        }),
        React.createElement('button', { className: 'dshm-btn', onClick: () => act(host.call('mem.path.set', { path: pathTarget })), disabled: busy || !pathTarget.trim(), title: '目标不存在=迁移过去；已存在=采用远端那份' }, '设为存储'),
        React.createElement('button', { className: 'dshm-btn', onClick: () => act(host.call('mem.export', { path: pathTarget || file })), disabled: busy || !(pathTarget.trim() || file) }, '导出'),
        React.createElement('button', { className: 'dshm-btn', onClick: () => act(host.call('mem.import', { path: pathTarget, mode: 'merge' })), disabled: busy || !pathTarget.trim(), title: '把该文件合并进当前库（按 id/内容去重）' }, '导入'),
      ));

      children.push(React.createElement('div', { key: 'bar', className: 'dshm-bar' },
        React.createElement('input', {
          className: 'dshm-input dshm-grow', placeholder: '搜索记忆…', value: q,
          onChange: (e) => setQ(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') doLoad(q, cat); },
        }),
        React.createElement('select', { className: 'dshm-input', value: cat, onChange: (e) => setCat(e.target.value) }, opts),
        React.createElement('button', { className: 'dshm-btn', onClick: () => doLoad(q, cat), disabled: loading }, '搜索'),
      ));

      if (error) children.push(React.createElement('div', { key: 'err', className: 'dshm-error' }, error));
      if (msg) children.push(React.createElement('div', { key: 'msg', className: 'dshm-ok' }, msg));

      children.push(React.createElement('div', { key: 'add', className: 'dshm-add' },
        React.createElement('input', {
          className: 'dshm-input dshm-grow', placeholder: '输入要记住的内容…', value: newContent,
          onChange: (e) => setNewContent(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') addMem(); },
        }),
        React.createElement('select', { className: 'dshm-input dshm-sm', value: newCat, onChange: (e) => setNewCat(e.target.value) }, opts.slice(1)),
        React.createElement('select', { className: 'dshm-input dshm-sm', value: newImp, onChange: (e) => setNewImp(e.target.value), title: '重要度' }, impOpts),
        React.createElement('button', { className: 'dshm-btn dshm-primary', onClick: addMem, disabled: busy || !newContent.trim() }, '记住'),
      ));

      if (loading) {
        children.push(React.createElement('div', { key: 'loading', className: 'dshm-note' }, '加载中…'));
      } else if (!rows.length) {
        children.push(React.createElement('div', { key: 'empty', className: 'dshm-note' }, '暂无记忆。对我说“记住 …”，或在上方输入后点击“记住”。'));
      } else {
        const list = [];
        for (const r of rows) {
          list.push(React.createElement('div', { key: r.id, className: 'dshm-row' },
            React.createElement('div', { className: 'dshm-row-top' },
              React.createElement('span', { className: 'dshm-preview' }, r.preview || r.content),
              React.createElement('button', {
                className: 'dshm-btn dshm-danger',
                onClick: () => delMem(r.id),
                disabled: busy,
                title: '删除该记忆',
              }, '遗忘'),
            ),
            React.createElement('div', { className: 'dshm-meta' },
              '#' + r.category + ' · 重要度 ' + r.importance + ' · ' + (r.scope || 'shared') + (r.topic ? ' · 主题:' + r.topic : '') + ' · 访问 ' + r.accessCount + (r.historyCount ? ' · 历史 ' + r.historyCount + ' 版' : ''),
            ),
          ));
        }
        children.push(React.createElement('div', { key: 'list', className: 'dshm-list' }, list));
      }

      return React.createElement('div', { className: 'dshm' }, children);
    }

    const slots = ctx.get('slots');
    if (!slots) return;
    ctx.effect(() => styles.insert(
      '.dshm{font-size:12px;line-height:1.55;border:1px solid rgba(128,128,128,.35);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;color:inherit;max-width:820px}' +
      '.dshm *{box-sizing:border-box}' +
      '.dshm-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '.dshm-title{font-weight:600;font-size:13px}' +
      '.dshm-chip{border:1px solid rgba(128,128,128,.35);border-radius:999px;padding:0 8px;font-size:11px;opacity:.9;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dshm-file{direction:rtl;text-align:left}' +
      '.dshm-ok{border-color:rgba(60,170,90,.5);color:#3aa65a}' +
      '.dshm-warn{border-color:rgba(210,150,40,.5);color:#d29028}' +
      '.dshm-bar,.dshm-add{display:flex;gap:6px;align-items:center}' +
      '.dshm-grow{flex:1;min-width:120px}' +
      '.dshm-sm{width:78px}' +
      '.dshm-input{background:transparent;border:1px solid rgba(128,128,128,.4);border-radius:6px;padding:3px 6px;color:inherit;font-size:12px}' +
      '.dshm-btn{border:1px solid rgba(128,128,128,.4);border-radius:6px;background:transparent;color:inherit;padding:3px 8px;font-size:12px;cursor:pointer;white-space:nowrap}' +
      '.dshm-btn:disabled{opacity:.45;cursor:default}' +
      '.dshm-primary{border-color:rgba(70,130,230,.6);color:#4682e6}' +
      '.dshm-danger{border-color:rgba(220,90,90,.55);color:#dc5a5a;padding:1px 8px}' +
      '.dshm-error{color:#dc5a5a;font-size:12px}' +
      '.dshm-note{color:inherit;opacity:.6;font-size:12px;padding:2px 0}' +
      '.dshm-list{display:flex;flex-direction:column;gap:5px;max-height:300px;overflow:auto}' +
      '.dshm-row{border:1px solid rgba(128,128,128,.22);border-radius:8px;padding:5px 8px;display:flex;flex-direction:column;gap:2px}' +
      '.dshm-row-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}' +
      '.dshm-preview{white-space:pre-wrap;word-break:break-word;font-size:12px}' +
      '.dshm-meta{opacity:.6;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    ));
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => React.createElement(MemoryPanel, null),
    ));
  },
};
