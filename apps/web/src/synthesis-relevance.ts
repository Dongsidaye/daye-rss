const englishStop = new Set([
  'about','after','again','against','also','and','are','been','before','being','but','can','could','from','have','into','just','more','most','new','news','not','now','only','other','over','said','says','than','that','the','their','them','then','there','these','they','this','those','through','under','using','very','was','were','what','when','where','which','while','will','with','would','your',
  'report','reports','reported','update','updates','latest','tech','technology','company','companies','product','products','service','services','feature','features','users'
]);
const cjkStop = new Set([
  '一个','以及','产品','使用','公司','内容','功能','可以','可能','市场','已经','平台','应用','影响','报道','支持','数据','文章','新款','新闻','更新','最新','服务','正在','科技','系统','计划','设备','资讯','通过','进行','问题','发布','未来','智能','模型','消息','用户','相关','表示','全球','完成','实现','开始','提升','降低','首次','目前','此次','成为','其中','工具','芯片'
]);

export interface SynthesisArticleLike {
  id: string;
  sourceTitle: string;
  title: string;
  titleZh?: string;
  titleEn?: string;
  summaryZh?: string;
  excerpt: string;
  topics: string[];
  importanceScore: number;
  clusterId?: string;
  publishedAt: string;
}

function englishTerms(text: string) {
  return [...text.toLowerCase().matchAll(/[a-z0-9][a-z0-9.+#-]{2,}/g)]
    .map((match) => match[0].replace(/^[+.-]+|[+.-]+$/g, ''))
    .filter((term) => term.length >= 3 && !englishStop.has(term));
}

function cjkTerms(text: string) {
  const terms: string[] = [];
  for (const match of text.matchAll(/[\u3400-\u9fff]{2,18}/g)) {
    const chunk = match[0];
    for (let size = 2; size <= Math.min(4, chunk.length); size += 1) {
      for (let index = 0; index <= chunk.length - size; index += 1) {
        const term = chunk.slice(index, index + size);
        if (![...cjkStop].some((stop) => term.includes(stop))) terms.push(term);
      }
    }
  }
  return terms;
}

function terms(text: string) {
  return new Set([...englishTerms(text), ...cjkTerms(text)]);
}

function intersectionSize(left: Set<string>, right: Set<string>) {
  let count = 0;
  left.forEach((term) => { if (right.has(term)) count += 1; });
  return count;
}

function articleTitleTerms(article: SynthesisArticleLike) {
  const titleText = [article.titleZh, article.titleEn, article.title].filter(Boolean).join(' ');
  return terms(titleText);
}

export function articleRelevance(left: SynthesisArticleLike, right: SynthesisArticleLike) {
  if (left.id === right.id) return 1;
  if (left.clusterId && right.clusterId && left.clusterId === right.clusterId) return 1;
  const sharedTitle = intersectionSize(articleTitleTerms(left), articleTitleTerms(right));
  let score = sharedTitle >= 3 ? 0.92
    : sharedTitle >= 2 ? 0.8
      : 0;
  const sharedTopics = left.topics.filter((topic) => topic !== '综合' && right.topics.includes(topic)).length;
  if (score > 0 && sharedTopics > 0) score = Math.min(1, score + 0.03);
  return score;
}

export function relatedGroupCohesion(articles: SynthesisArticleLike[]) {
  if (articles.length < 2 || new Set(articles.map((article) => article.sourceTitle)).size < 2) return 0;
  const timestamps = articles.map((article) => Date.parse(article.publishedAt)).filter(Number.isFinite);
  if (timestamps.length === articles.length && Math.max(...timestamps) - Math.min(...timestamps) > 7 * 24 * 60 * 60_000) return 0;
  const scores: number[] = [];
  for (let left = 0; left < articles.length; left += 1) {
    for (let right = left + 1; right < articles.length; right += 1) {
      const score = articleRelevance(articles[left], articles[right]);
      if (score < 0.62) return 0;
      scores.push(score);
    }
  }
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

export function selectRelatedArticles<T extends SynthesisArticleLike>(articles: T[], limit = 4): T[] {
  const candidates = articles.slice(0, 40);
  let best: { articles: T[]; score: number } | undefined;
  candidates.forEach((anchor) => {
    const ranked = candidates.filter((candidate) => candidate.id !== anchor.id)
      .map((candidate) => ({ candidate, score: articleRelevance(anchor, candidate) }))
      .filter((item) => item.score >= 0.62)
      .sort((a, b) => b.score - a.score || b.candidate.importanceScore - a.candidate.importanceScore);
    const group: T[] = [anchor];
    ranked.forEach(({ candidate }) => {
      if (group.length >= limit) return;
      if (group.every((member) => articleRelevance(member, candidate) >= 0.62)) group.push(candidate);
    });
    const cohesion = relatedGroupCohesion(group);
    if (!cohesion) return;
    const sourceCount = new Set(group.map((article) => article.sourceTitle)).size;
    const importance = group.reduce((total, article) => total + article.importanceScore, 0) / group.length;
    const score = cohesion * 100 + sourceCount * 3 + group.length * 4 + importance / 20;
    if (!best || score > best.score) best = { articles: group, score };
  });
  if (!best) return [];
  const ids = new Set(best.articles.map((article) => article.id));
  return candidates.filter((article) => ids.has(article.id)).slice(0, limit);
}
