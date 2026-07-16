import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowLeft, ArrowUp, Bell, Bookmark, BookOpen, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, Database, Download, ExternalLink, FileUp, Filter, FolderOpen, Headphones, Languages, LayoutGrid, Library, MessageCircle, MoreHorizontal, Newspaper, Pencil, Play, PlugZap, Plus, RefreshCw, Rss, Search, Send, Settings, ShieldCheck, Sparkles, Sun, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import { del, get, getApiUrl, hasToken, isLocalMode, patch, post, put, setApiUrl, setToken } from './api';
import { articleReadingMinutes } from './reading-time';
import { selectRelatedArticles } from './synthesis-relevance';
import { CounterPositionedGlassImage, LiquidGlassRuntime } from './LiquidGlass';
import type { AIRole, Article, Importance, Model, Monitor, Preferences, Source, Tab } from './types';

const navItems: Array<{ id: Tab; label: string; icon: typeof Newspaper }> = [
  { id: 'today', label: '今日', icon: Newspaper }, { id: 'monitors', label: '监控', icon: Bell },
  { id: 'library', label: '资料库', icon: Library }, { id: 'settings', label: '我的', icon: Settings }
];
const importanceLabel: Record<Importance, string> = { critical: '重大', high: '重要', normal: '一般', low: '低优先' };
const editorialPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('previewEditorial') === '1';
const previewTheme = import.meta.env.DEV && ['light', 'dark'].includes(new URLSearchParams(window.location.search).get('previewTheme') ?? '') ? new URLSearchParams(window.location.search).get('previewTheme') as 'light' | 'dark' : undefined;
type EnrichmentStatus = { running: boolean; queued: number; currentId?: string; currentIds?: string[]; concurrency?: number; processed: number; failed: number; lastError?: string; dailyProcessed?: number; dailyLimit?: number; pausedReason?: string };
type SynthesisResult = { headline: string; answer: string; sources: Array<{ index: number; id: string; title: string; url: string; sourceTitle: string }> };
type SynthesisViewState = { key: string; articles: Article[]; loading: boolean; headline?: string; result?: SynthesisResult; error?: string };
type CurationResult = { mode: 'ai' | 'rules'; total: number; items: Array<{ id: string; reason: string }> };
type RefreshStatus = { kind: 'loading' | 'success' | 'error'; message: string };
type AIModelStatus = { state: 'idle' | 'working' | 'fallback' | 'ready' | 'error'; message: string; detail?: string; failureKind?: 'auth' | 'quota' | 'timeout' | 'network' | 'provider' | 'unknown'; modelLabel?: string; fallbackLabel?: string; updatedAt: string };
type HomePage = { kind: 'today' } | { kind: 'articles'; source?: string; fromSources?: boolean } | { kind: 'sources' };
const MarkdownBody = lazy(() => import('./MarkdownBody'));

function plainMarkdown(value = '') {
  return value.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_~>#-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function articleTitles(article: Article) {
  const originalIsChinese = /[\u3400-\u9fff]/.test(article.title);
  const summaryLead = plainMarkdown(article.summaryZh).replace(/^(?:一句话结论|结论)\s*/u, '').split(/[。！？]/u)[0]?.trim() ?? '';
  const derivedChinese = /[\u3400-\u9fff]/.test(summaryLead) ? shorten(summaryLead, 38) : '';
  const zh = article.titleZh || (originalIsChinese ? article.title : derivedChinese || article.title);
  const en = article.titleEn || (!originalIsChinese ? article.title : '');
  return { zh, en: en && en !== zh ? en : '' };
}

function articleProcessingCopy(article: Article) {
  if (article.summaryZh) return plainMarkdown(article.summaryZh);
  if (article.enrichmentError) return article.enrichmentError;
  if (article.fulltextError) return `正文抓取失败：${article.fulltextError}`;
  return article.excerpt || '等待后台生成中文摘要';
}

function synthesisFallbackHeadline(articles: Article[]) {
  const lead = articles[0];
  if (!lead) return '正在提炼跨来源观点';
  const summary = plainMarkdown(lead.summaryZh).replace(/^(?:一句话结论|结论)\s*/u, '');
  const sentence = summary.split(/[。！？]/u)[0]?.trim();
  return shorten(sentence || articleTitles(lead).zh, 44);
}

function displaySynthesisHeadline(value: string) {
  return shorten(value.replace(/^(?:综合结论|一句话结论|结论)\s*[:：]\s*/u, '').trim(), 44);
}

function selectCuratedFallback(articles: Article[], limit = 9) {
  const eligible = [...articles].sort((left, right) => right.importanceScore - left.importanceScore || Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  const selected: Article[] = []; const sourceCounts = new Map<string, number>(); const seenClusters = new Set<string>();
  eligible.forEach((article) => {
    if (selected.length >= limit) return;
    const cluster = article.clusterId || article.url;
    if (seenClusters.has(cluster) || (sourceCounts.get(article.sourceTitle) ?? 0) >= 3) return;
    selected.push(article); seenClusters.add(cluster); sourceCounts.set(article.sourceTitle, (sourceCounts.get(article.sourceTitle) ?? 0) + 1);
  });
  return selected;
}

function AsyncMarkdownBody({ children }: { children: string }) {
  return <Suspense fallback={<div className="markdown-loading">正在排版中文摘要…</div>}><MarkdownBody>{children}</MarkdownBody></Suspense>;
}
const previewArticles: Article[] = [
  { id:'preview-1', sourceId:'wsj', sourceTitle:'华尔街见闻', title:'OpenAI 发布 GPT-5 系列：推理能力大幅提升，API 性能与价格同步优化', titleZh:'OpenAI 发布 GPT-5：推理升级，API 同步降本', titleEn:'OpenAI launches GPT-5 with stronger reasoning and lower API costs', url:'#', publishedAt:'2026-07-13T01:28:00.000Z', excerpt:'GPT-5 在代码、数学和长上下文任务中表现领先，企业版 API 输入价格下降 20%。', contentHtml:'<p>OpenAI 发布新一代模型，重点提升复杂推理、代码生成和长期任务表现。</p>', summaryZh:'新模型进一步降低复杂推理成本，并把可靠性和长上下文能力作为企业应用重点。', imageUrl:'/editorial/ai-chip.webp', topics:['芯片与 AI','国际'], importance:'critical', importanceScore:96, importanceReason:'可能改变模型应用成本与产品路线', clusterId:'gpt5', status:'unread', createdAt:'2026-07-13T01:29:00.000Z' },
  { id:'preview-2', sourceId:'info', sourceTitle:'The Information', title:'苹果与台积电敲定 2nm 芯片独家协议', titleZh:'苹果锁定台积电早期 2nm 芯片产能', titleEn:'Apple secures TSMC early 2nm chip capacity', url:'#', publishedAt:'2026-07-13T00:41:00.000Z', excerpt:'新一代移动芯片将率先采用台积电 N2 工艺，苹果预计锁定大部分早期产能。', contentHtml:'<p>苹果正在为下一代设备锁定先进制程产能。</p>', topics:['芯片与 AI'], importance:'high', importanceScore:90, importanceReason:'影响先进制程供需与苹果产品节奏', clusterId:'2nm', status:'unread', createdAt:'2026-07-13T00:42:00.000Z' },
  { id:'preview-3', sourceId:'reuters', sourceTitle:'路透社', title:'英伟达将恢复向中国销售 H20 芯片', titleZh:'英伟达计划恢复向中国销售 H20 芯片', titleEn:'Nvidia plans to resume H20 chip sales in China', url:'#', publishedAt:'2026-07-13T00:15:00.000Z', excerpt:'在获得监管批准后，英伟达计划于未来两个月内恢复相关产品对华出口。', contentHtml:'<p>监管变化为 H20 芯片恢复供应创造条件。</p>', summaryZh:'恢复销售将影响英伟达区域收入，也会改变国内算力供给预期。', imageUrl:'/editorial/ai-chip.webp', topics:['芯片与 AI','国际'], importance:'high', importanceScore:88, importanceReason:'涉及出口限制与算力供给', clusterId:'h20', status:'unread', createdAt:'2026-07-13T00:16:00.000Z' },
  { id:'preview-4', sourceId:'bloomberg', sourceTitle:'彭博社', title:'软银愿景基金二季度大幅增持 TSMC 与 Arm', titleZh:'软银愿景基金加码台积电与 Arm', titleEn:'SoftBank Vision Fund boosts stakes in TSMC and Arm', url:'#', publishedAt:'2026-07-12T23:42:00.000Z', excerpt:'最新披露显示其提高了对半导体基础设施与 IP 公司的长期配置。', contentHtml:'<p>资本继续向 AI 基础设施集中。</p>', topics:['投资'], importance:'normal', importanceScore:78, importanceReason:'反映大型资本的 AI 配置方向', status:'unread', createdAt:'2026-07-12T23:43:00.000Z' },
  { id:'preview-5', sourceId:'caixin', sourceTitle:'财新网', title:'中国 6 月出口同比增长 6.3%，芯片出口加速', titleZh:'中国 6 月出口增长 6.3%，芯片出口提速', titleEn:'China exports rise 6.3% as chip shipments accelerate', url:'#', publishedAt:'2026-07-12T23:12:00.000Z', excerpt:'海关总署数据显示，集成电路出口创单月新高。', contentHtml:'<p>芯片出口成为本月贸易数据的重要推动力。</p>', topics:['投资','监控'], importance:'normal', importanceScore:72, importanceReason:'影响宏观与半导体景气判断', status:'unread', createdAt:'2026-07-12T23:13:00.000Z' },
  { id:'preview-6', sourceId:'tc', sourceTitle:'TechCrunch', title:'Meta 自研训练芯片新进展：MTIA 第二代已流片', titleZh:'Meta 第二代 MTIA 自研训练芯片已流片', titleEn:'Meta tapes out its second-generation MTIA training chip', url:'#', publishedAt:'2026-07-12T22:51:00.000Z', excerpt:'新一代芯片面向推荐与广告系统，预计将显著降低推理成本。', contentHtml:'<p>Meta 继续推进自研芯片以降低对外部算力的依赖。</p>', imageUrl:'/editorial/ai-chip.webp', topics:['芯片与 AI'], importance:'normal', importanceScore:70, importanceReason:'云厂商自研芯片趋势延续', status:'unread', createdAt:'2026-07-12T22:52:00.000Z' }
];

interface WebInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function cx(...values: Array<string | false | undefined>) { return values.filter(Boolean).join(' '); }
function timeAgo(value: string) {
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60_000);
  if (minutes < 1) return '刚刚'; if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function Button({ children, className, icon: Icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: typeof Plus }) {
  return <button className={cx('button', className)} {...props}>{Icon && <Icon size={16} />}{children}</button>;
}

function SourceLogo({ source, title, tone = 0 }: { source?: Pick<Source, 'url' | 'siteUrl'>; title: string; tone?: number }) {
  const [attempt, setAttempt] = useState(0);
  let icons: string[] = [];
  try { const base = source?.siteUrl || source?.url; if (base) { const parsed = new URL(base); icons = [new URL('/favicon.ico', parsed).toString(), `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(parsed.origin)}&sz=64`]; } } catch { /* Use the local fallback. */ }
  const icon = icons[attempt];
  return <span className={`source-avatar tone-${tone % 5}`}>{icon ? <img src={icon} alt={`${title} logo`} loading="lazy" referrerPolicy="no-referrer" onError={() => setAttempt((value) => value + 1)} /> : <span aria-hidden="true">{title.trim().slice(0, 1).toUpperCase() || <Rss size={16} />}</span>}</span>;
}

function runViewTransition(update: () => void, reduceMotion = false) {
  const documentWithTransitions = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (reduceMotion || !documentWithTransitions.startViewTransition) { update(); return; }
  documentWithTransitions.startViewTransition(update);
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState(''); const [serverUrl, setServerUrl] = useState(getApiUrl()); const [code, setCode] = useState(''); const [sent, setSent] = useState(false); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const verify = async (raw: string) => { const result = await post<{ token: string }>('/api/auth/verify', { token: raw }); setToken(result.token); onLogin(); };
  useEffect(() => { const raw = new URLSearchParams(location.search).get('token'); if (raw) verify(raw).then(() => history.replaceState({}, '', '/')).catch((e) => setError(e.message)); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(''); setApiUrl(serverUrl);
    try {
      const result = await post<{ ok: boolean; devMagicLink?: string; devCode?: string }>('/api/auth/request', { email }); setSent(true);
      if (result.devCode) setCode(result.devCode);
    } catch (e) { setError(e instanceof Error ? e.message : '发送失败'); } finally { setLoading(false); }
  };
  const enterDevelopment = async () => {
    setLoading(true); setError(''); setApiUrl(serverUrl);
    try { const result = await post<{ token: string }>('/api/auth/dev'); setToken(result.token); onLogin(); }
    catch (e) { setError(e instanceof Error ? e.message : '开发模式登录失败'); }
    finally { setLoading(false); }
  };
  return <main className="login-shell">
    <section className="login-card glass">
      <div className="brand-mark">大</div><p className="eyebrow">PRIVATE INTELLIGENCE READER</p>
      <h1>大爷的 RSS</h1><p className="login-lead">替你读完、过滤并整合重要资讯。<br />只有重要的事，才来打扰你。</p>
      {!sent ? <form onSubmit={submit}><label>私有服务地址（网页版同域部署可留空）</label><input className="server-input" type="url" placeholder="https://rss.example.com" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} /><label>允许登录的邮箱</label><div className="input-row"><input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required /><Button type="submit" disabled={loading}>{loading ? '发送中' : '获取验证码'}</Button></div></form> : <form onSubmit={async (e) => { e.preventDefault(); setLoading(true); try { const result = await post<{ token: string }>('/api/auth/verify', { code }); setToken(result.token); onLogin(); } catch (err) { setError(err instanceof Error ? err.message : '验证失败'); } finally { setLoading(false); } }}><label>邮件中的 6 位验证码</label><div className="input-row"><input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" required /><Button type="submit" disabled={loading || code.length !== 6}>{loading ? '验证中' : '登录'}</Button></div><button className="link-button" type="button" onClick={() => { setSent(false); setCode(''); }}>更换邮箱或服务地址</button></form>}
      {import.meta.env.DEV && !sent && <button className="dev-login-button" type="button" onClick={enterDevelopment} disabled={loading}><Sparkles size={16} />直接进入本地 Web 测试</button>}
      {sent && !error && <p className="success"><Check size={16} />验证码已发送，10 分钟内有效。</p>}{error && <p className="error"><CircleAlert size={16} />{error}</p>}
      <p className="privacy-note"><ShieldCheck size={15} />仅配置在服务器中的邮箱可以登录</p>
    </section>
  </main>;
}

function Sidebar({ tab, onTab, unread, online }: { tab: Tab; onTab: (tab: Tab) => void; unread: number; online: boolean }) {
  return <aside className="sidebar glass" aria-label="主导航"><div className="brand"><div className="brand-mark small">大</div><div><strong>大爷的 RSS</strong><span>安静地掌握变化</span></div></div>
    <nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={cx('nav-item', tab === id && 'active')} onClick={() => onTab(id)} aria-current={tab === id ? 'page' : undefined}><Icon size={19} /><span>{label}</span>{id === 'today' && unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}</button>)}</nav>
    <div className="sidebar-foot"><div className={cx('status-dot', !online && 'offline')} /><span>{online ? '私有服务已连接' : '当前离线'}</span></div>
  </aside>;
}

