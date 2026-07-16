import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Bot, Check, ChevronRight, Download, Eye, EyeOff, FoldHorizontal, Library, Maximize2, Monitor, Moon, Newspaper, PanelRightClose, PanelRightOpen, RefreshCw, RotateCw, Ruler, Settings, ShieldCheck, Smartphone, Sparkles, Sun, TestTube2, Wifi } from 'lucide-react';
import { get, patch, post } from './api';
import type { Model, Tab } from './types';

type DeviceId = 'outer' | 'inner' | 'desktop';
type LogKind = 'info' | 'running' | 'success' | 'error';
type StudioLog = { id: number; time: string; kind: LogKind; message: string };
type Diagnostics = { viewport: { width: number; height: number; dpr: number }; safeArea: { top: string; right: string; bottom: string; left: string }; theme: string; userAgent: string };

const DEVICES: Array<{ id: DeviceId; label: string; hint: string; width: number; height: number; icon: typeof Smartphone }> = [
  { id: 'outer', label: 'X Fold 外屏', hint: '430 × 932', width: 430, height: 932, icon: Smartphone },
  { id: 'inner', label: 'X Fold 内屏', hint: '760 × 900', width: 760, height: 900, icon: FoldHorizontal },
  { id: 'desktop', label: '桌面三栏', hint: '1180 × 820', width: 1180, height: 820, icon: Monitor }
];

const NAV_ITEMS: Array<{ tab: Tab; label: string; icon: typeof Newspaper }> = [
  { tab: 'today', label: '今日', icon: Newspaper },
  { tab: 'monitors', label: '监控', icon: TestTube2 },
  { tab: 'library', label: '资料库', icon: Library },
  { tab: 'settings', label: '模型设置', icon: Settings }
];

const CHECKS = ['首页与时间线', '文章打开和返回', 'Kimi 连接', '深色模式', '外屏布局', '内屏布局'];

