import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MarkdownBody({ children }: { children: string }) {
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children: linkText, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener">{linkText}</a> }}>{children}</ReactMarkdown></div>;
}