function MobileNav({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  return <nav className="mobile-nav glass" aria-label="主导航">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => onTab(id)} aria-current={tab === id ? 'page' : undefined}><Icon size={20} /><span>{label}</span></button>)}</nav>;
}

function Topbar({ title, subtitle, onRefresh, refreshing, onAI }: { title: string; subtitle: string; onRefresh?: () => void; refreshing?: boolean; onAI: () => void }) {
  return <header className="topbar"><div><p>{subtitle}</p><h1>{title}</h1></div><div className="top-actions">{onRefresh && <Button className="icon-button" icon={RefreshCw} aria-label="刷新" onClick={onRefresh} disabled={refreshing} />}<Button className="ai-button" icon={Sparkles} onClick={onAI}>问 AI</Button></div></header>;
}

function FilterBar({ topics, topic, setTopic, importance, setImportance, density, setDensity, onSearch }: { topics: string[]; topic: string; setTopic: (v: string) => void; importance: string; setImportance: (v: string) => void; density: Preferences['density']; setDensity: (v: Preferences['density']) => void; onSearch?: () => void }) {
  return <div className="filter-bar glass"><div className="chips"><button className={!topic && !importance ? 'active' : ''} onClick={() => { setTopic(''); setImportance(''); }}>全部</button><button className={importance === 'critical' ? 'active critical-chip' : ''} onClick={() => setImportance(importance === 'critical' ? '' : 'critical')}>重大</button>{topics.slice(0, 4).map((item) => <button key={item} className={topic === item ? 'active' : ''} onClick={() => setTopic(topic === item ? '' : item)}>{item}</button>)}</div><div className="select-wrap"><Filter size={15} /><select value={importance} onChange={(e) => setImportance(e.target.value)}><option value="">所有级别</option><option value="critical">重大</option><option value="high">重要</option><option value="normal">一般</option></select></div>{onSearch && <button className="density-button filter-search" onClick={onSearch} title="搜索资料库"><Search size={16} /></button>}<button className="density-button" onClick={() => setDensity(density === 'compact' ? 'standard' : density === 'standard' ? 'comfortable' : 'compact')} title="切换信息密度"><LayoutGrid size={16} /></button></div>;
}