export default function DemoStudio() {
  const [deviceId, setDeviceId] = useState<DeviceId>('outer');
  const [rotated, setRotated] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [frameVersion, setFrameVersion] = useState(0);
  const [scale, setScale] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panelPage, setPanelPage] = useState<'controls' | 'android'>('controls');
  const [model, setModel] = useState('kimi-for-coding');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [modelBusy, setModelBusy] = useState<'test' | 'save'>();
  const [logs, setLogs] = useState<StudioLog[]>([{ id: 1, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), kind: 'info', message: '测试工作台已就绪' }]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const stageRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const selected = DEVICES.find((item) => item.id === deviceId)!;
  const dimensions = rotated ? { width: selected.height, height: selected.width } : selected;

  const addLog = (message: string, kind: LogKind = 'info') => setLogs((items) => [{
    id: Date.now() + Math.random(),
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    kind,
    message
  }, ...items].slice(0, 20));

  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams({ previewNative: '1', previewEditorial: '1', previewTheme: theme, studioChild: '1', v: String(frameVersion) });
    return `/?${params.toString()}`;
  }, [theme, frameVersion]);

  useEffect(() => {
    const fit = () => {
      if (!stageRef.current) return;
      const availableWidth = Math.max(280, stageRef.current.clientWidth - 56);
      const availableHeight = Math.max(360, stageRef.current.clientHeight - 56);
      setScale(Math.min(1, availableWidth / dimensions.width, availableHeight / (dimensions.height + 32)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (stageRef.current) observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [dimensions.width, dimensions.height, sidebarOpen]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.data?.source !== 'daye-app') return;
      if (event.data.type === 'toast' && typeof event.data.message === 'string') addLog(event.data.message, /成功|已保存|已更新|已刷新/.test(event.data.message) ? 'success' : 'info');
      if (event.data.type === 'diagnostics') {
        setDiagnostics({ viewport: event.data.viewport, safeArea: event.data.safeArea, theme: event.data.theme, userAgent: event.data.userAgent });
        addLog(`视口诊断完成：${event.data.viewport.width} × ${event.data.viewport.height}`, 'success');
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  const send = (payload: Record<string, unknown>) => iframeRef.current?.contentWindow?.postMessage({ source: 'daye-studio', ...payload }, location.origin);
  const navigate = (tab: Tab) => { send({ type: 'navigate', tab }); addLog(`已切换到「${NAV_ITEMS.find((item) => item.tab === tab)?.label}」`); };
  const runDiagnostics = () => { send({ type: 'diagnostics' }); addLog('正在读取预览 App 诊断信息…', 'running'); };

  const testKimi = async () => {
    if (!apiKey.trim()) { addLog('请先输入 Kimi Coding Plan Key', 'error'); return; }
    setModelBusy('test'); addLog('正在连接 Kimi Coding Plan…', 'running');
    try {
      const result = await post<{ message: string }>('/api/models/test', { provider: 'kimi-coding', label: 'Kimi Coding Plan', model, baseUrl: 'https://api.kimi.com/coding/v1', apiKey: apiKey.trim() });
      addLog(result.message || 'Kimi 连接成功', 'success');
      setChecks((value) => ({ ...value, 'Kimi 连接': true }));
    } catch (error) { addLog(error instanceof Error ? error.message : '连接测试失败', 'error'); }
    finally { setModelBusy(undefined); }
  };

  const saveKimi = async () => {
    if (!apiKey.trim()) { addLog('请先输入 Kimi Coding Plan Key', 'error'); return; }
    setModelBusy('save'); addLog('正在保存模型到当前 Demo 会话…', 'running');
    try {
      const payload = { provider: 'kimi-coding', label: 'Kimi Coding Plan', model, baseUrl: 'https://api.kimi.com/coding/v1', apiKey: apiKey.trim(), roles: ['summary', 'translation', 'analysis'] };
      const models = await get<Model[]>('/api/models');
      const existing = models.find((item) => item.provider === 'kimi-coding');
      if (existing) await patch(`/api/models/${existing.id}`, payload); else await post('/api/models', payload);
      send({ type: 'reload-data' });
      addLog('模型已保存到当前浏览器会话，并同步给预览 App', 'success');
      setChecks((value) => ({ ...value, 'Kimi 连接': true }));
    } catch (error) { addLog(error instanceof Error ? error.message : '模型保存失败', 'error'); }
    finally { setModelBusy(undefined); }
  };

  const chooseDevice = (id: DeviceId) => {
    setDeviceId(id); setRotated(false);
    const label = DEVICES.find((item) => item.id === id)?.label ?? id;
    addLog(`预览设备：${label}`);
    if (id === 'outer') setChecks((value) => ({ ...value, '外屏布局': true }));
    if (id === 'inner') setChecks((value) => ({ ...value, '内屏布局': true }));
  };

  const frameChromeHeight = 32;
  const frameStyle = {
    '--frame-width': `${dimensions.width}px`, '--frame-height': `${dimensions.height}px`, '--frame-scale': scale,
    width: dimensions.width * scale, height: (dimensions.height + frameChromeHeight) * scale
  } as CSSProperties;

  return <div className={`studio-shell ${sidebarOpen ? 'panel-open' : 'panel-closed'}`}>
    <header className="studio-topbar">
      <div className="studio-brand"><span><Sparkles size={17} /></span><div><strong>大爷的 RSS · Test Studio</strong><small><i />本地实时 Demo</small></div></div>
      <div className="studio-top-actions"><button onClick={() => { setFrameVersion((value) => value + 1); addLog('预览已重新载入'); }}><RefreshCw size={16} />重新载入</button><a href={iframeSrc} target="_blank" rel="noreferrer"><Maximize2 size={16} />独立打开</a><button className="panel-toggle" onClick={() => setSidebarOpen((value) => !value)}>{sidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div>
    </header>

    <main className="studio-stage" ref={stageRef}>
      <div className="device-frame" style={frameStyle}>
        <div className="device-frame-inner" style={{ width: dimensions.width, height: dimensions.height + frameChromeHeight, transform: `scale(${scale})` }}>
          <div className="device-bar"><span>{selected.label}{rotated ? ' · 横屏' : ''}</span><b>{dimensions.width} × {dimensions.height}</b></div>
          <iframe ref={iframeRef} key={iframeSrc} title="大爷的 RSS 实时预览" src={iframeSrc} onLoad={() => addLog('App 预览载入完成', 'success')} />
        </div>
      </div>
    </main>

    <aside className="studio-panel" aria-label="测试控制侧边栏">
      <div className="studio-panel-head"><div><strong>测试控制台</strong><span>设备、界面、模型与运行结果</span></div><button onClick={() => setSidebarOpen(false)}><PanelRightClose size={18} /></button></div>
      <nav className="studio-panel-tabs"><button className={panelPage === 'controls' ? 'active' : ''} onClick={() => setPanelPage('controls')}><Settings size={15} />控制台</button><button className={panelPage === 'android' ? 'active' : ''} onClick={() => { setPanelPage('android'); window.setTimeout(runDiagnostics, 120); }}><Smartphone size={15} />安卓测试</button></nav>

      <div className={panelPage === 'controls' ? 'studio-panel-page active' : 'studio-panel-page'}>

      <section className="studio-control-section">
        <h2>设备与视口</h2>
        <div className="device-options">{DEVICES.map(({ id, label, hint, icon: Icon }) => <button key={id} className={deviceId === id ? 'active' : ''} onClick={() => chooseDevice(id)}><Icon size={17} /><span><strong>{label}</strong><small>{hint}</small></span>{deviceId === id && <Check size={15} />}</button>)}</div>
        <button className="studio-wide-button" onClick={() => { setRotated((value) => !value); addLog('已旋转预览方向'); }}><RotateCw size={16} />旋转设备<span>{rotated ? '横屏' : '竖屏'}</span></button>
      </section>

      <section className="studio-control-section">
        <h2>界面状态</h2>
        <div className="theme-switch"><button className={theme === 'light' ? 'active' : ''} onClick={() => { setTheme('light'); addLog('已切换浅色模式'); }}><Sun size={16} />浅色</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => { setTheme('dark'); setChecks((value) => ({ ...value, '深色模式': true })); addLog('已切换深色模式'); }}><Moon size={16} />深色</button></div>
        <div className="studio-nav-grid">{NAV_ITEMS.map(({ tab, label, icon: Icon }) => <button key={tab} onClick={() => navigate(tab)}><Icon size={16} />{label}<ChevronRight size={14} /></button>)}</div>
        <button className="studio-wide-button" onClick={() => { send({ type: 'open-ai' }); addLog('已打开 AI 助手'); }}><Bot size={16} />打开 AI 助手<ChevronRight size={15} /></button>
      </section>

      <section className="studio-control-section">
        <h2>Kimi Coding Plan</h2>
        <label className="studio-field"><span>模型</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="kimi-for-coding">kimi-for-coding</option><option value="kimi-for-coding-highspeed">kimi-for-coding-highspeed</option></select></label>
        <label className="studio-field"><span>API Key</span><div className="studio-key"><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} placeholder="输入后直接测试" autoComplete="off" /><button onClick={() => setShowKey((value) => !value)} type="button">{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
        <p className="studio-security-note">仅保存在当前浏览器标签会话；关闭标签后清除。安卓版本使用 Keystore。</p>
        <div className="studio-model-actions"><button onClick={testKimi} disabled={Boolean(modelBusy)}><TestTube2 size={16} />{modelBusy === 'test' ? '测试中…' : '测试连接'}</button><button className="primary" onClick={saveKimi} disabled={Boolean(modelBusy)}>{modelBusy === 'save' ? '保存中…' : '保存到 Demo'}</button></div>
      </section>

      <section className="studio-control-section">
        <h2>验收清单 <span>{Object.values(checks).filter(Boolean).length}/{CHECKS.length}</span></h2>
        <div className="studio-checks">{CHECKS.map((item) => <label key={item}><input type="checkbox" checked={Boolean(checks[item])} onChange={(event) => setChecks((value) => ({ ...value, [item]: event.target.checked }))} /><span>{item}</span></label>)}</div>
      </section>

      <section className="studio-control-section studio-log-section">
        <h2>运行日志 <button onClick={() => setLogs([])}>清空</button></h2>
        <div className="studio-logs">{logs.length ? logs.map((item) => <div key={item.id} className={item.kind}><i /><time>{item.time}</time><span>{item.message}</span></div>) : <p>暂无日志</p>}</div>
      </section>
      </div>

      <div className={panelPage === 'android' ? 'studio-panel-page active' : 'studio-panel-page'}>
        <section className="studio-control-section android-test-hero">
          <div className="android-test-badge"><ShieldCheck size={18} /><span><strong>Android 专项测试</strong><small>v1.5-kimi-xfold · com.daye.rss</small></span></div>
          <p>针对 vivo X Fold 外屏、内屏、系统返回手势、安全区与原生网络链路。</p>
          <a className="android-apk-link" href="/__daye_apk"><Download size={16} />下载最新测试 APK</a>
        </section>

        <section className="studio-control-section">
          <h2>快速场景</h2>
          <div className="android-scenarios">
            <button onClick={() => { chooseDevice('outer'); window.setTimeout(runDiagnostics, 260); }}><Smartphone size={17} /><span><strong>外屏竖屏</strong><small>430 × 932 真实内容视口</small></span><ChevronRight size={15} /></button>
            <button onClick={() => { chooseDevice('inner'); window.setTimeout(runDiagnostics, 260); }}><FoldHorizontal size={17} /><span><strong>展开内屏</strong><small>双栏与折叠屏布局</small></span><ChevronRight size={15} /></button>
            <button onClick={() => { setTheme('dark'); setChecks((value) => ({ ...value, '深色模式': true })); addLog('安卓测试：深色模式'); }}><Moon size={17} /><span><strong>深色模式</strong><small>正文、玻璃层与对比度</small></span><ChevronRight size={15} /></button>
            <button onClick={() => { navigate('today'); send({ type: 'close-transient' }); addLog('请打开一篇文章后使用屏幕边缘返回'); }}><ArrowLeft size={17} /><span><strong>返回手势</strong><small>文章 → 首页，不退出 App</small></span><ChevronRight size={15} /></button>
            <button onClick={() => { setPanelPage('controls'); addLog('已进入 Kimi 连接测试'); }}><Bot size={17} /><span><strong>Kimi 原生链路</strong><small>Key、摘要与空响应重试</small></span><ChevronRight size={15} /></button>
            <button onClick={() => { navigate('settings'); addLog('请添加 RSS 地址测试真实网络抓取'); }}><Wifi size={17} /><span><strong>RSS 网络</strong><small>HTTPS、图片与全文提取</small></span><ChevronRight size={15} /></button>
          </div>
        </section>

        <section className="studio-control-section">
          <h2>实时设备诊断 <button onClick={runDiagnostics}>重新检测</button></h2>
          {diagnostics ? <div className="android-diagnostics">
            <div><Ruler size={15} /><span>内容视口</span><strong>{diagnostics.viewport.width} × {diagnostics.viewport.height}</strong></div>
            <div><Monitor size={15} /><span>像素倍率</span><strong>{diagnostics.viewport.dpr.toFixed(2)} DPR</strong></div>
            <div><Sun size={15} /><span>解析主题</span><strong>{diagnostics.theme === 'dark' ? '深色' : '浅色'}</strong></div>
            <div><ShieldCheck size={15} /><span>安全区</span><strong>{diagnostics.safeArea.top} / {diagnostics.safeArea.bottom}</strong></div>
            <p>{diagnostics.userAgent}</p>
          </div> : <button className="studio-wide-button" onClick={runDiagnostics}><RefreshCw size={16} />读取当前预览诊断</button>}
        </section>

        <section className="studio-control-section">
          <h2>安卓验收 <span>{Object.values(checks).filter(Boolean).length}/{CHECKS.length}</span></h2>
          <div className="android-check-list">{CHECKS.map((item) => <label key={item}><input type="checkbox" checked={Boolean(checks[item])} onChange={(event) => setChecks((value) => ({ ...value, [item]: event.target.checked }))} /><span>{item}</span><b>{checks[item] ? '通过' : '待验证'}</b></label>)}</div>
        </section>

        <section className="studio-control-section studio-log-section">
          <h2>测试日志 <button onClick={() => setLogs([])}>清空</button></h2>
          <div className="studio-logs">{logs.length ? logs.map((item) => <div key={item.id} className={item.kind}><i /><time>{item.time}</time><span>{item.message}</span></div>) : <p>暂无日志</p>}</div>
        </section>
      </div>
    </aside>
  </div>;
}
