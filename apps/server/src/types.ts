export type Importance = 'critical' | 'high' | 'normal' | 'low';
export type ArticleStatus = 'unread' | 'read' | 'saved' | 'later';

export interface Source {
  id: string;
  title: string;
  url: string;
  siteUrl?: string;
  category: string;
  enabled: boolean;
  refreshMinutes: number;
  qualityScore: number;
  articleCount?: number;
  lastFetchedAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface Article {
  id: string;
  sourceId: string;
  sourceTitle: string;
  title: string;
  titleZh?: string;
  titleEn?: string;
  url: string;
  author?: string;
  publishedAt: string;
  excerpt: string;
  contentHtml: string;
  summaryZh?: string;
  translationZh?: string;
  imageUrl?: string;
  mediaUrl?: string;
  topics: string[];
  importance: Importance;
  importanceScore: number;
  importanceReason: string;
  clusterId?: string;
  status: ArticleStatus;
  createdAt: string;
  enrichmentAttemptedAt?: string;
  enrichmentError?: string;
  fulltextAttemptedAt?: string;
  fulltextError?: string;
  fulltextRetryCount?: number;
}

export interface Monitor {
  id: string;
  name: string;
  query: string;
  topics: string[];
  importance: Importance;
  notificationMode: 'instant' | 'brief' | 'silent';
  enabled: boolean;
  createdAt: string;
}

export interface ModelConfig {
  id: string;
  provider: 'kimi-coding' | 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'deepseek' | 'custom';
  label: string;
  model: string;
  baseUrl?: string;
  encryptedApiKey: string;
  roles: Array<'summary' | 'translation' | 'analysis'>;
  enabled: boolean;
  priority: number;
}
