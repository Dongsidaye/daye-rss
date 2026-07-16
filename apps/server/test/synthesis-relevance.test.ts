import { describe, expect, it } from 'vitest';
import { relatedGroupCohesion, selectRelatedArticles, type SynthesisArticleLike } from '../src/synthesis-relevance.js';

function article(id: string, sourceTitle: string, title: string, summaryZh: string, topics = ['科技']): SynthesisArticleLike {
  return { id, sourceTitle, title, titleZh: title, excerpt: summaryZh, summaryZh, topics, importanceScore: 70, publishedAt: '2026-07-15T06:00:00.000Z' };
}

describe('cross-article synthesis relevance gate', () => {
  it('rejects the unrelated four-article set that previously appeared in the timeline', () => {
    const unrelated = [
      article('dependabot', "Simon Willison's Weblog", 'GitHub Dependabot 增加版本更新冷却期', 'Dependabot 默认等待新版本发布三天后再更新。', ['软件']),
      article('pedalican', "Simon Willison's Weblog", 'Simon Willison 在 Codex Desktop 创作骑车鹈鹕', '使用 GPT 图像模型制作 Codex 宠物动画。', ['人工智能']),
      article('watch', 'The Verge', 'Nothing Watch 3 Pro 降至 69 美元', '智能手表促销，支持 OLED 与 GPS。', ['硬件']),
      article('windows', 'The Verge', 'Windows 11 可暂停更新 35 天', '微软调整系统补丁更新机制。', ['软件'])
    ];
    expect(selectRelatedArticles(unrelated)).toEqual([]);
    expect(relatedGroupCohesion(unrelated)).toBe(0);
  });

  it('selects multiple sources reporting the same Nvidia H20 event', () => {
    const related = [
      article('reuters', '路透社', '英伟达计划恢复向中国销售 H20 芯片', '监管批准后，Nvidia 将恢复 H20 对华销售。', ['芯片']),
      article('bloomberg', '彭博社', '美国批准 Nvidia H20 恢复对华出口', 'H20 芯片出口许可变化将恢复中国市场供应。', ['芯片']),
      article('ft', '金融时报', 'Nvidia H20 重返中国市场影响算力供应', '英伟达 H20 对华销售恢复，云厂商算力预期改变。', ['芯片'])
    ];
    expect(selectRelatedArticles(related).map((item) => item.id)).toEqual(['reuters', 'bloomberg', 'ft']);
    expect(relatedGroupCohesion(related)).toBeGreaterThan(0.6);
  });

  it('keeps an unrelated article out of an otherwise cohesive event group', () => {
    const articles = [
      article('h20-a', '路透社', '英伟达 H20 芯片恢复对华销售', 'Nvidia H20 获得出口许可。', ['芯片']),
      article('weather', '气象台', '华北地区迎来强降雨', '多个城市发布暴雨预警。', ['天气']),
      article('h20-b', '彭博社', 'Nvidia H20 对华出口获批', '英伟达 H20 将重新供应中国市场。', ['芯片'])
    ];
    expect(selectRelatedArticles(articles).map((item) => item.id)).toEqual(['h20-a', 'h20-b']);
  });

  it('does not treat an ambiguous shared word as the same event', () => {
    const articles = [
      article('cloud-code', '科技媒体', 'Grok uploads codebases to cloud storage', '代码仓库被上传到云存储。', ['安全']),
      article('cloud-star', '天文媒体', 'Hubble captures a crimson cloud around young stars', '哈勃拍摄恒星附近的红色星云。', ['天文'])
    ];
    expect(selectRelatedArticles(articles)).toEqual([]);
  });

  it('requires reports from at least two distinct sources', () => {
    const articles = [
      article('same-source-a', '同一媒体', 'Nvidia H20 exports to China resume', 'H20 对华出口恢复。', ['芯片']),
      article('same-source-b', '同一媒体', 'Nvidia H20 returns to the China market', 'H20 重返中国市场。', ['芯片'])
    ];
    expect(relatedGroupCohesion(articles)).toBe(0);
    expect(selectRelatedArticles(articles)).toEqual([]);
  });
});