function ArticleCard({ article, active, density, clusterCount, onOpen }: { article: Article; active: boolean; density: Preferences['density']; clusterCount: number; onOpen: () => void }) {
  const titles = articleTitles(article);
  return <article className={cx('article-card', active && 'active', article.status !== 'unread' && 'read', density)} onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
    <div className="card-meta"><span className={cx('importance', article.importance)}>{importanceLabel[article.importance]}</span><span>{article.sourceTitle}</span><i>·</i><span>{timeAgo(article.publishedAt)}</span>{clusterCount > 1 && <span className="source-count">{clusterCount} 个来源</span>}</div>
    <div className="card-content"><div className="card-copy"><h2><span>{titles.zh}</span>{titles.en && <small lang="en">{titles.en}</small>}</h2>{density !== 'compact' && <p>{articleProcessingCopy(article)}</p>}<div className="card-bottom"><div>{article.topics.slice(0, 3).map((topic) => <span className="topic" key={topic}>{topic}</span>)}</div><span><Clock3 size={13} />{articleReadingMinutes(article)} 分钟</span></div></div>{density === 'comfortable' && article.imageUrl && article.importance !== 'low' && <img src={article.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}</div>
  </article>;
}

function EmptyState({ icon: Icon = Rss, title, text, action }: { icon?: typeof Rss; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div><Icon size={28} /></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function shorten(value: string, max = 54) { return value.length > max ? `${value.slice(0, max)}…` : value; }

function BriefingHero({ articles, curated, curationMode, curationLoading, onSelect, onSave, reduceMotion }: { articles: Article[]; curated: Article[]; curationMode: 'ai' | 'rules'; curationLoading: boolean; onSelect: (article: Article) => void; onSave: () => void; reduceMotion: boolean }) {
  const slides = useMemo(() => [...curated.filter((article) => article.imageUrl), ...curated.filter((article) => !article.imageUrl)].slice(0, 6), [curated]);
  const [active, setActive] = useState(0); const touchStart = useRef<number>(); const heroRef = useRef<HTMLElement>(null);
  useEffect(() => { if (active >= slides.length) setActive(0); }, [active, slides.length]);
  useEffect(() => { if (reduceMotion || slides.length < 2) return; const timer = window.setInterval(() => setActive((current) => (current + 1) % slides.length), 7000); return () => window.clearInterval(timer); }, [reduceMotion, slides.length]);
  const lead = slides[active] ?? curated[0] ?? articles.find((article) => article.imageUrl) ?? articles[0];
  const leadTitles = lead ? articleTitles(lead) : { zh: '全球 AI 治理加速落地，产业与资本重构进行时', en: '' };
  const highlights = curated.filter((article) => article.id !== lead?.id).slice(0, 3);
  const defaults = ['全球主要经济体加快 AI 监管与标准建设，风险与创新并行。', '大模型应用进入价值验证期，商业化路径逐步清晰。', '资本向基础设施与长期主义项目集中，行业洗牌加速。'];
  const changeSlide = (direction: number) => { if (slides.length > 1) setActive((current) => (current + direction + slides.length) % slides.length); };
  return <section ref={heroRef} className={cx('briefing-hero', lead?.imageUrl ? 'has-article-image' : 'without-image')} aria-label="你的早间简报" onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX; }} onTouchEnd={(event) => { const start = touchStart.current; const end = event.changedTouches[0]?.clientX; touchStart.current = undefined; if (start !== undefined && end !== undefined && Math.abs(end - start) > 42) changeSlide(end < start ? 1 : -1); }}>
    {lead?.imageUrl && <img src={lead.imageUrl} alt={`来自${lead.sourceTitle}的今日简报配图`} referrerPolicy="no-referrer" />}
    <div className="briefing-shade" />
    <CounterPositionedGlassImage sceneRef={heroRef} src={lead?.imageUrl} className="briefing-content" key={lead?.id ?? 'empty'}><span className="briefing-duration"><Clock3 size={14} />{lead ? articleReadingMinutes(lead) : 1} 分钟读完</span><h2>{shorten(leadTitles.zh, 33)}</h2>{leadTitles.en && <p className="briefing-title-en" lang="en">{shorten(leadTitles.en, 72)}</p>}<p className="briefing-kicker"><Sparkles size={15} />{curationLoading ? `AI 正在从 ${articles.length} 条资讯中筛选…` : curationMode === 'ai' ? `AI 从 ${articles.length} 条中精选 ${curated.length} 条高价值资讯` : `从 ${articles.length} 条中筛选 ${curated.length} 条高价值资讯`}</p>
      <ol>{[0,1,2].map((index) => { const item = highlights[index]; return <li key={item?.id ?? index} className={item ? 'clickable' : ''} onClick={() => item && onSelect(item)} onKeyDown={(event) => item && event.key === 'Enter' && onSelect(item)} tabIndex={item ? 0 : -1} aria-label={item ? `打开资讯：${articleTitles(item).zh}` : undefined}><b>{index + 1}</b><span>{item ? shorten(articleTitles(item).zh, 45) : defaults[index]}</span>{item && <ChevronRight size={14} />}</li>; })}</ol>
      <div className="briefing-actions"><button className="briefing-start" onClick={() => lead && onSelect(lead)} disabled={!lead}><Play size={18} fill="currentColor" />开始阅读</button><button className="briefing-save" onClick={onSave} aria-label="收藏简报"><Bookmark size={19} /></button></div>
      <div className="briefing-pages" aria-label="简报轮播分页">{slides.map((slide, index) => <button key={slide.id} className={index === active ? 'active' : ''} onClick={() => setActive(index)} aria-label={`查看第 ${index + 1} 条精选资讯`} aria-current={index === active ? 'true' : undefined}><i /></button>)}</div>
    </CounterPositionedGlassImage>
  </section>;
}

function ContinueFollowing({ articles, onSelect, onViewAll }: { articles: Article[]; onSelect: (article: Article) => void; onViewAll: () => void }) {
  if (!articles.length) return null;
  return <section className="curated-section"><header><h2>继续关注</h2><button onClick={onViewAll}>查看全部<ChevronRight size={15} /></button></header><div className="continue-list">{articles.slice(0,3).map((article) => { const titles = articleTitles(article); return <button key={article.id} onClick={() => onSelect(article)}>{article.imageUrl ? <img src={article.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="article-image-empty" aria-hidden="true"><Rss size={17} /></span>}<span><strong>{shorten(titles.zh, 28)}</strong>{titles.en && <small className="title-en" lang="en">{shorten(titles.en, 46)}</small>}<small>{article.sourceTitle} · {timeAgo(article.publishedAt)}</small></span><Bookmark size={16} /><MoreHorizontal size={16} /></button>; })}</div></section>;
}

function DiscoveryDeck({ articles, onOpen, onSave, onAI, onViewAll, reduceMotion }: { articles: Article[]; onOpen: (article: Article) => void; onSave: (article: Article) => void; onAI: (article?: Article) => void; onViewAll: () => void; reduceMotion: boolean }) {
  const cards = useMemo(() => [...articles.filter((article) => article.imageUrl), ...articles.filter((article) => !article.imageUrl)].slice(0, 6), [articles]);
  const [active, setActive] = useState(0); const touchStart = useRef<number>();
  useEffect(() => { if (active >= cards.length) setActive(0); }, [active, cards.length]);
  if (!cards.length) return null;
  const move = (direction: number) => setActive((current) => (current + direction + cards.length) % cards.length);
  return <section className="curated-section discovery-deck" aria-label="继续关注卡片组">
    <header><div><h2>继续关注</h2><p>点选卡片预览，点击箭头进入阅读</p></div><button onClick={onViewAll}>查看全部<ChevronRight size={15} /></button></header>
    <div className="story-deck" onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX; }} onTouchEnd={(event) => { const start = touchStart.current; const end = event.changedTouches[0]?.clientX; touchStart.current = undefined; if (start !== undefined && end !== undefined && Math.abs(end - start) > 38) move(end < start ? 1 : -1); }}>
      {cards.map((article, index) => {
        const rawOffset = index - active; const wrappedOffset = rawOffset > cards.length / 2 ? rawOffset - cards.length : rawOffset < -cards.length / 2 ? rawOffset + cards.length : rawOffset;
        const offset = Math.max(-2, Math.min(2, wrappedOffset)); const titles = articleTitles(article); const isActive = index === active;
        const style = { '--deck-shift': `${offset * 68}%`, '--deck-scale': String(isActive ? 1 : Math.abs(offset) === 1 ? .9 : .82), '--deck-rotate': `${offset * (reduceMotion ? 0 : 2.2)}deg`, zIndex: 10 - Math.abs(offset) } as CSSProperties;
        return <article key={article.id} className={cx('deck-card', isActive && 'active', Math.abs(offset) > 1 && 'far')} style={style} aria-hidden={Math.abs(offset) > 1} aria-current={isActive ? 'true' : undefined} onClick={() => setActive(index)} onDoubleClick={() => isActive && onOpen(article)}>
          {article.imageUrl ? <img src={article.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="deck-card-empty"><Rss size={34} /></div>}
          <div className="deck-shade" />
          <div className="deck-card-actions" aria-hidden={!isActive}><button tabIndex={isActive ? 0 : -1} onClick={(event) => { event.stopPropagation(); onSave(article); }} aria-label={`收藏${titles.zh}`}><Bookmark size={17} fill={article.status === 'saved' ? 'currentColor' : 'none'} /></button><button tabIndex={isActive ? 0 : -1} onClick={(event) => { event.stopPropagation(); onAI(article); }} aria-label={`针对${titles.zh}问 AI`}><Sparkles size={17} /></button></div>
          <div className="deck-card-copy"><span>{article.topics[0] || importanceLabel[article.importance]}</span><h3>{shorten(titles.zh, 34)}</h3>{titles.en && <p lang="en">{shorten(titles.en, 68)}</p>}<small>{article.sourceTitle} · {timeAgo(article.publishedAt)}</small></div>
          <button className="deck-open" tabIndex={Math.abs(offset) > 1 ? -1 : 0} onClick={(event) => { event.stopPropagation(); if (isActive) onOpen(article); else setActive(index); }} aria-label={isActive ? `打开${titles.zh}` : `选中${titles.zh}`}><ChevronRight size={21} /></button>
        </article>;
      })}
      <button className="deck-step previous" onClick={() => move(-1)} aria-label="上一张卡片"><ChevronLeft size={20} /></button><button className="deck-step next" onClick={() => move(1)} aria-label="下一张卡片"><ChevronRight size={20} /></button>
    </div>
    <div className="deck-pagination" aria-label="卡片分页">{cards.map((article, index) => <button key={article.id} className={index === active ? 'active' : ''} onClick={() => setActive(index)} aria-label={`查看第${index + 1}张卡片`} aria-current={index === active ? 'true' : undefined} />)}</div>
  </section>;
}

function SourceRail({ articles, sources, source, onSource, onViewAll }: { articles: Article[]; sources: Source[]; source: string; onSource: (source: string) => void; onViewAll: () => void }) {
  const titles = [...new Set(articles.map((article) => article.sourceTitle))].slice(0, 7);
  if (!titles.length) return null;
  return <section className="curated-section source-section"><header><h2>精选来源</h2><button onClick={onViewAll}>查看全部<ChevronRight size={15} /></button></header><div className="source-rail">{titles.map((item, index) => { const record = sources.find((candidate) => candidate.title === item); return <button key={item} className={source === item ? 'active' : ''} aria-pressed={source === item} onClick={() => onSource(source === item ? '' : item)}><SourceLogo source={record} title={item} tone={index} /><span><strong>{item}</strong><small>{source === item ? '正在筛选' : index % 2 ? '深度报道' : '已验证来源'}</small></span><i><Check size={10} /></i></button>; })}</div></section>;
}

function TimelineRow({ article, active, index, onOpen }: { article: Article; active: boolean; index: number; onOpen: () => void }) {
  const clock = new Intl.DateTimeFormat('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(article.publishedAt));
  const titles = articleTitles(article);
  return <article className={cx('timeline-row', active && 'active', article.status !== 'unread' && 'read')} style={{ '--row-index': index } as CSSProperties} onClick={onOpen} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onOpen()}>
    <span className={cx('timeline-dot', article.importance)} /><time>{clock}</time><div className="timeline-copy"><h3><span>{titles.zh}</span>{titles.en && <small lang="en">{titles.en}</small>}</h3><div className="timeline-tags" aria-label="资讯来源和重要程度"><span className="timeline-source-tag">{article.sourceTitle}</span><span className={cx('timeline-importance-tag', article.importance)}>{importanceLabel[article.importance]}</span></div><p>{articleProcessingCopy(article)}</p></div>{article.imageUrl && (index === 0 || index % 3 === 2) && <img src={article.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
  </article>;
}

function CollectionHeader({ title, subtitle, onBack, backLabel = '返回今日' }: { title: string; subtitle: string; onBack: () => void; backLabel?: string }) {
  return <header className="collection-header"><button onClick={onBack} aria-label={backLabel}><ArrowLeft size={20} /></button><div><h1>{title}</h1><p>{subtitle}</p></div></header>;
}

function AllArticlesView({ articles, source, selected, onBack, onSelect }: { articles: Article[]; source?: string; selected?: Article; onBack: () => void; onSelect: (article: Article) => void }) {
  const [search, setSearch] = useState('');
  const visible = articles.filter((article) => (!source || article.sourceTitle === source) && (!search || `${article.title} ${article.titleZh ?? ''} ${article.titleEn ?? ''} ${article.sourceTitle}`.toLowerCase().includes(search.toLowerCase())));
  return <section className="view collection-view"><CollectionHeader title={source ? source : '全部资讯'} subtitle={source ? `${visible.length} 条来自该来源的资讯` : `${visible.length} 条资讯 · 按发布时间排序`} onBack={onBack} backLabel={source ? '返回全部来源' : '返回今日'} /><label className="collection-search glass"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题或来源" />{search && <button onClick={() => setSearch('')} aria-label="清除搜索"><X size={16} /></button>}</label><section className="collection-timeline" aria-label={source ? `${source}的全部资讯` : '全部资讯列表'}>{visible.length ? visible.map((article, index) => <TimelineRow key={article.id} article={article} active={selected?.id === article.id} index={index} onOpen={() => onSelect(article)} />) : <EmptyState icon={Search} title="没有匹配的资讯" text="换一个关键词后再试。" />}</section></section>;
}

function AllSourcesView({ sources, articles, onBack, onSelect }: { sources: Source[]; articles: Article[]; onBack: () => void; onSelect: (source: string) => void }) {
  const counts = useMemo(() => articles.reduce((map, article) => map.set(article.sourceTitle, (map.get(article.sourceTitle) ?? 0) + 1), new Map<string, number>()), [articles]);
  const records = sources.length ? sources : [...counts.keys()].map((title, index) => ({ id: `derived-${index}`, title, url: '', category: '未分类', enabled: true, refreshMinutes: 60, qualityScore: 0, createdAt: '' } satisfies Source));
  return <section className="view collection-view"><CollectionHeader title="全部来源" subtitle={`${records.length} 个订阅源 · 点击查看该来源的全部资讯`} onBack={onBack} /><div className="all-sources-grid">{records.map((source, index) => <button key={source.id} onClick={() => onSelect(source.title)}><SourceLogo source={source} title={source.title} tone={index} /><span><strong>{source.title}</strong><small>{source.category || '未分类'} · {source.articleCount ?? counts.get(source.title) ?? 0} 条资讯</small>{source.lastError ? <em>抓取异常</em> : <em>{source.enabled ? '正常更新' : '已暂停'}</em>}</span><ChevronRight size={17} /></button>)}</div></section>;
}

function AISynthesisEvent({ count, headline, onOpen }: { count: number; headline: string; onOpen: () => void }) { return <button className="timeline-row synthesis-event" onClick={onOpen}><span className="timeline-dot ai"><Sparkles size={10} /></span><time>07:30</time><div className="timeline-copy"><div className="timeline-meta"><span>大爷的 RSS · AI 跨来源分析</span><span className="importance ai">AI 合成</span></div><h3>{headline}</h3><p className="synthesis-subtitle">AI 整合 {count} 篇观点</p></div><span className="synthesis-count">{count} 篇<ChevronRight size={15} /></span></button>; }

function TodayView({ articles, sources, selected, onSelect, onQuickSave, onSynthesis, onRefresh, refreshing, refreshStatus, aiStatus, enrichmentStatus, preferences, onDensity, onAI, onBrief, onViewAllArticles, onViewAllSources }: { articles: Article[]; sources: Source[]; selected?: Article; onSelect: (a: Article) => void; onQuickSave: (a: Article) => void; onSynthesis: (articles: Article[], headline: string) => void; onRefresh: () => void; refreshing: boolean; refreshStatus?: RefreshStatus; aiStatus?: AIModelStatus; enrichmentStatus?: EnrichmentStatus; preferences: Preferences; onDensity: (d: Preferences['density']) => void; onAI: (article?: Article) => void; onBrief: () => void; onViewAllArticles: () => void; onViewAllSources: () => void }) {
  const [topic, setTopic] = useState(''); const [importance, setImportance] = useState(''); const [source, setSource] = useState(''); const [search, setSearch] = useState(''); const [searchOpen, setSearchOpen] = useState(false); const [webResults, setWebResults] = useState<Array<{ title: string; url: string; description: string; source: string }>>([]); const [searchError, setSearchError] = useState(''); const [synthesisPreview, setSynthesisPreview] = useState<SynthesisResult>();
  const [curation, setCuration] = useState<CurationResult>(); const [curationLoading, setCurationLoading] = useState(false);
  const topics = useMemo(() => [...new Set(articles.flatMap((article) => article.topics))], [articles]);
  const fallbackCurated = useMemo(() => selectCuratedFallback(articles), [articles]);
  const curationKey = articles.slice(0, 40).map((article) => `${article.id}:${article.summaryZh ? 1 : 0}`).join('|');
  useEffect(() => {
    let active = true; if (!curationKey) { setCuration(undefined); return () => { active = false; }; }
    setCurationLoading(true);
    void post<CurationResult>('/api/ai/curation', { articleIds: articles.slice(0, 40).map((article) => article.id) })
      .then((result) => { if (active) setCuration(result); })
      .catch(() => { if (active) setCuration({ mode: 'rules', total: articles.length, items: fallbackCurated.map((article) => ({ id: article.id, reason: article.importanceReason })) }); })
      .finally(() => { if (active) setCurationLoading(false); });
    return () => { active = false; };
  }, [curationKey]);
  const curatedArticles = (curation?.items?.map((item) => articles.find((article) => article.id === item.id)).filter((article): article is Article => Boolean(article)) ?? fallbackCurated).slice(0, 9);
  const visible = articles.filter((article) => (!source || article.sourceTitle === source) && (!topic || article.topics.includes(topic)) && (!importance || article.importance === importance) && (!search || `${article.title} ${article.titleZh ?? ''} ${article.titleEn ?? ''} ${article.excerpt} ${article.sourceTitle}`.toLowerCase().includes(search.toLowerCase())));
  const synthesisArticles = selectRelatedArticles(visible); const synthesisIndex = synthesisArticles.length > 1 ? Math.max(...synthesisArticles.map((item) => visible.findIndex((article) => article.id === item.id))) : -1;
  const synthesisKey = synthesisArticles.map((article) => article.id).join('|');
  useEffect(() => {
    let active = true;
    if (!synthesisKey || synthesisArticles.length < 2) { setSynthesisPreview(undefined); return () => { active = false; }; }
    void post<SynthesisResult>('/api/ai/synthesis', { articleIds: synthesisArticles.map((article) => article.id), background: true })
      .then((result) => { if (active) setSynthesisPreview(result); })
      .catch(() => { if (active) setSynthesisPreview(undefined); });
    return () => { active = false; };
  }, [synthesisKey]);
  const date = new Intl.DateTimeFormat('zh-CN', { month:'long', day:'numeric', weekday:'long' }).format(new Date());
  const enrichmentMessage = enrichmentStatus?.running ? `后台处理中 · ${enrichmentStatus.currentIds?.length ?? 1}/${enrichmentStatus.concurrency ?? 3} 并发 · ${enrichmentStatus.queued} 等待` : enrichmentStatus?.pausedReason;
  const operationMessage = refreshStatus?.message || enrichmentMessage || (aiStatus && ['working','fallback','error'].includes(aiStatus.state) ? aiStatus.message : undefined);
  return <section className="view today-view"><header className="today-header"><div><p>{date}</p><h1>今日</h1><span>你的早间简报</span></div><div className="today-header-actions">{operationMessage && <span className={cx('operation-status', refreshStatus?.kind || (enrichmentStatus?.pausedReason ? 'error' : enrichmentStatus?.running ? 'loading' : aiStatus?.state))} aria-live="polite">{operationMessage}</span>}<div><button className="today-action glass" onClick={() => onAI()} aria-label="问 AI"><Sparkles size={20} /></button><button className={cx('today-action glass', refreshing && 'refreshing')} onClick={onRefresh} disabled={refreshing} aria-label={refreshing ? '正在刷新' : '刷新'}><RefreshCw size={20} /></button></div></div></header>
    <FilterBar topics={topics} topic={topic} setTopic={setTopic} importance={importance} setImportance={setImportance} density={preferences.density} setDensity={onDensity} onSearch={() => setSearchOpen((open) => !open)} />
    <BriefingHero articles={articles} curated={curatedArticles} curationMode={curation?.mode ?? 'rules'} curationLoading={curationLoading} onSelect={onSelect} onSave={onBrief} reduceMotion={preferences.reduceMotion} />
    <DiscoveryDeck articles={curatedArticles.length ? curatedArticles : articles} onOpen={onSelect} onSave={onQuickSave} onAI={onAI} onViewAll={onViewAllArticles} reduceMotion={preferences.reduceMotion} />
    <SourceRail articles={articles} sources={sources} source={source} onViewAll={onViewAllSources} onSource={(next) => { setSource(next); document.querySelector('.signal-timeline')?.scrollIntoView({ behavior:'smooth', block:'start' }); }} />
    {searchOpen && <form className="search-box glass editorial-search" onSubmit={async (event) => { event.preventDefault(); setSearchError(''); setWebResults([]); if (!search.trim() || isLocalMode) return; try { const result = await post<{ items: Array<{ title: string; url: string; description: string; source: string }> }>('/api/search/web', { query: search }); setWebResults(result.items); } catch (error) { setSearchError(error instanceof Error ? error.message : '联网搜索失败'); } }}><Search size={16} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索手机本地资料库" /><button type="button" onClick={() => { setSearchOpen(false); setSearch(''); }}><X size={16} /></button></form>}
    {searchError && <p className="search-error">{searchError}</p>}{webResults.length > 0 && <section className="web-results"><h3>互联网补充内容</h3>{webResults.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.url}><span>{item.source}</span><strong>{item.title}</strong><p>{item.description}</p></a>)}</section>}
    <section className="signal-timeline" aria-label="今日信息时间轴" data-source-filter={source}>{visible.length ? visible.map((article, index) => { const synthesisHeadline = displaySynthesisHeadline(synthesisPreview?.headline || synthesisFallbackHeadline(synthesisArticles)); return <div key={article.id}><TimelineRow article={article} active={selected?.id === article.id} index={index} onOpen={() => onSelect(article)} />{index === synthesisIndex && <AISynthesisEvent count={synthesisArticles.length} headline={synthesisHeadline} onOpen={() => onSynthesis(synthesisArticles, synthesisHeadline)} />}</div>; }) : <EmptyState title={search || source ? '资料库中没有匹配内容' : '还没有资讯'} text={search || source ? '清除来源或搜索条件后再试。' : '在“我的”中添加 RSS 地址或导入 OPML，资讯会在抓取后进入时间轴。'} />}</section>
  </section>;
}

function BilingualBody({ payload }: { payload: string }) {
  try {
    const data = JSON.parse(payload) as { originals: string[]; translations: string[] };
    return <div className="bilingual-body">{data.originals.map((original, index) => <div className="bilingual-pair" key={index}><p lang="en">{original}</p><p lang="zh-CN">{data.translations[index]}</p></div>)}</div>;
  } catch { return <AsyncMarkdownBody>{payload}</AsyncMarkdownBody>; }
}

function ArticleDetail({ article, onClose, onStatus, onSummarize, summarizing, onTranslate, translating, onFulltext, extracting, onAI, aiActive }: { article?: Article; onClose: () => void; onStatus: (status: Article['status']) => void; onSummarize: () => void; summarizing: boolean; onTranslate: () => void; translating: boolean; onFulltext: () => void; extracting: boolean; onAI: () => void; aiActive: boolean }) {
  const [summaryExpanded, setSummaryExpanded] = useState(false); const [listening, setListening] = useState(false);
  useEffect(() => { setSummaryExpanded(false); setListening(false); window.speechSynthesis?.cancel(); }, [article?.id]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  if (!article) return <aside className="detail-pane placeholder"><div><BookOpen size={30} /><h3>选择一条资讯</h3><p>原文、双语阅读与来源依据会显示在这里。</p></div></aside>;
  const titles = articleTitles(article);
  const toggleListening = () => {
    if (!('speechSynthesis' in window)) return;
    if (listening) { window.speechSynthesis.cancel(); setListening(false); return; }
    const utterance = new SpeechSynthesisUtterance(`${titles.zh}。${plainMarkdown(article.summaryZh || article.excerpt)}`); utterance.lang = 'zh-CN'; utterance.rate = .95; utterance.onend = () => setListening(false); utterance.onerror = () => setListening(false); window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); setListening(true);
  };
  const share = async () => { if (navigator.share) await navigator.share({ title: titles.zh, url: article.url }); else await navigator.clipboard.writeText(article.url); };
  const saved = article.status === 'saved';
  const translated = Boolean(article.translationZh);
  return <aside className="detail-pane"><div className="detail-toolbar glass"><button onClick={onClose} className="mobile-close" aria-label="关闭文章"><X size={20} /></button><div className="toolbar-group"><button className={saved ? 'active' : ''} aria-pressed={saved} onClick={() => onStatus(saved ? 'read' : 'saved')} title={saved ? '取消收藏' : '收藏'}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /></button><button className={article.status === 'later' ? 'active' : ''} aria-pressed={article.status === 'later'} onClick={() => onStatus('later')} title="稍后读"><Clock3 size={18} /></button><button className={aiActive ? 'active' : ''} aria-pressed={aiActive} onClick={onAI} title="针对本文问 AI"><MessageCircle size={18} /></button><a href={article.url} target="_blank" rel="noreferrer" title="打开原文"><ExternalLink size={18} /></a><button onClick={() => void share()} aria-label="分享文章"><MoreHorizontal size={18} /></button></div></div>
    {article.imageUrl && <div className="reader-cover"><img src={article.imageUrl} alt={`来自${article.sourceTitle}的文章配图`} referrerPolicy="no-referrer" /></div>}
    <div className={cx('reader', article.imageUrl && 'with-cover')}><div className="reader-meta"><span className={cx('importance', article.importance)}>{importanceLabel[article.importance]}</span><span>{article.sourceTitle}</span><span>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(article.publishedAt))}</span><span className="reader-duration"><Clock3 size={13} />{articleReadingMinutes(article)} 分钟读完</span></div><h1 lang="zh-CN">{titles.zh}</h1>{titles.en && <p className="reader-title-en" lang="en">{titles.en}</p>}{article.author && <p className="byline">作者：{article.author}</p>}
      <section className={cx('ai-summary', summaryExpanded && 'expanded')}><button className="summary-title" onClick={() => setSummaryExpanded((expanded) => !expanded)} aria-expanded={summaryExpanded}><Sparkles size={17} /><strong>AI 中文摘要</strong><span>{article.importanceScore} 分 · {article.importanceReason}</span><ChevronDown size={17} /></button><div className="summary-body">{article.summaryZh ? <AsyncMarkdownBody>{article.summaryZh}</AsyncMarkdownBody> : article.enrichmentError ? <div className="processing-error"><CircleAlert size={17} /><div><strong>摘要暂未生成</strong><p>{article.enrichmentError}</p><Button onClick={onSummarize} disabled={summarizing}>{summarizing ? '正在重试…' : '重新生成摘要'}</Button></div></div> : <div className="processing-copy"><span className="processing-pulse" />正在后台提取全文并生成中文摘要，完成后会自动显示。</div>}</div></section>
      {article.mediaUrl && <section className="media-player"><video src={article.mediaUrl} controls playsInline /><a href={article.mediaUrl} target="_blank" rel="noreferrer">无法播放？打开媒体源 <ExternalLink size={14} /></a></section>}
      <div className="language-label"><Languages size={16} />中英双语{!article.translationZh && !article.enrichmentError && <span className="language-progress"><span className="processing-pulse" />打开后优先翻译</span>}{(article.contentHtml.length < 600 || article.fulltextError) && <button onClick={onFulltext} disabled={extracting}>{extracting ? '正在提取…' : article.fulltextError ? '重新抓取正文' : '立即提取完整原文'}</button>}</div>
      {article.fulltextError && <div className="processing-error inline"><CircleAlert size={17} /><div><strong>完整正文抓取失败</strong><p>{article.fulltextError}</p></div></div>}
      {article.translationZh ? <BilingualBody payload={article.translationZh} /> : <><div className="article-body" dangerouslySetInnerHTML={{ __html: article.contentHtml || `<p>${article.excerpt}</p>` }} />{article.enrichmentError ? <p className="translation-pending">本篇翻译尚未完成。点击下方“翻译”会立即重试，不代表模型服务已暂停。</p> : <p className="translation-pending">正在优先生成逐段中文翻译，也可稍后重新打开。</p>}</>}
      <footer className="source-footer"><ShieldCheck size={18} /><div><strong>始终核对原始来源</strong><p>AI 摘要可能遗漏上下文。重要决策前请阅读并验证原文。</p></div><a href={article.url} target="_blank" rel="noreferrer">查看原文</a></footer>
    </div>
    <nav className="reader-dock" aria-label="文章操作"><button className={saved ? 'active' : ''} aria-pressed={saved} onClick={() => onStatus(saved ? 'read' : 'saved')}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /><span>{saved ? '已收藏' : '收藏'}</span></button><button className={cx(translating && 'working', translated && 'active')} aria-pressed={translated} onClick={onTranslate} disabled={translating}>{translated && !translating ? <Check size={18} /> : <Languages size={18} />}<span>{translating ? '翻译中' : translated ? '已翻译' : '翻译'}</span></button><button className={listening ? 'active' : ''} aria-pressed={listening} onClick={toggleListening}><Headphones size={18} /><span>{listening ? '停止' : '朗读'}</span></button><button className={aiActive ? 'primary' : ''} aria-pressed={aiActive} onClick={onAI}><Sparkles size={18} /><span>问 AI</span></button></nav>
  </aside>;
}

