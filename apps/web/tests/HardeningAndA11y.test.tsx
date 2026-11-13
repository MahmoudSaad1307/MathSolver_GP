import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StudentShell } from '../src/components/layouts/StudentShell';
import { TeacherShell } from '../src/components/layouts/TeacherShell';
import LandingPage from '../src/pages/LandingPage';

describe('Phase 8: Web Accessibility, RTL & Shell Landmarks', () => {
  it('renders StudentShell with skip link, header, main landmark, and aria-hidden decorative mark', () => {
    const { container } = render(
      <MemoryRouter>
        <StudentShell studentName="طالب 1">
          <h1>محتوى الطالب</h1>
        </StudentShell>
      </MemoryRouter>,
    );

    const skipLink = container.querySelector('a[href="#main-content"]');
    expect(skipLink).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    const decorativeLogo = container.querySelector('span[aria-hidden="true"]');
    expect(decorativeLogo).toHaveTextContent('∑');
  });

  it('renders TeacherShell with accessible navigation landmark and language toggle', () => {
    render(
      <MemoryRouter>
        <TeacherShell teacherName="أ. سارة">
          <div>لوحة المدرس</div>
        </TeacherShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Teacher navigation' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /التحليلات|Analytics/i })).toHaveAttribute(
      'href',
      '/teacher/analytics',
    );
    expect(screen.getByRole('link', { name: /الاستهلاك والتكلفة|AI Cost/i })).toHaveAttribute(
      'href',
      '/teacher/usage',
    );
  });

  it('renders LandingPage join and resume tabs with accessible form labels', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: /ابدأ الاختبار الآن/ })).toBeInTheDocument();
    const resumeTab = screen.getByRole('button', { name: /لدي كود استرجاع/ });
    expect(resumeTab).toBeInTheDocument();
    expect(screen.getByLabelText(/كود المجموعة/)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText(/الاسم/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /انضم للمجموعة/ })).toBeInTheDocument();

    fireEvent.click(resumeTab);
    expect(screen.getByLabelText(/كود الاسترجاع/)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('button', { name: /متابعة من حيث توقفت/ })).toBeInTheDocument();
  });
});
