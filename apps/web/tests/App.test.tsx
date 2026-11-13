import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MathBlock } from '../src/components/MathBlock';
import App from '../src/App';

describe('MathBlock', () => {
  it('renders KaTeX math inside an LTR container', () => {
    const { container } = render(<MathBlock text="Solve $x^2 + 1 = 0$" disableCopy />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveAttribute('dir', 'ltr');
    expect(root.className).toContain('select-none');
    expect(container.querySelector('.katex')).toBeInTheDocument();
  });
});

describe('App landing page', () => {
  it('renders Arabic RTL landing page by default', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'عدسة الرياضيات' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });
});
