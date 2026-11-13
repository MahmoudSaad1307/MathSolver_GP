import katex from 'katex';
import * as React from 'react';
import { cn } from '@/lib/utils';

interface MathBlockProps {
  text: string;
  className?: string;
  disableCopy?: boolean;
  forceLtr?: boolean;
}

interface Token {
  kind: 'text' | 'inline' | 'display';
  value: string;
}

function tokenizeMath(input: string): Token[] {
  const tokens: Token[] = [];
  const regex = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let lastIndex = 0;

  for (const match of input.matchAll(regex)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      tokens.push({ kind: 'text', value: input.slice(lastIndex, idx) });
    }
    if (match[1] !== undefined) {
      tokens.push({ kind: 'display', value: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ kind: 'inline', value: match[2] });
    }
    lastIndex = idx + match[0].length;
  }

  if (lastIndex < input.length) {
    tokens.push({ kind: 'text', value: input.slice(lastIndex) });
  }
  return tokens;
}

function renderKatexHtml(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, {
    displayMode,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml',
  });
}

export const MathBlock: React.FC<MathBlockProps> = ({
  text,
  className,
  disableCopy = false,
  forceLtr = true,
}) => {
  const tokens = React.useMemo(() => tokenizeMath(text), [text]);

  return (
    <div
      dir={forceLtr ? 'ltr' : undefined}
      onCopy={disableCopy ? (e) => e.preventDefault() : undefined}
      className={cn(
        'overflow-x-auto leading-relaxed',
        forceLtr && 'math-ltr text-start',
        disableCopy && 'select-none',
        className,
      )}
    >
      {tokens.map((tok, idx) => {
        if (tok.kind === 'text') {
          return <span key={idx}>{tok.value}</span>;
        }
        const html = renderKatexHtml(tok.value, tok.kind === 'display');
        return (
          <span
            key={idx}
            dir="ltr"
            className={
              tok.kind === 'display' ? 'my-2 block overflow-x-auto' : 'inline-block align-baseline'
            }
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
};