function SynthesisDetail({ view, onClose, onOpenArticle }: { view: SynthesisViewState; onClose: () => void; onOpenArticle: (article: Article) => void }) {
  return <aside className="detail-pane synthesis-detail"><div className="detail-toolbar glass"><button onClick={onClose} className="mobile-close"><X size={20} /></button><div className="toolbar-group"><button onClick={onClose} title="关闭整合结果"><X size={18} /></button></div></div>
    <div className="reader"><div className="synthesis-heading"><span><Sparkles size={17} />跨来源分析</span><h1>{displaySynthesisHeadline(view.result?.headline || view.headline || synthesisFallbackHeadline(view.articles))}</h1><p>AI 整合 {view.articles.length} 篇观点 · 只依据下列订阅文章</p></div>
      {view.loading && <section className="synthesis-loading" aria-live="polite"><span className="processing-pulse" /><div><strong>正在交叉阅读 {view.articles.length} 篇文章</strong><p>核对来源并整理共同信号与分歧…</p></div></section>}
      {view.error && <section className="synthesis-error"><CircleAlert size={20} /><div><strong>整合失败</strong><p>{view.error}</p></div></section>}
      {view.result && <section className="synthesis-result"><AsyncMarkdownBody>{view.result.answer}</AsyncMarkdownBody></section>}
      <section className="synthesis-sources"><h2>本次依据</h2>{view.articles.map((article, index) => { const titles = articleTitles(article); return <button key={article.id} onClick={() => onOpenArticle(article)}><b>[{index + 1}]</b><span><strong>{titles.zh}</strong>{titles.en && <small className="title-en" lang="en">{titles.en}</small>}<small>{article.sourceTitle} · {timeAgo(article.publishedAt)}</small></span><ChevronRight size={17} /></button>; })}</section>
      <footer className="source-footer"><ShieldCheck size={18} /><div><strong>整合不是事实替代品</strong><p>重要判断前请逐篇打开来源核对上下文。</p></div></footer>
    </div>
  </aside>;
}

function MonitorView({ monitors, reload, onAI }: { monitors: Monitor[]; reload: () => void; onAI: () => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(''); const [query, setQuery] = useState(''); const [mode, setMode] = useState('instant');
  const submit = async (e: FormEvent) => { e.preventDefault(); await post('/api/monitors', { name, query, notificationMode: mode, importance: 'high' }); setName(''); setQuery(''); setOpen(false); reload(); };
  return <section className="view"><Topbar title="监控" subtitle="只让重要变化打扰你" onAI={onAI} /><div className="section-actions"><div><strong>{monitors.filter((m) => m.enabled).length} 个监控正在运行</strong><p>关键词、公司、人物、行业或事件</p></div><Button icon={Plus} onClick={() => setOpen(true)}>新建监控</Button></div>
    {open && <form className="editor-card glass" onSubmit={submit}><div className="form-head"><h3>新建监控</h3><button type="button" onClick={() => setOpen(false)}><X size={18} /></button></div><label>名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：英伟达供应链风险" required /></label><label>关键词或自然语言规则<textarea value={query} onChange={(e) => setQuery(e.target.value)} placeholder="英伟达、台积电、GPU；只关注产能、出口限制和供应链中断" required /></label><label>通知方式<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="instant">重大变化即时提醒</option><option value="brief">仅加入每日简报</option><option value="silent">静默收集</option></select></label><Button type="submit">开始监控</Button></form>}
    <div className="monitor-grid">{monitors.length ? monitors.map((monitor) => <article className="monitor-card" key={monitor.id}><div className="monitor-head"><div className="monitor-icon"><Activity size={18} /></div><label className="switch"><input type="checkbox" checked={monitor.enabled} onChange={async (e) => { await patch(`/api/monitors/${monitor.id}`, { enabled: e.target.checked }); reload(); }} /><span /></label></div><h3>{monitor.name}</h3><p>{monitor.query}</p><div className="monitor-foot"><span className={cx('importance', monitor.importance)}>{importanceLabel[monitor.importance]}</span><span>{monitor.notificationMode === 'instant' ? '即时提醒' : monitor.notificationMode === 'brief' ? '加入简报' : '静默收集'}</span><button onClick={async () => { await del(`/api/monitors/${monitor.id}`); reload(); }}><Trash2 size={15} /></button></div></article>) : <EmptyState icon={Bell} title="建立第一条监控" text="告诉系统哪些变化值得立即通知你，其余内容会安静地进入信息流。" action={<Button icon={Plus} onClick={() => setOpen(true)}>新建监控</Button>} />}</div>
  </section>;
}

function LibraryView({ articles, onSelect, onAI }: { articles: Article[]; onSelect: (a: Article) => void; onAI: () => void }) {
  const [kind, setKind] = useState<'saved' | 'later' | 'read'>('saved'); const items = articles.filter((a) => a.status === kind);
  return <section className="view"><Topbar title="资料库" subtitle="你的私人研究记忆" onAI={onAI} /><div className="library-tabs"><button className={kind === 'saved' ? 'active' : ''} onClick={() => setKind('saved')}><Bookmark size={16} />收藏</button><button className={kind === 'later' ? 'active' : ''} onClick={() => setKind('later')}><Clock3 size={16} />稍后读</button><button className={kind === 'read' ? 'active' : ''} onClick={() => setKind('read')}><Check size={16} />阅读历史</button></div><div className="article-list">{items.length ? items.map((article) => <ArticleCard key={article.id} article={article} active={false} density="compact" clusterCount={1} onOpen={() => onSelect(article)} />) : <EmptyState icon={FolderOpen} title="这里还是空的" text="收藏的文章和研究材料会永久保存在这里，并可用于全局 AI 问答。" />}</div></section>;
}

type ModelDraft = { provider: string; label: string; model: string; apiKey: string; baseUrl: string; roles: AIRole[] };
const aiRoleOptions: Array<{ id: AIRole; label: string; description: string }> = [
  { id: 'summary', label: '摘要', description: '标题与 200 字中文摘要' },
  { id: 'translation', label: '翻译', description: '正文逐段中英双语' },
  { id: 'analysis', label: '分析', description: '精选、整合、问答与简报' }
];
const emptyModelDraft = (): ModelDraft => ({ provider: 'kimi-coding', label: 'Kimi Coding Plan', model: 'kimi-for-coding', apiKey: '', baseUrl: 'https://api.kimi.com/coding/v1', roles: ['analysis'] });

function SettingsView({ sources, models, preferences, aiStatus, reload, onPreferences, onAI, notify, online, installAvailable, onInstall }: { sources: Source[]; models: Model[]; preferences: Preferences; aiStatus?: AIModelStatus; reload: () => void; onPreferences: (p: Preferences) => void; onAI: () => void; notify: (m: string) => void; online: boolean; installAvailable: boolean; onInstall: () => void }) {
  const [sourceUrl, setSourceUrl] = useState(''); const [adding, setAdding] = useState(false); const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState<ModelDraft>(emptyModelDraft); const [editingModelId, setEditingModelId] = useState<string>(); const [testingModel, setTestingModel] = useState(false); const [savingModel, setSavingModel] = useState(false); const [resumingAI, setResumingAI] = useState(false);
  const addSource = async (e: FormEvent) => { e.preventDefault(); setAdding(true); try { await post('/api/sources', { url: sourceUrl }); setSourceUrl(''); notify('订阅源已添加并完成首次抓取'); await reload(); } catch (error) { notify(error instanceof Error ? error.message : '订阅源添加失败'); } finally { setAdding(false); } };
  const importOpml = async (file?: File) => { if (!file) return; try { const xml = await file.text(); const result = await post<{ imported: number }>('/api/opml/import', { xml }); notify(`已导入 ${result.imported} 个订阅源`); await reload(); } catch (error) { notify(error instanceof Error ? error.message : 'OPML 导入失败'); } };
  const resetModelEditor = () => { setModel(emptyModelDraft()); setEditingModelId(undefined); setModelOpen(false); };
  const chooseProvider = (provider: string) => {
    if (provider === 'kimi-coding') setModel({ ...model, provider, label: 'Kimi Coding Plan', model: 'kimi-for-coding', baseUrl: 'https://api.kimi.com/coding/v1', roles: ['analysis'] });
    else if (provider === 'deepseek') setModel({ ...model, provider, label: 'DeepSeek V4 Flash', model: 'deepseek-v4-flash', baseUrl: '', roles: ['summary', 'translation'] });
    else setModel({ ...model, provider, label: '', model: '', baseUrl: '', roles: ['analysis'] });
  };
  const toggleModelRole = (role: AIRole) => setModel((current) => ({ ...current, roles: current.roles.includes(role) ? current.roles.filter((item) => item !== role) : [...current.roles, role] }));
  const saveModel = async (event: FormEvent) => {
    event.preventDefault(); setSavingModel(true);
    try {
      if (!model.roles.length) throw new Error('至少选择一个负责功能');
      const payload = model;
      const wasEditing = Boolean(editingModelId);
      if (editingModelId) await patch(`/api/models/${editingModelId}`, payload); else await post('/api/models', payload);
      resetModelEditor(); await reload(); notify(wasEditing ? '模型配置已更新' : '模型已安全保存并加入对应功能链路');
    } catch (error) { notify(error instanceof Error ? error.message : '模型保存失败'); } finally { setSavingModel(false); }
  };
  const testModel = async () => {
    setTestingModel(true);
    try { const result = await post<{ message: string }>('/api/models/test', { ...model, id: editingModelId }); notify(result.message || '连接成功'); }
    catch (error) { notify(error instanceof Error ? error.message : '连接测试失败'); } finally { setTestingModel(false); }
  };
  const resumeAI = async () => {
    if (resumingAI) return; setResumingAI(true);
    try { const result = await post<{ message: string }>('/api/ai/resume'); notify(result.message || 'AI 后台处理已恢复'); await reload(); }
    catch (error) { notify(error instanceof Error ? error.message : '恢复失败'); }
    finally { setResumingAI(false); }
  };
  const editModel = (item: Model) => { setEditingModelId(item.id); setModel({ provider: item.provider, label: item.label, model: item.model, apiKey: '', baseUrl: item.baseUrl ?? (item.provider === 'kimi-coding' ? 'https://api.kimi.com/coding/v1' : ''), roles: item.roles }); setModelOpen(true); };
  const preferredPriority = Math.min(...models.map((item) => item.priority ?? 100), 101) - 1;
  const roleRoutes = aiRoleOptions.map((role) => {
    const candidates = models.filter((item) => item.enabled && item.roles.includes(role.id)).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    return { ...role, primary: candidates[0], backups: candidates.slice(1) };
  });
  const updatePref = async (next: Partial<Preferences>) => { const value = await put<Preferences>('/api/preferences', next); onPreferences(value); };
  return <section className="view settings-view"><Topbar title="我的" subtitle="订阅、模型与系统偏好" onAI={onAI} />
    <SettingsSection icon={Rss} title="订阅源" subtitle={`${sources.length} 个来源 · ${isLocalMode ? '打开 App 时自动刷新' : '后台自动抓取'}`} action={<label className="file-button"><FileUp size={16} />导入 OPML<input type="file" accept=".opml,.xml" onChange={(e) => importOpml(e.target.files?.[0])} /></label>}>
      <form className="source-adder" onSubmit={addSource}><input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="粘贴 RSS / Atom 地址" required /><Button type="submit" icon={Plus} disabled={adding}>{adding ? '验证并抓取中' : '添加'}</Button></form>
      <div className="source-list">{sources.map((source, index) => <div className="source-row" key={source.id}><SourceLogo source={source} title={source.title} tone={index} /><div><strong>{source.title}</strong><span>{source.category} · {source.refreshMinutes} 分钟刷新</span>{source.lastError && <em>{source.lastError}</em>}</div><div className={cx('health', source.lastError && 'bad')}><span />{source.lastError ? '异常' : source.lastFetchedAt ? '正常' : '等待'}</div><button onClick={async () => { await del(`/api/sources/${source.id}`); reload(); }}><Trash2 size={16} /></button></div>)}{!sources.length && <p className="inline-empty">尚未添加订阅源</p>}</div>
    </SettingsSection>
    <SettingsSection icon={Bot} title="AI 模型" subtitle={isLocalMode ? '主模型失败时自动切换备用模型，Key 保存在 Android Keystore' : '主模型失败时自动切换已保存的备用模型'} action={<Button icon={modelOpen ? X : Plus} onClick={() => modelOpen ? resetModelEditor() : setModelOpen(true)}>{modelOpen ? '取消' : '添加模型'}</Button>}>
      {aiStatus && aiStatus.state !== 'idle' && <div className={cx('ai-runtime-banner', aiStatus.state)} aria-live="polite"><span className="status-dot" /><div><strong>{aiStatus.message}</strong>{aiStatus.detail && <small>{aiStatus.detail}</small>}{aiStatus.fallbackLabel && <small>备用模型：{aiStatus.fallbackLabel}</small>}{aiStatus.state === 'error' && <Button className="resume-ai-button" icon={RefreshCw} onClick={resumeAI} disabled={resumingAI}>{resumingAI ? '测试连接中…' : '测试并恢复后台处理'}</Button>}</div></div>}
      <div className="role-routing" aria-label="AI 功能分工">{roleRoutes.map((route) => <div className="route-card" key={route.id}><span>{route.label}</span><strong>{route.primary?.label ?? '未配置'}</strong><small>{route.primary ? `${route.description}${route.backups.length ? ` · ${route.backups.length} 个备用` : ''}` : route.description}</small></div>)}</div>
      {modelOpen && <form className="model-form" onSubmit={saveModel}>
        <select aria-label="模型服务商" value={model.provider} onChange={(e) => chooseProvider(e.target.value)}><option value="kimi-coding">Kimi Coding Plan</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option><option value="deepseek">DeepSeek</option><option value="custom">兼容 OpenAI 的自定义服务</option></select>
        <input aria-label="显示名称" placeholder="显示名称" value={model.label} onChange={(e) => setModel({ ...model, label: e.target.value })} required />
        {model.provider === 'kimi-coding' ? <select aria-label="Kimi 模型" value={model.model} onChange={(e) => setModel({ ...model, model: e.target.value })}><option value="kimi-for-coding">标准版 · kimi-for-coding</option><option value="kimi-for-coding-highspeed">高速版 · kimi-for-coding-highspeed</option></select> : model.provider === 'deepseek' ? <select aria-label="DeepSeek 模型" value={model.model} onChange={(e) => setModel({ ...model, model: e.target.value, label: e.target.value === 'deepseek-v4-pro' ? 'DeepSeek V4 Pro' : e.target.value === 'deepseek-v4-flash' ? 'DeepSeek V4 Flash' : 'DeepSeek Chat' })}><option value="deepseek-v4-flash">DeepSeek V4 Flash · 高并发翻译</option><option value="deepseek-v4-pro">DeepSeek V4 Pro · 深度任务</option><option value="deepseek-chat">deepseek-chat · 兼容模型</option></select> : <input aria-label="模型 ID" placeholder="模型 ID，例如 gpt-5-mini" value={model.model} onChange={(e) => setModel({ ...model, model: e.target.value })} required />}
        {(model.provider === 'custom' || model.provider === 'kimi-coding') && <input aria-label="API Base URL" type="url" placeholder="API Base URL" value={model.baseUrl} onChange={(e) => setModel({ ...model, baseUrl: e.target.value })} readOnly={model.provider === 'kimi-coding'} required />}
        <fieldset className="model-role-picker"><legend>负责功能（可多选）</legend>{aiRoleOptions.map((role) => <label key={role.id}><input type="checkbox" checked={model.roles.includes(role.id)} onChange={() => toggleModelRole(role.id)} /><span><strong>{role.label}</strong><small>{role.description}</small></span></label>)}</fieldset>
        <input aria-label="API Key" type="password" autoComplete="off" placeholder={editingModelId ? 'API Key（留空则保持原 Key）' : 'API Key'} value={model.apiKey} onChange={(e) => setModel({ ...model, apiKey: e.target.value.trim() })} required={!editingModelId} />
        {model.provider === 'kimi-coding' && <p className="model-hint">Coding Plan 默认只负责分析；Key 与开放平台 Key 不通用。</p>}
        {model.provider === 'deepseek' && <p className="model-hint">默认负责摘要与翻译。翻译会分块并行：服务端最高 64 路，手机本地最高 32 路，按实际段落数自动取值。</p>}
        <div className="model-form-actions"><Button type="button" icon={PlugZap} onClick={testModel} disabled={testingModel || (!model.apiKey && !editingModelId)}>{testingModel ? '正在测试' : '测试连接'}</Button><Button type="submit" disabled={savingModel || !model.roles.length}>{savingModel ? '保存中' : editingModelId ? '保存修改' : '加密保存'}</Button></div>
      </form>}
      <div className="model-list">{models.map((item) => <div className={cx('model-row', !item.enabled && 'disabled')} key={item.id}><div className="model-icon"><Bot size={18} /></div><div><strong>{item.label}<em className={cx('model-state-badge', item.enabled ? 'primary' : 'backup')}>{item.enabled ? '已启用' : '已停用'}</em></strong><span>{item.provider === 'kimi-coding' ? 'Kimi Coding Plan' : item.provider} · {item.model}</span></div><div className="role-tags">{item.roles.map((role) => <span className={item.primaryRoles?.includes(role) ? 'primary-role' : ''} key={role}>{role === 'summary' ? '摘要' : role === 'translation' ? '翻译' : '分析'}{item.primaryRoles?.includes(role) ? '主' : '备'}</span>)}</div><button title="将其负责的功能设为优先" onClick={async () => { await patch(`/api/models/${item.id}`, { priority: preferredPriority, enabled: true }); await reload(); notify(`${item.label} 已设为优先模型`); }}><ArrowUp size={16} /></button><button title={item.enabled ? '停用模型' : '启用模型'} onClick={async () => { await patch(`/api/models/${item.id}`, { enabled: !item.enabled }); await reload(); notify(`${item.label} 已${item.enabled ? '停用' : '启用'}`); }}>{item.enabled ? <Check size={16} /> : <Bot size={16} />}</button><button title="修改模型配置" onClick={() => editModel(item)}><Pencil size={16} /></button><button title="删除模型" onClick={async () => { await del(`/api/models/${item.id}`); reload(); }}><Trash2 size={16} /></button></div>)}{!models.length && <p className="inline-empty">添加模型后即可分别配置摘要、翻译与分析</p>}</div>
    </SettingsSection>
    <SettingsSection icon={Bell} title="简报与通知" subtitle={isLocalMode ? '本机生成简报，打开时检查监控' : '后台生成简报，网页版安静呈现'}>{isLocalMode ? <p className="inline-empty">数据完全留在手机。Android 为省电可能暂停熄屏网络任务，因此请打开 App 或下拉刷新获取最新资讯。</p> : <div className="setting-grid"><label>晨报时间<select value={preferences.morningBriefHour} onChange={(e) => updatePref({ morningBriefHour: Number(e.target.value) })}>{[6,7,8,9,10].map((h) => <option key={h} value={h}>{h}:00</option>)}</select></label><label>晚报时间<select value={preferences.eveningBriefHour} onChange={(e) => updatePref({ eveningBriefHour: Number(e.target.value) })}>{[18,19,20,21,22].map((h) => <option key={h} value={h}>{h}:00</option>)}</select></label></div>}</SettingsSection>
    <SettingsSection icon={Sun} title="外观与阅读" subtitle="液态玻璃只用于导航层，正文保持清晰"><div className="appearance-group"><span>主题</span><div className="segmented"><button className={preferences.theme === 'system' ? 'active' : ''} onClick={() => updatePref({ theme: 'system' })}>跟随系统</button><button className={preferences.theme === 'light' ? 'active' : ''} onClick={() => updatePref({ theme: 'light' })}>浅色</button><button className={preferences.theme === 'dark' ? 'active' : ''} onClick={() => updatePref({ theme: 'dark' })}>深色</button></div></div><div className="appearance-group"><span>信息密度</span><div className="segmented"><button className={preferences.density === 'compact' ? 'active' : ''} onClick={() => updatePref({ density: 'compact' })}>紧凑</button><button className={preferences.density === 'standard' ? 'active' : ''} onClick={() => updatePref({ density: 'standard' })}>标准</button><button className={preferences.density === 'comfortable' ? 'active' : ''} onClick={() => updatePref({ density: 'comfortable' })}>舒适</button></div></div><Toggle label="降低透明度" checked={preferences.reduceTransparency} onChange={(value) => updatePref({ reduceTransparency: value })} /><Toggle label="减少动态效果" checked={preferences.reduceMotion} onChange={(value) => updatePref({ reduceMotion: value })} /></SettingsSection>
    <SettingsSection icon={Database} title="系统状态" subtitle={isLocalMode ? '手机本地独立运行' : '可安装的单人 Web 应用'}><div className="system-status"><div><span className={cx('status-dot', !online && 'offline')} />{online ? (isLocalMode ? '本地数据库正常' : 'API 与数据库正常') : '当前离线，正在读取缓存'}</div><div><ShieldCheck size={16} />{isLocalMode ? 'API Key 由 Android Keystore 保护' : 'API Key 在服务端加密保存'}</div><div>{online ? <Wifi size={16} /> : <WifiOff size={16} />}离线时保留最近一次信息流</div></div>{!isLocalMode && <div className="system-actions"><Button icon={Download} onClick={onInstall}>{installAvailable ? '安装 Web App' : '查看安装方式'}</Button><Button className="danger" onClick={async () => { try { await post('/api/auth/logout'); } finally { setToken(null); location.reload(); } }}>退出并撤销所有会话</Button></div>}</SettingsSection>
  </section>;
}

function SettingsSection({ icon: Icon, title, subtitle, action, children }: { icon: typeof Rss; title: string; subtitle: string; action?: ReactNode; children: ReactNode }) { return <section className="settings-section"><header><div className="settings-icon"><Icon size={19} /></div><div><h2>{title}</h2><p>{subtitle}</p></div>{action && <div className="settings-action">{action}</div>}</header><div className="settings-content">{children}</div></section>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) { return <label className="toggle-row"><span>{label}</span><span className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span /></span></label>; }

function MiniReader({ article, onOpen }: { article?: Article; onOpen: () => void }) {
  if (!article) return null;
  const titles = articleTitles(article);
  return <button className="mini-reader glass" onClick={onOpen} aria-label={`继续阅读：${titles.zh}`}>{article.imageUrl ? <img src={article.imageUrl} alt="" referrerPolicy="no-referrer" /> : <span className="mini-reader-empty" aria-hidden="true"><Rss size={18} /></span>}<span><strong>{shorten(titles.zh, 31)}</strong>{titles.en && <em lang="en">{shorten(titles.en, 46)}</em>}<small>{article.sourceTitle} · 继续阅读</small><i><b /></i></span><span className="mini-reader-play"><Play size={17} fill="currentColor" /></span></button>;
}

function AIPanel({ open, article, onClose }: { open: boolean; article?: Article; onClose: () => void }) {
  const [question, setQuestion] = useState(''); const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]); const [loading, setLoading] = useState(false);
  const send = async (e: FormEvent) => { e.preventDefault(); if (!question.trim() || loading) return; const q = question; setQuestion(''); setMessages((m) => [...m, { role: 'user', text: q }]); setLoading(true); try { const result = await post<{ answer: string }>('/api/ai/chat', { question: q, articleId: article?.id }); setMessages((m) => [...m, { role: 'ai', text: result.answer }]); } catch (err) { setMessages((m) => [...m, { role: 'ai', text: err instanceof Error ? err.message : '暂时无法回答' }]); } finally { setLoading(false); } };
  return <aside className={cx('ai-panel glass', open && 'open')}><header><div><Sparkles size={19} /><div><strong>大爷 AI</strong><span>{article ? '正在阅读当前文章' : '正在检索全部资料库'}</span></div></div><button onClick={onClose}><X size={20} /></button></header><div className="ai-messages">{!messages.length && <div className="ai-welcome"><div className="orb"><Sparkles size={24} /></div><h3>想知道什么？</h3><p>我只根据你的订阅资料回答，并标出来源。没有证据时，我会明确告诉你。</p><button onClick={() => setQuestion(article ? '这篇文章最重要的结论和风险是什么？' : '过去 24 小时最值得关注的变化是什么？')}>{article ? '提炼结论与风险' : '总结今日重要变化'}</button><button onClick={() => setQuestion('有哪些来源存在明显分歧？')}>找出观点分歧</button></div>}{messages.map((m, i) => <div className={cx('message', m.role)} key={i}>{m.text}</div>)}{loading && <div className="message ai typing"><span /><span /><span /></div>}</div><form onSubmit={send}><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="向你的资料库提问…" rows={2} /><button type="submit" disabled={loading || !question.trim()}><Send size={18} /></button></form></aside>;
}

const defaultPrefs: Preferences = { density: 'standard', theme: previewTheme ?? 'system', reduceTransparency: false, reduceMotion: false, morningBriefHour: 8, eveningBriefHour: 20, briefsEnabled: true };

export default function App() {
  const [authenticated, setAuthenticated] = useState(hasToken()); const [tab, setTab] = useState<Tab>('today'); const [homePage, setHomePage] = useState<HomePage>({ kind: 'today' }); const [articles, setArticles] = useState<Article[]>(() => { try { return JSON.parse(localStorage.getItem('daye_articles') ?? '[]'); } catch { return []; } });
  const [sources, setSources] = useState<Source[]>([]); const [monitors, setMonitors] = useState<Monitor[]>([]); const [models, setModels] = useState<Model[]>([]); const [preferences, setPreferences] = useState(defaultPrefs); const [selected, setSelected] = useState<Article>(); const [synthesis, setSynthesis] = useState<SynthesisViewState>(); const [aiOpen, setAiOpen] = useState(false); const [aiArticle, setAiArticle] = useState<Article>(); const [refreshing, setRefreshing] = useState(false); const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>(); const [aiStatus, setAIStatus] = useState<AIModelStatus>(); const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentStatus>(); const [summarizing, setSummarizing] = useState(false); const [translating, setTranslating] = useState(false); const [extracting, setExtracting] = useState(false); const [toast, setToast] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine); const [installPrompt, setInstallPrompt] = useState<WebInstallPrompt>();
  const notify = (message: string) => {
    setToast(message); setTimeout(() => setToast(''), 3200);
    if (window.parent !== window) window.parent.postMessage({ source: 'daye-app', type: 'toast', message }, location.origin);
  };
  const reload = useCallback(async () => {
    if (!hasToken()) return;
    try {
      const [articleData, sourceData, monitorData, modelData, prefs] = await Promise.all([get<{ items: Article[] }>('/api/articles?limit=200'), get<Source[]>('/api/sources'), get<Monitor[]>('/api/monitors'), get<Model[]>('/api/models'), get<Preferences>('/api/preferences')]);
      setArticles(articleData.items); localStorage.setItem('daye_articles', JSON.stringify(articleData.items)); setSources(sourceData); setMonitors(monitorData); setModels(modelData); setPreferences({ ...defaultPrefs, ...prefs, ...(previewTheme ? { theme: previewTheme } : {}) });
    } catch (e) { notify(e instanceof Error ? e.message : '数据加载失败'); }
  }, []);
  useEffect(() => { if (authenticated) reload(); const off = () => setAuthenticated(false); window.addEventListener('daye-unauthorized', off); return () => window.removeEventListener('daye-unauthorized', off); }, [authenticated, reload]);
  useEffect(() => {
    if (!authenticated || !isLocalMode) return;
    const last = Number(localStorage.getItem('daye_local_refresh_at') ?? 0);
    if (Date.now() - last < 15 * 60_000) return;
    localStorage.setItem('daye_local_refresh_at', String(Date.now()));
    void post('/api/sources/refresh').then(reload).catch(() => undefined);
  }, [authenticated, reload]);
  useEffect(() => {
    if (!authenticated || isLocalMode) return;
    let stopped = false; let timer = 0; let lastVersion = '';
    void post<EnrichmentStatus>('/api/articles/enrich', { limit: 24 }).catch(() => undefined);
    const poll = async () => {
      try {
        const status = await get<EnrichmentStatus>('/api/articles/enrich/status');
        if (!stopped) setEnrichmentStatus(status);
        const version = `${status.processed}:${status.failed}`;
        if (version !== lastVersion) { lastVersion = version; await reload(); }
        if (!stopped) timer = window.setTimeout(poll, status.running || status.queued ? 2500 : 15000);
      } catch { if (!stopped) timer = window.setTimeout(poll, 15000); }
    };
    void poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [authenticated, reload]);
  useEffect(() => {
    if (!authenticated) return; let stopped = false; let timer = 0;
    const poll = async () => { try { const status = await get<AIModelStatus>('/api/ai/status'); if (!stopped) setAIStatus(status); } catch { /* model status is non-blocking */ } finally { if (!stopped) timer = window.setTimeout(poll, 2000); } };
    void poll(); return () => { stopped = true; window.clearTimeout(timer); };
  }, [authenticated]);
  useEffect(() => {
    setSelected((current) => current ? articles.find((article) => article.id === current.id) ?? current : current);
  }, [articles]);
  useEffect(() => {
    document.documentElement.dataset.density = preferences.density;
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.style.colorScheme = preferences.theme === 'system' ? 'light dark' : preferences.theme;
    document.documentElement.classList.toggle('reduce-transparency', preferences.reduceTransparency);
    document.documentElement.classList.toggle('reduce-motion', preferences.reduceMotion);
    const colorPreference = matchMedia('(prefers-color-scheme: dark)');
    const applyResolvedTheme = () => {
      const dark = preferences.theme === 'dark' || (preferences.theme === 'system' && colorPreference.matches);
      document.documentElement.classList.toggle('theme-dark', dark);
      document.documentElement.classList.toggle('theme-light', !dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0f12' : '#f2f3f5');
    };
    applyResolvedTheme(); colorPreference.addEventListener('change', applyResolvedTheme);
    return () => colorPreference.removeEventListener('change', applyResolvedTheme);
  }, [preferences]);
  useEffect(() => {
    const handleOnline = () => setOnline(true); const handleOffline = () => setOnline(false);
    const handleInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as WebInstallPrompt); };
    window.addEventListener('online', handleOnline); window.addEventListener('offline', handleOffline); window.addEventListener('beforeinstallprompt', handleInstall);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); window.removeEventListener('beforeinstallprompt', handleInstall); };
  }, []);
  useEffect(() => {
    const closeTransientView = () => { setSelected(undefined); setSynthesis(undefined); setAiOpen(false); setAiArticle(undefined); };
    window.addEventListener('popstate', closeTransientView);
    return () => window.removeEventListener('popstate', closeTransientView);
  }, []);
  useEffect(() => {
    const receiveStudioCommand = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.data?.source !== 'daye-studio') return;
      if (event.data.type === 'navigate' && ['today', 'monitors', 'library', 'settings'].includes(event.data.tab)) {
        setTab(event.data.tab as Tab); setHomePage({ kind: 'today' }); setSelected(undefined); setSynthesis(undefined); setAiOpen(false); setAiArticle(undefined);
      }
      if (event.data.type === 'open-ai') setAiOpen(true);
      if (event.data.type === 'close-transient') { setSelected(undefined); setSynthesis(undefined); setAiOpen(false); setAiArticle(undefined); }
      if (event.data.type === 'reload-data') void reload();
      if (event.data.type === 'diagnostics' && window.parent !== window) {
        const rootStyle = getComputedStyle(document.documentElement);
        window.parent.postMessage({
          source: 'daye-app', type: 'diagnostics',
          viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
          safeArea: {
            top: rootStyle.getPropertyValue('--safe-top').trim() || '0px',
            right: rootStyle.getPropertyValue('--safe-right').trim() || '0px',
            bottom: rootStyle.getPropertyValue('--safe-bottom').trim() || '0px',
            left: rootStyle.getPropertyValue('--safe-left').trim() || '0px'
          },
          theme: document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light',
          userAgent: navigator.userAgent
        }, location.origin);
      }
    };
    window.addEventListener('message', receiveStudioCommand);
    return () => window.removeEventListener('message', receiveStudioCommand);
  }, [reload]);
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  const activeArticles = articles.length ? articles : editorialPreview ? previewArticles : articles;
  const navigateTab = (next: Tab) => runViewTransition(() => { setTab(next); setHomePage({ kind: 'today' }); setSelected(undefined); setSynthesis(undefined); setAiOpen(false); setAiArticle(undefined); }, preferences.reduceMotion);
  const selectArticle = async (article: Article) => {
    const nextState = { ...(history.state ?? {}), dayeView: 'article', articleId: article.id };
    if (history.state?.dayeView === 'article') history.replaceState(nextState, '', location.href); else history.pushState(nextState, '', location.href);
    // Opening an article is an explicit retry. Hide any stale enrichment error
    // immediately while the server starts summary/translation work.
    const openingArticle = { ...article, enrichmentError: undefined };
    runViewTransition(() => { setSynthesis(undefined); setAiArticle(undefined); setSelected(openingArticle); setArticles((items) => items.map((item) => item.id === article.id ? openingArticle : item)); }, preferences.reduceMotion);
    if (article.id.startsWith('preview-')) {
      if (article.status === 'unread') {
        const updated = { ...article, status: 'read' as const };
        setArticles((items) => items.map((item) => item.id === article.id ? updated : item));
        setSelected(updated);
      }
      return;
    }
    void post<EnrichmentStatus>(`/api/articles/${article.id}/enrich`).then(() => { if (isLocalMode) return reload(); }).catch(() => undefined);
    if (article.status === 'unread') { try { const updated = await patch<Article>(`/api/articles/${article.id}`, { status: 'read' }); setArticles((items) => items.map((a) => a.id === article.id ? updated : a)); setSelected((current) => current?.id === article.id ? updated : current); } catch { /* reading stays available offline */ } }
  };
  const closeArticle = () => runViewTransition(() => { setSelected(undefined); if (history.state?.dayeView === 'article') history.back(); }, preferences.reduceMotion);
  const closeSynthesis = () => { if (history.state?.dayeView === 'synthesis') history.back(); else setSynthesis(undefined); };
  const openSynthesis = (items: Article[], headline: string) => {
    if (items.length < 2) { notify('至少需要两篇文章才能进行 AI 整合'); return; }
    const key = `${Date.now()}-${items.map((item) => item.id).join('-')}`;
    const nextState = { ...(history.state ?? {}), dayeView: 'synthesis' };
    if (history.state?.dayeView === 'synthesis') history.replaceState(nextState, '', location.href); else history.pushState(nextState, '', location.href);
    setSelected(undefined); setSynthesis({ key, articles: items, headline, loading: true });
    void post<SynthesisResult>('/api/ai/synthesis', { articleIds: items.map((item) => item.id) })
      .then((result) => setSynthesis((current) => current?.key === key ? { ...current, loading: false, result } : current))
      .catch((error) => setSynthesis((current) => current?.key === key ? { ...current, loading: false, error: error instanceof Error ? error.message : 'AI 整合失败' } : current));
  };
  const updateStatus = async (status: Article['status']) => { if (!selected) return; const wasSaved = selected.status === 'saved'; try { const optimistic = { ...selected, status }; setSelected(optimistic); setArticles((items) => items.map((a) => a.id === optimistic.id ? optimistic : a)); const updated = selected.id.startsWith('preview-') ? optimistic : await patch<Article>(`/api/articles/${selected.id}`, { status }); setSelected(updated); setArticles((items) => items.map((a) => a.id === updated.id ? updated : a)); notify(status === 'saved' ? '已收藏到资料库' : status === 'later' ? '已加入稍后读' : wasSaved ? '已取消收藏' : '阅读状态已更新'); } catch (error) { setSelected(selected); setArticles((items) => items.map((a) => a.id === selected.id ? selected : a)); notify(error instanceof Error ? error.message : '状态更新失败'); } };
  const quickSave = async (article: Article) => {
    const status = article.status === 'saved' ? 'read' : 'saved';
    try {
      const updated = article.id.startsWith('preview-') ? { ...article, status } : await patch<Article>(`/api/articles/${article.id}`, { status });
      setArticles((items) => items.map((item) => item.id === updated.id ? updated : item)); setSelected((current) => current?.id === updated.id ? updated : current); notify(status === 'saved' ? '已收藏到资料库' : '已取消收藏');
    } catch (error) { notify(error instanceof Error ? error.message : '收藏失败'); }
  };
  const refresh = async () => {
    if (refreshing) return; setRefreshing(true); setRefreshStatus({ kind:'loading', message:'正在连接订阅源并抓取最新内容…' });
    try {
      const result = await post<{ results: Array<{ ok?: boolean }> }>('/api/sources/refresh'); await reload();
      const checked = result.results.length; const failed = result.results.filter((item) => item.ok === false).length;
      const message = checked ? `刷新完成 · 已检查 ${checked} 个来源${failed ? `，${failed} 个失败` : ''}` : '没有需要刷新的订阅源';
      setRefreshStatus({ kind:'success', message }); notify(message); window.setTimeout(() => setRefreshStatus((current) => current?.kind === 'success' ? undefined : current), 4200);
    } catch (e) {
      const message = e instanceof Error ? e.message : '刷新失败'; setRefreshStatus({ kind:'error', message:`刷新失败 · ${message}` }); notify(message);
    } finally { setRefreshing(false); }
  };
  const summarize = async () => { if (!selected) return; setSummarizing(true); try { if (selected.contentHtml.length < 600) { try { await post(`/api/articles/${selected.id}/fulltext`); } catch { /* A feed excerpt may still support a summary. */ } } const result = await post<{ summary: string; titleZh: string; titleEn: string }>(`/api/articles/${selected.id}/summarize`); const updated = { ...selected, summaryZh: result.summary, titleZh: result.titleZh, titleEn: result.titleEn, enrichmentError: undefined }; setSelected(updated); setArticles((items) => items.map((a) => a.id === updated.id ? updated : a)); } catch (e) { notify(e instanceof Error ? e.message : '摘要生成失败'); await reload(); } finally { setSummarizing(false); } };
  const translate = async () => { if (!selected) return; if (selected.translationZh) { notify('全文双语翻译已完成'); return; } setTranslating(true); notify('正在提取并翻译全文…'); try { if (selected.contentHtml.length < 600) { try { await post(`/api/articles/${selected.id}/fulltext`); } catch { /* Translate the available feed content. */ } } const result = await post<{ translationZh: string }>(`/api/articles/${selected.id}/translate`); const updated = { ...selected, translationZh: result.translationZh, enrichmentError: undefined }; setSelected(updated); setArticles((items) => items.map((a) => a.id === updated.id ? updated : a)); notify('全文翻译完成，已切换为中英双语'); } catch (e) { notify(e instanceof Error ? e.message : '翻译失败'); await reload(); } finally { setTranslating(false); } };
  const extractFulltext = async () => { if (!selected) return; setExtracting(true); try { const updated = await post<Article>(`/api/articles/${selected.id}/fulltext`); setSelected(updated); setArticles((items) => items.map((a) => a.id === updated.id ? updated : a)); notify('已提取并保存网页正文'); } catch (e) { notify(e instanceof Error ? e.message : '正文提取失败'); } finally { setExtracting(false); } };
  const generateBrief = async () => { notify('正在生成简报…'); try { await post('/api/briefs/generate'); await reload(); notify('简报已生成并保存'); } catch (e) { notify(e instanceof Error ? e.message : '简报生成失败'); } };
  const installWebApp = async () => {
    if (!installPrompt) { notify('请使用浏览器菜单中的“安装应用”或“添加到主屏幕”'); return; }
    await installPrompt.prompt(); const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') { setInstallPrompt(undefined); notify('Web App 已安装'); }
  };
  return <div className="app-shell editorial-v2"><LiquidGlassRuntime /><Sidebar tab={tab} onTab={navigateTab} unread={activeArticles.filter((a) => a.status === 'unread').length} online={online} /><main className="main-pane">
    {tab === 'today' && homePage.kind === 'today' && <TodayView articles={activeArticles} sources={sources} selected={selected} onSelect={selectArticle} onQuickSave={(article) => void quickSave(article)} onSynthesis={openSynthesis} onRefresh={refresh} refreshing={refreshing} refreshStatus={refreshStatus} aiStatus={aiStatus} enrichmentStatus={enrichmentStatus} preferences={preferences} onDensity={(density) => { setPreferences((p) => ({ ...p, density })); void put('/api/preferences', { density }); }} onAI={(article) => { setAiArticle(article); setAiOpen(true); }} onBrief={generateBrief} onViewAllArticles={() => setHomePage({ kind: 'articles' })} onViewAllSources={() => setHomePage({ kind: 'sources' })} />}
    {tab === 'today' && homePage.kind === 'articles' && <AllArticlesView articles={activeArticles} source={homePage.source} selected={selected} onSelect={selectArticle} onBack={() => setHomePage(homePage.fromSources ? { kind: 'sources' } : { kind: 'today' })} />}
    {tab === 'today' && homePage.kind === 'sources' && <AllSourcesView sources={sources} articles={activeArticles} onBack={() => setHomePage({ kind: 'today' })} onSelect={(source) => setHomePage({ kind: 'articles', source, fromSources: true })} />}
    {tab === 'monitors' && <MonitorView monitors={monitors} reload={reload} onAI={() => setAiOpen(true)} />}
    {tab === 'library' && <LibraryView articles={articles} onSelect={selectArticle} onAI={() => setAiOpen(true)} />}
    {tab === 'settings' && <SettingsView sources={sources} models={models} preferences={preferences} aiStatus={aiStatus} reload={reload} onPreferences={setPreferences} onAI={() => setAiOpen(true)} notify={notify} online={online} installAvailable={Boolean(installPrompt)} onInstall={installWebApp} />}
  </main><div className={cx('detail-wrap', (selected || synthesis) && 'mobile-visible')}>{synthesis ? <SynthesisDetail view={synthesis} onClose={closeSynthesis} onOpenArticle={selectArticle} /> : <ArticleDetail article={selected} onClose={closeArticle} onStatus={updateStatus} onSummarize={summarize} summarizing={summarizing} onTranslate={translate} translating={translating} onFulltext={extractFulltext} extracting={extracting} onAI={() => { setAiArticle(selected); setAiOpen(true); }} aiActive={Boolean(aiOpen && (!aiArticle || aiArticle.id === selected?.id))} />}</div>{tab === 'today' && homePage.kind === 'today' && !selected && !synthesis && <MiniReader article={activeArticles[0]} onOpen={() => activeArticles[0] && void selectArticle(activeArticles[0])} />}{!selected && !synthesis && <MobileNav tab={tab} onTab={navigateTab} />}{tab !== 'today' && !selected && !synthesis && <button className="mobile-ai glass" onClick={() => { setAiArticle(undefined); setAiOpen(true); }}><Sparkles size={20} /></button>}<AIPanel open={aiOpen} article={aiArticle ?? selected} onClose={() => { setAiOpen(false); setAiArticle(undefined); }} />{aiOpen && <div className="scrim" onClick={() => { setAiOpen(false); setAiArticle(undefined); }} />}{toast && <div className="toast glass">{toast}</div>}</div>;
}
